import { env } from "@/lib/env";
import { candidates, isRefusal, markRefused, markWorking } from "@/lib/model-router";

/*
 * Whether the AI key may use the embedding and speech models, checked with
 * one tiny request each and cached for a few minutes. Settings → Models shows
 * the result, so nobody needs to handle the key to find out.
 */

export type Access = "on" | "denied" | "unavailable";
export type ModelStatus = { access: Access; model: string };

let cached: { at: number; value: { embedding: ModelStatus; asr: ModelStatus } } | null = null;

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
    if (response.ok) {
      await response.body?.cancel().catch(() => {});
      return "on";
    }
    const json = (await response.json().catch(() => ({}))) as { error?: { code?: string } };
    return isRefusal(response.status, json.error?.code) ? "denied" : "unavailable";
  } catch {
    return "unavailable";
  }
}

/** The first model of a kind that the key accepts, trying them in order. */
async function firstWorking(kind: "embedding" | "asr", request: (model: string) => [string, unknown]): Promise<ModelStatus> {
  let sawOther = false;
  for (const model of candidates(kind)) {
    const [path, body] = request(model);
    const access = await probe(path, body);
    if (access === "on") {
      markWorking(kind, model);
      return { access, model };
    }
    if (access === "denied") markRefused(model);
    else sawOther = true;
  }
  return { access: sawOther ? "unavailable" : "denied", model: candidates(kind)[0] ?? "" };
}

export async function modelAccess() {
  const none: ModelStatus = { access: "unavailable", model: "" };
  if (!env.AI_GATEWAY_URL || !env.AI_GATEWAY_KEY) return { embedding: none, asr: none };
  if (cached && Date.now() - cached.at < 5 * 60_000) return cached.value;
  const audio = `data:audio/wav;base64,${silentWav()}`;
  const [embedding, asr] = await Promise.all([
    firstWorking("embedding", (model) => ["/embeddings", { model, input: ["hello"], dimensions: 1024 }]),
    firstWorking("asr", (model) =>
      /omni/.test(model)
        ? [
            "/chat/completions",
            {
              model,
              stream: true,
              modalities: ["text"],
              messages: [{ role: "user", content: [{ type: "input_audio", input_audio: { data: audio, format: "wav" } }, { type: "text", text: "Transcribe." }] }],
            },
          ]
        : ["/chat/completions", { model, stream: false, messages: [{ role: "user", content: [{ type: "input_audio", input_audio: { data: audio, format: "wav" } }] }] }],
    ),
  ]);
  cached = { at: Date.now(), value: { embedding, asr } };
  return cached.value;
}
