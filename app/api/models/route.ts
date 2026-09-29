import { z } from "zod";
import { env } from "cloudflare:workers";
import { identity, failure, log, saveRecord, database, ApiError } from "@/lib/server";
import {
  defaultModels,
  isModelId,
  listGatewayModels,
  presets,
  readModelChoice,
} from "@/lib/models";

export async function GET() {
  try {
    const user = await identity();
    const chosen = await readModelChoice(user.userId);
    const listed = await listGatewayModels();
    const catalog = [
      ...new Set(
        [chosen.model, chosen.fast, defaultModels().model, defaultModels().fast]
          .filter(Boolean)
          .concat(listed),
      ),
    ];
    return Response.json({
      configured: !!env.AI_GATEWAY_URL && !!env.AI_GATEWAY_KEY && !!chosen.model,
      provider: "Aliyun Model Studio",
      providerNote: "Your questions go to the approved OpenAI-compatible gateway. API keys stay on the server.",
      embedding: "Lexical retrieval",
      embeddingNote: "Ask matches documents by text. A private embedder is not connected.",
      store: "Cloudflare D1 + R2",
      storeNote: "Workspace records and uploads stay in this Internal AI instance.",
      selected: chosen,
      presets: presets(),
      models: catalog,
    });
  } catch (e) {
    return failure(e);
  }
}

export async function POST(request: Request) {
  try {
    const user = await identity(request);
    const parsed = z
      .object({
        model: z.string().min(2).max(80),
        fastModel: z.string().min(2).max(80).optional(),
      })
      .safeParse(await request.json().catch(() => null));
    if (!parsed.success || !isModelId(parsed.data.model))
      throw new ApiError("Choose a valid model identifier.");
    const fast = parsed.data.fastModel || parsed.data.model;
    if (!isModelId(fast)) throw new ApiError("Choose a valid fast model.");
    // An empty list means the gateway can't list models; don't block on it.
    const listed = await listGatewayModels();
    if (listed.length && [parsed.data.model, fast].some((m) => !listed.includes(m)))
      throw new ApiError("This model isn't available on your gateway.");
    const existing = await database()
      .prepare(
        "SELECT id,data FROM records WHERE user_id=? AND kind='settings' ORDER BY updated_at DESC LIMIT 1",
      )
      .bind(user.userId)
      .first();
    const data = existing ? JSON.parse(String(existing.data)) : {};
    const id = await saveRecord(
      user.userId,
      "settings",
      { ...data, model: parsed.data.model, fastModel: fast },
      existing ? String(existing.id) : undefined,
    );
    await log(user.userId, "Model updated", parsed.data.model).catch(() => {});
    return Response.json({ id, model: parsed.data.model, fastModel: fast });
  } catch (e) {
    return failure(e);
  }
}
