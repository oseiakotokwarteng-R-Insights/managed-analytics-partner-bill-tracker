-- Made up organizations, people and notes, so there is something to protect.
-- None of this is real. The organizations don't exist, and the notes are invented.
-- Each note starts with a tag like [RIVERBEND] so a test can spot a leak at a glance.

insert into public.orgs (id, name) values
  ('b0000000-0000-4000-8000-00000000000a', 'Riverbend Tenants Union'),
  ('b0000000-0000-4000-8000-00000000000b', 'Highland Clean Energy Coalition'),
  ('b0000000-0000-4000-8000-00000000000c', 'Lakeside Ratepayers Alliance');

-- The nobody@demo.test account has no membership on purpose: it should see nothing.
insert into public.memberships (user_id, org_id, role) values
  ('a0000000-0000-4000-8000-000000000001', null, 'staff_admin'),
  ('a0000000-0000-4000-8000-000000000002', null, 'staff_analyst'),
  ('a0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-00000000000a', 'partner_editor'),
  ('a0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-00000000000a', 'partner_viewer'),
  ('a0000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-00000000000b', 'partner_editor'),
  ('a0000000-0000-4000-8000-000000000006', 'b0000000-0000-4000-8000-00000000000c', 'partner_editor');

-- Watchlists. Bill VA SB 552 is watched by two organizations on purpose, to test that
-- counts never leak across them.
insert into public.watchlist (org_id, bill_id, priority, created_by)
select o.org_id, b.id, o.priority, o.created_by
from (values
  ('b0000000-0000-4000-8000-00000000000a'::uuid, 'VA', 'SB 552',  2026, 'high',   'a0000000-0000-4000-8000-000000000003'::uuid),
  ('b0000000-0000-4000-8000-00000000000a'::uuid, 'PA', 'HB 2516', 2025, 'medium', 'a0000000-0000-4000-8000-000000000003'::uuid),
  ('b0000000-0000-4000-8000-00000000000a'::uuid, 'SC', 'S 902',   2025, 'low',    'a0000000-0000-4000-8000-000000000003'::uuid),
  ('b0000000-0000-4000-8000-00000000000b'::uuid, 'VA', 'SB 552',  2026, 'medium', 'a0000000-0000-4000-8000-000000000005'::uuid),
  ('b0000000-0000-4000-8000-00000000000b'::uuid, 'IL', 'HB 5607', 2025, 'high',   'a0000000-0000-4000-8000-000000000005'::uuid),
  ('b0000000-0000-4000-8000-00000000000b'::uuid, 'MD', 'HB 1532', 2026, 'high',   'a0000000-0000-4000-8000-000000000005'::uuid),
  ('b0000000-0000-4000-8000-00000000000c'::uuid, 'NJ', 'A 796',   2026, 'high',   'a0000000-0000-4000-8000-000000000006'::uuid),
  ('b0000000-0000-4000-8000-00000000000c'::uuid, 'ID', 'HB 911',  2026, 'medium', 'a0000000-0000-4000-8000-000000000006'::uuid),
  ('b0000000-0000-4000-8000-00000000000c'::uuid, 'AL', 'SB 270',  2026, 'low',    'a0000000-0000-4000-8000-000000000006'::uuid)
) as o(org_id, state, number, year, priority, created_by)
join public.bills b on b.state = o.state and b.number = o.number and b.year = o.year;

insert into public.notes (org_id, bill_id, body, author)
select n.org_id, b.id, n.body, n.author
from (values
  ('b0000000-0000-4000-8000-00000000000a'::uuid, 'VA', 'SB 552', 2026, '[RIVERBEND] Ask members to testify at the second hearing. Keep this quiet until the committee agenda is posted.', 'a0000000-0000-4000-8000-000000000003'::uuid),
  ('b0000000-0000-4000-8000-00000000000a'::uuid, 'PA', 'HB 2516', 2025, '[RIVERBEND] Setback distance matters most to our block captains.', 'a0000000-0000-4000-8000-000000000003'::uuid),
  ('b0000000-0000-4000-8000-00000000000b'::uuid, 'IL', 'HB 5607', 2025, '[HIGHLAND] Our fallback position if the credit rule stays as written.', 'a0000000-0000-4000-8000-000000000005'::uuid),
  ('b0000000-0000-4000-8000-00000000000c'::uuid, 'NJ', 'A 796', 2026, '[LAKESIDE] Compare the 85 percent commitment with what our utility offers.', 'a0000000-0000-4000-8000-000000000006'::uuid)
) as n(org_id, state, number, year, body, author)
join public.bills b on b.state = n.state and b.number = n.number and b.year = n.year;
