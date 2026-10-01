import { identity, log, ApiError } from "@/lib/server";
import { clearGoogleCookie, finishGoogleAuth } from "@/lib/google-calendar";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  let outcome = "connected";
  try {
    const user = await identity();
    await finishGoogleAuth(user.userId, request);
    await log(user.userId, "Integration connected", "Google Calendar");
  } catch (e) {
    console.error(e instanceof Error ? e.message : "Google connection failed");
    outcome = e instanceof ApiError && e.status === 401 ? "signin" : "failed";
  }
  return new Response(null, {
    status: 302,
    headers: {
      Location: `/?google=${outcome}#meeting-assistant`,
      "Set-Cookie": clearGoogleCookie,
      "Cache-Control": "no-store",
    },
  });
}
