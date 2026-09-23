import { z } from "zod";
import {
  database,
  identity,
  log,
  saveRecord,
  failure,
  ApiError,
} from "@/lib/server";
import { env } from "cloudflare:workers";
export async function GET() {
  try {
    const user = await identity();
    const db = database();
    const [records, documents, audit] = await Promise.all([
      db
        .prepare(
          "SELECT * FROM records WHERE user_id=? ORDER BY updated_at DESC LIMIT 500",
        )
        .bind(user.userId)
        .all(),
      db
        .prepare(
          "SELECT * FROM documents WHERE user_id=? ORDER BY created_at DESC LIMIT 200",
        )
        .bind(user.userId)
        .all(),
      db
        .prepare(
          "SELECT * FROM audit WHERE user_id=? ORDER BY created_at DESC LIMIT 100",
        )
        .bind(user.userId)
        .all(),
    ]);
    return Response.json({
      user,
      records: records.results.map((r) => ({
        ...r,
        data: JSON.parse(String(r.data)),
      })),
      documents: documents.results,
      audit: audit.results,
      aiConfigured:
        !!env.AI_GATEWAY_URL && !!env.AI_GATEWAY_KEY && !!env.AI_MODEL,
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    const user = await identity(request);
    const parsed = z
      .object({
        kind: z.enum([
          "saved",
          "conversation",
          "action",
          "memory",
          "dismissed",
          "settings",
          "mcp",
          "outcome",
        ]),
        id: z.string().max(100).optional(),
        data: z.record(z.unknown()),
      })
      .safeParse(await request.json());
    if (!parsed.success) throw new ApiError("Invalid workspace record.");
    const body = parsed.data;
    if (body.kind === "action" && body.id?.startsWith("act-")) {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(user.userId + ":" + body.id),
      );
      body.id = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    }
    const allowed = [
      "saved",
      "conversation",
      "action",
      "memory",
      "dismissed",
      "settings",
      "mcp",
      "outcome",
    ];
    if (
      !allowed.includes(body.kind) ||
      typeof body.data !== "object" ||
      body.data === null ||
      JSON.stringify(body.data).length > 250000
    )
      throw new ApiError("This workspace record is invalid.");
    if (body.id) {
      if (typeof body.id !== "string" || body.id.length > 100)
        throw new ApiError("Invalid record identifier.");
      const existing = await database()
        .prepare("SELECT user_id,kind FROM records WHERE id=?")
        .bind(body.id)
        .first();
      if (
        existing &&
        (existing.user_id !== user.userId || existing.kind !== body.kind)
      )
        throw new ApiError("Record not found.", 404);
    }
    if (
      body.kind === "mcp" &&
      ("token" in body.data || "password" in body.data || "secret" in body.data)
    )
      throw new ApiError(
        "Store credentials in server environment settings, not in a workspace record.",
      );
    const id = await saveRecord(user.userId, body.kind, body.data, body.id);
    await log(
      user.userId,
      body.kind === "action"
        ? "Action updated"
        : body.kind === "memory"
          ? "Knowledge approved"
          : "Work saved",
      String(body.data.title ?? body.kind).slice(0, 200),
    );
    return Response.json({ id });
  } catch (e) {
    return failure(e);
  }
}
