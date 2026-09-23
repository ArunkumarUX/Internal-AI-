import { identity, failure, log } from "@/lib/server";
import { notionStatus, disconnectNotion } from "@/lib/notion";

export async function GET() {
  try {
    const user = await identity();
    return Response.json(await notionStatus(user.userId));
  } catch (e) {
    return failure(e);
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await identity(request);
    await disconnectNotion(user.userId);
    await log(user.userId, "Integration disconnected", "Notion MCP");
    return Response.json({ connected: false });
  } catch (e) {
    return failure(e);
  }
}
