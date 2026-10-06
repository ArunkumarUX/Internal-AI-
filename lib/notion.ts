import { database, ApiError } from "@/lib/server";
import { callMcpTools, McpError } from "@/lib/mcp-client";
import type { Source } from "@/lib/knowledge";

const ISSUER = "https://mcp.notion.com";
export const NOTION_MCP_URL = new URL(`${ISSUER}/mcp`);
const PROVIDER = "notion";
const COOKIE = "notion_oauth";
/** Read-only Notion MCP tools the assistant may call. */
const READ_TOOLS = new Set(["notion-search", "notion-fetch"]);

type Tokens = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  clientId: string;
  connectedAt: string;
  workspace?: string;
  /** Set when the refresh token stopped working; the user must reconnect. */
  reauth?: boolean;
};

/** Notion is connected but its tokens no longer work. */
export class NotionReauthError extends Error {
  constructor() {
    super("Notion needs reconnecting.");
  }
}

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const random = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));

async function readConnection<T>(userId: string, provider: string) {
  const row = await database()
    .prepare("SELECT data FROM connections WHERE user_id=? AND provider=?")
    .bind(userId, provider)
    .first();
  return row ? (JSON.parse(String(row.data)) as T) : null;
}
async function writeConnection(userId: string, provider: string, data: unknown) {
  await database()
    .prepare(
      "INSERT INTO connections (user_id,provider,data,updated_at) VALUES (?,?,?,?) ON CONFLICT(user_id,provider) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at",
    )
    .bind(userId, provider, JSON.stringify(data), new Date().toISOString())
    .run();
}

async function clientFor(redirectUri: string) {
  const key = `notion-client:${redirectUri}`;
  const cached = await readConnection<{ clientId: string }>("_app", key);
  if (cached) return cached.clientId;
  const response = await fetch(`${ISSUER}/register`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Internal AI",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  const json = (await response.json().catch(() => ({}))) as { client_id?: string };
  if (!response.ok || !json.client_id)
    throw new ApiError("Notion did not accept the app registration. Please retry.", 502);
  await writeConnection("_app", key, { clientId: json.client_id });
  return json.client_id;
}

export async function startNotionAuth(request: Request, configuredOrigin?: string) {
  const origin = configuredOrigin ?? new URL(request.url).origin;
  const redirectUri = `${origin}/api/notion/callback`;
  const clientId = await clientFor(redirectUri);
  const state = random(16);
  const verifier = random(48);
  const challenge = b64url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
  );
  const url = new URL(`${ISSUER}/authorize`);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "default",
    resource: ISSUER,
  }).toString();
  const cookie = `${COOKIE}=${b64url(new TextEncoder().encode(JSON.stringify({ state, verifier, clientId, redirectUri })))}; HttpOnly; SameSite=Lax; Path=/api/notion; Max-Age=600${origin.startsWith("https:") ? "; Secure" : ""}`;
  return { url: url.toString(), cookie };
}

export const clearAuthCookie = `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/api/notion; Max-Age=0`;

function readAuthCookie(request: Request) {
  const raw = request.headers
    .get("cookie")
    ?.split(/;\s*/)
    .find((c) => c.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  if (!raw) return null;
  try {
    const json = atob(raw.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json) as { state: string; verifier: string; clientId: string; redirectUri: string };
  } catch {
    return null;
  }
}

async function tokenRequest(body: Record<string, string>) {
  const response = await fetch(`${ISSUER}/token`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ ...body, resource: ISSUER }).toString(),
  });
  const json = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!response.ok || !json.access_token) return null;
  return json;
}

export async function finishNotionAuth(userId: string, request: Request) {
  const params = new URL(request.url).searchParams;
  const saved = readAuthCookie(request);
  if (params.get("error")) throw new ApiError("Notion access was not granted.", 400);
  if (!saved || !params.get("code") || params.get("state") !== saved.state)
    throw new ApiError("The Notion sign-in expired or didn’t match. Start the connection again.", 400);
  const token = await tokenRequest({
    grant_type: "authorization_code",
    code: params.get("code")!,
    redirect_uri: saved.redirectUri,
    client_id: saved.clientId,
    code_verifier: saved.verifier,
  });
  if (!token) throw new ApiError("Notion didn’t issue an access token. Start the connection again.", 502);
  const tokens: Tokens = {
    accessToken: token.access_token!,
    refreshToken: token.refresh_token,
    expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000,
    clientId: saved.clientId,
    connectedAt: new Date().toISOString(),
  };
  await writeConnection(userId, PROVIDER, tokens);
}

