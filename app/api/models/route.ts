import { z } from "zod";
import { env } from "@/lib/env";
import { identity, failure, log, saveRecord, database, ApiError } from "@/lib/server";
import {
  defaultModels,
  isModelId,
  listGatewayModels,
  presets,
  readModelChoice,
} from "@/lib/models";
import { asrModel, embeddingModel, modelAccess } from "@/lib/model-access";
import { pgConfigured } from "@/lib/postgres";

export async function GET() {
  try {
    const user = await identity();
    const chosen = await readModelChoice(user.userId);
    const [listed, access] = await Promise.all([listGatewayModels(), modelAccess()]);
    const pg = pgConfigured();
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
      embedding:
        access.embedding === "on" ? `Search by meaning on (${embeddingModel()})` : pg ? "Full-text search" : "Lexical retrieval",
      embeddingNote:
        access.embedding === "on"
          ? "Ask finds passages by meaning as well as by words."
          : access.embedding === "denied"
            ? `Your AI key doesn’t allow ${embeddingModel()} yet, so Ask matches by words. Allow it on the key to search by meaning.`
            : "Ask matches documents by words.",
      transcription: access.asr === "on" ? `Call transcription on (${asrModel()})` : "Call transcription off",
      transcriptionNote:
        access.asr === "on"
          ? "Teams, Zoom and Meet call audio can be transcribed in the Meeting assistant."
          : access.asr === "denied"
            ? `Your AI key doesn’t allow ${asrModel()} yet. Microphone transcription still works.`
            : "The speech model couldn’t be reached just now.",
      store: pg ? "Supabase Postgres + pgvector" : "Vercel Blob (SQLite)",
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
