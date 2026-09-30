import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import initSqlJs, { type Database as SqlDatabase, type SqlValue } from "sql.js";
import { BlobPreconditionFailedError, del, get, put } from "@vercel/blob";

const DB_BLOB = "internal-ai/workspace.sqlite";
const FILE_PREFIX = "internal-ai/files/";

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS audit (
    id text PRIMARY KEY NOT NULL,
    user_id text NOT NULL,
    event text NOT NULL,
    detail text NOT NULL,
    created_at text NOT NULL
  );
  CREATE INDEX IF NOT EXISTS audit_user_created ON audit (user_id, created_at);
  CREATE TABLE IF NOT EXISTS documents (
    id text PRIMARY KEY NOT NULL,
    user_id text NOT NULL,
    title text NOT NULL,
    content text NOT NULL,
    mime text NOT NULL,
    size integer NOT NULL,
    created_at text NOT NULL
  );
  CREATE INDEX IF NOT EXISTS documents_user ON documents (user_id);
  CREATE TABLE IF NOT EXISTS records (
    id text PRIMARY KEY NOT NULL,
    user_id text NOT NULL,
    kind text NOT NULL,
    data text NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL
  );
  CREATE INDEX IF NOT EXISTS records_user_kind ON records (user_id, kind);`,
  `ALTER TABLE documents ADD COLUMN client text DEFAULT '' NOT NULL;`,
  `ALTER TABLE documents ADD COLUMN category text DEFAULT '' NOT NULL;`,
  `ALTER TABLE documents ADD COLUMN doc_date text DEFAULT '' NOT NULL;`,
  `CREATE TABLE IF NOT EXISTS connections (
    user_id text NOT NULL,
    provider text NOT NULL,
    data text NOT NULL,
    updated_at text NOT NULL,
    PRIMARY KEY (user_id, provider)
  );`,
  `ALTER TABLE documents ADD COLUMN sha256 text DEFAULT '' NOT NULL;`,
  `CREATE INDEX IF NOT EXISTS documents_user_sha256 ON documents (user_id, sha256);`,
  `CREATE TABLE IF NOT EXISTS members (
    id text PRIMARY KEY NOT NULL,
    email text NOT NULL,
    name text NOT NULL,
    password_hash text NOT NULL,
    role text DEFAULT 'member' NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL
);
  CREATE UNIQUE INDEX IF NOT EXISTS members_email ON members (email);
  CREATE TABLE IF NOT EXISTS conversations (
    id text PRIMARY KEY NOT NULL,
    kind text NOT NULL,
    title text DEFAULT '' NOT NULL,
    dm_key text DEFAULT '' NOT NULL,
    created_by text NOT NULL,
    created_at text NOT NULL,
    updated_at text NOT NULL
);
  CREATE INDEX IF NOT EXISTS conversations_dm_key ON conversations (dm_key);
  CREATE TABLE IF NOT EXISTS conversation_members (
    conversation_id text NOT NULL,
    user_id text NOT NULL,
    last_read_at text DEFAULT '' NOT NULL,
    PRIMARY KEY(conversation_id, user_id)
);
  CREATE INDEX IF NOT EXISTS conversation_members_user ON conversation_members (user_id);
  CREATE TABLE IF NOT EXISTS messages (
    id text PRIMARY KEY NOT NULL,
    conversation_id text NOT NULL,
    user_id text NOT NULL,
    body text NOT NULL,
    created_at text NOT NULL
);
  CREATE INDEX IF NOT EXISTS messages_conversation_created ON messages (conversation_id, created_at);`,
  `CREATE TABLE IF NOT EXISTS login_codes (
    email text PRIMARY KEY NOT NULL,
    code_hash text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    expires_at text NOT NULL,
    sent_at text NOT NULL
);
  CREATE TABLE IF NOT EXISTS auth_throttle (
    key text PRIMARY KEY NOT NULL,
    window_start text NOT NULL,
    count integer DEFAULT 0 NOT NULL
);`,
];

let queue: Promise<unknown> = Promise.resolve();

function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function wasmBinary(): ArrayBuffer {
  const wasmPath = path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm");
  return asArrayBuffer(new Uint8Array(readFileSync(wasmPath)));
}

/*
 * The whole database lives in one Blob. Several server instances can hold a
 * copy, so each copy remembers the Blob's ETag: reads re-check it every
 * FRESH_MS, and writes only land if the ETag still matches (otherwise the
 * write is replayed on the newer copy). Without a Blob token the database is
 * in memory only.
 */
const FRESH_MS = 1500;
const WRITE_ATTEMPTS = 6;
let sqlModule: ReturnType<typeof initSqlJs> | null = null;
let current: SqlDatabase | null = null;
let etag = "";
let checkedAt = 0;

/** Development only: keep the database in a file so it survives server reloads. */
function localFile() {
  const file = process.env.LOCAL_DB_FILE?.trim();
  return file && process.env.NODE_ENV !== "production" ? path.resolve(file) : "";
}

async function sql() {
  if (!sqlModule) sqlModule = initSqlJs({ wasmBinary: wasmBinary() });
  return sqlModule;
}

function replace(next: SqlDatabase, nextEtag: string) {
  current?.close();
  current = next;
  etag = nextEtag;
  migrate(next);
}

/** Loads the Blob when it changed since our copy (a 304 costs no download). */
async function refresh(force = false): Promise<SqlDatabase> {
  const SQL = await sql();
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    const file = localFile();
    const stamp = file && existsSync(file) ? String(statSync(file).mtimeMs) : "";
    if (!current || stamp !== etag) replace(new SQL.Database(stamp ? readFileSync(file) : undefined), stamp);
    return current!;
  }
  if (current && !force && Date.now() - checkedAt < FRESH_MS) return current;
  const result = await get(DB_BLOB, {
    access: "private",
    useCache: false,
    ...(current && etag ? { ifNoneMatch: etag } : {}),
  });
  checkedAt = Date.now();
  if (!result) {
    // No Blob yet: start empty; the first write creates it.
    if (!current || etag) replace(new SQL.Database(), "");
  } else if (result.statusCode === 200) {
    const bytes = new Uint8Array(await new Response(result.stream).arrayBuffer());
    replace(new SQL.Database(bytes), result.blob.etag);
  }
  return current!;
}

function migrate(db: SqlDatabase) {
  for (const sql of MIGRATIONS) {
    try {
      db.run(sql);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/duplicate column|already exists/i.test(message)) throw error;
    }
  }
}

function conflict(error: unknown) {
  return error instanceof BlobPreconditionFailedError || (error instanceof Error && /already exists|precondition/i.test(error.message));
}

/** Applies a write to the latest copy and saves it only if nobody saved first. */
async function write<T>(apply: (db: SqlDatabase) => T): Promise<T> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    const db = await refresh();
    const result = apply(db);
    const file = localFile();
    if (file) {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, db.export());
      etag = String(statSync(file).mtimeMs);
    }
    return result;
  }
  for (let attempt = 1; ; attempt++) {
    const db = await refresh(true);
    const result = apply(db);
    try {
      const saved = await put(DB_BLOB, Buffer.from(db.export()), {
        access: "private",
        addRandomSuffix: false,
        contentType: "application/vnd.sqlite3",
        ...(etag ? { allowOverwrite: true, ifMatch: etag } : { allowOverwrite: false }),
      });
      etag = saved.etag;
      checkedAt = Date.now();
      return result;
    } catch (error) {
      // Our copy now holds an unsaved change: always reload before retrying.
      etag = "";
      current?.close();
      current = null;
      if (!conflict(error) || attempt >= WRITE_ATTEMPTS) throw error;
      await new Promise((r) => setTimeout(r, 40 * attempt + Math.random() * 60));
    }
  }
}

function bindValues(values: unknown[]): SqlValue[] {
  return values.map((value): SqlValue => {
    if (value === undefined || value === null) return null;
    if (typeof value === "number" || typeof value === "string") return value;
    if (typeof value === "bigint") return Number(value);
    if (value instanceof Uint8Array) return value;
    if (typeof value === "boolean") return value ? 1 : 0;
    return String(value);
  });
}

function statement(sql: string) {
  let bound: SqlValue[] = [];
  const self = {
    bind(...values: unknown[]) {
      bound = bindValues(values);
      return self;
    },
    async all<T = Record<string, unknown>>() {
      return exclusive(async () => {
        const db = await refresh();
        const stmt = db.prepare(sql);
        try {
          if (bound.length) stmt.bind(bound);
          const results: T[] = [];
          while (stmt.step()) results.push(stmt.getAsObject() as T);
          return { results, success: true };
        } finally {
          stmt.free();
        }
      });
    },
    async first<T = Record<string, unknown>>(colName?: string) {
      const { results } = await self.all<T>();
      const row = results[0];
      if (!row) return null;
      if (colName) return (row as Record<string, unknown>)[colName] as T;
      return row;
    },
    async run() {
      return exclusive(async () => {
        const changes = await write((db) => {
          db.run(sql, bound.length ? bound : undefined);
          return db.getRowsModified();
        });
        return { success: true, meta: { changes, duration: 0 } };
      });
    },
  };
  return self;
}

export function vercelD1() {
  return {
    prepare(sql: string) {
      return statement(sql);
    },
  };
}

async function toBytes(
  value: ArrayBuffer | ArrayBufferView | Blob | ReadableStream | string,
) {
  if (typeof value === "string") return Buffer.from(value);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  if (typeof Blob !== "undefined" && value instanceof Blob) {
    return Buffer.from(await value.arrayBuffer());
  }
  return Buffer.from(await new Response(value).arrayBuffer());
}

function filePath(key: string) {
  return `${FILE_PREFIX}${key}`;
}

async function readBlobBytes(pathname: string): Promise<Uint8Array | null> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  try {
    const result = await get(pathname, { access: "private", useCache: false });
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    return new Uint8Array(await new Response(result.stream).arrayBuffer());
  } catch {
    return null;
  }
}

export function vercelR2() {
  return {
    async put(
      key: string,
      value: ArrayBuffer | ArrayBufferView | Blob | ReadableStream | string,
      options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> },
    ) {
      const bytes = await toBytes(value);
      if (!process.env.BLOB_READ_WRITE_TOKEN) {
        throw new Error("Document storage is unavailable.");
      }
      await put(filePath(key), bytes, {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: options?.httpMetadata?.contentType || "application/octet-stream",
      });
      return { key };
    },
    async get(key: string) {
      const bytes = await readBlobBytes(filePath(key));
      if (!bytes) return null;
      const copy = bytes;
      return {
        body: new Blob([Buffer.from(copy)]).stream(),
        arrayBuffer: async () => asArrayBuffer(copy),
        text: async () => new TextDecoder().decode(copy),
      };
    },
    async delete(key: string) {
      if (!process.env.BLOB_READ_WRITE_TOKEN) return;
      await del(filePath(key)).catch(() => {});
    },
  };
}

export const vercelEnv = new Proxy(Object.create(null) as Record<string, unknown>, {
  get(_target, prop) {
    if (prop === "DB") return vercelD1();
    if (prop === "BUCKET") return vercelR2();
    if (typeof prop !== "string") return undefined;
    return process.env[prop];
  },
  has(_target, prop) {
    if (prop === "DB" || prop === "BUCKET") return true;
    return typeof prop === "string" && prop in process.env;
  },
});
