import {
  identity,
  database,
  bucket,
  log,
  failure,
  ApiError,
} from "@/lib/server";
import { unzipSync, strFromU8 } from "fflate";
function xmlText(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
export async function POST(request: Request) {
  try {
    const user = await identity(request);
    if (Number(request.headers.get("content-length") ?? 0) > 12 * 1024 * 1024)
      throw new ApiError("Choose a file smaller than 10 MB.");
    const form = await request.formData();
    const file = form.get("file");
    if (
      !(file instanceof File) ||
      file.size > 10 * 1024 * 1024 ||
      file.size === 0
    )
      throw new ApiError("Choose a non-empty document smaller than 10 MB.");
    const field = (name: string, max: number) =>
      String(form.get(name) ?? "")
        .trim()
        .slice(0, max);
    const title = field("title", 250) || file.name.slice(0, 250);
    const client = field("client", 120);
    const category = field("category", 80);
    const docDate = field("docDate", 10);
    if (docDate && !/^\d{4}-\d{2}-\d{2}$/.test(docDate))
      throw new ApiError("Enter the document date as YYYY-MM-DD.");
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (
      ![
        "txt",
        "md",
        "csv",
        "pdf",
        "docx",
        "pptx",
        "xlsx",
        "png",
        "jpg",
        "jpeg",
        "webp",
      ].includes(ext ?? "")
    )
      throw new ApiError(
        "Supported files: PDF, DOCX, PPTX, XLSX, TXT, Markdown, CSV, PNG, JPG and WebP.",
      );
    const bytes = new Uint8Array(await file.arrayBuffer());
    let content = "";
    if (["txt", "md", "csv"].includes(ext!))
      content = new TextDecoder().decode(bytes);
    else if (ext === "pdf") {
      const { extractText } = await import("unpdf");
      const result = await extractText(bytes.slice(), { mergePages: true });
      content = Array.isArray(result.text)
        ? result.text.join("\n")
        : result.text;
    } else if (["docx", "pptx", "xlsx"].includes(ext!)) {
      let expanded = 0;
      const parts = unzipSync(bytes, {
        filter: (f) => {
          expanded += f.originalSize;
          if (expanded > 30 * 1024 * 1024)
            throw new ApiError(
              "The expanded document is too large. Please split it into smaller files.",
            );
          return /^(word\/document|ppt\/slides\/slide\d+|xl\/sharedStrings|xl\/worksheets\/sheet\d+)\.xml$/.test(
            f.name,
          );
        },
      });
      content = Object.entries(parts)
        .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
        .map(([name, part]) => `${name}\n${xmlText(strFromU8(part))}`)
        .join("\n\n");
    }
    content = content.slice(0, 300000);
    const id = crypto.randomUUID();
    const mime = file.type || "application/octet-stream";
    const createdAt = new Date().toISOString();
    await bucket().put(`${user.userId}/${id}`, bytes, {
      httpMetadata: { contentType: mime },
    });
    try {
      await database()
        .prepare(
          "INSERT INTO documents (id,user_id,title,content,mime,size,created_at,client,category,doc_date) VALUES (?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          id,
          user.userId,
          title,
          content,
          mime,
          file.size,
          createdAt,
          client,
          category,
          docDate,
        )
        .run();
    } catch (e) {
      await bucket().delete(`${user.userId}/${id}`);
      throw e;
    }
    await log(
      user.userId,
      "Document uploaded",
      client ? `${title} · ${client}` : title,
    );
    return Response.json({
      id,
      title,
      content,
      mime,
      size: file.size,
      created_at: createdAt,
      client,
      category,
      doc_date: docDate,
      notice: content
        ? "Document uploaded and text indexed."
        : "Original saved. This file has no extractable text; OCR/image understanding is not configured.",
    });
  } catch (e) {
    return failure(e);
  }
}
