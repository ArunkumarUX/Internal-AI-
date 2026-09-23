import { identity, failure } from "@/lib/server";
import { startNotionAuth } from "@/lib/notion";

export async function GET(request: Request) {
  try {
    await identity();
    const { url, cookie } = await startNotionAuth(request);
    return new Response(null, {
      status: 302,
      headers: { Location: url, "Set-Cookie": cookie, "Cache-Control": "no-store" },
    });
  } catch (e) {
    return failure(e);
  }
}
