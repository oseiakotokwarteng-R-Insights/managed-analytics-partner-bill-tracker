# Partner bill tracker: a demo of database level access control

This is a small web app where partner organizations track the bills they care about, and where the database itself makes sure each organization can only ever see its own work. I built it to show how I'd handle one of the hardest parts of a shared data tool: keeping different groups' information apart, even if someone tries on purpose.

Everything in it is made up except the bills, which are public facts. The organizations, the people and the notes are invented, and the email addresses all end in `.test`.

## Why I built it

A tool like this holds information that different groups must not see about each other. A tenants' union might write a candid note about a legislator, and another coalition shouldn't be able to read it. If the only thing keeping those notes apart is the web page hiding them, then anyone who skips the page can read everything.

So I put the rules in the database. The page asks for everything, and the database decides what each person gets back. That way a mistake in a screen can't leak data, and I can write tests that try to break the rules directly.

## What it does

There are four roles:

- **Staff admin** manages the bill catalog, the organizations and who belongs where. Can see every watchlist.
- **Staff analyst** can see every watchlist and the activity log, but can't change anything.
- **Partner editor** can see and change their own organization's watchlist and notes.
- **Partner viewer** can read their own organization's watchlist and notes, but not change them.

Two choices are on purpose. Staff can't read partners' notes at all, because a stronger privacy promise is easy to loosen later and hard to tighten once people have written things down. And staff can see a partner's watchlist but can't edit it, because the partner owns it.

Every change is recorded in an activity log by the database itself. The log shows what changed and who did it. It never contains the text of a note, so reading the log can't reveal one.

## Try it yourself

You'll need Node 22 or newer (I built it on Node 24), and Python 3 for the demo server in the last step. In the project folder:

```bash
npm install
```

To run the tests that try to break the rules:

```bash
npm test
```

To open the demo:

```bash
npm run serve
```

That just serves the `app` folder, so any other static file server works too. Then go to `http://localhost:8766`. The first time, the page downloads the database engine from a public file host. It's about 16 MB unpacked and a few megabytes over the wire, so you need an internet connection. After a few seconds, pick a person from the list at the top and look around. Then open the "Try to break it" tab. Each button runs one forbidden thing as the person you picked, using plain SQL sent straight to the database, and tells you whether it was blocked. Everything is undone afterwards, so you can't hurt anything. Switch people and run them again.

## What's in this folder

- `docs/01-design.md` is the plan I wrote before any code: roles, tables, who can do what, and the 15 attacks I planned to test.
- `docs/02-security-note.md` explains what the tests prove, what they don't, and what I'd check before using this for real.
- `db/` has the SQL: the tables, the access rules, the audit triggers and the made up data. `00_local_shim.sql` and `04_local_users.sql` are only for local testing.
- `tests/` has the tests that try to break it.
- `app/` is the web page. It's plain HTML, CSS and JavaScript with no build step. `app/sql/` is a copy of `db/`, and a test fails if the two drift apart.
- `scripts/` has two small helpers: one copies the SQL into the app, and one turns the bills from my first project into SQL.

## How the tests work

There are 30 tests, and they run on a real Postgres engine that lives inside Node, so nothing else needs to be installed.

- **16 attack tests** act as a specific person and try something they shouldn't. A test passes only when the database stops it. They cover reading another organization's watchlist or notes, writing into another organization, moving a row to another organization, promoting yourself, a viewer writing, staff reading notes, someone with no membership, someone not logged in, switching the rules off, rewriting the audit log, and counting through a summary view.
- **2 sanity tests** check that the things people are allowed to do still work, because a database that refuses everything would pass every attack.
- **11 weakening tests** break one rule on purpose, for example by making the watchlist readable by everyone or copying note text into the log, and confirm the right attack test fails. A test that never fails proves nothing, so these check the tests themselves.
- **1 test** makes sure the app's copy of the SQL matches the real files.

I also ran every screen in the demo as all seven people, and ran all nine attacks in the demo as each of them. None got through.

## What I haven't done, and what you shouldn't take from this

I'd rather say this up front.

- **It isn't running on a real server yet.** In this demo the database runs inside your browser, so it shows how the rules behave, not a deployed system. Someone with the page open could tamper with their own copy, but that only changes their own browser. The SQL is written to run on Supabase as it is, but I haven't run it there yet.
- **The login is a switcher.** Picking a person stands in for logging in. The tests prove the database's rules hold once it knows who someone is. They don't prove that a login system correctly checks who someone is. On a real deployment that is the hosting service's job.
- **The test engine is a bit more forgiving than a real server.** It runs as a superuser, so it can't prove that the "applies even to the table's owner" setting works. That setting is a second layer behind the main rules, not the main protection. I also turned it off for the memberships table on purpose, and the reason is written in the SQL.
- **Someone with full control of the database server could undo this,** including dropping the triggers that keep the log append only. That's true of any database. These rules protect against the people using the app.
- **Nothing stops the last staff admin from being removed.** I left that out to keep the rules readable. A real system should guard against it.
- **I haven't tested the demo with a screen reader or with a keyboard alone.** I used labeled controls and real headings, but that isn't the same as someone using assistive technology.
- **The demo needs a public file host to load.** If the host is down, the page says so and doesn't start.

`docs/02-security-note.md` goes into more detail on all of this.

## Data

The 26 bills come from the example bills in my first project, a redesign concept of a public data center policy tool. Their statuses were copied by hand from that tool on 25 Nov 2026 and haven't been checked against the original sources. Two of them, Texas SB 6 and Delaware HB 233, look inconsistent on the original, and I haven't resolved that. Everything else is invented.

## What I practiced

- turning a plain request ("each group only sees its own work") into rules a database can enforce,
- writing tests that try to break my own work, and checking that those tests can actually fail,
- being clear about what a demo proves and what it doesn't,
- documentation someone else could pick up.

Powered by [Managed Analytics](https://managedanalytics.co).
