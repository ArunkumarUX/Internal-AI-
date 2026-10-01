// Builds search passages for every document that doesn't have them yet.
//   POSTGRES_URL=... node --experimental-strip-types scripts/index-documents.mjs
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { chunk } = await import(path.join(root, "lib/chunk.ts"));
const schema = (process.env.PG_SCHEMA || "internal_ai").replace(/[^a-z0-9_]/gi, "");
const url = new URL(process.env.POSTGRES_URL);
url.search = "";
if (url.port === "6543") url.port = "5432";
const sql = postgres(url.toString(), { ssl: "require", max: 2, onnotice: () => {}, connection: { search_path: `${schema},public,extensions` } });

const docs = await sql`SELECT d.id, d.user_id, d.title, d.content FROM documents d
  WHERE NOT EXISTS (SELECT 1 FROM document_chunks c WHERE c.document_id = d.id)`;
let passages = 0;
for (const d of docs) {
  const pieces = chunk(`${d.title}\n\n${d.content}`);
  const rows = pieces.map((content, ord) => ({ document_id: d.id, user_id: d.user_id, ord, content }));
  for (let i = 0; i < rows.length; i += 200) await sql`INSERT INTO document_chunks ${sql(rows.slice(i, i + 200), "document_id", "user_id", "ord", "content")}`;
  passages += rows.length;
}
const [{ n }] = await sql`SELECT count(*)::int n FROM document_chunks`;
console.log(`Indexed ${docs.length} documents into ${passages} passages (total passages: ${n}).`);
await sql.end();
