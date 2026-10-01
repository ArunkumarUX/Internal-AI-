import { failure, identity, log } from "@/lib/server";
import { disconnectMicrosoft, microsoftStatus } from "@/lib/microsoft";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await identity();
    return Response.json(await microsoftStatus(user.userId), { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return failure(e);
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await identity(request);
    await disconnectMicrosoft(user.userId);
    await log(user.userId, "Integration disconnected", "Microsoft 365");
    return Response.json(await microsoftStatus(user.userId));
  } catch (e) {
    return failure(e);
  }
}
