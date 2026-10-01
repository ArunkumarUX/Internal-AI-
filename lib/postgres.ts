import postgres from "postgres";

/*
 * Supabase Postgres behind the same small D1-style interface the app already
 * uses (prepare → bind → all / first / run, plus batch). Queries stay written
 * once, in SQL that SQLite (the ChatGPT Sites build) also understands; the few
 * SQLite-only bits are translated here.
 *
 * Tables live in a private schema (PG_SCHEMA, default "internal_ai") that
 * Supabase's public REST API doesn't expose, with row-level security on as a
 * second lock. Connects through Supabase's session pooler (POSTGRES_URL).
 */

export const pgConfigured = () => !!process.env.POSTGRES_URL?.trim();
const SCHEMA = () => (process.env.PG_SCHEMA?.trim() || "internal_ai").replace(/[^a-z0-9_]/gi, "");

type Sql = ReturnType<typeof postgres>;
let client: Sql | null = null;
let ready: Promise<void> | null = null;

function connect(): Sql {
  if (client) return client;
  const url = new URL(process.env.POSTGRES_URL!.trim());
  // postgres.js doesn't know Supabase's extra query flags.
  url.search = "";
  // Supabase's transaction pooler (6543) drops replies when postgres.js sends
  // several queries at once; its session pooler (5432) on the same host is
  // reliable and allows prepared statements, which are faster.
  if (url.port === "6543" && process.env.PG_TRANSACTION_POOLER !== "1") url.port = "5432";
  const session = url.port !== "6543";
  client = postgres(url.toString(), {
    ssl: "require",
    prepare: session,
    max: Number(process.env.PG_POOL_MAX || 3),
    idle_timeout: 20,
    connect_timeout: 15,
    connection: { search_path: `${SCHEMA()},public,extensions`, application_name: "internal-ai" },
    // counts and sizes arrive as bigint; the app expects plain numbers
    types: { bigint: { to: 20, from: [20], serialize: (v: number) => String(v), parse: (v: string) => Number(v) } },
    onnotice: () => {},
  });
  return client;
}

/* ---------------------------------------------------------------- */
/* SQLite → Postgres translation                                      */
/* ---------------------------------------------------------------- */

const cache = new Map<string, string>();

/** Rewrites the SQLite-only parts of a query; everything else is shared SQL. */
export function translate(sql: string) {
  const hit = cache.get(sql);
  if (hit) return hit;
  let out = sql
    .replace(/\bINSERT OR IGNORE INTO\b([\s\S]*)$/i, (_m, rest: string) => `INSERT INTO${rest} ON CONFLICT DO NOTHING`)
    .replace(/\b([A-Za-z_][\w.]*)\s+COLLATE NOCASE\b/gi, "lower($1)")
    // json_extract(...) = 1  →  compare as text, since it returns text here
    .replace(/(coalesce\(json_extract\([^()]*\)\s*,\s*)(\d+)(\)\s*=\s*)(\d+)/gi, "$1'$2'$3'$4'")
    .replace(/(json_extract\([^()]*\))\s*=\s*(\d+)\b/gi, "$1='$2'");
  // ?1 / ? placeholders → $1, $2 … (outside string literals)
  let n = 0;
  let quoted = false;
  let result = "";
  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    if (c === "'") quoted = !quoted;
    if (c === "?" && !quoted) {
      const digits = /^\d+/.exec(out.slice(i + 1))?.[0];
      if (digits) {
        result += `$${digits}`;
        i += digits.length;
      } else result += `$${++n}`;
      continue;
    }
    result += c;
  }
  out = result;
  cache.set(sql, out);
  return out;
}

/* ---------------------------------------------------------------- */
/* Schema                                                             */
/* ---------------------------------------------------------------- */

