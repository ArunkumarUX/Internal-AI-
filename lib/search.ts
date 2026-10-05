import { gateway } from "@/lib/ai";
import { ensureSchema, pgConfigured, postgresD1 } from "@/lib/postgres";
import { chunk } from "@/lib/chunk";
import { AllRefused, isRefusal, withModel, workingModel } from "@/lib/model-router";

export { chunk };

/*
 * Fast document search on Supabase Postgres:
 *   - full-text search (tsvector + GIN index) works straight away;
 *   - pgvector semantic search joins in once the AI key allows an embedding
 *     model (AI_EMBEDDING_MODEL, default text-embedding-v4, 1024 dimensions).
 * Results are merged with reciprocal-rank fusion. Without Postgres, callers
 * fall back to loading every document as before.
 */

const DIMENSIONS = 1024;
const EMBED_BATCH = 10;

export const searchAvailable = () => pgConfigured();
const sql = () => postgresD1().raw();

/* ---------------------------------------------------------------- */
/* Embeddings                                                         */
/* ---------------------------------------------------------------- */

// When the key refuses every embedding model, don't ask again for a while.
let deniedUntil = 0;

/** Vectors for `inputs` and the model that made them (chosen automatically). */
async function embed(userId: string, inputs: string[]): Promise<{ vectors: number[][]; model: string } | null> {
  if (!inputs.length || Date.now() < deniedUntil) return null;
  const ai = await gateway(userId).catch(() => null);
  if (!ai) return null;
  try {
    type Embedded = { vectors: number[][]; model: string } | null;
    return await withModel<Embedded>("embedding", async (model): Promise<Embedded | { refused: true }> => {
      const response = await fetch(`${ai.base}/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${ai.key}` },
        body: JSON.stringify({ model, input: inputs, dimensions: DIMENSIONS, encoding_format: "float" }),
        signal: AbortSignal.timeout(20_000),
      });
      const json = (await response.json().catch(() => ({}))) as {
        data?: { embedding: number[]; index: number }[];
        error?: { code?: string };
      };
      if (isRefusal(response.status, json.error?.code)) return { refused: true as const };
      if (!response.ok || !json.data || json.data[0]?.embedding.length !== DIMENSIONS) return null;
      return { vectors: json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding), model };
    });
  } catch (e) {
    if (e instanceof AllRefused) deniedUntil = Date.now() + 10 * 60 * 1000;
    return null;
  }
}

const vector = (values: number[]) => `[${values.join(",")}]`;

/* ---------------------------------------------------------------- */
/* Indexing                                                           */
/* ---------------------------------------------------------------- */

/** Stores a document's passages, embedding them when the model is available. */
export async function indexDocument(userId: string, documentId: string, title: string, content: string) {
  if (!pgConfigured()) return;
  await ensureSchema();
  const pieces = chunk(`${title}\n\n${content}`);
  const db = sql();
  await db.begin(async (tx) => {
    await tx`DELETE FROM document_chunks WHERE document_id = ${documentId}`;
    for (let i = 0; i < pieces.length; i += 100) {
      const rows = pieces.slice(i, i + 100).map((text, k) => ({ document_id: documentId, user_id: userId, ord: i + k, content: text }));
      await tx`INSERT INTO document_chunks ${tx(rows, "document_id", "user_id", "ord", "content")}`;
    }
  });
  await embedPending(userId, 60);
}

