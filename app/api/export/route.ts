import { z } from "zod";
import { identity, database, bucket, log, failure, ApiError } from "@/lib/server";
import { buildDocx } from "@/lib/docx";
import { readSkills } from "@/lib/engine";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Creates a Word document from an answer, saves it to uploads, returns it. */
export async function POST(request: Request) {
  try {
    const user = await identity(request);
    const parsed = z
      .object({
        title: z.string().trim().min(1).max(200),
        markdown: z.string().min(1).max(200000),
        save: z.boolean().default(true),
      })
      .safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new ApiError("Nothing to export.");
    if (!(await readSkills(user.userId))["create-docs"])
      throw new ApiError("Turn on the Document creation skill to export Word documents.", 409);
    const { title, markdown, save } = parsed.data;
    const bytes = buildDocx(
      title,
      markdown,
      `Prepared with Internal AI for ${user.displayName} · ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`,
    );
    let id: string | undefined;
    if (save) {
      id = crypto.randomUUID();
      await bucket().put(`${user.userId}/${id}`, bytes, { httpMetadata: { contentType: DOCX } });
      try {
        await database()
          .prepare(
            "INSERT INTO documents (id,user_id,title,content,mime,size,created_at,client,category,doc_date) VALUES (?,?,?,?,?,?,?,?,?,?)",
          )
          .bind(id, user.userId, `${title}.docx`, markdown.slice(0, 300000), DOCX, bytes.length, new Date().toISOString(), "", "Generated document", new Date().toISOString().slice(0, 10))
          .run();
      } catch (e) {
        // Don't leave an orphaned original if the index row can't be written.
        await bucket().delete(`${user.userId}/${id}`).catch(() => {});
        throw e;
      }
    }
    await log(user.userId, "Document created", title);
    return new Response(bytes, {
      headers: {
        "Content-Type": DOCX,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(title.replace(/[\\/:*?"<>|]/g, "").slice(0, 100))}.docx`,
        "Cache-Control": "no-store",
        ...(id ? { "X-Document-Id": id } : {}),
      },
    });
  } catch (e) {
    return failure(e);
  }
}
