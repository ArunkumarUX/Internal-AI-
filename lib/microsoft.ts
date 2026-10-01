import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { database, ApiError } from "@/lib/server";
import { secret } from "@/lib/accounts";

/*
 * Microsoft 365 (Teams / Outlook) calendar connection, per person, with the
 * OAuth authorization-code flow + PKCE. Uses the same Entra app as Graph email:
 *   MS_GRAPH_CLIENT_ID, MS_GRAPH_CLIENT_SECRET,
 *   MS_GRAPH_TENANT_ID (optional; "organizations" lets naar.io and
 *   nextgentechs.io accounts both sign in when the app is multi-tenant).
 * Delegated permissions: User.Read, Calendars.Read, OnlineMeetings.Read,
 * OnlineMeetingTranscript.Read.All, offline_access.
 * Redirect URI: <site>/api/microsoft/callback. Tokens are stored encrypted.
 */

const PROVIDER = "microsoft";
const COOKIE = "ia_ms_auth";
export const SCOPES = [
  "openid",
  "profile",
  "offline_access",
  "User.Read",
  "Calendars.Read",
  "OnlineMeetings.Read",
  "OnlineMeetingTranscript.Read.All",
];

export function microsoftConfigured() {
  return !!(process.env.MS_GRAPH_CLIENT_ID?.trim() && process.env.MS_GRAPH_CLIENT_SECRET?.trim());
}
const tenant = () => encodeURIComponent(process.env.MS_GRAPH_TENANT_ID?.trim() || "organizations");
const authority = () => `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0`;

/* ---------------------------------------------------------------- */
/* Encrypted token storage                                            */
/* ---------------------------------------------------------------- */

const key = () => createHash("sha256").update(`internal-ai-microsoft:${secret()}`).digest();

function seal(value: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${body.toString("base64url")}`;
}

function unseal<T>(sealed: string): T | null {
  try {
    const [version, iv, tag, body] = sealed.split(".");
    if (version !== "v1") return null;
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8")) as T;
  } catch {
    return null;
  }
}

type Tokens = { access: string; refresh: string; expires: number; account: string; name: string };

async function readTokens(userId: string): Promise<Tokens | null> {
  const row = await database()
    .prepare("SELECT data FROM connections WHERE user_id=? AND provider=?")
    .bind(userId, PROVIDER)
    .first<{ data: string }>();
  return row ? unseal<Tokens>(row.data) : null;
}

async function writeTokens(userId: string, tokens: Tokens) {
  await database()
    .prepare(
      "INSERT INTO connections (user_id,provider,data,updated_at) VALUES (?,?,?,?) ON CONFLICT(user_id,provider) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at",
    )
    .bind(userId, PROVIDER, seal(tokens), new Date().toISOString())
    .run();
}

export async function disconnectMicrosoft(userId: string) {
  await database().prepare("DELETE FROM connections WHERE user_id=? AND provider=?").bind(userId, PROVIDER).run();
}

/* ---------------------------------------------------------------- */
/* OAuth                                                              */
/* ---------------------------------------------------------------- */

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

export function startMicrosoftAuth(origin: string) {
  if (!microsoftConfigured())
    throw new ApiError("Microsoft 365 isn’t set up for this workspace yet. Ask your admin to add the Microsoft app.", 503);
  const redirectUri = `${origin}/api/microsoft/callback`;
  const state = b64url(randomBytes(16));
  const verifier = b64url(randomBytes(48));
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const url = new URL(`${authority()}/authorize`);
  url.search = new URLSearchParams({
    client_id: process.env.MS_GRAPH_CLIENT_ID!.trim(),
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: SCOPES.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  const cookie = `${COOKIE}=${b64url(Buffer.from(JSON.stringify({ state, verifier, redirectUri })))}; HttpOnly; SameSite=Lax; Path=/api/microsoft; Max-Age=600${origin.startsWith("https:") ? "; Secure" : ""}`;
  return { url: url.toString(), cookie };
}

export const clearMicrosoftCookie = `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/api/microsoft; Max-Age=0`;

function readAuthCookie(request: Request) {
  const raw = request.headers
    .get("cookie")
    ?.split(/;\s*/)
    .find((c) => c.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  if (!raw) return null;
  try {
    return JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as { state: string; verifier: string; redirectUri: string };
  } catch {
    return null;
  }
}

async function tokenRequest(body: Record<string, string>) {
  const response = await fetch(`${authority()}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.MS_GRAPH_CLIENT_ID!.trim(),
      client_secret: process.env.MS_GRAPH_CLIENT_SECRET!.trim(),
      scope: SCOPES.join(" "),
      ...body,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !json.access_token) {
    console.error("[microsoft] token request failed:", json.error, json.error_description?.split("\r\n")[0]);
    return null;
  }
  return json;
}

