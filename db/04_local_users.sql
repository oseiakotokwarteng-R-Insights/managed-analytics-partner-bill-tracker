-- LOCAL TESTING ONLY. Do not run this on Supabase.
--
-- Demo people, as rows in the local copy of the auth users table.
-- On Supabase these accounts are created through the Auth settings, with these same ids.
-- Every address ends in .test, which can never be a real address.

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-000000000001', 'admin@demo.test'),
  ('a0000000-0000-4000-8000-000000000002', 'analyst@demo.test'),
  ('a0000000-0000-4000-8000-000000000003', 'riverbend.editor@demo.test'),
  ('a0000000-0000-4000-8000-000000000004', 'riverbend.viewer@demo.test'),
  ('a0000000-0000-4000-8000-000000000005', 'highland.editor@demo.test'),
  ('a0000000-0000-4000-8000-000000000006', 'lakeside.editor@demo.test'),
  ('a0000000-0000-4000-8000-000000000007', 'nobody@demo.test');
