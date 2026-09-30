import { database, ApiError } from "@/lib/server";
import { listAccounts, type Account } from "@/lib/accounts";

export const MESSAGE_LIMIT = 4000;
export const GROUP_LIMIT = 20;

export type Person = { id: string; name: string; role: Account["role"] };
export type MessageRow = { id: string; conversation_id: string; user_id: string; body: string; created_at: string };

export async function people(): Promise<Map<string, Person>> {
  return new Map((await listAccounts()).map((a) => [a.id, { id: a.id, name: a.name, role: a.role }]));
}

/** Throws unless the user belongs to the conversation. */
export async function requireMember(conversationId: string, userId: string) {
  const row = await database()
    .prepare("SELECT last_read_at FROM conversation_members WHERE conversation_id=? AND user_id=?")
    .bind(conversationId, userId)
    .first<{ last_read_at: string }>();
  if (!row) throw new ApiError("Conversation not found.", 404);
  return row;
}

export const placeholders = (n: number) => Array.from({ length: n }, () => "?").join(",");
