import { env } from "cloudflare:workers";
import { bucket, database, log } from "@/lib/server";
import { approvedEndpoint, callMcpTools } from "@/lib/mcp-client";
import { complete, generateImage, type Capabilities, type Gateway, type ToolSpec } from "@/lib/ai";
import { checkPublicUrl, readPage } from "@/lib/web";
import { describe, parseCsv, runQuery, toMarkdown, type Query } from "@/lib/data";
import { INTEGRATION_MATCH, type SkillId } from "@/lib/skills";
import type { Source } from "@/lib/knowledge";

/**
 * Agent skills exposed to the model as tools. Only enabled skills with their
 * prerequisites met are offered, and every tool is read-only except image
 * generation, which only writes to the user's own uploads.
 */

type Doc = { id: string; title: string; content: string; mime: string };
type McpTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  access: string;
  enabled: boolean;
};
type McpServer = { id: string; title: string; url: string; tools: McpTool[] };

export type AgentContext = {
  userId: string;
  ai: Gateway;
  skills: Record<SkillId, boolean>;
  caps: Capabilities;
  documents: Doc[];
  onSource: (s: Source) => void;
};

/** One rule for "this upload is a CSV table", used by the engine and tools. */
export const isCsv = (d: { mime?: string; title: string }) =>
  /^text\/csv/i.test(d.mime ?? "") || /\.csv$/i.test(d.title);

const safeName = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);

async function mcpServers(userId: string, skills: Record<SkillId, boolean>) {
  const rows = await database()
    .prepare("SELECT id,data FROM records WHERE user_id=? AND kind='mcp'")
    .bind(userId)
    .all();
  return rows.results
    .map((r) => ({ id: String(r.id), ...JSON.parse(String(r.data)) }))
    .filter((s: any) => s.enabled && s.status === "Connected" && Array.isArray(s.tools))
    .filter((s: any) => {
      const label = `${s.title} ${s.url}`;
      const integration = (Object.entries(INTEGRATION_MATCH) as [SkillId, RegExp][]).find(([, re]) =>
        re.test(label),
      );
      return integration ? skills[integration[0]] : skills.mcp;
    })
    .map((s: any) => ({
      id: s.id,
      title: String(s.title),
      url: String(s.url),
      // Write tools are never offered to the model; they need human approval.
      tools: (s.tools as McpTool[]).filter((t) => t.enabled && t.access === "Read"),
    }))
    .filter((s) => s.tools.length) as McpServer[];
}