export async function markReauth(userId: string) {
  // UPDATE only: a disconnect made meanwhile must not be undone.
  await database()
    .prepare(
      "UPDATE connections SET data=json_set(data,'$.reauth',json('true')),updated_at=? WHERE user_id=? AND provider=?",
    )
    .bind(new Date().toISOString(), userId, PROVIDER)
    .run();
}

async function refresh(userId: string, tokens: Tokens): Promise<string | null> {
  if (!tokens.refreshToken) {
    await markReauth(userId);
    throw new NotionReauthError();
  }
  const refreshed = await tokenRequest({
    grant_type: "refresh_token",
    refresh_token: tokens.refreshToken,
    client_id: tokens.clientId,
  });
  if (!refreshed) {
    await markReauth(userId);
    throw new NotionReauthError();
  }
  const next: Tokens = {
    ...tokens,
    accessToken: refreshed.access_token!,
    refreshToken: refreshed.refresh_token ?? tokens.refreshToken,
    expiresAt: Date.now() + (refreshed.expires_in ?? 3600) * 1000,
  };
  // Conditional on the row still holding the token we refreshed, so a
  // disconnect or a newer connection made meanwhile wins.
  const updated = await database()
    .prepare(
      "UPDATE connections SET data=?,updated_at=? WHERE user_id=? AND provider=? AND json_extract(data,'$.refreshToken')=?",
    )
    .bind(JSON.stringify(next), new Date().toISOString(), userId, PROVIDER, tokens.refreshToken)
    .run();
  if (updated.meta.changes) return next.accessToken;
  const current = await readConnection<Tokens>(userId, PROVIDER);
  return current && !current.reauth && current.expiresAt - Date.now() > 60_000 ? current.accessToken : null;
}

/** One refresh per user at a time within this isolate. */
const refreshing = new Map<string, Promise<string | null>>();

export async function accessToken(userId: string) {
  const tokens = await readConnection<Tokens>(userId, PROVIDER);
  if (!tokens) return null;
  if (tokens.reauth) throw new NotionReauthError();
  if (tokens.expiresAt - Date.now() > 60_000) return tokens.accessToken;
  let pending = refreshing.get(userId);
  if (!pending) {
    pending = refresh(userId, tokens).finally(() => refreshing.delete(userId));
    refreshing.set(userId, pending);
  }
  return pending;
}

export async function notionStatus(userId: string) {
  const tokens = await readConnection<Tokens>(userId, PROVIDER);
  if (!tokens) return { connected: false, server: NOTION_MCP_URL.href };
  if (tokens.reauth)
    return { connected: false, reauth: true, connectedAt: tokens.connectedAt, server: NOTION_MCP_URL.href };
  return { connected: true, connectedAt: tokens.connectedAt, server: NOTION_MCP_URL.href };
}

/** Revokes the token when the issuer advertises a revocation endpoint. */
async function revoke(tokens: Tokens) {
  try {
    const meta = await fetch(`${ISSUER}/.well-known/oauth-authorization-server`, {
      redirect: "manual",
      signal: AbortSignal.timeout(4000),
    });
    const json = (await meta.json().catch(() => ({}))) as { revocation_endpoint?: string };
    const endpoint = json.revocation_endpoint;
    if (!meta.ok || typeof endpoint !== "string" || new URL(endpoint).origin !== ISSUER) return;
    for (const [token, hint] of [
      [tokens.refreshToken, "refresh_token"],
      [tokens.accessToken, "access_token"],
    ] as const) {
      if (!token) continue;
      const r = await fetch(endpoint, {
        method: "POST",
        redirect: "manual",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token, token_type_hint: hint, client_id: tokens.clientId }).toString(),
        signal: AbortSignal.timeout(4000),
      });
      await r.body?.cancel();
    }
  } catch {
    // Revocation is best effort; the local tokens are deleted regardless.
  }
}

export async function disconnectNotion(userId: string) {
  const tokens = await readConnection<Tokens>(userId, PROVIDER).catch(() => null);
  if (tokens) await revoke(tokens);
  await database()
    .prepare("DELETE FROM connections WHERE user_id=? AND provider=?")
    .bind(userId, PROVIDER)
    .run();
}

type Hit = { id: string; title: string; url?: string; highlight?: string; timestamp?: string };

