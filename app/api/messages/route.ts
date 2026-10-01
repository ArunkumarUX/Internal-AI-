import { z } from "zod";
import { database, failure, identity, ApiError } from "@/lib/server";
import { GROUP_LIMIT, MESSAGE_LIMIT, people, placeholders, requireMember, type MessageRow } from "@/lib/messaging";

export const dynamic = "force-dynamic";

type ConversationRow = { id: string; kind: string; title: string; updated_at: string; last_read_at: string };

/** Your conversations, newest first, with the last message and unread counts. */
export async function GET() {
  try {
    const user = await identity();
    const db = database();
    const directory = await people();
    const conversations =
      (
        await db
          .prepare(
            "SELECT c.id,c.kind,c.title,c.updated_at,cm.last_read_at FROM conversations c JOIN conversation_members cm ON cm.conversation_id=c.id AND cm.user_id=? ORDER BY c.updated_at DESC LIMIT 200",
          )
          .bind(user.userId)
          .all<ConversationRow>()
      ).results ?? [];
    const ids = conversations.map((c) => c.id);
    const members = new Map<string, string[]>();
    const last = new Map<string, MessageRow>();
    const unread = new Map<string, number>();
    if (ids.length) {
      const inList = placeholders(ids.length);
      for (const row of (
        await db
          .prepare(`SELECT conversation_id,user_id FROM conversation_members WHERE conversation_id IN (${inList})`)
          .bind(...ids)
          .all<{ conversation_id: string; user_id: string }>()
      ).results ?? [])
        members.set(row.conversation_id, [...(members.get(row.conversation_id) ?? []), row.user_id]);
      for (const row of (
        await db
          .prepare(
            `SELECT m.* FROM messages m WHERE m.conversation_id IN (${inList}) AND m.created_at=(SELECT max(created_at) FROM messages WHERE conversation_id=m.conversation_id)`,
          )
          .bind(...ids)
          .all<MessageRow>()
      ).results ?? [])
        last.set(row.conversation_id, row);
      for (const row of (
        await db
          .prepare(
            "SELECT m.conversation_id AS id, count(*) AS n FROM messages m JOIN conversation_members cm ON cm.conversation_id=m.conversation_id AND cm.user_id=? WHERE m.user_id<>? AND m.created_at>cm.last_read_at GROUP BY m.conversation_id",
          )
          .bind(user.userId, user.userId)
          .all<{ id: string; n: number }>()
      ).results ?? [])
        unread.set(row.id, Number(row.n));
    }
    const list = conversations.map((c) => ({
      id: c.id,
      kind: c.kind,
      title: c.title,
      updatedAt: c.updated_at,
      members: members.get(c.id) ?? [],
      last: last.get(c.id)
        ? { body: last.get(c.id)!.body.slice(0, 160), userId: last.get(c.id)!.user_id, at: last.get(c.id)!.created_at }
        : null,
      unread: unread.get(c.id) ?? 0,
    }));
    return Response.json(
      {
        me: user.userId,
        people: [...directory.values()],
        conversations: list,
        unread: list.reduce((n, c) => n + c.unread, 0),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}

const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("open"),
    with: z.array(z.string().max(100)).min(1, "Choose at least one person.").max(GROUP_LIMIT - 1),
    title: z.string().trim().max(80).optional(),
  }),
  z.object({
    action: z.literal("send"),
    conversationId: z.string().max(100),
    body: z.string().trim().min(1, "Write a message first.").max(MESSAGE_LIMIT, `Messages are limited to ${MESSAGE_LIMIT.toLocaleString()} characters.`),
  }),
  z.object({ action: z.literal("read"), conversationId: z.string().max(100) }),
]);

export async function POST(request: Request) {
  try {
    const user = await identity(request);
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new ApiError(parsed.error.issues[0]?.message ?? "Invalid request.");
    const body = parsed.data;
    const db = database();
    const now = new Date().toISOString();

    if (body.action === "open") {
      const directory = await people();
      const others = [...new Set(body.with)].filter((id) => id !== user.userId);
      if (!others.length) throw new ApiError("Choose someone other than yourself.");
      if (others.some((id) => !directory.has(id))) throw new ApiError("Someone you chose is no longer on the team.", 404);
      const participants = [user.userId, ...others];
      // A direct message between two people is reused; groups are always new.
      const dmKey = participants.length === 2 ? [...participants].sort().join("|") : "";
      if (dmKey) {
        const existing = await db
          .prepare("SELECT id FROM conversations WHERE dm_key=? LIMIT 1")
          .bind(dmKey)
          .first<{ id: string }>();
        if (existing) return Response.json({ id: existing.id });
      }
      const id = crypto.randomUUID();
      // The conversation and all its members in one save, so nobody sees half of it.
      await db.batch([
        db
          .prepare(
            "INSERT INTO conversations (id,kind,title,dm_key,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
          )
          .bind(id, dmKey ? "dm" : "group", dmKey ? "" : (body.title ?? ""), dmKey, user.userId, now, now),
        ...participants.map((member) =>
          db
            .prepare("INSERT OR IGNORE INTO conversation_members (conversation_id,user_id,last_read_at) VALUES (?,?,?)")
            .bind(id, member, member === user.userId ? now : ""),
        ),
      ]);
      return Response.json({ id });
    }

    await requireMember(body.conversationId, user.userId);

    if (body.action === "send") {
      // Don't send into a conversation where everyone else has left the team.
      const directory = await people();
      const others =
        (
          await db
            .prepare("SELECT user_id FROM conversation_members WHERE conversation_id=? AND user_id<>?")
            .bind(body.conversationId, user.userId)
            .all<{ user_id: string }>()
        ).results ?? [];
      if (others.length && !others.some((o) => directory.has(o.user_id)))
        throw new ApiError("No one else in this conversation is on the team any more.", 409);
      const id = crypto.randomUUID();
      // One save for the message, the conversation's order and your read position.
      await db.batch([
        db
          .prepare("INSERT INTO messages (id,conversation_id,user_id,body,created_at) VALUES (?,?,?,?,?)")
          .bind(id, body.conversationId, user.userId, body.body, now),
        db.prepare("UPDATE conversations SET updated_at=? WHERE id=?").bind(now, body.conversationId),
        db
          .prepare("UPDATE conversation_members SET last_read_at=? WHERE conversation_id=? AND user_id=?")
          .bind(now, body.conversationId, user.userId),
      ]);
      return Response.json({ id, conversationId: body.conversationId, userId: user.userId, body: body.body, at: now });
    }

    await db
      .prepare("UPDATE conversation_members SET last_read_at=? WHERE conversation_id=? AND user_id=? AND last_read_at<?")
      .bind(now, body.conversationId, user.userId, now)
      .run();
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