export async function buildAgent(ctx: AgentContext) {
  const specs: ToolSpec[] = [];
  const handlers = new Map<string, (args: any) => Promise<string>>();
  const labels = new Map<string, (args: any) => string>();
  const add = (
    spec: ToolSpec["function"],
    label: (args: any) => string,
    run: (args: any) => Promise<string>,
  ) => {
    specs.push({ type: "function", function: spec });
    handlers.set(spec.name, run);
    labels.set(spec.name, label);
  };

  if (ctx.skills.web && ctx.caps.webSearch)
    add(
      {
        name: "web_search",
        description:
          "Search the live public web for current or public information that the workspace evidence doesn't cover (news, regulations, companies, prices, dates).",
        parameters: {
          type: "object",
          properties: { query: { type: "string", description: "A focused search query" } },
          required: ["query"],
        },
      },
      (a) => `Searching the web for “${String(a.query ?? "").slice(0, 60)}”`,
      async (a) => {
        const query = String(a.query ?? "").slice(0, 300);
        const raw = await complete(
          ctx.ai,
          [
            {
              role: "user",
              content: `Search the web for: ${query}\n\nReply with JSON only, no prose around it:\n{"summary":"3-6 factual sentences; put [n] after each fact, where n is the number of the source it came from","sources":[{"n":1,"title":"page title","url":"https://…","publisher":"site or organisation","published":"YYYY-MM-DD or empty"}]}\nUse only pages you actually found. Include publication dates in the summary when relevant.`,
            },
          ],
          { webSearch: true, maxTokens: 1200, timeoutMs: 60000 },
        );
        const found = parseWebResults(raw);
        // Only links that resolve become citable sources; the rest are dropped.
        const checked = await Promise.all(
          found.sources.slice(0, 6).map(async (src) => ({ src, ok: await reachable(src.url) })),
        );
        const cards: Source[] = [];
        let summary = found.summary;
        for (const { src, ok } of checked) {
          if (!ok) {
            summary = summary.replaceAll(`[${src.n}]`, "");
            continue;
          }
          const id = await webSourceId(src.url);
          summary = summary.replaceAll(`[${src.n}]`, `[${id}]`);
          const facts = found.summary
            .split(/(?<=[.!?])\s+/)
            .filter((sentence) => sentence.includes(`[${src.n}]`))
            .join(" ")
            .replace(/\[\d+\]/g, "")
            .trim();
          cards.push({
            id,
            title: src.title || new URL(src.url).hostname,
            content: facts || found.summary.replace(/\[\d+\]/g, ""),
            system: "Web",
            owner: src.publisher || new URL(src.url).hostname,
            date: /^\d{4}-\d{2}-\d{2}$/.test(src.published ?? "") ? src.published! : "",
            kind: "Web result",
            client: "Public web",
            tags: [],
            status: "Unverified",
            url: src.url,
          });
        }
        summary = summary.replace(/\[\d+\]/g, "").replace(/\s{2,}/g, " ").trim();
        cards.forEach(ctx.onSource);
        if (!cards.length) {
          const id = `web-${(await hash(query)).slice(0, 8)}`;
          ctx.onSource({
            id,
            title: `Web search · ${query.slice(0, 70)}`,
            content: summary,
            system: "Web",
            owner: "Web search",
            date: new Date().toISOString().slice(0, 10),
            kind: "Web search",
            client: "Public web",
            tags: [],
            status: "Unverified",
          });
          return `WEB RESULTS (external, not from the user's organisation). No source links could be verified, so treat these as unverified and say so.\nSource id: ${id}\n${summary}`;
        }
        return `WEB RESULTS (external, not from the user's organisation). Cite with these ids:\n${cards
          .map((c) => `- [${c.id}] ${c.title} · ${c.owner}${c.date ? ` · ${c.date}` : ""} · ${c.url}`)
          .join("\n")}\n\nFindings:\n${summary}`;
      },
    );

  if (ctx.skills.scrape)
    add(
      {
        name: "read_url",
        description:
          "Read the text of a public web page. Use when the user links a page or when a specific public URL would answer the question.",
        parameters: {
          type: "object",
          properties: { url: { type: "string", description: "Absolute http(s) URL" } },
          required: ["url"],
        },
      },
      (a) => `Reading ${hostOf(a.url)}`,
      async (a) => {
        const page = await readPage(String(a.url));
        const id = await webSourceId(page.url);
        ctx.onSource({
          id,
          title: page.title,
          content: page.text,
          system: "Web",
          owner: new URL(page.url).hostname,
          date: new Date().toISOString().slice(0, 10),
          kind: "Web page",
          client: "Public web",
          tags: [],
          status: "Unverified",
          url: page.url,
        });
        return `Source id: ${id}\nURL: ${page.url}\nTitle: ${page.title}\n\n${page.text.slice(0, 16000)}`;
      },
    );

  const tables = ctx.skills.data
    ? ctx.documents.filter(isCsv)
    : [];
  if (tables.length) {
    const catalog = tables.slice(0, 12).map((d) => {
      const t = parseCsv(d.content, 300);
      return `- ${d.id} "${d.title}": ${describe(t)
        .map((c) => `${c.name} (${c.type})`)
        .join(", ")}`;
    });
    add(
      {
        name: "analyze_data",
        description: `Query an uploaded CSV table with filters, grouping and aggregates. Tables:\n${catalog.join("\n")}`,
        parameters: {
          type: "object",
          properties: {
            document_id: { type: "string" },
            select: { type: "array", items: { type: "string" } },
            filters: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  column: { type: "string" },
                  op: { type: "string", enum: ["=", "!=", ">", ">=", "<", "<=", "contains"] },
                  value: { type: ["string", "number"] },
                },
                required: ["column", "op", "value"],
              },
            },
            group_by: { type: "array", items: { type: "string" } },
            metrics: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  fn: { type: "string", enum: ["count", "sum", "avg", "min", "max"] },
                  column: { type: "string" },
                  as: { type: "string" },
                },
                required: ["fn"],
              },
            },
            sort: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  column: { type: "string" },
                  direction: { type: "string", enum: ["asc", "desc"] },
                },
                required: ["column"],
              },
            },
            limit: { type: "number" },
          },
          required: ["document_id"],
        },
      },
      (a) => `Analysing ${tables.find((t) => t.id === a.document_id)?.title ?? "your data"}`,
      async (a) => {
        const doc = tables.find((t) => t.id === a.document_id);
        if (!doc) return `Unknown document_id. Use one of: ${tables.map((t) => t.id).join(", ")}`;
        const result = runQuery(parseCsv(doc.content), a as Query);
        ctx.onSource({
          id: doc.id,
          title: doc.title,
          content: doc.content.slice(0, 2000),
          system: "Uploads",
          owner: "You",
          date: new Date().toISOString().slice(0, 10),
          kind: "Data",
          client: "Your workspace",
          tags: [],
          status: "Unverified",
          url: `/api/files/${doc.id}`,
        });
        return `Result from [${doc.id}] (${result.matched} matching rows):\n${toMarkdown(result)}`;
      },
    );
  }

  if (ctx.skills.images && ctx.caps.images)
    add(
      {
        name: "generate_image",
        description: "Create an illustrative image (concept visual, diagram sketch). Returns Markdown to embed.",
        parameters: {
          type: "object",
          properties: { prompt: { type: "string", description: "Detailed visual description" } },
          required: ["prompt"],
        },
      },
      () => "Generating an image",
      async (a) => {
        const bytes = await generateImage(ctx.ai, String(a.prompt));
        const id = crypto.randomUUID();
        const title = `Generated image · ${String(a.prompt).slice(0, 60)}`;
        await bucket().put(`${ctx.userId}/${id}`, bytes, { httpMetadata: { contentType: "image/png" } });
        await database()
          .prepare(
            "INSERT INTO documents (id,user_id,title,content,mime,size,created_at,client,category,doc_date) VALUES (?,?,?,?,?,?,?,?,?,?)",
          )
          .bind(id, ctx.userId, title, `AI-generated image. Prompt: ${a.prompt}`, "image/png", bytes.length, new Date().toISOString(), "", "Generated image", "")
          .run();
        await log(ctx.userId, "Image generated", title);
        return `Embed exactly: ![${String(a.prompt).slice(0, 80).replace(/[\[\]]/g, "")}](/api/files/${id})`;
      },
    );

  const servers = ctx.skills.mcp || ctx.skills.gmail || ctx.skills.calendar || ctx.skills.outlook
    ? await mcpServers(ctx.userId, ctx.skills)
    : [];
  for (const [si, server] of servers.entries()) {
    for (const tool of server.tools.slice(0, 20)) {
      // Sanitising can map different tool names to the same function name.
      let name = `mcp${si}_${safeName(tool.name)}`;
      if (handlers.has(name)) name = `${name.slice(0, 50)}_${(await hash(tool.name)).slice(0, 6)}`;
      if (handlers.has(name)) continue;
      add(
        {
          name,
          description: `[${server.title}] ${tool.description}`.slice(0, 1000),
          parameters: tool.inputSchema?.type === "object" ? tool.inputSchema : { type: "object", properties: {} },
        },
        () => `Using ${server.title} · ${tool.name}`,
        async (a) => {
          const url = approvedEndpoint(server.url, env.MCP_ALLOWED_HOSTS ?? "");
          const token = String(env[`MCP_TOKEN_${server.id.toUpperCase().replace(/-/g, "_")}`] ?? "");
          let text = "";
          await callMcpTools(url, token, async (call) => {
            text = await call(tool.name, a && typeof a === "object" ? a : {});
          });
          const id = `mcp-${(await hash(server.id + tool.name + JSON.stringify(a))).slice(0, 10)}`;
          ctx.onSource({
            id,
            title: `${server.title} · ${tool.name}`,
            content: text.slice(0, 20000),
            system: server.title,
            owner: server.title,
            date: new Date().toISOString().slice(0, 10),
            kind: "Tool result",
            client: "Connected app",
            tags: [],
            status: "Unverified",
          });
          await log(ctx.userId, "MCP tool used", `${server.title} · ${tool.name}`);
          return `Source id: ${id}\n${text.slice(0, 16000) || "(no text content returned)"}`;
        },
      );
    }
  }

  return {
    specs,
    label: (name: string, args: unknown) => labels.get(name)?.(args) ?? `Running ${name}`,
    async run(name: string, raw: string) {
      const handler = handlers.get(name);
      if (!handler) return `Tool ${name} is not available.`;
      let args: unknown;
      try {
        args = raw ? JSON.parse(raw) : {};
      } catch {
        return "Tool arguments were not valid JSON. Retry with valid JSON.";
      }
      try {
        return await handler(args);
      } catch (e) {
        return `Tool failed: ${(e as Error).message}`.slice(0, 500);
      }
    },
    parse(raw: string) {
      try {
        return raw ? JSON.parse(raw) : {};
      } catch {
        return {};
      }
    },
  };
}

