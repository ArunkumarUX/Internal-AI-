/** Bounded Streamable HTTP MCP client. Tool calls run only through callMcpTools with caller-approved names. */
export class McpError extends Error {
  status: number;
  constructor(message: string, status = 502) { super(message); this.status = status; }
}
const versions = ["2025-11-25", "2025-06-18", "2025-03-26"];
const MAX_BYTES = 1_000_000;
type ObjectValue = Record<string, any>;
const object = (x: unknown): x is ObjectValue => !!x && typeof x === "object" && !Array.isArray(x);
export function approvedEndpoint(value: unknown, hosts: string): URL {
  let url: URL;
  try { url = new URL(String(value)); } catch { throw new McpError("Enter a valid MCP endpoint URL.", 400); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash ||
      !hosts.split(",").map(x => x.trim().toLowerCase()).filter(Boolean).includes(url.hostname.toLowerCase())) {
    throw new McpError("This endpoint is not on the server’s approved HTTPS host list. Ask your administrator to add its exact hostname before connecting.", 403);
  }
  return url;
}

async function readResult(response: Response, id: string): Promise<ObjectValue> {
  const reader = response.body?.getReader();
  if (!reader) throw new McpError("The MCP server returned an empty response.");
  const decoder = new TextDecoder();
  let bytes = 0, buffer = "", eventData: string[] = [];
  const streaming = response.headers.get("content-type")?.includes("text/event-stream");
  const parse = (raw: string): ObjectValue | undefined => {
    let data: unknown;
    try { data = JSON.parse(raw); } catch { throw new McpError("The MCP server returned malformed JSON."); }
    if (!object(data) || data.jsonrpc !== "2.0") throw new McpError("The MCP server returned an invalid JSON-RPC response.");
    if (data.id !== id) {
      if (streaming) return undefined;
      throw new McpError("The MCP server returned a response for a different request.");
    }
    if (data.error) throw new McpError(`The MCP server rejected the request (RPC ${Number(data.error.code) || "error"}).`);
    if (!object(data.result)) throw new McpError("The MCP server returned an invalid result.");
    return data.result;
  };
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BYTES) throw new McpError("The MCP response exceeds the 1 MB limit.");
      buffer += decoder.decode(chunk.value, { stream: true });
      if (streaming) {
        let newline;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline).replace(/\r$/, "");
          buffer = buffer.slice(newline + 1);
          if (line.startsWith("data:")) eventData.push(line.slice(5).replace(/^ /, ""));
          else if (!line && eventData.length) {
            const result = parse(eventData.join("\n"));
            eventData = [];
            if (result) return result;
          }
        }
      }
    }
    buffer += decoder.decode();
    if (!streaming) return parse(buffer)!;
    throw new McpError("The MCP stream closed without a matching response.");
  } finally { await reader.cancel().catch(() => {}); }
}

type SessionOptions = { fetch?: typeof fetch; timeoutMs?: number };

