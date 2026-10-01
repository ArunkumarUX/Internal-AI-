import { gateway } from "@/lib/ai";
import { ApiError } from "@/lib/server";

/*
 * Speech to text for captured call audio, through the workspace's AI gateway.
 * Alibaba Model Studio's Qwen3-ASR accepts audio as an `input_audio` part on
 * the OpenAI-compatible chat endpoint. AI_ASR_MODEL overrides the model.
 */

const MODEL = () => process.env.AI_ASR_MODEL?.trim() || "qwen3-asr-flash";
export const MAX_AUDIO_BYTES = 3 * 1024 * 1024;

export async function transcribe(userId: string, audio: Uint8Array, mime: string, language?: string) {
  const ai = await gateway(userId);
  if (!ai) throw new ApiError("Transcription needs the AI gateway, which isn’t configured.", 503, "asr_unavailable");
  const response = await fetch(ai.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ai.key}` },
    body: JSON.stringify({
      model: MODEL(),
      stream: false,
      messages: [
        {
          role: "user",
          content: [{ type: "input_audio", input_audio: { data: `data:${mime};base64,${Buffer.from(audio).toString("base64")}` } }],
        },
      ],
      asr_options: { enable_itn: true, ...(language ? { language } : {}) },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const json = (await response.json().catch(() => ({}))) as {
    choices?: { message?: { content?: string | { text?: string }[] } }[];
    error?: { code?: string; message?: string };
  };
  if (response.status === 401 || response.status === 403 || json.error?.code === "access_denied" || json.error?.code === "model_not_found")
    throw new ApiError(
      "Call transcription isn’t enabled for this workspace’s AI key yet. Ask your admin to allow the speech-to-text model.",
      503,
      "asr_unavailable",
    );
  if (!response.ok) {
    console.error("[transcribe]", response.status, json.error?.code, json.error?.message);
    throw new ApiError("That part of the call couldn’t be transcribed.", 502);
  }
  const content = json.choices?.[0]?.message?.content;
  const text = Array.isArray(content) ? content.map((c) => c.text ?? "").join(" ") : (content ?? "");
  return text.trim();
}
