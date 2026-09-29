import { NextRequest, NextResponse } from "next/server";
import { EMAIL_COOKIE, SESSION_COOKIE } from "@/lib/auth-session";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const returnTo = safeReturn(request.nextUrl.searchParams.get("return_to"));
  const response = NextResponse.redirect(new URL(returnTo, request.url));
  const secure = process.env.VERCEL === "1";
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure,
    maxAge: 0,
  });
  response.cookies.set(EMAIL_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure,
    maxAge: 0,
  });
  return response;
}

function safeReturn(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}
