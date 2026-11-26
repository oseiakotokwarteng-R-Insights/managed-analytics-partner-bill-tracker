import { test, before } from "node:test";
import { freshDb } from "./harness.mjs";
import { checks } from "./attacks.mjs";

let db;
before(async () => {
  db = await freshDb();
});

for (const check of checks) {
  test(`${check.id}: ${check.title}`, async () => {
    await check.run(db);
  });
}
