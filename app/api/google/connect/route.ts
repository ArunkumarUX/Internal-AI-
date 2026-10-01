import { identity, failure, ApiError } from "@/lib/server";
import { startGoogleAuth } from "@/lib/google-calendar";

export const dynamic = "force-dynamic";

const redirect = (location: string, cookie?: string) =>
  new Response(null, {
    status: 302,
    headers: { Location: location, "Cache-Control": "no-store", ...(cookie ? { "Set-Cookie": cookie } : {}) },
  });

/** Starts the Google Calendar sign-in; only a top-level navigation from this app may start it. */
export async function GET(request: Request) {
  try {
    const site = request.headers.get("sec-fetch-site");
    if (site && site !== "same-origin" && site !== "none")
      throw new ApiError("Connect Google Calendar from the Meeting assistant.", 403);
    try {
      await identity();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return redirect("/?google=signin");
      throw e;
    }
    const origin = process.env.APP_ORIGIN?.trim() ? new URL(process.env.APP_ORIGIN).origin : new URL(request.url).origin;
    const { url, cookie } = startGoogleAuth(origin);
    return redirect(url, cookie);
  } catch (e) {
    return failure(e);
  }
}
