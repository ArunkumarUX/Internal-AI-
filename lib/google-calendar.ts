import { createHash, randomBytes } from "node:crypto";
import { database, ApiError } from "@/lib/server";
import { seal, unseal, type Meeting } from "@/lib/microsoft";
import { detectProvider } from "@/lib/meeting-providers";

/*
 * Google Calendar connection, per person (OAuth authorization code + PKCE),
 * read-only. Needs a Google Cloud OAuth client (Web application):
 *   GOOGLE_CALENDAR_CLIENT_ID, GOOGLE_CALENDAR_CLIENT_SECRET
 * Authorised redirect URI: <site>/api/google/callback.
 * Scope: calendar.readonly. Tokens are stored encrypted, like Microsoft's.
 */

const PROVIDER = "google-calendar";
const COOKIE = "ia_google_auth";
const SCOPES = ["openid", "email", "profile", "https://www.googleapis.com/auth/calendar.readonly"];

export function googleConfigured() {
  return !!(process.env.GOOGLE_CALENDAR_CLIENT_ID?.trim() && process.env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim());
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

export async function disconnectGoogle(userId: string) {
  await database().prepare("DELETE FROM connections WHERE user_id=? AND provider=?").bind(userId, PROVIDER).run();
}

export async function googleStatus(userId: string) {
  const tokens = await readTokens(userId).catch(() => null);
  return { configured: googleConfigured(), connected: !!tokens, account: tokens?.account ?? "", name: tokens?.name ?? "" };
}

/* ---------------------------------------------------------------- */
/* OAuth                                                              */
/* ---------------------------------------------------------------- */

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

export function startGoogleAuth(origin: string) {
  if (!googleConfigured())
    throw new ApiError("Google Calendar isn’t set up for this workspace yet. Ask your admin to add the Google app.", 503);
  const redirectUri = `${origin}/api/google/callback`;
  const state = b64url(randomBytes(16));
  const verifier = b64url(randomBytes(48));
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: process.env.GOOGLE_CALENDAR_CLIENT_ID!.trim(),
    response_type: "code",
    redirect_uri: redirectUri,
    scope: SCOPES.join(" "),
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent select_account",
    include_granted_scopes: "true",
  }).toString();
  const cookie = `${COOKIE}=${b64url(Buffer.from(JSON.stringify({ state, verifier, redirectUri })))}; HttpOnly; SameSite=Lax; Path=/api/google; Max-Age=600${origin.startsWith("https:") ? "; Secure" : ""}`;
  return { url: url.toString(), cookie };
}

export const clearGoogleCookie = `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/api/google; Max-Age=0`;

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
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CALENDAR_CLIENT_ID!.trim(),
      client_secret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET!.trim(),
      ...body,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (!response.ok || !json.access_token) {
    console.error("[google] token request failed:", json.error);
    return null;
  }
  return json;
}

export async function finishGoogleAuth(userId: string, request: Request) {
  const params = new URL(request.url).searchParams;
  const saved = readAuthCookie(request);
  if (params.get("error")) throw new ApiError("Google access was not granted.", 400);
  if (!saved || !params.get("code") || params.get("state") !== saved.state)
    throw new ApiError("The Google sign-in expired or didn’t match. Connect again.", 400);
  const token = await tokenRequest({
    grant_type: "authorization_code",
    code: params.get("code")!,
    redirect_uri: saved.redirectUri,
    code_verifier: saved.verifier,
  });
  if (!token?.refresh_token) throw new ApiError("Google didn’t complete the connection. Please try again.", 502);
  const me = (await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${token.access_token}` },
  })
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}))) as { email?: string; name?: string };
  await writeTokens(userId, {
    access: token.access_token!,
    refresh: token.refresh_token,
    expires: Date.now() + (token.expires_in ?? 3600) * 1000,
    account: String(me.email || ""),
    name: String(me.name || ""),
  });
}

async function accessToken(userId: string) {
  const tokens = await readTokens(userId);
  if (!tokens) return null;
  if (tokens.expires > Date.now() + 60_000) return tokens.access;
  const fresh = await tokenRequest({ grant_type: "refresh_token", refresh_token: tokens.refresh });
  if (!fresh) throw new ApiError("Your Google connection expired. Connect Google Calendar again.", 401, "google_reauth");
  await writeTokens(userId, {
    ...tokens,
    access: fresh.access_token!,
    expires: Date.now() + (fresh.expires_in ?? 3600) * 1000,
  });
  return fresh.access_token!;
}

/* ---------------------------------------------------------------- */
/* Calendar                                                           */
/* ---------------------------------------------------------------- */

type GoogleEvent = {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  hangoutLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  organizer?: { email?: string; displayName?: string; self?: boolean };
  attendees?: { email?: string; displayName?: string; self?: boolean; resource?: boolean }[];
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
};

/** Timed events (not all-day) from `days` ago to `ahead` days ahead on the primary calendar. */
export async function listGoogleMeetings(userId: string, days = 1, ahead = 7): Promise<Meeting[]> {
  const token = await accessToken(userId);
  if (!token) return [];
  const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  url.search = new URLSearchParams({
    timeMin: new Date(Date.now() - days * 86_400_000).toISOString(),
    timeMax: new Date(Date.now() + ahead * 86_400_000).toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "100",
  }).toString();
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
  if (response.status === 401) throw new ApiError("Your Google connection expired. Connect Google Calendar again.", 401, "google_reauth");
  if (!response.ok) throw new ApiError(`Google Calendar returned ${response.status}.`, 502);
  const data = (await response.json()) as { items?: GoogleEvent[] };
  return (data.items ?? [])
    .filter((e) => e.status !== "cancelled" && e.start?.dateTime && e.end?.dateTime)
    .map((e) => {
      const video = e.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri;
      const found = detectProvider(video, e.hangoutLink, e.location, e.description);
      return {
        id: `g:${e.id}`,
        title: e.summary?.trim() || "Untitled meeting",
        start: new Date(e.start!.dateTime!).toISOString(),
        end: new Date(e.end!.dateTime!).toISOString(),
        organizer: e.organizer?.displayName || e.organizer?.email || "",
        attendees: (e.attendees ?? [])
          .filter((a) => !a.resource && !a.self)
          .map((a) => ({ name: a.displayName ?? "", email: a.email ?? "" })),
        joinUrl: found.joinUrl,
        teams: found.provider === "teams",
        provider: found.provider,
        calendar: "google" as const,
        location: e.location ?? "",
        preview: (e.description ?? "").replace(/<[^>]+>/g, " ").slice(0, 280),
      };
    });
}
