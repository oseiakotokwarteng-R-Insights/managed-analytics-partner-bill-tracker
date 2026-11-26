-- Tables for the partner bill tracker.
-- Runs on Supabase as it is, and on the local test engine after 00_local_shim.sql.

create schema if not exists private;   -- helper functions live here, away from the public API

create type public.app_role as enum (
  'staff_admin', 'staff_analyst', 'partner_editor', 'partner_viewer'
);

-- Partner organizations. All made up in the demo.
create table public.orgs (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique check (char_length(name) between 2 and 80),
  created_at timestamptz not null default now()
);

-- Who is who. One row per person, so a person has one role and at most one organization.
-- Staff have no organization. Partners must have one.
create table public.memberships (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  org_id     uuid references public.orgs (id) on delete restrict,
  role       public.app_role not null,
  created_at timestamptz not null default now(),
  constraint staff_have_no_org
    check ((role in ('staff_admin', 'staff_analyst')) = (org_id is null))
);

-- The shared bill catalog. Public information.
create table public.bills (
  id      bigint generated always as identity primary key,
  state   char(2) not null,
  number  text not null,
  year    int not null check (year between 2000 and 2100),
  status  text not null check (status in ('Introduced', 'Engrossed', 'Passed', 'Failed')),
  summary text not null,
  topics  text[] not null default '{}',
  unique (state, number, year)
);

-- Which organization is watching which bill, and how much it matters to them.
create table public.watchlist (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.orgs (id) on delete cascade,
  bill_id    bigint not null references public.bills (id) on delete cascade,
  priority   text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  unique (org_id, bill_id)
);

-- An organization's private notes on a bill.
create table public.notes (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.orgs (id) on delete cascade,
  bill_id    bigint not null references public.bills (id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 4000),
  author     uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A record of every change. Written by the database, never by the app.
-- It holds what changed and who did it, but never the text of a note.
create table public.audit_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  actor      uuid,
  actor_role public.app_role,
  org_id     uuid,
  action     text not null,
  table_name text not null,
  row_id     text,
  detail     jsonb not null default '{}'
);

create index watchlist_org_idx on public.watchlist (org_id);
create index notes_org_bill_idx on public.notes (org_id, bill_id);
create index audit_org_idx on public.audit_log (org_id, at desc);
