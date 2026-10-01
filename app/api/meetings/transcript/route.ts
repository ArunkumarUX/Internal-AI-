import { failure, identity, log, ApiError } from "@/lib/server";
import { teamsTranscript } from "@/lib/microsoft";

export const dynamic = "force-dynamic";

/** Imports the official Teams transcript for a meeting you attended. */
export async function POST(request: Request) {
  try {
    const user = await identity(request);
    const body = (await request.json().catch(() => null)) as { joinUrl?: unknown } | null;
    const joinUrl = typeof body?.joinUrl === "string" ? body.joinUrl.trim() : "";
    if (!joinUrl || joinUrl.length > 2000) throw new ApiError("Choose a Teams meeting first.");
    const text = await teamsTranscript(user.userId, joinUrl);
    await log(user.userId, "Teams transcript imported", "").catch(() => {});
    return Response.json({ text });
  } catch (e) {
    return failure(e);
  }
}
