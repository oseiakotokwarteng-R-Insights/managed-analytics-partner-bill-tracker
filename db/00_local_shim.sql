-- LOCAL TESTING ONLY. Do not run this on Supabase.
--
-- Supabase already provides everything in this file: the anon and authenticated roles,
-- the auth schema, the users table and auth.uid(). On a plain Postgres engine they don't
-- exist, so this file imitates the small part the rest of the SQL depends on.
--
-- The one piece that matters is auth.uid(). It reads the logged-in person's id from the
-- login token claims, the same way Supabase does. The rules never read anything else
-- about the person from the token.

create role anon nologin;
create role authenticated nologin;

create schema auth;
grant usage on schema auth to anon, authenticated;

create table auth.users (
  id    uuid primary key,
  email text unique
);

create function auth.uid() returns uuid
language sql stable as $$
  select nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
    ), ''
  )::uuid
$$;

grant execute on function auth.uid() to anon, authenticated;
