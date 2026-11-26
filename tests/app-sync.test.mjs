// The web app loads its SQL from app/sql, a copy of db/. If someone edits a rule in db/
// and forgets to copy it, the demo would quietly run old rules. This test catches that.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dbDir = join(here, "..", "db");
const appDir = join(here, "..", "app", "sql");

test("the app's copy of the SQL matches db/ (run `npm run sync:app` if this fails)", () => {
  const files = readdirSync(dbDir).filter((f) => /^\d\d_.*\.sql$/.test(f)).sort();
  assert.deepEqual(JSON.parse(readFileSync(join(appDir, "files.json"), "utf8")), files);
  for (const f of files) {
    assert.equal(readFileSync(join(appDir, f), "utf8"), readFileSync(join(dbDir, f), "utf8"), `${f} is out of date`);
  }
});
