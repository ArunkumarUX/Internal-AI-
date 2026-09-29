import { z } from "zod";
import {
  database,
  identity,
  log,
  saveRecord,
  failure,
  userHash,
  ApiError,
} from "@/lib/server";
import { env } from "cloudflare:workers";
import { readModelChoice } from "@/lib/models";
import { clients as sampleClients } from "@/lib/knowledge";

const PREVIEW = 2000;
const KINDS = [
  "saved",
  "conversation",
  "action",
  "memory",
  "dismissed",
  "settings",
  "mcp",
  "outcome",
  "client",
  "proposal",
] as const;
/** Kinds loaded in full on every workspace load. */
const UNCAPPED = "'settings','job','mcp','client','memory','action','dismissed','outcome','proposal'";
const DELETABLE = new Set([
  "client",
  "saved",
  "outcome",
  "dismissed",
  "conversation",
  "memory",
  "mcp",
  "proposal",
  "action",
]);
/** Seeded or fixed ids the client may use; they are hashed per user. */
const FIXED_ID = /^(act|fixed)-[A-Za-z0-9_-]{1,80}$/;
const SECRET_KEY = /token|secret|password|passwd|api[-_]?key|authorization|bearer|credential|cookie/i;
const SECRET_VALUE = /^\s*bearer\s+\S{8,}|^eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]*|\bsk-[A-Za-z0-9_-]{12,}/i;

export async function GET() {
  try {
    const user = await identity();
    const db = database();
    const [records, documents, audit, counts] = await Promise.all([
      db
        .prepare(
          `SELECT * FROM (SELECT * FROM records WHERE user_id=? AND kind IN (${UNCAPPED}) UNION ALL SELECT * FROM (SELECT * FROM records WHERE user_id=? AND kind IN ('conversation','saved') ORDER BY updated_at DESC LIMIT 400) UNION ALL SELECT * FROM (SELECT * FROM records WHERE user_id=? AND kind='job-run' ORDER BY updated_at DESC LIMIT 100)) ORDER BY updated_at DESC`,
        )
        .bind(user.userId, user.userId, user.userId)
        .all(),
      // Full text is fetched per document from /api/documents/[id].
      db
        .prepare(
          `SELECT id,user_id,title,mime,size,created_at,client,category,doc_date,substr(content,1,${PREVIEW}) AS content,length(content) AS textLength FROM documents WHERE user_id=? ORDER BY created_at DESC LIMIT 200`,
        )
        .bind(user.userId)
        .all(),
      db
        .prepare(
          "SELECT * FROM audit WHERE user_id=? ORDER BY created_at DESC LIMIT 100",
        )
        .bind(user.userId)
        .all(),
      db
        .prepare(
          "SELECT (SELECT COUNT(*) FROM documents WHERE user_id=?1) AS documents,(SELECT COUNT(*) FROM records WHERE user_id=?1 AND kind='conversation') AS conversations",
        )
        .bind(user.userId)
        .first(),
    ]);
    const choice = await readModelChoice(user.userId);
    return Response.json({
      user,
      records: records.results.flatMap((r) => {
        try {
          return [{ ...r, data: JSON.parse(String(r.data)) }];
        } catch {
          return [];
        }
      }),
      documents: documents.results.map((d) => ({
        ...d,
        textLength: Number(d.textLength ?? 0),
        truncated: Number(d.textLength ?? 0) > PREVIEW,
      })),
      documentTotal: Number(counts?.documents ?? 0),
      conversationTotal: Number(counts?.conversations ?? 0),
      audit: audit.results,
      aiConfigured: !!env.AI_GATEWAY_URL && !!env.AI_GATEWAY_KEY && !!choice.model,
      aiModel: choice.model,
      aiFastModel: choice.fast,
    });
  } catch (e) {
    return failure(e);
  }
}

type Data = Record<string, unknown>;

function hasSecret(value: unknown, depth = 0): boolean {
  if (depth > 20) return true;
  if (typeof value === "string") return SECRET_VALUE.test(value);
  if (Array.isArray(value)) return value.some((v) => hasSecret(v, depth + 1));
  if (value && typeof value === "object")
    return Object.entries(value).some(
      ([k, v]) => SECRET_KEY.test(k) || hasSecret(v, depth + 1),
    );
  return false;
}

