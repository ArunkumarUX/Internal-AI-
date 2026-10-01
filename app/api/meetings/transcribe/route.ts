import { failure, identity, ApiError } from "@/lib/server";
import { MAX_AUDIO_BYTES, transcribe } from "@/lib/transcribe";

export const dynamic = "force-dynamic";

const LANGUAGE = /^[a-z]{2}(-[A-Z]{2})?$/;

/** Transcribes one chunk (about 30 seconds) of captured call audio. */
export async function POST(request: Request) {
  try {
    const user = await identity(request);
    const form = await request.formData().catch(() => {
      throw new ApiError("The audio couldn’t be read.");
    });
    const audio = form.get("audio");
    if (!(audio instanceof File) || audio.size === 0) throw new ApiError("No audio was sent.");
    if (audio.size > MAX_AUDIO_BYTES) throw new ApiError("That audio chunk is too large.");
    const mime = /^audio\/[a-z0-9.+-]+/i.exec(audio.type)?.[0] ?? "audio/webm";
    const language = String(form.get("language") ?? "").slice(0, 2).toLowerCase();
    const text = await transcribe(user.userId, new Uint8Array(await audio.arrayBuffer()), mime, LANGUAGE.test(language) ? language : undefined);
    return Response.json({ text });
  } catch (e) {
    return failure(e);
  }
}
