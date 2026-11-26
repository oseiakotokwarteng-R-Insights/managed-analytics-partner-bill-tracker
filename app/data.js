// The data layer. The screens never touch the database directly: they call run(), which
// acts as one specific person. The screens also never filter by organization themselves.
// They ask for everything and show what the database lets that person see.
//
// In this demo the database is a real Postgres engine (PGlite) running inside the page.
// On a real deployment this file would talk to Supabase instead, and the SQL files in
// ../db would run there. The screens wouldn't change.
import { PGlite } from "https://cdn.jsdelivr.net/npm/@electric-sql/pglite@0.6.0/dist/index.js";

let db = null;

export async function startDatabase(setStatus = () => {}) {
  setStatus("Loading the database engine (a few megabytes the first time)");
  db = new PGlite();
  await db.waitReady;
  setStatus("Setting up the tables and rules");
  const files = await (await fetch("sql/files.json")).json();
  for (const f of files) {
    const res = await fetch("sql/" + f);
    if (!res.ok) throw new Error("Couldn't load " + f);
    await db.exec(await res.text());
  }
  setStatus("");
}

const ROLLBACK = Symbol("rollback");

// Act as one person. uid is a person's id, or null for someone who isn't logged in.
// fn gets q: q(sql, params) returns rows, and q.try(sql, params) returns { rows } or { error }.
// With commit: false, everything is undone afterwards (used for the "try to break it" panel).
export async function run(uid, fn, { commit = true } = {}) {
  let result;
  try {
    await db.transaction(async (tx) => {
      if (uid) {
        await tx.query("select set_config('request.jwt.claims', $1, true)", [
          JSON.stringify({ sub: uid, role: "authenticated" }),
        ]);
      }
      await tx.exec(`set local role ${uid ? "authenticated" : "anon"}`);

      const q = async (sql, params) => (await tx.query(sql, params)).rows;
      q.try = async (sql, params) => {
        await tx.exec("savepoint attempt");
        try {
          const rows = (await tx.query(sql, params)).rows;
          await tx.exec("release savepoint attempt");
          return { rows };
        } catch (error) {
          await tx.exec("rollback to savepoint attempt");
          return { error };
        }
      };

      result = await fn(q);
      if (!commit) throw ROLLBACK;
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
  return result;
}

// The made up demo people. These are the same ids as db/04_local_users.sql.
export const PEOPLE = [
  { id: "a0000000-0000-4000-8000-000000000001", label: "Staff admin", group: "Staff" },
  { id: "a0000000-0000-4000-8000-000000000002", label: "Staff analyst", group: "Staff" },
  { id: "a0000000-0000-4000-8000-000000000003", label: "Riverbend editor", group: "Riverbend Tenants Union" },
  { id: "a0000000-0000-4000-8000-000000000004", label: "Riverbend viewer", group: "Riverbend Tenants Union" },
  { id: "a0000000-0000-4000-8000-000000000005", label: "Highland editor", group: "Highland Clean Energy Coalition" },
  { id: "a0000000-0000-4000-8000-000000000006", label: "Lakeside editor", group: "Lakeside Ratepayers Alliance" },
  { id: "a0000000-0000-4000-8000-000000000007", label: "Logged in, but not a member of anything", group: "Nobody" },
];

export const ORG_IDS = [
  "b0000000-0000-4000-8000-00000000000a",
  "b0000000-0000-4000-8000-00000000000b",
  "b0000000-0000-4000-8000-00000000000c",
];

export const personLabel = (id) => (PEOPLE.find((p) => p.id === id) || {}).label || "the database itself";
