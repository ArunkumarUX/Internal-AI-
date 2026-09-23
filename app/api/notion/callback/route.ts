import { identity, log, ApiError } from "@/lib/server";
import { finishNotionAuth, clearAuthCookie } from "@/lib/notion";

export async function GET(request: Request) {
  let outcome = "connected";
  try {
    const user = await identity();
    await finishNotionAuth(user.userId, request);
    await log(user.userId, "Integration connected", "Notion MCP");
  } catch (e) {
    console.error(e instanceof Error ? e.message : "Notion connection failed");
    outcome = e instanceof ApiError && e.status === 401 ? "signin" : "failed";
  }
  return new Response(null, {
    status: 302,
    headers: {
      Location: `/?notion=${outcome}#settings`,
      "Set-Cookie": clearAuthCookie,
      "Cache-Control": "no-store",
    },
  });
}
