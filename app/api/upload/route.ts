import {
  identity,
  database,
  bucket,
  log,
  failure,
  ApiError,
} from "@/lib/server";
import { unzipSync, strFromU8 } from "fflate";
import { capabilities, describeImage, gateway } from "@/lib/ai";
import { indexDocument } from "@/lib/search";
/** The stored type comes from the checked extension, never the client. */
const MIME: Record<string, string> = {
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};
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
/** Real calendar date, not later than today anywhere on Earth (UTC+14). */
function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return false;
  return value <= new Date(Date.now() + 14 * 3600 * 1000).toISOString().slice(0, 10);
}

/** UTF-8 when valid, otherwise Windows-1252 (Excel's usual CSV export). */
function decodeText(bytes: Uint8Array) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder("windows-1252").decode(bytes);
    } catch {
      let out = "";
      for (let i = 0; i < bytes.length; i += 0x8000)
        out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return out;
    }
  }
}

const IMAGE_LIMIT = 7 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const user = await identity(request);
    if (Number(request.headers.get("content-length") ?? 0) > 12 * 1024 * 1024)
      throw new ApiError("Choose a file smaller than 10 MB.");
    const form = await request.formData().catch(() => {
      throw new ApiError("The upload couldn’t be read. Please choose the file again.");
    });
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
    if (docDate && !validDate(docDate))
      throw new ApiError("Enter a real date that isn't in the future.");
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
    const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    let content = "";
    if (["txt", "md", "csv"].includes(ext!)) content = decodeText(bytes);
    else if (ext === "pdf") {
      // Encrypted or malformed PDFs are still stored, just without text.
      try {
        const { extractText } = await import("unpdf");
        const result = await extractText(bytes.slice(), { mergePages: true });
        content = Array.isArray(result.text)
          ? result.text.join("\n")
          : result.text;
      } catch (e) {
        console.error("pdf", e instanceof Error ? e.message : e);
      }
    } else if (["docx", "pptx", "xlsx"].includes(ext!)) {
      try {
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
      } catch (e) {
        if (e instanceof ApiError) throw e;
        console.error("office", e instanceof Error ? e.message : e);
      }
    }
    const image = ["png", "jpg", "jpeg", "webp"].includes(ext!);
    let vision: "read" | "too-large" | "unavailable" | "failed" | "" = "";
    if (image && file.size > IMAGE_LIMIT) vision = "too-large";
    else if (image) {
      // Images are read by the vision model so screenshots become searchable text.
      try {
        const ai = await gateway(user.userId);
        if (ai && (await capabilities(user.userId)).vision) {
          content = await describeImage(ai, bytes, MIME[ext!]);
          vision = content.trim() ? "read" : "failed";
        } else vision = "unavailable";
      } catch (e) {
        console.error("vision", e instanceof Error ? e.message : e);
        vision = "failed";
      }
    }
    content = content.slice(0, 300000);
    const id = crypto.randomUUID();
    const mime = MIME[ext!];
    const createdAt = new Date().toISOString();
    // Same bytes uploaded before: still stored, but the UI can warn.
    const duplicate = await database()
      .prepare("SELECT id,title FROM documents WHERE user_id=? AND sha256=? LIMIT 1")
      .bind(user.userId, sha256)
      .first()
      .catch(() => null);
    await bucket().put(`${user.userId}/${id}`, bytes, {
      httpMetadata: { contentType: mime },
      customMetadata: { sha256 },
    });
    try {
      const values = [id, user.userId, title, content, mime, file.size, createdAt, client, category, docDate];
      try {
        await database()
          .prepare(
            "INSERT INTO documents (id,user_id,title,content,mime,size,created_at,client,category,doc_date,sha256) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
          )
          .bind(...values, sha256)
          .run();
      } catch (e) {
        // Databases without migration 0003 have no sha256 column yet.
        if (!/sha256/i.test(e instanceof Error ? e.message : "")) throw e;
        await database()
          .prepare(
            "INSERT INTO documents (id,user_id,title,content,mime,size,created_at,client,category,doc_date) VALUES (?,?,?,?,?,?,?,?,?,?)",
          )
          .bind(...values)
          .run();
      }
    } catch (e) {
      await bucket().delete(`${user.userId}/${id}`);
      throw e;
    }
    // Searchable straight away; a search problem never fails the upload.
    await indexDocument(user.userId, id, title, content).catch((e) =>
      console.error("index", e instanceof Error ? e.message : e),
    );
    await log(
      user.userId,
      "Document uploaded",
      client ? `${title} · ${client}` : title,
    ).catch(() => {});
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
      ...(duplicate ? { duplicateOf: { id: String(duplicate.id), title: String(duplicate.title) } } : {}),
      notice:
        vision === "read"
          ? "Image uploaded and read by AI. Its text is now searchable."
          : vision === "too-large"
            ? "Image saved. It's too large for AI reading (limit 7 MB)."
            : vision === "unavailable"
              ? "Image saved. Your AI gateway can't read images, so it isn't searchable."
              : vision === "failed"
                ? "Image saved, but AI reading failed. Try uploading again."
                : ext === "pdf" && !content.trim()
                  ? "PDF saved. It has no selectable text (scanned or protected), so it isn't searchable."
                  : content.trim()
                    ? "Document uploaded and text indexed."
                    : "Original saved. No text could be extracted from this file.",
    });
  } catch (e) {
    return failure(e);
  }
}
