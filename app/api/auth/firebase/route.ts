import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth-session";
import { accountForSignIn, createSession, SESSION_MAX_AGE } from "@/lib/accounts";
import { verifyFirebaseToken } from "@/lib/firebase-auth";
import { clientAddress, verifyThrottle } from "@/lib/login-codes";
import { failure, log, ApiError } from "@/lib/server";

export const dynamic = "force-dynamic";

/** Exchanges a Firebase ID token (from the emailed sign-in link) for a workspace session. */
export async function POST(request: NextRequest) {
  try {
    // Same-site requests only, like every other workspace mutation.
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) throw new ApiError("Request origin is not allowed.", 403);
    const body = (await request.json().catch(() => null)) as { idToken?: unknown } | null;
    const idToken = typeof body?.idToken === "string" ? body.idToken : "";
    if (!idToken || idToken.length > 8000) throw new ApiError("That sign-in link didn’t work. Request a new one.", 400);
    const email = await verifyFirebaseToken(idToken);
    await verifyThrottle(email, clientAddress(request));
    const account = await accountForSignIn(email);
    if (!account)
      throw new ApiError(
        "This email can’t use this workspace. Use your @naar.io or @nextgentechs.io email, or ask your admin to add you.",
        403,
        "not_allowed",
      );
    await log(account.id, "Signed in", "Firebase email link").catch(() => {});
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
