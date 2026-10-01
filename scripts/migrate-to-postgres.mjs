// Copies the workspace database (the SQLite file in Vercel Blob) into Supabase
// Postgres. Safe to run more than once: existing rows are updated, nothing is
// duplicated, and nothing is ever deleted from either side.
//
//   BLOB_READ_WRITE_TOKEN=... POSTGRES_URL=... node --experimental-strip-types scripts/migrate-to-postgres.mjs [--from-file backup.sqlite] [--dry-run]
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import postgres from "postgres";
import { get } from "@vercel/blob";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const fromFile = args.includes("--from-file") ? args[args.indexOf("--from-file") + 1] : "";
const schema = (process.env.PG_SCHEMA || "internal_ai").replace(/[^a-z0-9_]/gi, "");

// Make sure the Postgres schema exists, using the app's own migrations.
process.env.PG_SCHEMA = schema;
const { ensureSchema } = await import(path.join(root, "lib/postgres.ts"));
await ensureSchema();

// 1. Read the SQLite database.
let bytes;
if (fromFile) bytes = readFileSync(fromFile);
else {
  const result = await get("internal-ai/workspace.sqlite", { access: "private", useCache: false });
  if (!result || result.statusCode !== 200) throw new Error("No workspace database found in Blob.");
  bytes = Buffer.from(await new Response(result.stream).arrayBuffer());
}
const SQL = await initSqlJs({ wasmBinary: readFileSync(path.join(root, "node_modules/sql.js/dist/sql-wasm.wasm")) });
const lite = new SQL.Database(bytes);
const rowsOf = (table) => {
  try {
    const res = lite.exec(`SELECT * FROM ${table}`)[0];
    if (!res) return [];
    return res.values.map((v) => Object.fromEntries(res.columns.map((c, i) => [c, v[i]])));
  } catch {
    return []; // table doesn't exist in this older database
  }
};

// 2. Copy each table. Primary keys decide what counts as "the same row".
const TABLES = {
  audit: ["id"],
  documents: ["id"],
  records: ["id"],
  connections: ["user_id", "provider"],
  members: ["id"],
  conversations: ["id"],
  conversation_members: ["conversation_id", "user_id"],
  messages: ["id"],
  login_codes: ["email"],
  auth_throttle: ["key"],
};

const url = new URL(process.env.POSTGRES_URL);
url.search = "";
if (url.port === "6543") url.port = "5432";
const pg = postgres(url.toString(), { ssl: "require", max: 2, onnotice: () => {}, connection: { search_path: `${schema},public,extensions` } });

const summary = [];
for (const [table, keys] of Object.entries(TABLES)) {
  const rows = rowsOf(table);
  if (!rows.length) {
    summary.push({ table, sqlite: 0, postgres: Number((await pg.unsafe(`SELECT count(*) n FROM ${table}`))[0].n) });
    continue;
  }
  // Only copy columns Postgres has (it may have generated ones like tsv).
  const pgColumns = new Set(
    (await pg`SELECT column_name FROM information_schema.columns WHERE table_schema = ${schema} AND table_name = ${table} AND is_generated = 'NEVER'`).map((r) => r.column_name),
  );
  const columns = Object.keys(rows[0]).filter((c) => pgColumns.has(c));
  const updates = columns.filter((c) => !keys.includes(c));
  if (!dryRun)
    for (let i = 0; i < rows.length; i += 200) {
      const batch = rows.slice(i, i + 200).map((r) => Object.fromEntries(columns.map((c) => [c, r[c] ?? null])));
      await pg`
        INSERT INTO ${pg(table)} ${pg(batch, ...columns)}
        ON CONFLICT (${pg(keys)}) DO ${updates.length ? pg`UPDATE SET ${pg.unsafe(updates.map((c) => `"${c}" = excluded."${c}"`).join(", "))}` : pg`NOTHING`}`;
    }
  const [{ n }] = await pg.unsafe(`SELECT count(*) n FROM ${table}`);
  summary.push({ table, sqlite: rows.length, postgres: Number(n) });
}
console.table(summary);
console.log(dryRun ? "Dry run: nothing was written." : `Copied into schema "${schema}". Document passages are built on first search.`);
await pg.end();
process.exit(0);
