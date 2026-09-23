import { z } from "zod";
import { env } from "cloudflare:workers";
import { identity, database, saveRecord, log, failure, ApiError } from "@/lib/server";
import { approvedEndpoint, inspectMcp, McpError } from "@/lib/mcp-client";

export async function POST(request: Request) {
  try {
    const user = await identity(request);
    const parsed = z.object({ id: z.string().min(1).max(100), operation: z.enum(["test", "discover"]) }).safeParse(await request.json());
    if (!parsed.success) throw new ApiError("Invalid server request.");
    const { id, operation } = parsed.data;
    const row = await database().prepare("SELECT data FROM records WHERE id=? AND user_id=? AND kind='mcp'").bind(id, user.userId).first();
    if (!row) throw new ApiError("Server not found.", 404);
    const config = JSON.parse(String(row.data));
    try {
      const url = approvedEndpoint(config.url, env.MCP_ALLOWED_HOSTS ?? "");
      const token = String(env[`MCP_TOKEN_${id.toUpperCase().replace(/-/g, "_")}`] ?? "");
      const result = await inspectMcp(url, token, operation === "discover");
      await saveRecord(user.userId, "mcp", {
        ...config, status: "Connected", lastTest: new Date().toISOString(), lastError: null,
        protocolVersion: result.protocolVersion, serverInfo: result.serverInfo, capabilities: result.capabilities,
        ...(operation === "discover" ? { tools: result.tools } : {}),
      }, id);
      await log(user.userId, "MCP connection tested", config.title);
      return Response.json({ status: "Connected", ...result });
    } catch (error) {
      if (error instanceof McpError) {
        await saveRecord(user.userId, "mcp", { ...config, status: error.status === 403 ? "Configuration required" : "Connection failed", lastTest: new Date().toISOString(), lastError: error.message }, id);
        throw new ApiError(error.message, error.status);
      }
      throw error;
    }
  } catch (error) { return failure(error); }
}
