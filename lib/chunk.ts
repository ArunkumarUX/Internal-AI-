/** Passage size for search: big enough for context, small enough to be specific. */
const CHUNK_CHARS = 1200;
const CHUNK_OVERLAP = 150;

/** Splits text into overlapping passages on paragraph or sentence boundaries. */
export function chunk(text: string) {
  const clean = text.replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(clean.length, start + CHUNK_CHARS);
    if (end < clean.length) {
      const window = clean.slice(start + CHUNK_CHARS * 0.6, end);
      const cut = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf(". "), window.lastIndexOf("\n"));
      if (cut > 0) end = start + Math.floor(CHUNK_CHARS * 0.6) + cut + 1;
    }
    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    start = Math.max(end - CHUNK_OVERLAP, start + 1);
  }
  return chunks.slice(0, 400); // ~480k characters is plenty for one document
}

