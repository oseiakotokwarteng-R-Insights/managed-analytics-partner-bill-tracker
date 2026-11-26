// Test helpers: build a fresh database from the SQL files, and act as a specific person.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const DB_DIR = join(here, "..", "db");

// The same ids as db/04_local_users.sql and db/06_demo_data.sql.
export const U = {
  admin: "a0000000-0000-4000-8000-000000000001",
  analyst: "a0000000-0000-4000-8000-000000000002",
  riverbendEditor: "a0000000-0000-4000-8000-000000000003",
  riverbendViewer: "a0000000-0000-4000-8000-000000000004",
  highlandEditor: "a0000000-0000-4000-8000-000000000005",
  lakesideEditor: "a0000000-0000-4000-8000-000000000006",
  nobody: "a0000000-0000-4000-8000-000000000007",
};
export const ORG = {
  riverbend: "b0000000-0000-4000-8000-00000000000a",
  highland: "b0000000-0000-4000-8000-00000000000b",
  lakeside: "b0000000-0000-4000-8000-00000000000c",
};

// Build a new in-memory database. "mutate" lets the mutation tests weaken one rule
// in one file, to prove the attack tests would notice.
export async function freshDb(mutate = (_file, sql) => sql) {
  const db = new PGlite();
  const files = readdirSync(DB_DIR).filter((f) => /^\d\d_.*\.sql$/.test(f)).sort();
  for (const f of files) {
    await db.exec(mutate(f, readFileSync(join(DB_DIR, f), "utf8")));
  }
  return db;
}

const ROLLBACK = Symbol("rollback");

// Act as one person for the length of a test, then undo everything.
//   uid = a person's id, or null for someone who isn't logged in.
// Inside fn you get q, a function that runs one SQL statement as that person.
//   await q("select ...")        returns rows, and throws if the database refuses
//   await q.try("insert ...")    returns { rows } or { error }, and carries on after a refusal
//   await q.sys("select ...")    runs as the database owner, to check what really happened
export async function as(db, uid, fn) {
  let result;
  try {
    await db.transaction(async (tx) => {
      const becomeUser = async () => {
        await tx.exec(`set local role ${uid ? "authenticated" : "anon"}`);
      };
      if (uid) {
        await tx.query("select set_config('request.jwt.claims', $1, true)", [
          JSON.stringify({ sub: uid, role: "authenticated" }),
        ]);
      }
      await becomeUser();

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
      q.sys = async (sql, params) => {
        await tx.exec("reset role");
        try {
          return (await tx.query(sql, params)).rows;
        } finally {
          await becomeUser();
        }
      };

      result = await fn(q);
      throw ROLLBACK; // always undo, so tests never affect each other
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
  return result;
}
