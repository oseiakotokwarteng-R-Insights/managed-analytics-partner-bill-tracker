-- Triggers that the app can't skip.
--   * Record every change in the audit log.
--   * Stop certain columns from ever changing after a row is created.
--   * Make the audit log append only.

-- ---------------------------------------------------------------------------
-- Audit: who did what, to which organization, and when.
-- Only a short list of safe fields is copied into the log for each table.
-- A note's text is never copied, so reading the log can't reveal a note.
-- ---------------------------------------------------------------------------

create function private.audit() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  r        record;
  allowed  text[];
  detail   jsonb;
  changed  jsonb;
  org      uuid;
  rid      text;
begin
  r := case when tg_op = 'DELETE' then old else new end;

  allowed := case tg_table_name
    when 'watchlist'   then array['bill_id', 'priority']
    when 'notes'       then array['bill_id']
    when 'memberships' then array['role', 'org_id']
    when 'bills'       then array['state', 'number', 'year', 'status']
    when 'orgs'        then array['name']
    else array[]::text[]
  end;

  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
    into detail
    from jsonb_each(to_jsonb(r)) e
   where e.key = any (allowed);

  -- On an update, list which columns changed by name only, never by value.
  if tg_op = 'UPDATE' then
    select coalesce(jsonb_agg(n.key order by n.key), '[]'::jsonb)
      into changed
      from jsonb_each(to_jsonb(new)) n
      join jsonb_each(to_jsonb(old)) o using (key)
     where n.value is distinct from o.value
       and n.key <> 'updated_at';
    detail := detail || jsonb_build_object('changed_columns', changed);
  end if;

  org := case tg_table_name
    when 'orgs' then (to_jsonb(r) ->> 'id')::uuid
    else (to_jsonb(r) ->> 'org_id')::uuid
  end;

  rid := coalesce(to_jsonb(r) ->> 'id', to_jsonb(r) ->> 'user_id');

  insert into public.audit_log (actor, actor_role, org_id, action, table_name, row_id, detail)
  values (auth.uid(), private.my_role(), org, tg_op, tg_table_name, rid, detail);

  return null;
end;
$$;

create trigger audit_orgs        after insert or update or delete on public.orgs
  for each row execute function private.audit();
create trigger audit_memberships after insert or update or delete on public.memberships
  for each row execute function private.audit();
create trigger audit_bills       after insert or update or delete on public.bills
  for each row execute function private.audit();
create trigger audit_watchlist   after insert or update or delete on public.watchlist
  for each row execute function private.audit();
create trigger audit_notes       after insert or update or delete on public.notes
  for each row execute function private.audit();

-- ---------------------------------------------------------------------------
-- The audit log can only be added to. Even the table's owner can't change or remove entries.
-- (Someone with full control of the database server could still drop these triggers.
-- That's a limit of any database, and the write-up says so.)
-- ---------------------------------------------------------------------------

create function private.audit_is_append_only() returns trigger
language plpgsql set search_path = ''
as $$
begin
  raise exception 'The audit log is append only.' using errcode = '42501';
end;
$$;

create trigger audit_no_change before update or delete on public.audit_log
  for each row execute function private.audit_is_append_only();
create trigger audit_no_truncate before truncate on public.audit_log
  for each statement execute function private.audit_is_append_only();

-- ---------------------------------------------------------------------------
-- Columns that must never change once a row exists. This is a second lock behind the
-- row rules: even if a rule were loosened by mistake, a row still can't be moved to
-- another organization or have its author rewritten.
-- ---------------------------------------------------------------------------

create function private.lock_columns() returns trigger
language plpgsql set search_path = ''
as $$
declare
  col text;
begin
  foreach col in array tg_argv loop
    if to_jsonb(new) -> col is distinct from to_jsonb(old) -> col then
      raise exception 'The column % cannot be changed after a row is created.', col
        using errcode = '42501';
    end if;
  end loop;
  return new;
end;
$$;

create trigger watchlist_locked before update on public.watchlist
  for each row execute function private.lock_columns('org_id', 'bill_id', 'created_by', 'created_at');
create trigger notes_locked before update on public.notes
  for each row execute function private.lock_columns('org_id', 'bill_id', 'author', 'created_at');

-- Keep a note's updated_at honest.
create function private.touch_updated_at() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger notes_touch before update on public.notes
  for each row execute function private.touch_updated_at();

-- Trigger functions don't need to be callable by anyone. Close the default open door.
revoke all on all functions in schema private from public;
grant execute on function private.my_role(), private.my_org(), private.is_staff() to authenticated;
