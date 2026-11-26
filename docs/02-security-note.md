# Security note

This is my honest account of what the access rules in this project protect, what the tests prove, and what they don't. I wrote it because "it has tests" can sound like more than it is.

## What I'm trying to protect

The main promise is simple: **one organization can never read or change another organization's work.** That means its watchlist and its private notes.

Three smaller promises sit under it:

1. Staff can see every watchlist but can never read a partner's notes.
2. Nobody can give themselves more access than they were given.
3. Every change is recorded, and the record can't be edited or deleted, and never contains what a note said.

## Who I'm worried about

- A partner who is curious or careless and tries to look at another organization's data.
- A partner who knows a little SQL and sends requests straight to the database, skipping the screens.
- A staff member who shouldn't be able to read notes, or a staff analyst who shouldn't be able to edit anything.
- A person who is logged in but doesn't belong to any organization.
- Someone who isn't logged in at all.

I'm not trying to defend against someone who already controls the database server or the hosting account. No rule in the database can stop them.

## How the rules work

Every table starts closed. A rule has to say "yes" for anything to happen, and a table with no rule lets nobody in. The rules live in `db/02_security.sql`.

The database works out who someone is by looking them up in its own memberships table, using the id from their login. It never believes a role or an organization sent from the web page. That matters because, on some hosting services, people can edit parts of their own profile, so a role stored there could be changed by the person it describes.

On top of the rules, there are a few locks that don't depend on them (`db/03_audit_and_guards.sql`):

- Once a row exists, its organization and its author can't be changed. If a rule were ever loosened by mistake, a row still couldn't be moved into someone else's organization.
- The activity log is written by triggers, not by the app, and it can only be added to.
- The log copies only a short list of safe fields from each table. For notes, that's which bill it's about and nothing else, so reading the log can't reveal what a note said.
- A summary view runs with the permissions of whoever asks, so it only counts what that person is allowed to see.

## What the tests prove

There are 16 attack tests. Each one acts as a particular person and tries something forbidden, and it passes only when the database stops it. The full list is in `tests/attacks.mjs`, and the README has a short version.

There are also 11 tests where I break one rule on purpose and check that the right attack test fails. They exist because a test that has never failed tells me nothing. Making the watchlist readable by everyone, letting staff read notes, copying note text into the log, and letting someone who isn't logged in read the bill catalog were all caught.

In the demo, I also ran all nine "try to break it" buttons as each of the seven demo people, and none got through.

## What the tests can't prove

I'd rather list these than leave them for someone to find.

- **They don't prove the login is secure.** The tests pretend to be a person by telling the database who they are. They can't show that a real login system checks identities properly. That is the job of the hosting service, and I'd have to test it separately on the real thing.
- **The test engine isn't a real server.** It runs inside Node, and it runs as a superuser. Superusers skip row level security by design, so I can't test that "apply the rules even to the table's owner" works. I turned that setting on for most tables as a second layer, and I turned it off for the memberships table, because the helper functions read that table as the owner to find out who is asking. Forcing the rules there would make those functions ask themselves the question they're answering. I wrote the reason in the SQL. I haven't been able to check how Supabase's own database roles behave around this setting, so I'd test it there.
- **I haven't run the SQL on Supabase.** I wrote it to run unchanged, with a small local-only file standing in for the parts Supabase already has. Until I've run it there and repeated the tests against it, "should work" is the most I can honestly say.
- **The demo runs the database in your browser.** That's fine for showing how the rules behave. But anyone can open their own copy and change it, so the demo is not evidence about a deployed system.
- **The last staff admin can be removed.** I left out a guard for that to keep the rules short. A real system needs one.
- **There's no protection against heavy use or guessing.** No limit on how many requests someone can send, and nothing watching for strange patterns. That belongs to the hosting layer.
- **The log can't stop someone with full control of the server.** They could drop the triggers that keep it append only. Nothing in a database can prevent that.
- **Small leaks I haven't looked for.** For example, whether an error message or the time a request takes could tell someone something about data they can't see. I tried to avoid it, but I haven't tested for it.

## What I'd check before using this for real

1. Run the SQL on a fresh Supabase project, create the demo accounts there, and run the attack tests against the real thing, signed in as real users.
2. Confirm that Supabase's default permissions on new tables really are taken back by `02_security.sql`, by looking at what each role can do afterwards.
3. Make sure the `private` schema, where the helper functions live, isn't exposed through the public API.
4. Make sure the "service" key, which skips all the rules, is never put in the web page. Only the public key belongs there.
5. Check that nothing in the app or the rules reads a role or an organization from a profile the user can edit.
6. Add a guard so the last staff admin can't be removed.
7. Look at how errors and slow responses behave, in case they reveal anything.
8. Test the screens with a screen reader and a keyboard alone.
9. Ask whoever will use it whether staff really shouldn't read notes. It's an easy rule to loosen and a hard one to tighten, which is why I started strict, but it's their decision.

## Short version

The rules are written in the database, they're tested by trying to break them, and the tests themselves are tested. What's left is the part I can't test from here: the real login, on a real server.
