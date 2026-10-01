import { identity, failure, ApiError } from "@/lib/server";
import { startMicrosoftAuth } from "@/lib/microsoft";

export const dynamic = "force-dynamic";

const redirect = (location: string, cookie?: string) =>
  new Response(null, {
    status: 302,
    headers: { Location: location, "Cache-Control": "no-store", ...(cookie ? { "Set-Cookie": cookie } : {}) },
  });

/** Starts the Microsoft 365 sign-in; only a top-level navigation from this app may start it. */
export async function GET(request: Request) {
  try {
    const site = request.headers.get("sec-fetch-site");
    if (site && site !== "same-origin" && site !== "none")
      throw new ApiError("Connect Microsoft 365 from the Meeting assistant.", 403);
    try {
      await identity();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return redirect("/?microsoft=signin");
      throw e;
    }
    const origin = process.env.APP_ORIGIN?.trim() ? new URL(process.env.APP_ORIGIN).origin : new URL(request.url).origin;
    const { url, cookie } = startMicrosoftAuth(origin);
    return redirect(url, cookie);
  } catch (e) {
    return failure(e);
  }
}
