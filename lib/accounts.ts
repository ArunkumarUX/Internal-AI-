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

const toAccount = (row: MemberRow): Account => ({
  id: row.id,
  email: row.email,
  name: row.name,
  role: row.role === "admin" ? "admin" : "member",
});

export async function accountById(id: string): Promise<Account | null> {
  const admin = adminAccount();
  if (admin && id === admin.id) return admin;
  const row = await db()?.prepare("SELECT id,email,name,role FROM members WHERE id=?").bind(id).first<MemberRow>();
  return row ? toAccount(row) : null;
}

export async function accountByEmail(email: string): Promise<Account | null> {
  const wanted = normaliseEmail(email);
  const admin = adminAccount();
  if (admin && wanted === admin.email) return admin;
  const row = await db()
    ?.prepare("SELECT id,email,name,role FROM members WHERE email=?")
    .bind(wanted)
    .first<MemberRow>();
  return row ? toAccount(row) : null;
}

/** Everyone in the workspace, admin first. */
export async function listAccounts(): Promise<Account[]> {
  const admin = adminAccount();
  const rows =
    (await db()?.prepare("SELECT id,email,name,role FROM members ORDER BY name COLLATE NOCASE").all<MemberRow>())
      ?.results ?? [];
  return [...(admin ? [admin] : []), ...rows.map(toAccount)];
}
