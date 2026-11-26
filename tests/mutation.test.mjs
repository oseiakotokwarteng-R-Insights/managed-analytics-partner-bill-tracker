// Do the attack tests actually catch problems?
//
// A test that never fails proves nothing. Here I weaken one rule at a time, on purpose,
// build a database from the weakened SQL, run every attack, and confirm the attack that
// should notice really does fail. If a weakened rule slips through, that's a gap in the tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { freshDb } from "./harness.mjs";
import { checks } from "./attacks.mjs";

const mutations = [
  {
    name: "watchlist is readable by everyone",
    file: "02_security.sql",
    from: "create policy watchlist_read on public.watchlist for select to authenticated\n  using (private.is_staff() or org_id = private.my_org());",
    to: "create policy watchlist_read on public.watchlist for select to authenticated\n  using (true);",
    shouldFail: ["A01", "A07"],
  },
  {
    name: "notes are readable by staff",
    file: "02_security.sql",
    from: "using (private.my_role() in ('partner_editor', 'partner_viewer') and org_id = private.my_org());",
    to: "using (private.is_staff() or (private.my_role() in ('partner_editor', 'partner_viewer') and org_id = private.my_org()));",
    shouldFail: ["A10"],
  },
  {
    name: "anyone can edit memberships",
    file: "02_security.sql",
    from: "create policy memberships_write on public.memberships for all to authenticated\n  using (private.my_role() = 'staff_admin')\n  with check (private.my_role() = 'staff_admin');",
    to: "create policy memberships_write on public.memberships for all to authenticated\n  using (true)\n  with check (true);",
    shouldFail: ["A08"],
  },
  {
    name: "inserts don't check which organization the row belongs to",
    file: "02_security.sql",
    from: "    private.my_role() = 'partner_editor'\n    and org_id = private.my_org()\n    and created_by = auth.uid()\n  );",
    to: "    private.my_role() = 'partner_editor'\n  );",
    shouldFail: ["A04"],
  },
  {
    name: "a viewer is allowed to write",
    file: "02_security.sql",
    from: "create policy watchlist_delete on public.watchlist for delete to authenticated\n  using (private.my_role() = 'partner_editor' and org_id = private.my_org());",
    to: "create policy watchlist_delete on public.watchlist for delete to authenticated\n  using (org_id = private.my_org());",
    shouldFail: ["A07"],
  },
  {
    name: "the summary view runs with the owner's permissions",
    file: "02_security.sql",
    from: "create view public.watch_counts with (security_invoker = true) as",
    to: "create view public.watch_counts with (security_invoker = false) as",
    shouldFail: ["A16"],
  },
  {
    name: "note text is copied into the audit log",
    file: "03_audit_and_guards.sql",
    from: "when 'notes'       then array['bill_id']",
    to: "when 'notes'       then array['bill_id', 'body']",
    shouldFail: ["A14"],
  },
  {
    name: "people are allowed to write to the audit log",
    file: "02_security.sql",
    from: "grant insert, update, delete on public.bills, public.orgs, public.memberships,\n                               public.watchlist, public.notes to authenticated;",
    to: "grant insert, update, delete on public.bills, public.orgs, public.memberships,\n                               public.watchlist, public.notes, public.audit_log to authenticated;",
    shouldFail: ["A13"],
  },
  {
    name: "people who aren't logged in can read the bill catalog",
    file: "02_security.sql",
    from: "grant select on public.bills, public.orgs, public.memberships,\n                public.watchlist, public.notes, public.audit_log to authenticated;",
    to: "grant select on public.bills, public.orgs, public.memberships,\n                public.watchlist, public.notes, public.audit_log to authenticated, anon;",
    shouldFail: ["A12"],
  },
  {
    name: "the audit log stops recording",
    file: "03_audit_and_guards.sql",
    from: "create trigger audit_watchlist   after insert or update or delete on public.watchlist\n  for each row execute function private.audit();",
    to: "",
    shouldFail: ["A14"],
  },
  {
    name: "a person with no membership can read the bill catalog",
    file: "02_security.sql",
    from: "using (private.my_role() is not null);",
    to: "using (true);",
    shouldFail: ["A11"],
  },
];

for (const m of mutations) {
  test(`weakening the rules ("${m.name}") is caught by ${m.shouldFail.join(", ")}`, async () => {
    let changed = false;
    const db = await freshDb((file, sql) => {
      if (file !== m.file) return sql;
      assert.ok(sql.includes(m.from), `the text to weaken wasn't found in ${file}, so this test is out of date`);
      changed = true;
      return sql.replace(m.from, m.to);
    });
    assert.ok(changed);

    const failed = [];
    for (const c of checks) {
      try {
        await c.run(db);
      } catch {
        failed.push(c.id);
      }
    }
    for (const id of m.shouldFail) {
      assert.ok(failed.includes(id), `${id} should have failed, but only these did: ${failed.join(", ") || "none"}`);
    }
  });
}
