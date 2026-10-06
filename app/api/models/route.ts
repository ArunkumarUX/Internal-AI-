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
import { modelAccess } from "@/lib/model-access";
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
      providerNote:
        "Your questions go to the approved OpenAI-compatible gateway. If a model isn’t available on the key, Internal AI switches to the next suitable one automatically. API keys stay on the server.",
      embedding:
        access.embedding.access === "on"
          ? `Search by meaning on · ${access.embedding.model}`
          : pg
            ? "Full-text search"
            : "Lexical retrieval",
      embeddingNote:
        access.embedding.access === "on"
          ? "Chosen automatically. Ask finds passages by meaning as well as by words."
          : access.embedding.access === "denied"
            ? "Your AI key doesn’t allow any embedding model yet (for example text-embedding-v4), so Ask matches by words. It switches on by itself once one is allowed."
            : "Ask matches documents by words.",
      transcription: access.asr.access === "on" ? `Workspace transcription on · ${access.asr.model}` : "Workspace transcription off",
      transcriptionNote:
        access.asr.access === "on"
          ? "Chosen automatically. Call audio, and the microphone when the browser’s speech service can’t be reached, are transcribed with it."
          : access.asr.access === "denied"
            ? "No speech-to-text service yet: add TRANSCRIBE_API_KEY (OpenAI or Groq) or allow qwen3-asr-flash on the AI key. Browser microphone transcription still works where available."
            : "The speech models couldn’t be reached just now.",
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
