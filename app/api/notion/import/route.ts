import { z } from "zod";
import { failure, identity, log, ApiError } from "@/lib/server";
import { importNotion } from "@/lib/notion-import";
import { NotionReauthError } from "@/lib/notion";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Copies a Notion page and everything under it into Knowledge. */
export async function POST(request: Request) {
  try {
    const user = await identity(request);
    const parsed = z.object({ url: z.string().min(10).max(2000) }).safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new ApiError("Paste a Notion page link.");
    const result = await importNotion(user.userId, parsed.data.url);
    await log(user.userId, "Notion imported", `${result.imported} new, ${result.updated} updated`).catch(() => {});
    return Response.json(result);
  } catch (e) {
    if (e instanceof NotionReauthError) return failure(new ApiError("Notion needs reconnecting: Settings → Integrations → Notion.", 401, "notion_reauth"));
    return failure(e);
  }
}
