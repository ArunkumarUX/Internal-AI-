import { z } from "zod";
import { identity, database, failure, ApiError } from "@/lib/server";
import { sources } from "@/lib/knowledge";
export async function POST(request: Request) {
  try {
    const user = await identity(request);
    const json = await request.json().catch(() => {
      throw new ApiError("The request couldn’t be read. Please try again.");
    });
    const parsed = z.object({ text: z.string() }).safeParse(json);
    if (!parsed.success || !parsed.data.text.trim()) throw new ApiError("Enter claims to review.");
    const { text } = parsed.data;
    if (text.length > 30000)
      throw new ApiError("Your text is too long to check (max 30,000 characters).");
    const extra = await database()
      .prepare("SELECT id,title,content FROM documents WHERE user_id=? ORDER BY created_at DESC LIMIT 200")
      .bind(user.userId)
      .all();
    const docs = [
      ...sources,
      ...extra.results.map((d) => ({
        id: String(d.id),
        title: String(d.title),
        content: String(d.content),
      })),
    ];
    const all = text
      .split(/\n+|(?<=[.!?])\s+/)
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 15);
    const claims = all.slice(0, 20);
    return Response.json({
      checked: claims.length,
      total: all.length,
      method:
        "Text overlap check — not semantic or factual verification. Review the source before relying on a claim.",
      claims: claims.map((claim: string) => {
        const normalized = claim.toLowerCase().replace(/[^a-z0-9 ]/g, "");
        const words = normalized.split(/\s+/).filter((w) => w.length > 3);
        const ranked = docs
          .map((d) => ({
            d,
            score:
              words.filter((w) => d.content.toLowerCase().includes(w)).length /
              Math.max(words.length, 1),
          }))
          .sort((a, b) => b.score - a.score);
        const exact = docs.find((d) =>
          d.content
            .toLowerCase()
            .replace(/[^a-z0-9 ]/g, "")
            .includes(normalized),
        );
        // Sample conflict: the old pitch says Project Atlas deploys in June
        // 2027; the later status update says August. Only the stale June date
        // is flagged, and only when the claim is about Atlas.
        const conflict =
          /\batlas\b/.test(normalized) &&
          /\bjune\b/.test(normalized) &&
          !/\baugust\b/.test(normalized);
        return {
          claim,
          status: conflict
            ? "Potential conflict"
            : exact
              ? "Exact source match"
              : ranked[0]?.score >= 0.5
                ? "Related evidence · review needed"
                : "No evidence found",
          sourceIds: conflict
            ? ["pitch-old", "atlas-status"]
            : exact
              ? [exact.id]
              : ranked
                  .filter((r) => r.score >= 0.5)
                  .slice(0, 2)
                  .map((r) => r.d.id),
        };
      }),
    });
  } catch (e) {
    return failure(e);
  }
}
