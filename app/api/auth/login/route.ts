import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth-session";
import { createSession, SESSION_MAX_AGE } from "@/lib/accounts";
import { clientAddress, verifyCode } from "@/lib/login-codes";
import { failure, log, ApiError } from "@/lib/server";

export const dynamic = "force-dynamic";

/** Step 2: exchange the emailed code for a session. */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as { email?: unknown; code?: unknown } | null;
    const email = typeof body?.email === "string" ? body.email : "";
    const code = typeof body?.code === "string" ? body.code : "";
    if (!email || !code) throw new ApiError("Enter the 6-digit code from your email.");
    const account = await verifyCode(email, code, clientAddress(request));
    await log(account.id, "Signed in", "Email code").catch(() => {});
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
