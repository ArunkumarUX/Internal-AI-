import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth-session";
import { adminAccount, createSession, normaliseEmail, same, SESSION_MAX_AGE, type Account } from "@/lib/accounts";
import { passwordFallback } from "@/lib/mailer";
import { clientAddress, verifyCode, verifyThrottle } from "@/lib/login-codes";
import { failure, log, ApiError } from "@/lib/server";

export const dynamic = "force-dynamic";

/** Step 2: exchange the emailed code for a session. */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as { email?: unknown; code?: unknown; password?: unknown } | null;
    const email = typeof body?.email === "string" ? body.email : "";
    const code = typeof body?.code === "string" ? body.code : "";
    const password = typeof body?.password === "string" ? body.password : "";
    let account: Account;
    if (password) account = await adminPassword(email, password, request);
    else {
      if (!email || !code) throw new ApiError("Enter the 6-digit code from your email.");
      account = await verifyCode(email, code, clientAddress(request));
    }
    await log(account.id, "Signed in", password ? "Admin password (email not set up)" : "Email code").catch(() => {});
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, createSession(account.id), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.VERCEL === "1",
      maxAge: SESSION_MAX_AGE,
    });
    return response;
  } catch (e) {
    return failure(e);
  }
}

/** Temporary admin-only password sign-in while SMTP isn't configured. */
async function adminPassword(email: string, password: string, request: Request): Promise<Account> {
  if (!passwordFallback()) throw new ApiError("Sign in with the code sent to your email.", 400);
  // Reuse the code-check rate limits so the password can't be guessed quickly.
  await verifyThrottle(email, clientAddress(request));
  const admin = adminAccount();
  const ok =
    !!admin &&
    same(normaliseEmail(email), admin.email) &&
    same(password, process.env.AUTH_PASSWORD ?? "");
  if (!ok || !admin) throw new ApiError("Those details didn’t match. Check your email and password, then try again.", 401);
  return admin;
}
