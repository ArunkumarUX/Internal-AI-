import { identity, database, failure, ApiError } from "@/lib/server";

/** Full extracted text for one upload; the workspace load only carries a preview. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await identity();
    const { id } = await params;
    const doc = await database()
      .prepare(
        "SELECT id,title,content,mime,size,created_at,client,category,doc_date FROM documents WHERE id=? AND user_id=?",
      )
      .bind(id, user.userId)
      .first();
    if (!doc) throw new ApiError("Document not found.", 404);
    return Response.json(doc, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return failure(e);
  }
}
