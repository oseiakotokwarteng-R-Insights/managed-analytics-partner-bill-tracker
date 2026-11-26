# Design: a bill tracker where every organization only sees its own work

This is the plan I'm building from. I wrote it before any code so I can say what the system should do, and then test that it does.

## What I'm building

A small web app where partner organizations track the bills that matter to them. Each organization keeps a watchlist of bills and writes private notes about them. A small staff team can see what every organization is watching, so they know where the interest is, but they can't read the partners' notes.

The point of the project is the access control. A tool like this holds information that different groups must not see about each other, so the hard part is making sure one organization can never reach another's data, even if someone tries on purpose.

Everything in it is made up except the bills. The organizations, people and notes are invented. The bills are public facts, the same 26 example bills from my first project.

## Who uses it

There are four roles. A person has exactly one role and belongs to at most one organization.

- **Staff admin.** Manages organizations and who belongs to them, and keeps the bill catalog up to date. Can see every watchlist.
- **Staff analyst.** Can see every watchlist and the activity log, to understand what partners care about. Can't change anything.
- **Partner editor.** Belongs to one partner organization. Can add and remove bills on that organization's watchlist and write its notes.
- **Partner viewer.** Belongs to one partner organization. Can read its watchlist and notes but not change them.

## What's stored

- **bills**: the shared catalog. State, bill number, year, status, a short summary and topic tags. Public information.
- **orgs**: the partner organizations.
- **memberships**: which person has which role, and in which organization. Staff have no organization.
- **watchlist**: which organization is watching which bill, and how important it is to them.
- **notes**: an organization's private notes on a bill.
- **audit_log**: a record of every change, with who made it and when.

## Who can do what

R means read, W means write. "Own org" means only the rows that belong to the person's own organization.

| | Staff admin | Staff analyst | Partner editor | Partner viewer |
|---|---|---|---|---|
| bills | R, W | R | R | R |
| orgs | R, W | R | R own org | R own org |
| memberships | R, W | R | R own row | R own row |
| watchlist | R | R | R, W own org | R own org |
| notes | none | none | R, W own org | R own org |
| audit_log | R | R | R own org | none |

Two choices in that table are worth explaining.

**Staff can't read notes.** A partner might write something candid about a legislator or a strategy. If staff could read it, partners would have to trust staff with everything. Keeping notes visible only to the owning organization is a stronger promise, and it's easy to loosen later if the real users want that. It's much harder to tighten after people have written things down.

**Staff can't edit a partner's watchlist.** The partner owns it. Staff can see it, which is enough to do their job.

## The rules the database enforces

I want the database itself to refuse bad requests, not only the app. If the screens have a bug, or someone sends requests by hand, the data should still be safe.

1. **Nothing is allowed unless a rule says so.** Row level security is switched on for every table, and forced even for the table's owner on every table except memberships. The helper functions read memberships as the owner to answer "who is this?", and forcing the rules there would make them ask themselves the question they're answering. A table with no rule lets nobody in.
2. **The database decides who you are.** It reads your identity from the login token and looks up your role and organization in the memberships table. It never trusts a role or organization sent by the app. (In Supabase, a user can edit their own profile metadata, so I won't use that for permissions.)
3. **Rows can't be moved or faked.** The organization on a row is checked on every insert and every update, so nobody can write into another organization or move their own row there.
4. **Only staff admins change who belongs where.** Nobody can promote themselves.
5. **The audit log is append-only.** Changes are recorded by the database, not the app, and nobody, including admins, can edit or delete an entry.
6. **The audit log never holds note text.** If it did, staff could read notes by reading the log. Entries for notes record that something changed, not what it said.
7. **Helper functions are locked down.** The few functions that look up roles run with a fixed search path, and nobody gets more access to them than they need.
8. **Views respect the rules.** Any view runs with the caller's permissions, so a view can't become a way around the rules.

## The attacks I'll try, and what should happen

Each of these becomes an automated test. A test passes when the attack fails.

1. A partner reads another organization's watchlist. They get no rows.
2. A partner reads another organization's notes. No rows.
3. A partner adds a watchlist row for another organization. Refused.
4. A partner edits or deletes another organization's row. Nothing changes.
5. A partner moves their own row to another organization. Refused.
6. A partner viewer tries to add, edit or delete anything. Refused.
7. A person changes their own role to staff admin. Refused.
8. A person moves themselves to another organization. Refused.
9. A staff analyst tries to change a bill, an organization or a membership. Refused.
10. A staff member reads notes. No rows.
11. A person with no membership at all reads anything. No rows.
12. Someone with no login reads anything. No rows.
13. A person tries to turn row level security off, or edit or delete an audit entry. Refused.
14. Every write by a legitimate user leaves an audit entry with the right person, organization and action, and no entry contains note text.
15. A partner counts rows or uses a view to learn something about another organization. The numbers only include their own.

Some things these tests can't prove. They check the database's rules. They don't prove that the login system correctly verifies a person's identity, which is the job of the hosting service. I'll say so in the write-up.

## How the pieces fit

- **The database.** Plain SQL files that create the tables, rules and audit triggers. I'll write them so they run on Supabase as they are. For local testing, a short extra file imitates the one Supabase piece the rules depend on, the function that returns who is logged in.
- **The tests.** Run on a real Postgres engine that lives inside Node, so anyone can run `npm test` with nothing else installed. Each test acts as a specific person and tries one thing.
- **The app.** A plain web page like my first project, with screens for the watchlist, the bill catalog, notes, activity, and a staff overview. It talks to the database through one small data layer, so the same screens can work against local Postgres in the browser while I build, and against Supabase when deployed. I'll settle exactly how when I get to that step.
- **Demo accounts.** A handful of made-up users, one per role, so a reviewer can switch between them and see the walls in action.

## Folder layout

- `docs/` has this design and, later, the security note.
- `db/` has the SQL files.
- `tests/` has the automated attack tests.
- `app/` has the web app.
- `README.md` at the top.

## What I'm leaving out on purpose

- Real people or real organizations. Everything is invented.
- Sending email, password resets, or billing.
- Several organizations per person. One is enough to show the idea, and it keeps the rules simple to read.
- Anything that makes the tool look like it belongs to a real organization.

## Done means

- All the attack tests pass, and a test I deliberately break (by weakening a rule) fails, so I know the tests actually catch things.
- The README says what is and isn't proven.
- A reviewer can open the demo, switch users, and see that one organization can't see another's data.
