import { identity, log, ApiError } from "@/lib/server";
import { clearMicrosoftCookie, finishMicrosoftAuth } from "@/lib/microsoft";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  let outcome = "connected";
  try {
    const user = await identity();
    await finishMicrosoftAuth(user.userId, request);
    await log(user.userId, "Integration connected", "Microsoft 365");
  } catch (e) {
    console.error(e instanceof Error ? e.message : "Microsoft connection failed");
    outcome = e instanceof ApiError && e.status === 401 ? "signin" : "failed";
  }
  return new Response(null, {
    status: 302,
    headers: {
      Location: `/?microsoft=${outcome}#meeting-assistant`,
      "Set-Cookie": clearMicrosoftCookie,
      "Cache-Control": "no-store",
    },
  });
}
