import { bucket, database, userHash, ApiError } from "@/lib/server";
import { callMcpTools, McpError } from "@/lib/mcp-client";
import { indexDocument } from "@/lib/search";
import { accessToken, markReauth, notionIdsIn, pageText, pageTitle, NOTION_MCP_URL, NotionReauthError } from "@/lib/notion";

/*
 * Copies a Notion page and everything under it (sub-pages, databases and
 * their entries) into the workspace's documents, so search and Ask can use
 * it like any upload. Re-importing updates the same documents instead of
 * duplicating them. Reads go through the person's own Notion connection,
 * so only pages they can see are copied.
 */

export type ImportResult = {
  imported: number;
  updated: number;
  unchanged: number;
  failed: number;
  truncated: boolean;
  pages: { title: string; id: string }[];
};

const MAX_PAGES = 150;
const TIME_BUDGET_MS = 240_000;

/** Data sources (database tables) referenced in fetched content. */
const dataSourcesIn = (raw: string) => [...new Set(raw.match(/collection:\/\/[0-9a-f-]{32,36}/gi) ?? [])];

/** Notion's markup → readable text: keep words and links, drop layout tags. */
function readable(raw: string) {
  return pageText(raw)
    .replace(/<(page|database|data-source|view)\s+url="[^"]*"[^>]*>(.*?)<\/\1>/gi, "$2")
    .replace(/<\/?(columns|column|callout|details|summary|span|empty-block|table_of_contents)[^>]*>/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function importNotion(userId: string, url: string): Promise<ImportResult> {
  const root = notionIdsIn(url)[0];
  if (!root) throw new ApiError("That doesn’t look like a Notion page link. Copy it from Notion with Share → Copy link.");
  const token = await accessToken(userId);
  if (!token) throw new ApiError("Connect Notion first: Settings → Integrations → Notion.", 409, "notion_not_connected");

  const result: ImportResult = { imported: 0, updated: 0, unchanged: 0, failed: 0, truncated: false, pages: [] };
  const started = Date.now();
  const seen = new Set<string>();
  const queue: { id: string; path: string[] }[] = [{ id: root, path: [] }];
  const db = database();

  try {
    await callMcpTools(
      NOTION_MCP_URL,
      token,
      async (call) => {
        const searchedSources = new Set<string>();
        while (queue.length) {
          if (seen.size >= MAX_PAGES || Date.now() - started > TIME_BUDGET_MS) {
            result.truncated = true;
            break;
          }
          const { id, path } = queue.shift()!;
          if (seen.has(id)) continue;
          seen.add(id);
          let raw: string;
          try {
            raw = await call("notion-fetch", { id });
          } catch {
            result.failed++;
            continue;
          }
          const title = pageTitle(raw, "Untitled Notion page").slice(0, 200);
          const body = readable(raw);

          // Follow everything this page links to inside Notion: sub-pages, databases, entries.
          if (path.length < 5)
            for (const child of notionIdsIn(raw)) if (!seen.has(child)) queue.push({ id: child, path: [...path, title] });
          // Database entries aren't listed in full on the database itself; ask for them.
          for (const source of dataSourcesIn(raw)) {
            if (searchedSources.has(source)) continue;
            searchedSources.add(source);
            for (const query of [title, "*"]) {
              try {
                const hits = await call("notion-search", { query, query_type: "internal", data_source_url: source });
                for (const child of notionIdsIn(hits)) if (!seen.has(child)) queue.push({ id: child, path: [...path, title] });
              } catch {
                /* this workspace's search can't filter by database; the links on the page still count */
              }
            }
          }
          if (!body || body.length < 20) continue;

          const content = `${[...path, title].join(" › ")}\nNotion: https://www.notion.so/${id.replaceAll("-", "")}\n\n${body}`.slice(0, 300_000);
          const docId = `notion-${(await userHash(userId, `notion:${id}`)).slice(0, 32)}`;
          const existing = await db
            .prepare("SELECT content FROM documents WHERE id=? AND user_id=?")
            .bind(docId, userId)
            .first<{ content: string }>();
          if (existing?.content === content) {
            result.unchanged++;
            continue;
          }
          const now = new Date().toISOString();
          const bytes = new TextEncoder().encode(content);
          await bucket().put(`${userId}/${docId}`, bytes, { httpMetadata: { contentType: "text/markdown" } });
          if (existing)
            await db
              .prepare("UPDATE documents SET title=?, content=?, size=?, doc_date=? WHERE id=? AND user_id=?")
              .bind(title, content, bytes.length, now.slice(0, 10), docId, userId)
              .run();
          else
            await db
              .prepare(
                "INSERT INTO documents (id,user_id,title,content,mime,size,created_at,client,category,doc_date) VALUES (?,?,?,?,?,?,?,?,?,?)",
              )
              .bind(docId, userId, title, content, "text/markdown", bytes.length, now, "", "Notion", now.slice(0, 10))
              .run();
          await indexDocument(userId, docId, title, content).catch(() => {});
          if (existing) result.updated++;
          else result.imported++;
          result.pages.push({ title, id: docId });
        }
        if (queue.length) result.truncated = true;
      },
      { timeoutMs: TIME_BUDGET_MS + 30_000 },
    );
  } catch (error) {
    if (error instanceof McpError && error.status === 401) {
      await markReauth(userId);
      throw new NotionReauthError();
    }
    // Pages copied before a failure are kept; report what happened.
    if (!result.imported && !result.updated && !result.unchanged) throw error;
    result.truncated = true;
  }
  return result;
}
