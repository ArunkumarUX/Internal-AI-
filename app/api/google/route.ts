import { failure, identity, log } from "@/lib/server";
import { disconnectGoogle, googleStatus } from "@/lib/google-calendar";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await identity();
    return Response.json(await googleStatus(user.userId), { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return failure(e);
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await identity(request);
    await disconnectGoogle(user.userId);
    await log(user.userId, "Integration disconnected", "Google Calendar");
    return Response.json(await googleStatus(user.userId));
  } catch (e) {
    return failure(e);
  }
}
