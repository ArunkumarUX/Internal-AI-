import { identity, database, bucket, log, failure, ApiError } from "@/lib/server";
const INLINE = new Set(["image/png", "image/jpeg", "image/webp"]);
const EXTENSION: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/csv": "csv",
  "text/plain": "txt",
  "text/markdown": "md",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** Titles are free text, so make sure the download opens with the right app. */
function filename(title: string, mime: string) {
  const ext = EXTENSION[mime];
  if (!ext) return title;
  const lower = title.toLowerCase();
  const ok = lower.endsWith(`.${ext}`) || (ext === "jpg" && lower.endsWith(".jpeg"));
  return ok ? title : `${title}.${ext}`;
}
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await identity();
    const { id } = await params;
    const doc = await database()
      .prepare("SELECT title,mime FROM documents WHERE id=? AND user_id=?")
      .bind(id, user.userId)
      .first();
    if (!doc) throw new ApiError("Document not found.", 404);
    const file = await bucket().get(`${user.userId}/${id}`);
    if (!file) throw new ApiError("Document not found.", 404);
    return new Response(file.body, {
      headers: {
        "Content-Type": String(doc.mime),
        // Raster images render inline (previews, generated images); all else downloads.
        "Content-Disposition": `${INLINE.has(String(doc.mime)) ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(filename(String(doc.title), String(doc.mime)))}`,
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; sandbox",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return failure(e);
  }
}

/** Permanently removes an upload: its original in storage and its indexed text. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await identity(request);
    const { id } = await params;
    const doc = await database()
      .prepare("SELECT title FROM documents WHERE id=? AND user_id=?")
      .bind(id, user.userId)
      .first();
    if (!doc) throw new ApiError("Document not found.", 404);
    // The index row goes first so a storage failure can't leave a searchable ghost.
    await database()
      .prepare("DELETE FROM documents WHERE id=? AND user_id=?")
      .bind(id, user.userId)
      .run();
    try {
      await bucket().delete(`${user.userId}/${id}`);
    } catch (e) {
      console.error("r2 delete", e instanceof Error ? e.message : e);
    }
    await log(user.userId, "Document deleted", String(doc.title)).catch(() => {});
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
