import { identity, database, bucket, failure, ApiError } from "@/lib/server";
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
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(String(doc.title))}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return failure(e);
  }
}
