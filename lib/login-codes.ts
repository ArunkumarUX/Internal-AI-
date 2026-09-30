import { randomInt } from "node:crypto";
import { database, ApiError } from "@/lib/server";
import { accountByEmail, accountForSignIn, canSignIn, hmac, nameFromEmail, normaliseEmail, same, type Account } from "@/lib/accounts";
import { sendLoginCode } from "@/lib/mailer";

/*
 * One-time sign-in codes. Only a keyed hash of each code is stored; a code
 * works once, expires after CODE_MINUTES and allows MAX_ATTEMPTS guesses.
 * Sending and checking are rate-limited per email and per network address.
 * Responses never reveal whether an email belongs to the team.
 */

export const CODE_MINUTES = 10;
export const RESEND_SECONDS = 60;
const MAX_ATTEMPTS = 5;
const HOUR = 60 * 60 * 1000;
const LIMITS = {
  sendPerEmail: 5,
  sendPerAddress: 20,
  checkPerAddress: 30,
  checkPerEmail: 15,
};

const codeHash = (email: string, code: string) => hmac(`login-code:${email}:${code}`);

/** Counts an event in a fixed window; returns false once `limit` is reached. */
async function allow(key: string, limit: number, windowMs = HOUR) {
  const db = database();
  const now = Date.now();
  const row = await db
    .prepare("SELECT window_start, count FROM auth_throttle WHERE key=?")
    .bind(key)
    .first<{ window_start: string; count: number }>();
  if (!row || now - Date.parse(row.window_start) >= windowMs) {
    await db
      .prepare(
        "INSERT INTO auth_throttle (key,window_start,count) VALUES (?,?,1) ON CONFLICT(key) DO UPDATE SET window_start=excluded.window_start, count=1",
      )
      .bind(key, new Date(now).toISOString())
      .run();
    return true;
  }
  if (Number(row.count) >= limit) return false;
  await db.prepare("UPDATE auth_throttle SET count=count+1 WHERE key=?").bind(key).run();
  return true;
}

const tooMany = () =>
  new ApiError("Too many attempts. Wait a while, then try again.", 429, "rate_limited");

/**
 * Emails a code if the address belongs to the team. Returns how long to wait
 * before another code can be requested. Unknown emails get the same answer.
 */
export async function requestCode(rawEmail: string, address: string) {
  const email = normaliseEmail(rawEmail);
  if (!(await allow(`send:ip:${address}`, LIMITS.sendPerAddress))) throw tooMany();
  const db = database();
  const now = Date.now();
  const existing = await db
    .prepare("SELECT sent_at FROM login_codes WHERE email=?")
    .bind(email)
    .first<{ sent_at: string }>();
  if (existing) {
    const wait = Math.ceil((Date.parse(existing.sent_at) + RESEND_SECONDS * 1000 - now) / 1000);
    if (wait > 0) return { wait };
  }
  if (!(await allow(`send:email:${email}`, LIMITS.sendPerEmail))) throw tooMany();

  // Existing accounts, plus new people from an allowed organisation domain.
  const allowed = await canSignIn(email);
  const known = allowed ? await accountByEmail(email) : null;
  // Record a placeholder for unknown emails too, so the resend timer and
  // limits behave identically and don't reveal who is on the team.
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db
    .prepare(
      "INSERT INTO login_codes (email,code_hash,attempts,expires_at,sent_at) VALUES (?,?,0,?,?) ON CONFLICT(email) DO UPDATE SET code_hash=excluded.code_hash, attempts=0, expires_at=excluded.expires_at, sent_at=excluded.sent_at",
    )
    .bind(
      email,
      allowed ? codeHash(email, code) : "none",
      new Date(now + CODE_MINUTES * 60 * 1000).toISOString(),
      new Date(now).toISOString(),
    )
    .run();
  if (allowed) {
    try {
      await sendLoginCode(email, known?.name ?? nameFromEmail(email), code, CODE_MINUTES);
    } catch (error) {
      // Let them retry straight away if the email never left.
      await db.prepare("DELETE FROM login_codes WHERE email=?").bind(email).run();
      throw error;
    }
  } else {
    // Roughly match the time a real email takes, so timing doesn't reveal membership.
    await new Promise((r) => setTimeout(r, 400 + randomInt(0, 800)));
  }
  return { wait: RESEND_SECONDS };
}

/** Rate limit for any sign-in check (codes, and the admin password fallback). */
export async function verifyThrottle(rawEmail: string, address: string) {
  const email = normaliseEmail(rawEmail);
  if (!(await allow(`check:ip:${address}`, LIMITS.checkPerAddress))) throw tooMany();
  if (!(await allow(`check:email:${email}`, LIMITS.checkPerEmail))) throw tooMany();
}

/** Checks a code and returns the account it signs in, or throws. */
export async function verifyCode(rawEmail: string, rawCode: string, address: string): Promise<Account> {
  const email = normaliseEmail(rawEmail);
  const code = rawCode.replace(/\s|-/g, "");
  await verifyThrottle(email, address);
  const wrong = new ApiError("That code isn’t right. Check the latest email and try again.", 401, "bad_code");
  if (!/^\d{6}$/.test(code)) throw wrong;
  const db = database();
  const row = await db
    .prepare("SELECT code_hash, attempts, expires_at FROM login_codes WHERE email=?")
    .bind(email)
    .first<{ code_hash: string; attempts: number; expires_at: string }>();
  const expired = new ApiError("That code has expired. Request a new one.", 401, "expired");
  if (!row) throw expired;
  if (Date.parse(row.expires_at) < Date.now()) {
    await db.prepare("DELETE FROM login_codes WHERE email=?").bind(email).run();
    throw expired;
  }
  if (Number(row.attempts) >= MAX_ATTEMPTS) {
    await db.prepare("DELETE FROM login_codes WHERE email=?").bind(email).run();
    throw new ApiError("Too many wrong codes. Request a new one.", 401, "expired");
  }
  if (row.code_hash === "none" || !same(row.code_hash, codeHash(email, code))) {
    await db.prepare("UPDATE login_codes SET attempts=attempts+1 WHERE email=?").bind(email).run();
    throw wrong;
  }
  // Single use: remove it before signing in.
  const used = await db
    .prepare("DELETE FROM login_codes WHERE email=? AND code_hash=?")
    .bind(email, row.code_hash)
    .run();
  if (!used.meta.changes) throw expired;
  // First sign-in from an allowed domain creates the account here.
  const account = await accountForSignIn(email);
  if (!account) throw expired; // removed between sending and signing in
  return account;
}

/** Best-effort client address for rate limits. Vercel sets x-forwarded-for. */
export function clientAddress(request: Request) {
  return (
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}