export async function finishMicrosoftAuth(userId: string, request: Request) {
  const params = new URL(request.url).searchParams;
  const saved = readAuthCookie(request);
  if (params.get("error")) throw new ApiError("Microsoft access was not granted.", 400);
  if (!saved || !params.get("code") || params.get("state") !== saved.state)
    throw new ApiError("The Microsoft sign-in expired or didn’t match. Connect again.", 400);
  const token = await tokenRequest({
    grant_type: "authorization_code",
    code: params.get("code")!,
    redirect_uri: saved.redirectUri,
    code_verifier: saved.verifier,
  });
  if (!token?.refresh_token) throw new ApiError("Microsoft didn’t complete the connection. Please try again.", 502);
  const me = await fetch("https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName", {
    headers: { Authorization: `Bearer ${token.access_token}` },
  })
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}));
  await writeTokens(userId, {
    access: token.access_token!,
    refresh: token.refresh_token,
    expires: Date.now() + (token.expires_in ?? 3600) * 1000,
    account: String((me as { mail?: string }).mail || (me as { userPrincipalName?: string }).userPrincipalName || ""),
    name: String((me as { displayName?: string }).displayName || ""),
  });
}

/** A fresh access token for this person, refreshing it when needed. */
async function accessToken(userId: string) {
  const tokens = await readTokens(userId);
  if (!tokens) return null;
  if (tokens.expires > Date.now() + 60_000) return tokens.access;
  const fresh = await tokenRequest({ grant_type: "refresh_token", refresh_token: tokens.refresh });
  if (!fresh) throw new ApiError("Your Microsoft connection expired. Connect Microsoft 365 again.", 401, "microsoft_reauth");
  await writeTokens(userId, {
    ...tokens,
    access: fresh.access_token!,
    refresh: fresh.refresh_token || tokens.refresh,
    expires: Date.now() + (fresh.expires_in ?? 3600) * 1000,
  });
  return fresh.access_token!;
}

async function graph<T>(userId: string, path: string, init: { headers?: Record<string, string>; raw?: boolean } = {}) {
  const token = await accessToken(userId);
  if (!token) throw new ApiError("Connect Microsoft 365 first.", 409, "microsoft_not_connected");
  const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    headers: { Authorization: `Bearer ${token}`, ...init.headers },
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 401) throw new ApiError("Your Microsoft connection expired. Connect Microsoft 365 again.", 401, "microsoft_reauth");
  if (!response.ok) {
    const detail = (await response.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
    throw new ApiError(detail.error?.message || `Microsoft returned ${response.status}.`, response.status === 403 ? 403 : 502, detail.error?.code);
  }
  return (init.raw ? await response.text() : await response.json()) as T;
}

/* ---------------------------------------------------------------- */
/* Calendar and Teams                                                 */
/* ---------------------------------------------------------------- */

export async function microsoftStatus(userId: string) {
  const tokens = await readTokens(userId).catch(() => null);
  return { configured: microsoftConfigured(), connected: !!tokens, account: tokens?.account ?? "", name: tokens?.name ?? "" };
}

export type Meeting = {
  id: string;
  title: string;
  start: string;
  end: string;
  organizer: string;
  attendees: { name: string; email: string }[];
  joinUrl: string;
  teams: boolean;
  location: string;
  preview: string;
};

type GraphEvent = {
  id: string;
  subject?: string;
  start?: { dateTime: string; timeZone: string };
  end?: { dateTime: string; timeZone: string };
  organizer?: { emailAddress?: { name?: string; address?: string } };
  attendees?: { emailAddress?: { name?: string; address?: string } }[];
  isOnlineMeeting?: boolean;
  onlineMeetingProvider?: string;
  onlineMeeting?: { joinUrl?: string } | null;
  webLink?: string;
  location?: { displayName?: string };
  bodyPreview?: string;
  isCancelled?: boolean;
};