/** Embeds passages that don't have a vector yet (new uploads, or after the model is allowed). */
export async function embedPending(userId: string, limit = 60) {
  if (!pgConfigured() || Date.now() < deniedUntil) return 0;
  const db = sql();
  const current = workingModel("embedding");
  const rows = await db<{ id: number; content: string }[]>`
    SELECT id, content FROM document_chunks
    WHERE user_id = ${userId}
      AND (embedding IS NULL ${
        // Once a model is known to work, passages embedded by another model are redone.
        current ? db`OR embedding_model IS DISTINCT FROM ${current}` : db``
      })
    ORDER BY embedding IS NOT NULL, id LIMIT ${limit}`;
  let done = 0;
  for (let i = 0; i < rows.length; i += EMBED_BATCH) {
    const batch = rows.slice(i, i + EMBED_BATCH);
    const result = await embed(userId, batch.map((r) => r.content.slice(0, 6000)));
    if (!result) break;
    for (let k = 0; k < batch.length; k++)
      await db`UPDATE document_chunks SET embedding = ${vector(result.vectors[k])}::extensions.vector, embedding_model = ${result.model} WHERE id = ${batch[k].id}`;
    done += batch.length;
  }
  return done;
}

/** Documents uploaded before search existed get their passages on first use. */
async function indexMissing(userId: string) {
  const db = sql();
  const missing = await db<{ id: string; title: string; content: string }[]>`
    SELECT d.id, d.title, d.content FROM documents d
    WHERE d.user_id = ${userId} AND NOT EXISTS (SELECT 1 FROM document_chunks c WHERE c.document_id = d.id)
    LIMIT 20`;
  for (const d of missing) await indexDocument(userId, d.id, d.title, d.content);
}

/* ---------------------------------------------------------------- */
/* Search                                                             */
/* ---------------------------------------------------------------- */

/**
 * The best-matching document ids for a question: full-text and (when
 * available) semantic matches, fused by rank. Empty when nothing matches.
 */
export async function searchDocumentIds(userId: string, query: string, limit = 24): Promise<string[]> {
  if (!pgConfigured() || !query.trim()) return [];
  await ensureSchema();
  const db = sql();
  await indexMissing(userId).catch(() => {});
  // Any word may match (OR); passages matching more words rank higher.
  const words = query.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu)?.slice(0, 24) ?? [];
  if (!words.length) return [];
  const text = await db<{ document_id: string }[]>`
    SELECT document_id, max(ts_rank_cd(tsv, q)) AS rank
    FROM document_chunks, websearch_to_tsquery('english', ${words.join(" or ")}) q
    WHERE user_id = ${userId} AND tsv @@ q
    GROUP BY document_id ORDER BY rank DESC LIMIT ${limit}`;
  let semantic: { document_id: string }[] = [];
  const q = await embed(userId, [query.slice(0, 2000)]);
  const qv = q?.vectors[0];
  if (q && qv) {
    semantic = await db<{ document_id: string }[]>`
      SELECT document_id, min(embedding <=> ${vector(qv)}::extensions.vector) AS distance
      FROM (SELECT document_id, embedding FROM document_chunks
            WHERE user_id = ${userId} AND embedding IS NOT NULL AND embedding_model = ${q.model}
            ORDER BY embedding <=> ${vector(qv)}::extensions.vector LIMIT ${limit * 3}) nearest
      GROUP BY document_id ORDER BY distance LIMIT ${limit}`;
    void embedPending(userId, 30).catch(() => {});
  }
  // Reciprocal-rank fusion: documents high in either list rise to the top.
  const score = new Map<string, number>();
  text.forEach((r, i) => score.set(r.document_id, (score.get(r.document_id) ?? 0) + 1 / (60 + i)));
  semantic.forEach((r, i) => score.set(r.document_id, (score.get(r.document_id) ?? 0) + 1 / (60 + i)));
  return [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id]) => id);
}

/** The documents Ask should consider: search matches plus anything attached. */
export async function candidateDocuments(userId: string, query: string, attachmentIds: string[]) {
  await ensureSchema();
  const ids = [...new Set([...(await searchDocumentIds(userId, query)), ...attachmentIds])];
  if (!ids.length) return [];
  return sql()<Record<string, unknown>[]>`
    SELECT id, user_id, title, content, mime, size, created_at, client, category, doc_date
    FROM documents WHERE user_id = ${userId} AND id = ANY(${ids})`;
}