/**
 * The server owns connection state and the discovered tool catalog; the
 * client may only set title, url, enabled and per-tool enabled flags.
 */
function mcpData(input: Data, stored: Data | null): Data {
  const {
    tools,
    status: _s,
    lastTest: _t,
    lastError: _e,
    protocolVersion: _p,
    serverInfo: _i,
    capabilities: _c,
    ...rest
  } = input;
  const flags = Array.isArray(tools)
    ? tools
        .filter((t): t is Data => !!t && typeof t === "object")
        .map((t) => ({ name: t.name, enabled: t.enabled }))
    : [];
  if (hasSecret({ ...rest, tools: flags }))
    throw new ApiError(
      "Store credentials in server environment settings, not in a workspace record.",
    );
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title || title.length > 80)
    throw new ApiError("Give the server a name of up to 80 characters.");
  let url: URL;
  try {
    url = new URL(String(input.url ?? ""));
  } catch {
    throw new ApiError("Enter a valid HTTPS server URL.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.href.length > 2000)
    throw new ApiError("Use an HTTPS URL without embedded credentials.");
  if (
    [...url.searchParams.keys()].some((k) => SECRET_KEY.test(k)) ||
    hasSecret([...url.searchParams.values()])
  )
    throw new ApiError(
      "Store credentials in server environment settings, not in the server URL.",
    );
  const base: Data =
    !stored || stored.url !== url.href
      ? { status: "Not tested", tools: [], enabled: false }
      : {
          status: stored.status,
          lastTest: stored.lastTest,
          lastError: stored.lastError,
          protocolVersion: stored.protocolVersion,
          serverInfo: stored.serverInfo,
          capabilities: stored.capabilities,
          enabled: stored.enabled === true,
          tools: (Array.isArray(stored.tools) ? (stored.tools as Data[]) : []).map((t) => {
            const flag = flags.find((f) => f.name === t.name);
            return typeof flag?.enabled === "boolean" ? { ...t, enabled: flag.enabled } : t;
          }),
        };
  if (typeof input.enabled === "boolean") {
    if (input.enabled && base.status !== "Connected")
      throw new ApiError("Test the connection before enabling this server.", 409);
    base.enabled = input.enabled;
  }
  return { ...base, title, url: url.href };
}

async function clientData(userId: string, id: string, input: Data) {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name || name.length > 80)
    throw new ApiError("Give the client a name of up to 80 characters.");
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === "string" && v.length > 2000)
      throw new ApiError(`The client ${k} is too long.`);
    if (Array.isArray(v) && (v.length > 50 || v.some((x) => typeof x === "string" && x.length > 2000)))
      throw new ApiError(`The client ${k} is too long.`);
  }
  const lower = name.toLowerCase();
  const clash =
    sampleClients.some((c) => c.name.toLowerCase() === lower) ||
    (await database()
      .prepare(
        "SELECT id FROM records WHERE user_id=? AND kind='client' AND id<>? AND coalesce(json_extract(data,'$.override'),0)=0 AND lower(trim(json_extract(data,'$.name')))=? LIMIT 1",
      )
      .bind(userId, id, lower)
      .first());
  if (clash) throw new ApiError("A client with this name already exists.", 409);
  return { ...input, name };
}

