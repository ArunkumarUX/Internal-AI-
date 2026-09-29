import { env } from "@/lib/env";
import { identity, failure, ApiError } from "@/lib/server";
import { startNotionAuth } from "@/lib/notion";

const redirect = (location: string, cookie?: string) =>
  new Response(null, {
    status: 302,
    headers: {
      Location: location,
      "Cache-Control": "no-store",
      ...(cookie ? { "Set-Cookie": cookie } : {}),
    },
  });

/** Starts the Notion OAuth flow; only a top-level navigation from this app may start it. */
export async function GET(request: Request) {
  try {
    const site = request.headers.get("sec-fetch-site");
    if (site && site !== "same-origin" && site !== "none")
      throw new ApiError("Start the Notion connection from Settings.", 403);
    try {
      await identity();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return redirect("/?notion=signin");
      throw e;
    }
    const configured = typeof env.APP_ORIGIN === "string" && env.APP_ORIGIN ? new URL(env.APP_ORIGIN).origin : undefined;
    const { url, cookie } = await startNotionAuth(request, configured);
    return redirect(url, cookie);
  } catch (e) {
    return failure(e);
  }
}
