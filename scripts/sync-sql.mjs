// Copies the database files into app/sql so the web page can load them.
// Run it after changing anything in db/:   npm run sync:app
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const from = join(here, "..", "db");
const to = join(here, "..", "app", "sql");

rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });
const files = readdirSync(from).filter((f) => /^\d\d_.*\.sql$/.test(f)).sort();
for (const f of files) writeFileSync(join(to, f), readFileSync(join(from, f)));
writeFileSync(join(to, "files.json"), JSON.stringify(files, null, 2) + "\n");
console.log("Copied", files.length, "files to app/sql");