function hostOf(value: unknown) {
  try {
    return new URL(String(value)).hostname;
  } catch {
    return "a web page";
  }
}

type WebResult = { n: number; title: string; url: string; publisher?: string; published?: string };

/** Reads the search model's JSON; falls back to any URLs in plain text. */
function parseWebResults(raw: string): { summary: string; sources: WebResult[] } {
  try {
    const json = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    const sources = (Array.isArray(json.sources) ? json.sources : [])
      .filter((x: any) => x && typeof x.url === "string" && /^https?:\/\//.test(x.url))
      .map((x: any, i: number) => ({
        n: Number(x.n) || i + 1,
        title: String(x.title ?? "").slice(0, 200),
        url: String(x.url),
        publisher: String(x.publisher ?? "").slice(0, 80),
        published: String(x.published ?? ""),
      }));
    if (typeof json.summary === "string") return { summary: json.summary.slice(0, 4000), sources };
  } catch {}
  const urls = [...new Set(raw.match(/https?:\/\/[^\s)\]"'<>]+/g) ?? [])];
  return {
    summary: raw.replace(/```json|```/g, "").slice(0, 4000),
    sources: urls.map((url, i) => ({ n: i + 1, title: "", url: url.replace(/[.,;]+$/, "") })),
  };
}

/** True when a public URL answers without an error (redirects count as live). */
async function reachable(url: string) {
  try {
    checkPublicUrl(url);
    const r = await fetch(url, {
      method: "GET",
      redirect: "manual",
      headers: { "User-Agent": "InternalAI-LinkCheck/1.0", Accept: "text/html,*/*" },
      signal: AbortSignal.timeout(5000),
    });
    await r.body?.cancel();
    return r.status < 400 || r.status === 403 || r.status === 405 || r.status === 429;
  } catch {
    return false;
  }
}

/** Stable id for a web page, shared with links read up front by the engine. */
export async function webSourceId(url: string) {
  return `web-${(await hash(url)).slice(0, 10)}`;
}

async function hash(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
