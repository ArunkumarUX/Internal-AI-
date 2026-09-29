import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const returnTo = safeReturn(request.nextUrl.searchParams.get("return_to"));
  const login = new URL("/", request.url);
  if (returnTo !== "/") login.searchParams.set("return_to", returnTo);
  return NextResponse.redirect(login);
}

function safeReturn(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}
