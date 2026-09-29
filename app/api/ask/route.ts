import { z } from "zod";
import { identity, failure, ApiError } from "@/lib/server";
import { answer, type Emit } from "@/lib/engine";

const schema = z.object({
  query: z.string().min(1).max(12000),
  scope: z.string().max(100).default("All knowledge"),
  verified: z.boolean().default(true),
  attachmentIds: z.array(z.string().max(100)).max(10).default([]),
  threadId: z.string().max(100).optional(),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        // Trimmed to a working size in the engine.
        content: z.string().max(200000),
      }),
    )
    .max(20)
    .default([]),
});

async function parse(request: Request) {
  const user = await identity(request);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const tooLong = parsed.error.issues.some(
      (i) => i.path[0] === "query" && i.code === "too_big",
    );
    throw new ApiError(
      tooLong
        ? "Your question is too long (max 12,000 characters)."
        : "Invalid question or conversation context.",
    );
  }
  return { user, body: parsed.data };
}

export async function POST(request: Request) {
  const wantsStream = request.headers.get("accept")?.includes("text/event-stream");
  let input: Awaited<ReturnType<typeof parse>>;
  try {
    input = await parse(request);
    if (!wantsStream)
      return Response.json(
        await answer(input.user, input.body, () => {}, true, request.signal),
      );
  } catch (e) {
    return failure(e);
  }
  const { readable, writable } = new TransformStream<Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const emit: Emit = (event, data) =>
    void writer
      .write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      .catch(() => {});
  (async () => {
    try {
      await answer(input.user, input.body, emit, true, request.signal);
    } catch (e) {
      // A disconnected client has nobody to report to.
      if (request.signal.aborted) return;
      const response = failure(e);
      const body = (await response.json()) as { error: string };
      emit("error", { error: body.error, status: response.status });
    } finally {
      await writer.close().catch(() => {});
    }
  })();
  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
