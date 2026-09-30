import { database, failure, identity } from "@/lib/server";
import { requireMember, type MessageRow } from "@/lib/messaging";

export const dynamic = "force-dynamic";

const PAGE = 100;

/** Messages in one conversation: the latest page, or only those after `after`. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await identity();
    const { id } = await params;
    await requireMember(id, user.userId);
    const after = new URL(request.url).searchParams.get("after") ?? "";
    const db = database();
    const rows = after
      ? ((
          await db
            .prepare(
              "SELECT * FROM messages WHERE conversation_id=? AND created_at>? ORDER BY created_at, id LIMIT 500",
            )
            .bind(id, after)
            .all<MessageRow>()
        ).results ?? [])
      : ((
          await db
            .prepare("SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at DESC, id DESC LIMIT ?")
            .bind(id, PAGE)
            .all<MessageRow>()
        ).results ?? []).reverse();
    // Everyone's read position, so the thread can show "Seen".
    const reads =
      (
        await db
          .prepare("SELECT user_id,last_read_at FROM conversation_members WHERE conversation_id=?")
          .bind(id)
          .all<{ user_id: string; last_read_at: string }>()
      ).results ?? [];
    return Response.json(
      {
        messages: rows.map((m) => ({ id: m.id, userId: m.user_id, body: m.body, at: m.created_at })),
        reads: Object.fromEntries(reads.map((r) => [r.user_id, r.last_read_at])),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
