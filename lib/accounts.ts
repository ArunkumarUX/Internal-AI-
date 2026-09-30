import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { SESSION_USER } from "@/lib/auth-session";
import { ApiError } from "@/lib/server";

/*
 * Workspace accounts. The admin is the AUTH_EMAIL address and keeps the
 * original workspace id, so existing data stays theirs. Teammates the admin
 * adds live in the `members` table, each with their own private workspace.
 * Everyone signs in with a one-time code emailed to them (see login-codes.ts);
 * sessions are HMAC-signed cookies.
 */

export type Role = "admin" | "member";
export type Account = { id: string; email: string; name: string; role: Role };

const SESSION_DAYS = 30;
export const SESSION_MAX_AGE = 60 * 60 * 24 * SESSION_DAYS;

export const normaliseEmail = (email: string) => email.trim().toLowerCase();
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function adminAccount(): Account | null {
  const email = normaliseEmail(process.env.AUTH_EMAIL ?? "");
  if (!email) return null;
  return { id: SESSION_USER, email, name: process.env.AUTH_NAME?.trim() || "Workspace admin", role: "admin" };
}

function db() {
  return env.DB ?? null;
}

/* ---------------------------------------------------------------- */
/* Organisation domains                                               */
/* ---------------------------------------------------------------- */

const DEFAULT_DOMAINS = "naar.io,nextgentechs.io";

/** Email domains whose people can sign in without being added first. */
export function allowedDomains(): string[] {
  return (process.env.ALLOWED_EMAIL_DOMAINS ?? DEFAULT_DOMAINS)
    .split(",")
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}

/** Exact domain match only: name@naar.io yes, name@mail.naar.io or name@fake-naar.io no. */
export function inAllowedDomain(email: string) {
  const domain = normaliseEmail(email).split("@")[1] ?? "";
  return !!domain && allowedDomains().includes(domain);
}

/** "arun.kumar_g@naar.io" → "Arun Kumar G". */
export function nameFromEmail(email: string) {
  const local = normaliseEmail(email).split("@")[0] ?? "";
  const words = local.split(/[._\-+]+/).filter((w) => w && !/^\d+$/.test(w));
  const name = words.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
  return (name || local).slice(0, 80);
}

/* ---------------------------------------------------------------- */
/* Secrets                                                            */
/* ---------------------------------------------------------------- */

/**
 * Signs sessions and sign-in codes. AUTH_SECRET is required; older
 * deployments that still set AUTH_PASSWORD derive one from it.
 */
export function secret() {
  const configured = process.env.AUTH_SECRET?.trim();
  if (configured) return configured;
  if (process.env.AUTH_PASSWORD)
    return createHash("sha256")
      .update(`internal-ai-session:${process.env.AUTH_EMAIL ?? ""}:${process.env.AUTH_PASSWORD}`)
      .digest("hex");
  throw new ApiError("Sign-in isn’t configured for this workspace. Ask your admin to set AUTH_SECRET.", 503);
}

export const hmac = (value: string) => createHmac("sha256", secret()).update(value).digest("base64url");

/** Constant-time comparison of two strings via fixed-length digests. */
export function same(left: string, right: string) {
  const a = createHash("sha256").update(left).digest();
  const b = createHash("sha256").update(right).digest();
  return timingSafeEqual(a, b);
}

/* ---------------------------------------------------------------- */
/* Sessions                                                           */
/* ---------------------------------------------------------------- */

export function createSession(userId: string) {
  const payload = `${userId}.${Math.floor(Date.now() / 1000) + SESSION_MAX_AGE}`;
  return `${payload}.${hmac(payload)}`;
}

/** Returns the signed-in user id, or null for a missing, forged or expired cookie. */
export function readSession(token: string | undefined): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, expires, signature] = parts;
  let expected: string;
  try {
    expected = hmac(`${userId}.${expires}`);
  } catch {
    return null; // no secret configured: nobody is signed in
  }
  if (!same(signature, expected)) return null;
  if (!/^\d+$/.test(expires) || Number(expires) * 1000 < Date.now()) return null;
  return userId;
}

/* ---------------------------------------------------------------- */
/* Members                                                            */
/* ---------------------------------------------------------------- */

type MemberRow = { id: string; email: string; name: string; role: string };

/** Removed people keep a row with role "blocked" so domain sign-in can't bring them back. */
const active = (row: MemberRow | null | undefined) => (row && row.role !== "blocked" ? row : null);

const toAccount = (row: MemberRow): Account => ({
  id: row.id,
  email: row.email,
  name: row.name,
  role: row.role === "admin" ? "admin" : "member",
});

export async function accountById(id: string): Promise<Account | null> {
  const admin = adminAccount();
  if (admin && id === admin.id) return admin;
  const row = active(await db()?.prepare("SELECT id,email,name,role FROM members WHERE id=?").bind(id).first<MemberRow>());
  return row ? toAccount(row) : null;
}

export async function accountByEmail(email: string): Promise<Account | null> {
  const wanted = normaliseEmail(email);
  const admin = adminAccount();
  if (admin && wanted === admin.email) return admin;
  const row = active(
    await db()?.prepare("SELECT id,email,name,role FROM members WHERE email=?").bind(wanted).first<MemberRow>(),
  );
  return row ? toAccount(row) : null;
}

/** True when the admin removed this email; they stay out until added back. */
export async function isBlocked(email: string) {
  const row = await db()
    ?.prepare("SELECT role FROM members WHERE email=?")
    .bind(normaliseEmail(email))
    .first<{ role: string }>();
  return row?.role === "blocked";
}

/** Who a sign-in code may be sent to: existing accounts, or new people from an allowed domain. */
export async function canSignIn(email: string) {
  if (await accountByEmail(email)) return true;
  return inAllowedDomain(email) && !(await isBlocked(email));
}

/** Returns the account for this email, creating it for a new person from an allowed domain. */
export async function accountForSignIn(email: string): Promise<Account | null> {
  const existing = await accountByEmail(email);
  if (existing) return existing;
  if (!inAllowedDomain(email) || (await isBlocked(email))) return null;
  const wanted = normaliseEmail(email);
  const now = new Date().toISOString();
  await db()
    ?.prepare(
      "INSERT INTO members (id,email,name,password_hash,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(email) DO NOTHING",
    )
    .bind(`u_${crypto.randomUUID()}`, wanted, nameFromEmail(wanted), "", "member", now, now)
    .run();
  return accountByEmail(wanted);
}

/** Everyone in the workspace, admin first. */
export async function listAccounts(): Promise<Account[]> {
  const admin = adminAccount();
  const rows =
    (
      await db()
        ?.prepare("SELECT id,email,name,role FROM members WHERE role<>'blocked' ORDER BY name COLLATE NOCASE")
        .all<MemberRow>()
    )?.results ?? [];
  return [...(admin ? [admin] : []), ...rows.map(toAccount)];
}
