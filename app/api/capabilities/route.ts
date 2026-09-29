import { identity, failure } from "@/lib/server";
import { capabilities } from "@/lib/ai";

/** What the configured gateway key may use; cached for 12 hours per user. */
export async function GET() {
  try {
    const user = await identity();
    return Response.json(await capabilities(user.userId));
  } catch (e) {
    return failure(e);
  }
}

/** Re-probes the gateway; at most once a minute per user. */
export async function POST(request: Request) {
  try {
    const user = await identity(request);
    return Response.json(await capabilities(user.userId, true));
  } catch (e) {
    return failure(e);
  }
}
