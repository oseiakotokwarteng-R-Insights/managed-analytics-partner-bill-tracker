// The attacks. Each check tries something a person shouldn't be able to do,
// and passes only when the database stops it. They throw if it doesn't.
//
// They live in their own file so the mutation tests can run the same checks against
// a database with one rule deliberately weakened, and confirm the checks notice.
import assert from "node:assert/strict";
import { as, U, ORG } from "./harness.mjs";

const refused = (result, pattern, message) => {
  assert.ok(result.error, message || "expected the database to refuse this");
  assert.match(String(result.error.message), pattern, message);
};

const billId = async (q, state, number, year) =>
  (await q.sys("select id from public.bills where state=$1 and number=$2 and year=$3", [state, number, year]))[0].id;

const count = async (q, sql, params) => (await q(sql, params))[0].n;

export const checks = [
  // ------------------------------------------------------------------ reading
  {
    id: "A01",
    title: "A partner can't read another organization's watchlist",
    async run(db) {
      await as(db, U.riverbendEditor, async (q) => {
        const rows = await q("select org_id from public.watchlist");
        assert.equal(rows.length, 3, "should see exactly their own 3 rows");
        assert.ok(rows.every((r) => r.org_id === ORG.riverbend));
        const other = await q("select * from public.watchlist where org_id = $1", [ORG.highland]);
        assert.deepEqual(other, [], "asking for another organization by name still returns nothing");
      });
    },
  },
  {
    id: "A02",
    title: "A partner can't read another organization's notes",
    async run(db) {
      await as(db, U.riverbendEditor, async (q) => {
        const rows = await q("select org_id, body from public.notes");
        assert.equal(rows.length, 2);
        assert.ok(rows.every((r) => r.body.startsWith("[RIVERBEND]")));
        for (const org of [ORG.highland, ORG.lakeside]) {
          assert.deepEqual(await q("select * from public.notes where org_id = $1", [org]), []);
        }
      });
    },
  },
  {
    id: "A03",
    title: "A partner can't see other organizations or other people's roles",
    async run(db) {
      await as(db, U.riverbendEditor, async (q) => {
        const orgs = await q("select id from public.orgs");
        assert.deepEqual(orgs.map((o) => o.id), [ORG.riverbend]);
        const people = await q("select user_id from public.memberships");
        assert.deepEqual(people.map((p) => p.user_id), [U.riverbendEditor]);
      });
    },
  },

  // ------------------------------------------------------------------ writing
  {
    id: "A04",
    title: "A partner can't add to, or fake an author on, another organization's list",
    async run(db) {
      await as(db, U.riverbendEditor, async (q) => {
        const bill = await billId(q, "CO", "SB 102", 2026);
        refused(
          await q.try("insert into public.watchlist (org_id, bill_id, created_by) values ($1,$2,$3)", [ORG.highland, bill, U.riverbendEditor]),
          /row-level security/,
          "inserting into another organization"
        );
        refused(
          await q.try("insert into public.watchlist (org_id, bill_id, created_by) values ($1,$2,$3)", [ORG.riverbend, bill, U.highlandEditor]),
          /row-level security/,
          "claiming someone else wrote the row"
        );
        refused(
          await q.try("insert into public.notes (org_id, bill_id, body, author) values ($1,$2,'x',$3)", [ORG.highland, bill, U.riverbendEditor]),
          /row-level security/,
          "writing a note into another organization"
        );
      });
    },
  },
  {
    id: "A05",
    title: "A partner can't change or delete another organization's rows",
    async run(db) {
      await as(db, U.riverbendEditor, async (q) => {
        const before = await q.sys("select count(*)::int n from public.watchlist where org_id = $1", [ORG.highland]);
        const updated = await q("update public.watchlist set priority = 'low' where org_id = $1 returning id", [ORG.highland]);
        const deleted = await q("delete from public.watchlist where org_id = $1 returning id", [ORG.highland]);
        const noteEdit = await q("update public.notes set body = 'hacked' where org_id = $1 returning id", [ORG.highland]);
        const noteDel = await q("delete from public.notes where org_id = $1 returning id", [ORG.highland]);
        assert.deepEqual([updated, deleted, noteEdit, noteDel], [[], [], [], []]);
        const after = await q.sys("select count(*)::int n from public.watchlist where org_id = $1", [ORG.highland]);
        assert.deepEqual(after, before, "the other organization's rows are untouched");
        const hacked = await q.sys("select count(*)::int n from public.notes where body = 'hacked'");
        assert.equal(hacked[0].n, 0);
      });
    },
  },
  {
    id: "A06",
    title: "A partner can't move their own row into another organization",
    async run(db) {
      await as(db, U.riverbendEditor, async (q) => {
        refused(
          await q.try("update public.watchlist set org_id = $1 where org_id = $2", [ORG.highland, ORG.riverbend]),
          /cannot be changed|row-level security/,
          "moving a watchlist row"
        );
        refused(
          await q.try("update public.notes set org_id = $1 where org_id = $2", [ORG.highland, ORG.riverbend]),
          /cannot be changed|row-level security/,
          "moving a note"
        );
        refused(
          await q.try("update public.notes set author = $1 where org_id = $2", [U.highlandEditor, ORG.riverbend]),
          /cannot be changed|row-level security/,
          "rewriting who wrote a note"
        );
      });
    },
  },
  {
    id: "A07",
    title: "A viewer can read their organization's work but not change it",
    async run(db) {
      await as(db, U.riverbendViewer, async (q) => {
        assert.equal(await count(q, "select count(*)::int n from public.watchlist"), 3);
        assert.equal(await count(q, "select count(*)::int n from public.notes"), 2);
        const bill = await billId(q, "CO", "SB 102", 2026);
        refused(
          await q.try("insert into public.watchlist (org_id, bill_id, created_by) values ($1,$2,$3)", [ORG.riverbend, bill, U.riverbendViewer]),
          /row-level security/,
          "viewer adding to the watchlist"
        );
        refused(
          await q.try("insert into public.notes (org_id, bill_id, body, author) values ($1,$2,'x',$3)", [ORG.riverbend, bill, U.riverbendViewer]),
          /row-level security/,
          "viewer adding a note"
        );
        assert.deepEqual(await q("update public.watchlist set priority='low' returning id"), []);
        assert.deepEqual(await q("delete from public.watchlist returning id"), []);
        assert.deepEqual(await q("update public.notes set body='x' returning id"), []);
        assert.deepEqual(await q("delete from public.notes returning id"), []);
      });
    },
  },

  // ------------------------------------------------------------- privilege
  {
    id: "A08",
    title: "Nobody can promote themselves, change their organization, or add a member",
    async run(db) {
      await as(db, U.riverbendEditor, async (q) => {
        assert.deepEqual(
          await q("update public.memberships set role = 'staff_admin' where user_id = $1 returning user_id", [U.riverbendEditor]),
          [],
          "promoting themselves"
        );
        assert.deepEqual(
          await q("update public.memberships set org_id = $1 where user_id = $2 returning user_id", [ORG.highland, U.riverbendEditor]),
          [],
          "moving themselves to another organization"
        );
        assert.deepEqual(await q("delete from public.memberships where user_id = $1 returning user_id", [U.riverbendEditor]), []);
        refused(
          await q.try("insert into public.memberships (user_id, org_id, role) values ($1, null, 'staff_admin')", [U.nobody]),
          /row-level security/,
          "adding a new staff admin"
        );
        const still = await q.sys("select role, org_id from public.memberships where user_id = $1", [U.riverbendEditor]);
        assert.deepEqual(still, [{ role: "partner_editor", org_id: ORG.riverbend }]);
      });
    },
  },
  {
    id: "A09",
    title: "A staff analyst can look but not change anything",
    async run(db) {
      await as(db, U.analyst, async (q) => {
        assert.equal(await count(q, "select count(*)::int n from public.watchlist"), 9, "sees every organization's list");
        const bill = await billId(q, "CO", "SB 102", 2026);
        refused(
          await q.try("insert into public.bills (state, number, year, status, summary) values ('ZZ','X 1',2026,'Introduced','x')"),
          /row-level security/,
          "adding a bill"
        );
        refused(
          await q.try("insert into public.watchlist (org_id, bill_id, created_by) values ($1,$2,$3)", [ORG.riverbend, bill, U.analyst]),
          /row-level security/,
          "editing a partner's list"
        );
        assert.deepEqual(await q("update public.orgs set name = 'Renamed' returning id"), []);
        assert.deepEqual(await q("update public.memberships set role = 'staff_admin' returning user_id"), []);
        assert.deepEqual(await q("delete from public.bills returning id"), []);
      });
    },
  },
  {
    id: "A10",
    title: "Staff can't read partners' private notes",
    async run(db) {
      for (const person of [U.admin, U.analyst]) {
        await as(db, person, async (q) => {
          const real = await q.sys("select count(*)::int n from public.notes");
          assert.ok(real[0].n > 0, "there are notes to protect");
          assert.equal(await count(q, "select count(*)::int n from public.notes"), 0);
        });
      }
    },
  },

  // ---------------------------------------------------------- no identity
  {
    id: "A11",
    title: "A logged-in person with no membership sees nothing",
    async run(db) {
      await as(db, U.nobody, async (q) => {
        for (const t of ["bills", "orgs", "memberships", "watchlist", "notes", "audit_log"]) {
          assert.equal(await count(q, `select count(*)::int n from public.${t}`), 0, `${t} should be empty for them`);
        }
        const bill = 1;
        assert.ok(
          (await q.try("insert into public.watchlist (org_id, bill_id, created_by) values ($1,$2,$3)", [ORG.riverbend, bill, U.nobody])).error
        );
      });
    },
  },
  {
    id: "A12",
    title: "Someone who isn't logged in can't read anything",
    async run(db) {
      await as(db, null, async (q) => {
        for (const t of ["bills", "orgs", "memberships", "watchlist", "notes", "audit_log"]) {
          refused(await q.try(`select * from public.${t}`), /permission denied/, `anonymous reading ${t}`);
        }
        refused(await q.try("select * from public.watch_counts"), /permission denied/, "anonymous reading the view");
      });
    },
  },

  // ---------------------------------------------------------------- tampering
  {
    id: "A13",
    title: "Nobody can switch the rules off or rewrite the audit log",
    async run(db) {
      for (const person of [U.riverbendEditor, U.admin]) {
        await as(db, person, async (q) => {
          refused(await q.try("alter table public.watchlist disable row level security"), /must be owner|permission denied/);
          refused(await q.try("drop policy watchlist_read on public.watchlist"), /must be owner|permission denied/);
          refused(await q.try("update public.audit_log set action = 'x'"), /permission denied/, "editing the log");
          refused(await q.try("delete from public.audit_log"), /permission denied/, "deleting log entries");
          refused(await q.try("truncate public.audit_log"), /permission denied/, "truncating the log");
          refused(await q.try("insert into public.audit_log (action, table_name) values ('forged','x')"), /permission denied/, "forging an entry");
        });
      }
      // Even the database owner is stopped by the append only triggers.
      await assert.rejects(db.exec("update public.audit_log set action = 'x'"), /append only/);
      await assert.rejects(db.exec("delete from public.audit_log"), /append only/);
      await assert.rejects(db.exec("truncate public.audit_log"), /append only/);
    },
  },
  {
    id: "A14",
    title: "Every change is logged with who did it, and notes never appear in the log",
    async run(db) {
      await as(db, U.riverbendEditor, async (q) => {
        const bill = await billId(q, "CO", "SB 102", 2026);
        const w = await q(
          "insert into public.watchlist (org_id, bill_id, priority, created_by) values ($1,$2,'low',$3) returning id",
          [ORG.riverbend, bill, U.riverbendEditor]
        );
        await q("update public.watchlist set priority = 'high' where id = $1", [w[0].id]);
        const n = await q(
          "insert into public.notes (org_id, bill_id, body, author) values ($1,$2,'TOPSECRET-123',$3) returning id",
          [ORG.riverbend, bill, U.riverbendEditor]
        );
        await q("update public.notes set body = 'TOPSECRET-456' where id = $1", [n[0].id]);

        const log = await q.sys(
          "select action, table_name, org_id, actor_role, detail from public.audit_log where actor = $1 order by id",
          [U.riverbendEditor]
        );
        assert.deepEqual(
          log.map((r) => `${r.action} ${r.table_name}`),
          ["INSERT watchlist", "UPDATE watchlist", "INSERT notes", "UPDATE notes"]
        );
        assert.ok(log.every((r) => r.org_id === ORG.riverbend && r.actor_role === "partner_editor"));
        assert.deepEqual(log[1].detail.changed_columns, ["priority"]);
        assert.deepEqual(log[3].detail.changed_columns, ["body"], "records that the note changed, not what it says");
        assert.ok(!JSON.stringify(log).includes("TOPSECRET"), "no note text anywhere in the log");
      });
    },
  },
  {
    id: "A15",
    title: "Who can read the log: staff everything, editors their own organization, viewers nothing",
    async run(db) {
      await as(db, U.admin, async (q) => {
        assert.ok((await count(q, "select count(*)::int n from public.audit_log")) > 0);
      });
      await as(db, U.highlandEditor, async (q) => {
        const rows = await q("select org_id from public.audit_log");
        assert.ok(rows.length > 0, "an editor can read their own organization's entries");
        assert.ok(rows.every((r) => r.org_id === ORG.highland), "and nobody else's");
      });
      await as(db, U.riverbendViewer, async (q) => {
        assert.equal(await count(q, "select count(*)::int n from public.audit_log"), 0);
      });
    },
  },
  {
    id: "A16",
    title: "A summary view can't be used to learn about other organizations",
    async run(db) {
      let sharedBill;
      await as(db, U.admin, async (q) => {
        sharedBill = await billId(q, "VA", "SB 552", 2026);
        const row = (await q("select orgs_watching from public.watch_counts where bill_id = $1", [sharedBill]))[0];
        assert.equal(Number(row.orgs_watching), 2, "staff see that two organizations watch it");
      });
      await as(db, U.riverbendEditor, async (q) => {
        const row = (await q("select orgs_watching from public.watch_counts where bill_id = $1", [sharedBill]))[0];
        assert.equal(Number(row.orgs_watching), 1, "a partner only counts their own organization");
        const total = (await q("select sum(orgs_watching)::int n from public.watch_counts"))[0].n;
        assert.equal(total, 3);
      });
    },
  },

  // ------------------------------------------------------------ the good paths
  {
    id: "S01",
    title: "The things people are allowed to do still work",
    async run(db) {
      await as(db, U.riverbendEditor, async (q) => {
        const bill = await billId(q, "CO", "SB 102", 2026);
        const w = await q(
          "insert into public.watchlist (org_id, bill_id, created_by) values ($1,$2,$3) returning id",
          [ORG.riverbend, bill, U.riverbendEditor]
        );
        assert.equal(w.length, 1);
        const note = await q(
          "insert into public.notes (org_id, bill_id, body) values ($1,$2,'a plain note') returning id, author",
          [ORG.riverbend, bill]
        );
        assert.equal(note[0].author, U.riverbendEditor, "the author fills in from who is logged in");
        assert.equal((await q("update public.watchlist set priority='high' where id=$1 returning id", [w[0].id])).length, 1);
        assert.equal((await q("delete from public.notes where id=$1 returning id", [note[0].id])).length, 1);
      });
      await as(db, U.admin, async (q) => {
        const added = await q(
          "insert into public.bills (state, number, year, status, summary) values ('ZZ','X 1',2026,'Introduced','A test bill') returning id"
        );
        assert.equal(added.length, 1);
        assert.equal((await q("update public.orgs set name = 'Riverbend Tenants Union' where id = $1 returning id", [ORG.riverbend])).length, 1);
      });
    },
  },
  {
    id: "S02",
    title: "The demo data is what the other tests expect",
    async run(db) {
      await as(db, U.admin, async (q) => {
        const counts = await q.sys(
          `select (select count(*)::int from public.bills) bills, (select count(*)::int from public.orgs) orgs,
                  (select count(*)::int from public.memberships) members, (select count(*)::int from public.watchlist) watch,
                  (select count(*)::int from public.notes) notes`
        );
        assert.deepEqual(counts[0], { bills: 26, orgs: 3, members: 6, watch: 9, notes: 4 });
      });
    },
  },
];