export async function POST(request: Request) {
  try {
    const user = await identity(request);
    const parsed = z
      .object({
        kind: z.enum(KINDS),
        id: z.string().max(100).optional(),
        data: z.record(z.unknown()),
      })
      .safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new ApiError("Invalid workspace record.");
    const body = parsed.data;
    if (JSON.stringify(body.data).length > 250000)
      throw new ApiError("This workspace record is invalid.");
    const db = database();
    const own = async (candidate: string) => {
      const row = await db
        .prepare("SELECT id,data FROM records WHERE id=? AND user_id=? AND kind=?")
        .bind(candidate, user.userId, body.kind)
        .first();
      return row
        ? { id: String(row.id), data: JSON.parse(String(row.data)) as Data }
        : null;
    };
    let id: string | undefined;
    let stored: { id: string; data: Data } | null = null;

    if (body.kind === "settings") {
      // One settings record per user. `merge` applies a partial patch on the
      // server (nested objects one level deep) so quick toggles can't
      // overwrite each other from stale copies.
      const existing = await db
        .prepare("SELECT id,data FROM records WHERE user_id=? AND kind='settings' ORDER BY updated_at DESC LIMIT 1")
        .bind(user.userId)
        .first();
      const merge = body.data.__merge === true;
      delete body.data.__merge;
      if (existing) {
        id = String(existing.id);
        if (merge) {
          const current = JSON.parse(String(existing.data)) as Data;
          for (const [k, v] of Object.entries(body.data)) {
            const before = current[k];
            current[k] =
              v && typeof v === "object" && !Array.isArray(v) && before && typeof before === "object"
                ? { ...(before as object), ...(v as object) }
                : v;
          }
          body.data = current;
        }
      }
    } else if (body.kind === "dismissed") {
      // One dismissal per insight, whatever id the client sends.
      const insight = String(body.data.insightId ?? "").slice(0, 200);
      if (!insight) throw new ApiError("Invalid workspace record.");
      id = await userHash(user.userId, "fixed-dismissed:" + insight);
    } else if (body.kind === "client" && body.data.override === true) {
      // Stage overrides for sample clients: one per client name.
      const lower = String(body.data.name ?? "").trim().toLowerCase();
      const sample = sampleClients.find((c) => c.name.toLowerCase() === lower);
      if (!sample) throw new ApiError("Client not found.", 404);
      id = await userHash(user.userId, "fixed-client-override:" + lower);
      body.data = { override: true, name: sample.name, stage: body.data.stage };
    } else if (body.id) {
      // An id is either the caller's own record, or a fixed id hashed per
      // user; anything else could pre-claim another user's hashed id.
      stored = await own(body.id);
      if (stored) id = stored.id;
      else if (FIXED_ID.test(body.id) && body.kind !== "mcp") {
        id = await userHash(user.userId, body.id);
        stored = await own(id);
      } else throw new ApiError("Invalid record identifier.");
    }
    id ??= crypto.randomUUID();

    if (body.kind === "mcp") body.data = mcpData(body.data, stored?.data ?? null);
    if (body.kind === "client" && body.data.override !== true)
      body.data = await clientData(user.userId, id, body.data);

    await saveRecord(user.userId, body.kind, body.data, id);
    if (body.kind === "client" && body.data.override === true)
      // Older overrides were stored under random ids; keep only this one.
      await db
        .prepare(
          "DELETE FROM records WHERE user_id=? AND kind='client' AND id<>? AND json_extract(data,'$.override')=1 AND lower(json_extract(data,'$.name'))=?",
        )
        .bind(user.userId, id, String(body.data.name).toLowerCase())
        .run();
    await log(
      user.userId,
      body.kind === "action"
        ? "Action updated"
        : body.kind === "memory"
          ? "Knowledge approved"
          : "Work saved",
      String(body.data.title ?? body.data.name ?? body.kind).slice(0, 200),
    ).catch(() => {});
    return Response.json({ id });
  } catch (e) {
    return failure(e);
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await identity(request);
    const id = new URL(request.url).searchParams.get("id") ?? "";
    if (!id || id.length > 100) throw new ApiError("Record not found.", 404);
    const db = database();
    const row = await db
      .prepare("SELECT kind,data FROM records WHERE id=? AND user_id=?")
      .bind(id, user.userId)
      .first();
    if (!row || !DELETABLE.has(String(row.kind))) throw new ApiError("Record not found.", 404);
    let data: Data = {};
    try {
      data = JSON.parse(String(row.data));
    } catch {}
    // Seeded actions can only be updated; drafts the user created can be removed.
    if (row.kind === "action" && data.kind !== "External draft" && data.custom !== true)
      throw new ApiError("Record not found.", 404);
    await db
      .prepare("DELETE FROM records WHERE id=? AND user_id=? AND kind=?")
      .bind(id, user.userId, String(row.kind))
      .run();
    await log(
      user.userId,
      "Record deleted",
      `${row.kind} · ${String(data.title ?? data.name ?? data.query ?? "").slice(0, 150)}`,
    ).catch(() => {});
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
