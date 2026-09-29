import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { EMAIL_COOKIE, SESSION_COOKIE, SESSION_USER } from "@/lib/auth-session";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const expectedEmail = process.env.AUTH_EMAIL?.trim().toLowerCase() ?? "";
  const expectedPassword = process.env.AUTH_PASSWORD ?? "";
  if (!expectedEmail || !expectedPassword) {
    return NextResponse.json(
      { error: "Sign-in isn’t configured for this instance. Ask an admin to set workspace access." },
      { status: 503 },
    );
  }
  const parsed = (await request.json().catch(() => null)) as {
    email?: unknown;
    password?: unknown;
  } | null;
  const email = typeof parsed?.email === "string" ? parsed.email.trim().toLowerCase() : "";
  const password = typeof parsed?.password === "string" ? parsed.password : "";
  if (!email || !password || !same(email, expectedEmail) || !same(password, expectedPassword)) {
    return NextResponse.json(
      { error: "Those details didn’t match. Check your email and password, then try again." },
      { status: 401 },
    );
  }
  const response = NextResponse.json({ ok: true });
  const secure = process.env.VERCEL === "1";
  response.cookies.set(SESSION_COOKIE, SESSION_USER, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure,
    maxAge: 60 * 60 * 24 * 30,
  });
  response.cookies.set(EMAIL_COOKIE, email, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure,
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}

function same(left: string, right: string) {
  const a = createHash("sha256").update(left).digest();
  const b = createHash("sha256").update(right).digest();
  return timingSafeEqual(a, b);
}
