import { env } from "@/lib/env";

/*
 * Whether the AI key may use the embedding and speech models, checked with
 * one tiny request each and cached for a few minutes. Settings → Models shows
 * the result, so nobody needs to handle the key to find out.
 */

export type Access = "on" | "denied" | "unavailable";

const EMBEDDING = () => process.env.AI_EMBEDDING_MODEL?.trim() || "text-embedding-v4";
const ASR = () => process.env.AI_ASR_MODEL?.trim() || "qwen3-asr-flash";

let cached: { at: number; value: { embedding: Access; asr: Access } } | null = null;

/** Half a second of 16 kHz mono silence as a WAV file. */
function silentWav() {
  const samples = 8000;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(16000, 24);
  buffer.writeUInt32LE(32000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  return buffer.toString("base64");
}

async function probe(path: string, body: unknown): Promise<Access> {
  try {
    const response = await fetch(`${env.AI_GATEWAY_URL!.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.AI_GATEWAY_KEY}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await response.json().catch(() => ({}))) as { error?: { code?: string } };
    if (response.ok) return "on";
    return response.status === 401 || response.status === 403 || json.error?.code === "access_denied" ? "denied" : "unavailable";
  } catch {
    return "unavailable";
  }
}

export async function modelAccess() {
  if (!env.AI_GATEWAY_URL || !env.AI_GATEWAY_KEY) return { embedding: "unavailable" as Access, asr: "unavailable" as Access };
  if (cached && Date.now() - cached.at < 5 * 60_000) return cached.value;
  const [embedding, asr] = await Promise.all([
    probe("/embeddings", { model: EMBEDDING(), input: ["hello"], dimensions: 1024 }),
    probe("/chat/completions", {
      model: ASR(),
      stream: false,
      messages: [
        { role: "user", content: [{ type: "input_audio", input_audio: { data: `data:audio/wav;base64,${silentWav()}`, format: "wav" } }] },
      ],
    }),
  ]);
  cached = { at: Date.now(), value: { embedding, asr } };
  return cached.value;
}

export const embeddingModel = EMBEDDING;
export const asrModel = ASR;
