-- The access rules. This is the heart of the project.
--
-- Principles:
--   1. Nothing is allowed unless a rule says so (row level security on every table).
--   2. The database decides who you are, from its own memberships table.
--      It never trusts a role or organization sent by the app.
--   3. Helper functions run with a fixed search path and only the access they need.

-- ---------------------------------------------------------------------------
-- Who is asking?
-- These read the memberships table on the caller's behalf (security definer), so the
-- rules below can ask "what role am I?" without opening that table to everyone.
-- ---------------------------------------------------------------------------

create function private.my_role() returns public.app_role
language sql stable security definer set search_path = ''
as $$
  select m.role from public.memberships m where m.user_id = auth.uid()
$$;

create function private.my_org() returns uuid
language sql stable security definer set search_path = ''
as $$
  select m.org_id from public.memberships m where m.user_id = auth.uid()
$$;

create function private.is_staff() returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(private.my_role() in ('staff_admin', 'staff_analyst'), false)
$$;

-- ---------------------------------------------------------------------------
-- Start from nothing. Take back every default permission, then grant only what's needed.
-- (Supabase hands out broad defaults on new tables, so this step matters there.)
-- ---------------------------------------------------------------------------

revoke create on schema public from public;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema private from public;

grant usage on schema public to authenticated;
grant usage on schema private to authenticated;
grant execute on function private.my_role(), private.my_org(), private.is_staff() to authenticated;

-- Reading is open to signed in people, and the row rules below narrow it down.
grant select on public.bills, public.orgs, public.memberships,
                public.watchlist, public.notes, public.audit_log to authenticated;

-- Writing is granted on the tables people edit. The row rules decide who actually can.
-- The audit log gets no write grant at all: only the database's own triggers write to it.
grant insert, update, delete on public.bills, public.orgs, public.memberships,
                               public.watchlist, public.notes to authenticated;

-- ---------------------------------------------------------------------------
-- Row level security
-- FORCE makes the rules apply even to the table's owner. The memberships table is the
-- one exception: the helper functions above read it as the owner, and forcing the rules
-- there would make those functions ask themselves the question they are answering.
-- ---------------------------------------------------------------------------

alter table public.bills      enable row level security;
alter table public.bills      force  row level security;
alter table public.orgs       enable row level security;
alter table public.orgs       force  row level security;
alter table public.memberships enable row level security;
alter table public.watchlist  enable row level security;
alter table public.watchlist  force  row level security;
alter table public.notes      enable row level security;
alter table public.notes      force  row level security;
alter table public.audit_log  enable row level security;
alter table public.audit_log  force  row level security;

-- bills: anyone with a role can read. Only a staff admin can change the catalog.
create policy bills_read on public.bills for select to authenticated
  using (private.my_role() is not null);
create policy bills_write on public.bills for all to authenticated
  using (private.my_role() = 'staff_admin')
  with check (private.my_role() = 'staff_admin');

-- orgs: staff see all. Partners see only their own. Only a staff admin changes them.
create policy orgs_read on public.orgs for select to authenticated
  using (private.is_staff() or id = private.my_org());
create policy orgs_write on public.orgs for all to authenticated
  using (private.my_role() = 'staff_admin')
  with check (private.my_role() = 'staff_admin');

-- memberships: staff see all. Everyone else sees only their own row.
-- Only a staff admin can change who has which role, so nobody can promote themselves.
create policy memberships_read on public.memberships for select to authenticated
  using (private.is_staff() or user_id = auth.uid());
create policy memberships_write on public.memberships for all to authenticated
  using (private.my_role() = 'staff_admin')
  with check (private.my_role() = 'staff_admin');

-- watchlist: staff can read every organization's list. A partner reads only their own.
-- Only a partner editor can change their own organization's list.
create policy watchlist_read on public.watchlist for select to authenticated
  using (private.is_staff() or org_id = private.my_org());
create policy watchlist_insert on public.watchlist for insert to authenticated
  with check (
    private.my_role() = 'partner_editor'
    and org_id = private.my_org()
    and created_by = auth.uid()
  );
create policy watchlist_update on public.watchlist for update to authenticated
  using (private.my_role() = 'partner_editor' and org_id = private.my_org())
  with check (private.my_role() = 'partner_editor' and org_id = private.my_org());
create policy watchlist_delete on public.watchlist for delete to authenticated
  using (private.my_role() = 'partner_editor' and org_id = private.my_org());

-- notes: only the owning organization. Staff can't read them, on purpose.
create policy notes_read on public.notes for select to authenticated
  using (private.my_role() in ('partner_editor', 'partner_viewer') and org_id = private.my_org());
create policy notes_insert on public.notes for insert to authenticated
  with check (
    private.my_role() = 'partner_editor'
    and org_id = private.my_org()
    and author = auth.uid()
  );
create policy notes_update on public.notes for update to authenticated
  using (private.my_role() = 'partner_editor' and org_id = private.my_org())
  with check (private.my_role() = 'partner_editor' and org_id = private.my_org());
create policy notes_delete on public.notes for delete to authenticated
  using (private.my_role() = 'partner_editor' and org_id = private.my_org());

-- audit_log: staff can read everything. A partner editor reads their own organization's entries.
-- Nobody can write through these rules. The one insert rule is for the database's own role,
-- which is what the audit triggers run as.
create policy audit_read on public.audit_log for select to authenticated
  using (
    private.is_staff()
    or (private.my_role() = 'partner_editor' and org_id = private.my_org())
  );
create policy audit_insert_by_triggers on public.audit_log for insert to postgres
  with check (true);

-- ---------------------------------------------------------------------------
-- A summary view for staff. It runs with the caller's permissions, so a partner who
-- opens it only ever counts their own organization.
-- ---------------------------------------------------------------------------

create view public.watch_counts with (security_invoker = true) as
  select bill_id,
         count(*)                                   as orgs_watching,
         count(*) filter (where priority = 'high')  as high_priority
  from public.watchlist
  group by bill_id;

revoke all on public.watch_counts from anon, authenticated;
grant select on public.watch_counts to authenticated;
