import { NextRequest, NextResponse } from "next/server";

const COOKIE = "sites_session";
const USER = "local_seedy";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const returnTo = safeReturn(request.nextUrl.searchParams.get("return_to"));
  const response = NextResponse.redirect(new URL(returnTo, request.url));
  response.cookies.set(COOKIE, USER, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.VERCEL === "1",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}

function safeReturn(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}