async function openSession(url: URL, token: string, options: SessionOptions, signal: AbortSignal) {
  const request = options.fetch ?? fetch;
  let session: string | undefined, protocol: string | undefined;
  const headers = () => ({
    "Content-Type": "application/json", Accept: "application/json, text/event-stream",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(session ? { "Mcp-Session-Id": session } : {}),
    ...(protocol ? { "MCP-Protocol-Version": protocol } : {}),
  });
  async function post(method: string, params?: unknown, notification = false) {
    const id = crypto.randomUUID();
    const response = await request(url, {
      method: "POST", redirect: "manual", headers: headers(), signal,
      body: JSON.stringify({ jsonrpc: "2.0", ...(notification ? {} : { id }), method, ...(params === undefined ? {} : { params }) }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      const message = response.status === 401 || response.status === 403
        ? "MCP authentication failed. Configure the server credential; OAuth-only servers require an OAuth integration."
        : response.status === 404 || response.status === 405
          ? "The MCP endpoint or session was not found. Use a Streamable HTTP endpoint; legacy SSE and local stdio servers require a gateway."
          : `The MCP server returned HTTP ${response.status}. Check the endpoint and retry.`;
      throw new McpError(message, response.status === 401 || response.status === 403 ? 401 : 502);
    }
    if (notification) {
      await response.body?.cancel();
      if (response.status !== 202) throw new McpError("The MCP server did not acknowledge initialization with HTTP 202.");
      return {};
    }
    if (method === "initialize") session = response.headers.get("Mcp-Session-Id") ?? undefined;
    return readResult(response, id);
  }
  async function close() {
    if (!session) return;
    try { const response = await request(url, { method: "DELETE", redirect: "manual", headers: headers(), signal: AbortSignal.timeout(2000) }); await response.body?.cancel(); } catch { /* Cleanup must not conceal the connection result. */ }
  }
  const init = await post("initialize", {
    protocolVersion: versions[0], capabilities: {}, clientInfo: { name: "internal-ai", version: "1.1.0" },
  });
  if (!versions.includes(init.protocolVersion) || !object(init.capabilities) || !object(init.serverInfo))
    throw new McpError("The server negotiated an unsupported MCP version or returned invalid capabilities.");
  protocol = init.protocolVersion;
  await post("notifications/initialized", undefined, true);
  return { init, post, close };
}

function normalise(error: unknown, signal?: AbortSignal): McpError {
  if (error instanceof McpError) return error;
  if (signal?.aborted) return new McpError("The MCP server timed out. Check its availability and retry.", 504);
  return new McpError("Unable to reach the MCP server. Check its HTTPS endpoint, certificate and network access.");
}

export async function inspectMcp(url: URL, token: string, discover: boolean, options: SessionOptions = {}) {
  const signal = AbortSignal.timeout(options.timeoutMs ?? 30_000);
  let conn: Awaited<ReturnType<typeof openSession>> | undefined;
  try {
    conn = await openSession(url, token, options, signal);
    const { init, post } = conn;
    const tools: ObjectValue[] = [];
    if (discover && init.capabilities.tools) {
      let cursor: string | undefined;
      const cursors = new Set<string>(), names = new Set<string>();
      do {
        const list = await post("tools/list", cursor ? { cursor } : {});
        if (!Array.isArray(list.tools)) throw new McpError("The server returned an invalid tool list.");
        for (const tool of list.tools) {
          if (!object(tool) || typeof tool.name !== "string" || !tool.name || !object(tool.inputSchema))
            throw new McpError("The server returned an invalid tool definition.");
          if (names.has(tool.name)) throw new McpError("The server returned duplicate tool names.");
          names.add(tool.name);
          tools.push({ name: tool.name, description: typeof tool.description === "string" ? tool.description : "", inputSchema: tool.inputSchema, access: tool.annotations?.readOnlyHint === true ? "Read" : "Write", enabled: false });
        }
        if (tools.length > 500 || JSON.stringify(tools).length > 200_000) throw new McpError("This server's tool catalog exceeds the supported limit. Scope the server to fewer tools.");
        cursor = list.nextCursor;
        if (cursor !== undefined && (typeof cursor !== "string" || !cursor || cursors.has(cursor) || cursors.size >= 49))
          throw new McpError("The server returned invalid or excessive tool pagination.");
        if (cursor) cursors.add(cursor);
      } while (cursor);
    }
    return { tools, protocolVersion: init.protocolVersion as string, serverInfo: init.serverInfo, capabilities: init.capabilities };
  } catch (error) {
    throw normalise(error, signal);
  } finally {
    await conn?.close();
  }
}

/** Runs caller-approved tool calls in one session and returns each call's text content. */
export async function callMcpTools(
  url: URL,
  token: string,
  run: (call: (name: string, args: ObjectValue) => Promise<string>) => Promise<void>,
  options: SessionOptions = {},
) {
  const signal = AbortSignal.timeout(options.timeoutMs ?? 30_000);
  let conn: Awaited<ReturnType<typeof openSession>> | undefined;
  try {
    conn = await openSession(url, token, options, signal);
    const { post } = conn;
    await run(async (name, args) => {
      const result = await post("tools/call", { name, arguments: args });
      const text = Array.isArray(result.content)
        ? result.content.filter((c: ObjectValue) => c?.type === "text" && typeof c.text === "string").map((c: ObjectValue) => c.text).join("\n")
        : "";
      if (result.isError) throw new McpError(text.slice(0, 200) || `The MCP tool ${name} failed.`);
      return text;
    });
  } catch (error) {
    throw normalise(error, signal);
  } finally {
    await conn?.close();
  }
}
