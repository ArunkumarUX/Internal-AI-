import { failure, identity } from "@/lib/server";
import { listMeetings, microsoftStatus } from "@/lib/microsoft";

export const dynamic = "force-dynamic";

/** Your Teams / Outlook meetings from yesterday to a week ahead. */
export async function GET() {
  try {
    const user = await identity();
    const status = await microsoftStatus(user.userId);
    if (!status.connected) return Response.json({ ...status, meetings: [] });
    return Response.json(
      { ...status, meetings: await listMeetings(user.userId) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