const MIGRATIONS = (schema: string) => [
  `CREATE SCHEMA IF NOT EXISTS ${schema}`,
  `CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions`,
  `CREATE TABLE IF NOT EXISTS ${schema}.audit (id text PRIMARY KEY, user_id text NOT NULL, event text NOT NULL, detail text NOT NULL, created_at text NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS audit_user_created ON ${schema}.audit (user_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS ${schema}.documents (
     id text PRIMARY KEY, user_id text NOT NULL, title text NOT NULL, content text NOT NULL, mime text NOT NULL,
     size integer NOT NULL, created_at text NOT NULL, client text NOT NULL DEFAULT '', category text NOT NULL DEFAULT '',
     doc_date text NOT NULL DEFAULT '', sha256 text NOT NULL DEFAULT '',
     tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(title,'') || ' ' || left(content, 250000))) STORED)`,
  `CREATE INDEX IF NOT EXISTS documents_user ON ${schema}.documents (user_id)`,
  `CREATE INDEX IF NOT EXISTS documents_user_sha256 ON ${schema}.documents (user_id, sha256)`,
  `CREATE INDEX IF NOT EXISTS documents_tsv ON ${schema}.documents USING gin (tsv)`,
  `CREATE TABLE IF NOT EXISTS ${schema}.records (id text PRIMARY KEY, user_id text NOT NULL, kind text NOT NULL, data text NOT NULL, created_at text NOT NULL, updated_at text NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS records_user_kind ON ${schema}.records (user_id, kind)`,
  `CREATE TABLE IF NOT EXISTS ${schema}.connections (user_id text NOT NULL, provider text NOT NULL, data text NOT NULL, updated_at text NOT NULL, PRIMARY KEY (user_id, provider))`,
  `CREATE TABLE IF NOT EXISTS ${schema}.members (id text PRIMARY KEY, email text NOT NULL UNIQUE, name text NOT NULL, password_hash text NOT NULL, role text NOT NULL DEFAULT 'member', created_at text NOT NULL, updated_at text NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS ${schema}.conversations (id text PRIMARY KEY, kind text NOT NULL, title text NOT NULL DEFAULT '', dm_key text NOT NULL DEFAULT '', created_by text NOT NULL, created_at text NOT NULL, updated_at text NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS conversations_dm_key ON ${schema}.conversations (dm_key)`,
  `CREATE TABLE IF NOT EXISTS ${schema}.conversation_members (conversation_id text NOT NULL, user_id text NOT NULL, last_read_at text NOT NULL DEFAULT '', PRIMARY KEY (conversation_id, user_id))`,
  `CREATE INDEX IF NOT EXISTS conversation_members_user ON ${schema}.conversation_members (user_id)`,
  `CREATE TABLE IF NOT EXISTS ${schema}.messages (id text PRIMARY KEY, conversation_id text NOT NULL, user_id text NOT NULL, body text NOT NULL, created_at text NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS messages_conversation_created ON ${schema}.messages (conversation_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS ${schema}.login_codes (email text PRIMARY KEY, code_hash text NOT NULL, attempts integer NOT NULL DEFAULT 0, expires_at text NOT NULL, sent_at text NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS ${schema}.auth_throttle (key text PRIMARY KEY, window_start text NOT NULL, count integer NOT NULL DEFAULT 0)`,
  // pgvector: document passages and their embeddings (filled when an embedding model is allowed)
  `CREATE TABLE IF NOT EXISTS ${schema}.document_chunks (
     id bigserial PRIMARY KEY, document_id text NOT NULL REFERENCES ${schema}.documents(id) ON DELETE CASCADE,
     user_id text NOT NULL, ord integer NOT NULL, content text NOT NULL, embedding extensions.vector(1024),
     tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED)`,
  `CREATE INDEX IF NOT EXISTS document_chunks_doc ON ${schema}.document_chunks (document_id)`,
  `CREATE INDEX IF NOT EXISTS document_chunks_user ON ${schema}.document_chunks (user_id)`,
  `CREATE INDEX IF NOT EXISTS document_chunks_tsv ON ${schema}.document_chunks USING gin (tsv)`,
  `CREATE INDEX IF NOT EXISTS document_chunks_embedding ON ${schema}.document_chunks USING hnsw (embedding extensions.vector_cosine_ops)`,
  // SQLite's JSON helpers, for the few queries that read inside a record's data
  `CREATE OR REPLACE FUNCTION ${schema}.json_path(path text) RETURNS text[] LANGUAGE sql IMMUTABLE AS
     $$ SELECT string_to_array(regexp_replace(path, '^\\$\\.?', ''), '.') $$`,
  `CREATE OR REPLACE FUNCTION ${schema}.json_extract(doc text, path text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
     SELECT CASE jsonb_typeof(doc::jsonb #> ${schema}.json_path(path))
       WHEN 'boolean' THEN CASE WHEN (doc::jsonb #>> ${schema}.json_path(path))::boolean THEN '1' ELSE '0' END
       WHEN 'null' THEN NULL
       ELSE doc::jsonb #>> ${schema}.json_path(path) END $$`,
  `CREATE OR REPLACE FUNCTION ${schema}.json_set(doc text, VARIADIC args text[]) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
     DECLARE result jsonb := coalesce(doc, '{}')::jsonb; i int := 1;
     BEGIN
       WHILE i < coalesce(array_length(args, 1), 0) LOOP
         result := jsonb_set(result, ${schema}.json_path(args[i]), coalesce(to_jsonb(args[i + 1]), 'null'::jsonb), true);
         i := i + 2;
       END LOOP;
       RETURN result::text;
     END $$`,
  // Row-level security as a second lock: no policies means no access through Supabase's APIs.
  ...[
    "audit", "documents", "records", "connections", "members", "conversations", "conversation_members",
    "messages", "login_codes", "auth_throttle", "document_chunks",
  ].map((t) => `ALTER TABLE ${schema}.${t} ENABLE ROW LEVEL SECURITY`),
  `REVOKE ALL ON SCHEMA ${schema} FROM anon, authenticated`,
];

