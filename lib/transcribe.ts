import { gateway, type Gateway } from "@/lib/ai";
import { ApiError } from "@/lib/server";
import { AllRefused, isRefusal, withModel } from "@/lib/model-router";

/*
 * Speech to text for captured audio, through the workspace's AI gateway.
 * The model is chosen automatically (lib/model-router): dedicated recognisers
 * such as Qwen3-ASR first, then audio-capable chat models (Qwen Omni) asked
 * to transcribe verbatim. AI_ASR_MODEL puts a specific model first.
 */

export const MAX_AUDIO_BYTES = 3 * 1024 * 1024;

type Reply = { choices?: { message?: { content?: string | { text?: string }[] } }[]; error?: { code?: string; message?: string } };

const textOf = (content: string | { text?: string }[] | undefined) =>
  (Array.isArray(content) ? content.map((c) => c.text ?? "").join(" ") : (content ?? "")).trim();

/** Dedicated speech recognisers take the audio on its own. */
async function recognise(ai: Gateway, model: string, audio: string, language?: string) {
  const response = await fetch(ai.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ai.key}` },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [{ role: "user", content: [{ type: "input_audio", input_audio: { data: audio } }] }],
      asr_options: { enable_itn: true, ...(language ? { language } : {}) },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const json = (await response.json().catch(() => ({}))) as Reply;
  if (isRefusal(response.status, json.error?.code)) return { refused: true as const };
  if (!response.ok) {
    console.error("[transcribe]", model, response.status, json.error?.code);
    throw new ApiError("That part of the audio couldn’t be transcribed.", 502);
  }
  return textOf(json.choices?.[0]?.message?.content);
}

/** Audio-capable chat models (Omni) only stream; they're told to transcribe verbatim. */
async function omni(ai: Gateway, model: string, audio: string, format: string, language?: string) {
  const response = await fetch(ai.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ai.key}` },
    body: JSON.stringify({
      model,
      stream: true,
      modalities: ["text"],
      messages: [
        {
          role: "user",
          content: [
            { type: "input_audio", input_audio: { data: audio, format } },
            {
              type: "text",
              text: `Transcribe this audio verbatim${language ? ` (language: ${language})` : ""}. Output only the words spoken, nothing else. If nobody speaks, output nothing.`,
            },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok || !response.body) {
    const json = (await response.json().catch(() => ({}))) as Reply;
    if (isRefusal(response.status, json.error?.code)) return { refused: true as const };
    console.error("[transcribe]", model, response.status, json.error?.code);
    throw new ApiError("That part of the audio couldn’t be transcribed.", 502);
  }
  let text = "";
  for (const line of (await response.text()).split("\n")) {
    if (!line.startsWith("data:") || line.includes("[DONE]")) continue;
    try {
      text += JSON.parse(line.slice(5)).choices?.[0]?.delta?.content ?? "";
    } catch {}
  }
  return text.trim();
}

/*
 * Optional dedicated speech-to-text service (OpenAI-compatible
 * /audio/transcriptions: OpenAI, Groq, Azure OpenAI…). Used first when set:
 *   TRANSCRIBE_API_KEY   the service's key
 *   TRANSCRIBE_API_URL   default https://api.openai.com/v1 (Groq: https://api.groq.com/openai/v1)
 *   TRANSCRIBE_MODEL     default gpt-4o-mini-transcribe (Groq: whisper-large-v3-turbo)
 */
export const transcriptionService = () =>
  process.env.TRANSCRIBE_API_KEY?.trim()
    ? {
        url: (process.env.TRANSCRIBE_API_URL?.trim() || "https://api.openai.com/v1").replace(/\/$/, ""),
        key: process.env.TRANSCRIBE_API_KEY.trim(),
        model: process.env.TRANSCRIBE_MODEL?.trim() || "gpt-4o-mini-transcribe",
      }
    : null;

async function viaService(audio: Uint8Array, mime: string, language?: string) {
  const service = transcriptionService()!;
  const form = new FormData();
  const ext = /wav/.test(mime) ? "wav" : /mp3|mpeg/.test(mime) ? "mp3" : /ogg/.test(mime) ? "ogg" : /mp4|m4a/.test(mime) ? "m4a" : "webm";
  form.append("file", new Blob([audio as BlobPart], { type: mime }), `audio.${ext}`);
  form.append("model", service.model);
  form.append("response_format", "json");
  if (language) form.append("language", language);
  const response = await fetch(`${service.url}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${service.key}` },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  const json = (await response.json().catch(() => ({}))) as { text?: string; error?: { message?: string; code?: string } };
  if (!response.ok) {
    console.error("[transcribe] service", response.status, json.error?.code);
    return null; // fall back to the AI gateway's models
  }
  return (json.text ?? "").trim();
}

export async function transcribe(userId: string, audio: Uint8Array, mime: string, language?: string) {
  if (transcriptionService()) {
    const text = await viaService(audio, mime, language);
    if (text !== null) return text;
  }
  const ai = await gateway(userId);
  if (!ai) throw new ApiError("Transcription needs the AI gateway, which isn’t configured.", 503, "asr_unavailable");
  const data = `data:${mime};base64,${Buffer.from(audio).toString("base64")}`;
  const format = /wav/.test(mime) ? "wav" : /mp3|mpeg/.test(mime) ? "mp3" : /ogg/.test(mime) ? "ogg" : "webm";
  try {
    return await withModel("asr", (model) =>
      /omni/.test(model) ? omni(ai, model, data, format, language) : recognise(ai, model, data, language),
    );
  } catch (e) {
    if (e instanceof AllRefused)
      throw new ApiError(
        "No speech-to-text service is available yet. Add a transcription key (TRANSCRIBE_API_KEY, e.g. OpenAI or Groq) or allow qwen3-asr-flash on the AI key. Meanwhile, paste or upload a transcript.",
        503,
        "asr_unavailable",
      );
    throw e;
  }
}