function parseHits(text: string): Hit[] {
  try {
    const json = JSON.parse(text);
    const list: unknown[] = Array.isArray(json) ? json : (json.results ?? json.pages ?? []);
    return list
      .filter((x): x is Record<string, any> => !!x && typeof x === "object" && typeof (x as any).id === "string")
      .map((x) => ({
        id: x.id,
        title: String(x.title || "Untitled"),
        url: typeof x.url === "string" ? x.url : undefined,
        highlight: typeof x.highlight === "string" ? x.highlight : undefined,
        timestamp: typeof x.timestamp === "string" ? x.timestamp : undefined,
      }));
  } catch {
    return [];
  }
}

export function pageText(raw: string) {
  try {
    const json = JSON.parse(raw);
    return String(json.text ?? json.content ?? raw);
  } catch {
    return raw;
  }
}

export function pageTitle(raw: string, fallback: string) {
  try {
    const json = JSON.parse(raw);
    if (typeof json.title === "string" && json.title.trim()) return json.title;
  } catch {
    /* plain text */
  }
  return (
    raw.match(/<title>([^<]+)<\/title>/i)?.[1] ||
    raw.match(/^#\s+(.+)$/m)?.[1] ||
    fallback
  );
}

export function notionIdsIn(query: string) {
  const compact = query.match(/[0-9a-f]{32}/gi) ?? [];
  const dashed =
    query.match(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    ) ?? [];
  const ids = [
    ...dashed,
    ...compact.map(
      (id) =>
        `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`,
    ),
  ];
  return [...new Set(ids.map((id) => id.toLowerCase()))];
}

/**
 * Searches the user's connected Notion workspace through the hosted MCP server.
 * Returns null when Notion isn't connected; throws NotionReauthError when the
 * user must reconnect and McpError when the server fails.
 */
export async function searchNotion(userId: string, query: string, limit = 4): Promise<Source[] | null> {
  const token = await accessToken(userId);
  if (!token) return null;
  const found: Source[] = [];
  try {
    await callMcpTools(
      NOTION_MCP_URL,
      token,
      async (call) => {
        const safeCall = (name: string, args: Record<string, unknown>) => {
          if (!READ_TOOLS.has(name)) throw new McpError("Tool not approved.", 403);
          return call(name, args);
        };
        const directIds = notionIdsIn(query);
        const direct = (
          await Promise.all(
            directIds.map(async (id): Promise<Hit | null> => {
              try {
                const raw = await safeCall("notion-fetch", { id });
                const text = pageText(raw);
                if (!text.trim()) return null;
                return {
                  id,
                  title: pageTitle(raw, "Notion page"),
                  url: `https://www.notion.so/${id.replaceAll("-", "")}`,
                  highlight: text,
                };
              } catch {
                return null;
              }
            }),
          )
        ).filter((x): x is Hit => !!x);
        const searchQuery = query
          .replace(/https?:\/\/\S+/g, " ")
          .replace(
            /[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}/gi,
            " ",
          )
          .replace(/\s+/g, " ")
          .trim();
        const searched = searchQuery
          ? parseHits(
              await safeCall("notion-search", {
                query: searchQuery,
                query_type: "internal",
              }),
            )
          : [];
        const hits = [
          ...direct,
          ...searched.filter((h) => !direct.some((d) => d.id === h.id)),
        ].slice(0, Math.max(limit, direct.length));
        const pages = await Promise.all(
          hits.map((h) =>
            h.highlight && directIds.includes(h.id.toLowerCase())
              ? Promise.resolve(h.highlight)
              : safeCall("notion-fetch", { id: h.id })
                  .then(pageText)
                  .catch(() => h.highlight ?? ""),
          ),
        );
        hits.forEach((h, i) =>
          found.push({
            id: `notion-${h.id}`,
            title: h.title,
            content: (pages[i] || h.highlight || "").slice(0, 8000),
            system: "Notion",
            owner: "Notion workspace",
            date: (h.timestamp ?? "").slice(0, 10) || new Date().toISOString().slice(0, 10),
            kind: "Notion page",
            client: "Your workspace",
            tags: [],
            status: "Live",
            url: h.url,
          }),
        );
      },
      { timeoutMs: 25_000 },
    );
  } catch (error) {
    if (error instanceof McpError && error.status === 401) {
      await markReauth(userId);
      throw new NotionReauthError();
    }
    throw error;
  }
  return found;
}
