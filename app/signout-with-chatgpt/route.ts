import { NextRequest, NextResponse } from "next/server";

const COOKIE = "sites_session";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const returnTo = safeReturn(request.nextUrl.searchParams.get("return_to"));
  const response = NextResponse.redirect(new URL(returnTo, request.url));
  response.cookies.set(COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.VERCEL === "1",
    maxAge: 0,
  });
  return response;
}

function safeReturn(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}