/** Meetings from `days` ago to `ahead` days ahead, in UTC. */
export async function listMeetings(userId: string, days = 1, ahead = 7): Promise<Meeting[]> {
  const from = new Date(Date.now() - days * 86_400_000).toISOString();
  const to = new Date(Date.now() + ahead * 86_400_000).toISOString();
  const select = "id,subject,start,end,organizer,attendees,isOnlineMeeting,onlineMeetingProvider,onlineMeeting,location,bodyPreview,isCancelled";
  const data = await graph<{ value: GraphEvent[] }>(
    userId,
    `/me/calendarView?startDateTime=${encodeURIComponent(from)}&endDateTime=${encodeURIComponent(to)}&$select=${select}&$orderby=start/dateTime&$top=100`,
    { headers: { Prefer: 'outlook.timezone="UTC"' } },
  );
  return (data.value ?? [])
    .filter((e) => !e.isCancelled)
    .map((e) => ({
      id: e.id,
      title: e.subject?.trim() || "Untitled meeting",
      start: e.start ? `${e.start.dateTime.replace(/\.\d+$/, "")}Z` : "",
      end: e.end ? `${e.end.dateTime.replace(/\.\d+$/, "")}Z` : "",
      organizer: e.organizer?.emailAddress?.name || e.organizer?.emailAddress?.address || "",
      attendees: (e.attendees ?? [])
        .map((a) => ({ name: a.emailAddress?.name ?? "", email: a.emailAddress?.address ?? "" }))
        .filter((a) => a.name || a.email),
      joinUrl: e.onlineMeeting?.joinUrl ?? "",
      teams: e.onlineMeetingProvider === "teamsForBusiness" || /teams\.microsoft\.com/.test(e.onlineMeeting?.joinUrl ?? ""),
      location: e.location?.displayName ?? "",
      preview: (e.bodyPreview ?? "").slice(0, 280),
    }));
}

/** The official Teams transcript of a meeting, as plain text, when Teams recorded one. */
export async function teamsTranscript(userId: string, joinUrl: string) {
  if (!/^https:\/\/teams\.microsoft\.com\//.test(joinUrl)) throw new ApiError("That isn’t a Teams meeting link.", 400);
  const meetings = await graph<{ value: { id: string }[] }>(
    userId,
    `/me/onlineMeetings?$filter=${encodeURIComponent(`JoinWebUrl eq '${joinUrl.replace(/'/g, "''")}'`)}`,
  );
  const meeting = meetings.value?.[0];
  if (!meeting) throw new ApiError("Teams didn’t find that meeting for your account.", 404);
  const transcripts = await graph<{ value: { id: string; createdDateTime: string }[] }>(
    userId,
    `/me/onlineMeetings/${encodeURIComponent(meeting.id)}/transcripts`,
  );
  const latest = (transcripts.value ?? []).sort((a, b) => b.createdDateTime.localeCompare(a.createdDateTime))[0];
  if (!latest)
    throw new ApiError("This meeting has no Teams transcript. Transcription must be turned on in Teams during the meeting.", 404);
  const vtt = await graph<string>(
    userId,
    `/me/onlineMeetings/${encodeURIComponent(meeting.id)}/transcripts/${encodeURIComponent(latest.id)}/content?$format=text/vtt`,
    { raw: true },
  );
  return vttToText(vtt);
}

/** "00:01:02.000 --> …" + "<v Priya>Hello</v>" → "[01:02] Priya: Hello". */
export function vttToText(vtt: string) {
  const lines: string[] = [];
  let time = "";
  for (const raw of vtt.split(/\r?\n/)) {
    const line = raw.trim();
    const cue = line.match(/^(\d{2}):(\d{2}):(\d{2})\.\d+\s+-->/);
    if (cue) {
      const minutes = Number(cue[1]) * 60 + Number(cue[2]);
      time = `${String(minutes).padStart(2, "0")}:${cue[3]}`;
      continue;
    }
    if (!line || line === "WEBVTT" || /^\d+$/.test(line) || /^NOTE\b/.test(line)) continue;
    const voice = line.match(/^<v ([^>]+)>(.*?)(<\/v>)?$/);
    const text = (voice ? `${voice[1]}: ${voice[2]}` : line).replace(/<[^>]+>/g, "").trim();
    if (text) lines.push(`[${time || "00:00"}] ${text}`);
  }
  return lines.join("\n");
}
