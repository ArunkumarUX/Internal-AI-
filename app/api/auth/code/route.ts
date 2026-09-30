import { NextRequest, NextResponse } from "next/server";
import { adminAccount, EMAIL_PATTERN, secret } from "@/lib/accounts";
import { clientAddress, requestCode } from "@/lib/login-codes";
import { failure, ApiError } from "@/lib/server";

export const dynamic = "force-dynamic";

/** Step 1: email a one-time sign-in code. */
export async function POST(request: NextRequest) {
  try {
    if (!adminAccount()) throw new ApiError("Sign-in isn’t configured for this workspace. Ask your admin to set AUTH_EMAIL.", 503);
    secret(); // fail clearly if AUTH_SECRET is missing
    const body = (await request.json().catch(() => null)) as { email?: unknown } | null;
    const email = typeof body?.email === "string" ? body.email.trim() : "";
    if (!EMAIL_PATTERN.test(email) || email.length > 200)
      throw new ApiError("Enter your work email, like name@company.com.");
    const { wait } = await requestCode(email, clientAddress(request));
    return NextResponse.json({ ok: true, wait });
  } catch (e) {
    return failure(e);
  }
}