/** Bump when MIGRATIONS change; instances skip the DDL when it's already applied. */
const SCHEMA_VERSION = 1;

/**
 * Makes sure the schema is current. A new instance only reads one row; the
 * DDL (which takes table locks) runs once per schema version, by one instance.
 */
export function ensureSchema() {
  if (!ready)
    ready = (async () => {
      const sql = connect();
      const schema = SCHEMA();
      const current = await sql
        .unsafe(`SELECT version FROM ${schema}.schema_version LIMIT 1`)
        .then((rows) => Number(rows[0]?.version ?? 0))
        .catch(() => 0);
      if (current >= SCHEMA_VERSION) return;
      await sql.begin(async (tx) => {
        // One instance migrates at a time; the others wait, then find it done.
        await tx.unsafe(`SELECT pg_advisory_xact_lock(hashtext('internal-ai-migrate:${schema}'))`);
        await tx.unsafe(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
        await tx.unsafe(`CREATE TABLE IF NOT EXISTS ${schema}.schema_version (version integer NOT NULL)`);
        const [row] = await tx.unsafe(`SELECT version FROM ${schema}.schema_version LIMIT 1`);
        if (Number(row?.version ?? 0) >= SCHEMA_VERSION) return;
        for (const statement of MIGRATIONS(schema)) await tx.unsafe(statement);
        await tx.unsafe(`ALTER TABLE ${schema}.schema_version ENABLE ROW LEVEL SECURITY`);
        await tx.unsafe(`DELETE FROM ${schema}.schema_version`);
        await tx.unsafe(`INSERT INTO ${schema}.schema_version (version) VALUES (${SCHEMA_VERSION})`);
      });
    })().catch((error) => {
      ready = null;
      throw error;
    });
  return ready;
}

/* ---------------------------------------------------------------- */
/* D1-style interface                                                 */
/* ---------------------------------------------------------------- */

type Value = string | number | null | boolean | Uint8Array;
const clean = (values: unknown[]): Value[] =>
  values.map((v) =>
    v === undefined || v === null
      ? null
      : typeof v === "bigint"
        ? Number(v)
        : v instanceof Uint8Array || typeof v === "string" || typeof v === "number" || typeof v === "boolean"
          ? v
          : String(v),
  );

type Runner = Pick<Sql, "unsafe">;

function statement(sqlText: string) {
  let bound: Value[] = [];
  const text = () => translate(sqlText);
  const self = {
    bind(...values: unknown[]) {
      bound = clean(values);
      return self;
    },
    async all<T = Record<string, unknown>>() {
      await ensureSchema();
      const rows = await connect().unsafe(text(), bound as never[]);
      return { results: [...rows] as unknown as T[], success: true };
    },
    async first<T = Record<string, unknown>>(colName?: string) {
      const { results } = await self.all<T>();
      const row = results[0];
      if (!row) return null;
      if (colName) return (row as Record<string, unknown>)[colName] as T;
      return row;
    },
    async run() {
      await ensureSchema();
      const result = await connect().unsafe(text(), bound as never[]);
      return { success: true, meta: { changes: result.count ?? 0, duration: 0 } };
    },
    /** Runs inside a batch's transaction. */
    async runWith(tx: Runner) {
      const result = await tx.unsafe(text(), bound as never[]);
      return result.count ?? 0;
    },
  };
  return self;
}

export function postgresD1() {
  return {
    prepare(sql: string) {
      return statement(sql);
    },
    /** Like D1's batch(): all statements commit together or not at all. */
    async batch(statements: ReturnType<typeof statement>[]) {
      await ensureSchema();
      const counts = await connect().begin(async (tx) => {
        const out: number[] = [];
        for (const s of statements) out.push(await s.runWith(tx));
        return out;
      });
      return counts.map((n) => ({ success: true, meta: { changes: n, duration: 0 } }));
    },
    /** Direct access for features that are Postgres-only (search, embeddings). */
    raw: () => connect(),
  };
}
