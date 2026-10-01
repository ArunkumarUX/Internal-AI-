import { z } from "zod";
import { failure, identity, ApiError } from "@/lib/server";
import { gateway, streamChat, type ChatMessage } from "@/lib/ai";
import { listNotes, readNote, transcriptReliable, type MeetingNote } from "@/lib/meeting-notes";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/*
 * The notebook's AI, streamed as server-sent events:
 *   enhance  rough notes + transcript → a structured note
 *   ask      a question about one meeting, answered from its transcript
 *   home     a question across every meeting note ("meeting memory")
 * Events: delta {text}, meetings {list}, insufficient {}, error {error}, done {}.
 */

const schema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("enhance"),
    id: z.string().max(100).optional(),
    title: z.string().max(200).default(""),
    when: z.string().max(80).default(""),
    attendees: z.array(z.string().max(200)).max(200).default([]),
    template: z.string().max(60).default("Automatic"),
    instructions: z.string().max(2000).default(""),
    notes: z.string().max(60_000).default(""),
    transcript: z.string().max(400_000).default(""),
  }),
  z.object({
    mode: z.literal("ask"),
    question: z.string().min(1).max(4000),
    title: z.string().max(200).default(""),
    when: z.string().max(80).default(""),
    attendees: z.array(z.string().max(200)).max(200).default([]),
    notes: z.string().max(60_000).default(""),
    enhanced: z.string().max(80_000).default(""),
    transcript: z.string().max(400_000).default(""),
    history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(12_000) })).max(8).default([]),
  }),
  z.object({
    mode: z.literal("home"),
    question: z.string().min(1).max(4000),
    today: z.string().max(80).default(""),
    history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(12_000) })).max(8).default([]),
  }),
]);

/** Keeps the start and (mostly) the end of very long transcripts. */
function fit(text: string, limit: number) {
  if (text.length <= limit) return text;
  const head = Math.round(limit * 0.3);
  return `${text.slice(0, head)}\n[… part of the meeting omitted for length …]\n${text.slice(-(limit - head))}`;
}

const ENHANCE = `You turn a person's rough meeting notes and the meeting transcript into a clean, readable meeting note.

Rules:
- The person's own notes are the most important input: they show what mattered. Every point they wrote must appear in your note, cleaned up and expanded with evidence from the transcript. Never drop, soften or contradict one.
- Use the transcript for context, detail and evidence. Never invent names, numbers, dates, decisions or owners that aren't in the notes or transcript. If something is unclear, say it is unclear.
- Structure the note around the meeting's natural topics, not a fixed template. Use short "## " headings named after the topics (for example "Customer timeline", "API integration", "Pricing"). Begin with "## Summary": two or three sentences of prose.
- Write readable prose and short bullets, not database fields or tables.
- Add "## Decisions" only if decisions were made. If anyone agreed to do something, finish with "## Actions" as task lines: "- [ ] Owner — action (due date if one was said)". Use "Unassigned" when no owner was said.
- Don't repeat the meeting title as a heading. No preamble, no closing remarks.
- Write in the language the meeting was held in.
- If the transcript is mostly noise, fragments or unintelligible and the person wrote no notes, reply with exactly: INSUFFICIENT_TRANSCRIPT`;

const ASK = `You answer questions about one meeting, using only its transcript, the person's own notes and the enhanced note.
- Ground every claim in what was said. Cite transcript timestamps right after the claim, like [12:31] or a range [32:14–32:47]. Use the timestamps exactly as they appear in the transcript.
- Quote short phrases when the exact wording matters.
- If the meeting doesn't answer the question, say so plainly instead of guessing.
- Be brief. Use short bullets for lists.
- For drafting requests (a follow-up email, a summary for someone), write the draft grounded in the meeting.`;

const HOME = `You are the person's meeting memory. Answer using only the meeting notes provided.
- Find meetings by meaning, not just exact words ("the meeting about delayed delivery" matches a discussion of a late shipment).
- Cite the meeting a point came from as [[meeting:ID]] using the ID given: once per paragraph or list, not after every line. Quote a short excerpt when it helps.
- For "my actions" or "commitments", list them as "- [ ] action — meeting" and include who owns each when known.
- Resolve relative dates ("yesterday", "last week") against today's date.
- If the notes don't contain the answer, say so plainly. Be brief.`;

const STOP = new Set(
  "the a an and or of to in on for with what who did we i my me our about was were is are be at from that this it as by meeting meetings discuss discussed said say any all have had has do does".split(" "),
);

function rank(notes: MeetingNote[], question: string) {
  const words = (question.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter((w) => !STOP.has(w));
  return notes
    .map((n, i) => {
      const hay = `${n.title} ${n.attendees.join(" ")} ${n.notes} ${n.enhanced} ${n.transcript}`.toLowerCase();
      const hits = words.reduce((s, w) => s + (hay.includes(w) ? (n.title.toLowerCase().includes(w) ? 3 : 1) : 0), 0);
      return { n, score: hits * 10 - i * 0.05 }; // ties go to the most recent
    })
    .sort((a, b) => b.score - a.score);
}

/** A few transcript lines around each matching word. */
function excerpts(transcript: string, question: string, limit = 2500) {
  const words = (question.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []).filter((w) => !STOP.has(w));
  if (!words.length) return "";
  const lines = transcript.split("\n");
  const keep = new Set<number>();
  lines.forEach((l, i) => {
    const low = l.toLowerCase();
    if (words.some((w) => low.includes(w))) for (let k = i - 1; k <= i + 1; k++) if (k >= 0 && k < lines.length) keep.add(k);
  });
  return [...keep]
    .sort((a, b) => a - b)
    .map((i) => lines[i])
    .join("\n")
    .slice(0, limit);
}

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export async function POST(request: Request) {
  let body: z.infer<typeof schema>;
  let user: Awaited<ReturnType<typeof identity>>;
  let ai: NonNullable<Awaited<ReturnType<typeof gateway>>>;
  try {
    user = await identity(request);
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new ApiError("That request couldn’t be read.");
    body = parsed.data;
    const g = await gateway(user.userId);
    if (!g) throw new ApiError("The AI model isn’t set up yet. Choose one in Settings → Models.", 503);
    ai = g;
  } catch (e) {
    return failure(e);
  }

  const { readable, writable } = new TransformStream<Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const emit = (event: string, data: unknown) =>
    void writer.write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)).catch(() => {});

  (async () => {
    try {
      let messages: ChatMessage[];
      if (body.mode === "enhance") {
        const reliable = transcriptReliable(body.transcript);
        if (!reliable && !body.notes.trim()) {
          emit("insufficient", {});
          return;
        }
        const style =
          body.template === "Custom" && body.instructions.trim()
            ? `\nThe person's own format for this note: ${body.instructions.trim()}`
            : body.template && body.template !== "Automatic"
              ? `\nThis was a ${body.template}. Shape the sections the way a good ${body.template} note reads, still using only what was said.`
              : "";
        const caution = reliable
          ? ""
          : "\nThe transcript is unreliable (very little was captured). Build the note from the person's notes; use only transcript lines that clearly support them, and add nothing else.";
        messages = [
          { role: "system", content: `${ENHANCE}${style}${caution}\nThe note taker is ${user.displayName || "the person asking"}.` },
          {
            role: "user",
            content: `Meeting: ${body.title || "Untitled"}${body.when ? `\nWhen: ${body.when}` : ""}${
              body.attendees.length ? `\nParticipants: ${body.attendees.join(", ")}` : ""
            }\n\nMy notes:\n"""\n${body.notes.trim() || "(I took no notes. Write the note from the transcript.)"}\n"""\n\nTranscript:\n"""\n${
              fit(body.transcript.trim(), 120_000) || "(no transcript)"
            }\n"""`,
          },
        ];
      } else if (body.mode === "ask") {
        messages = [
          { role: "system", content: `${ASK}\n- The person asking is ${user.displayName || "the note taker"}; "I", "me" and "my" mean them.` },
          {
            role: "user",
            content: `Meeting: ${body.title || "Untitled"}${body.when ? `\nWhen: ${body.when}` : ""}${
              body.attendees.length ? `\nParticipants: ${body.attendees.join(", ")}` : ""
            }\n\nMy notes:\n"""\n${body.notes.trim() || "(none)"}\n"""\n\nEnhanced note:\n"""\n${body.enhanced.trim() || "(none)"}\n"""\n\nTranscript:\n"""\n${
              fit(body.transcript.trim(), 120_000) || "(no transcript yet)"
            }\n"""`,
          },
          { role: "assistant", content: "I have the meeting. What would you like to know?" },
          ...body.history,
          { role: "user", content: body.question },
        ];
      } else {
        const notes = await listNotes(user.userId);
        if (!notes.length) {
          emit("delta", { text: "You don’t have any meeting notes yet. Open a meeting from Coming up, or start a new note." });
          return;
        }
        const ranked = rank(notes, body.question);
        const detailed = ranked.slice(0, 8).map((r) => r.n);
        const detailIds = new Set(detailed.map((n) => n.id));
        const index = notes
          .filter((n) => !detailIds.has(n.id))
          .slice(0, 80)
          .map((n) => `- ID ${n.id} · ${day(n.start)} · ${n.title}${n.attendees.length ? ` · with ${n.attendees.slice(0, 6).join(", ")}` : ""} · ${(n.enhanced || n.notes).replace(/\s+/g, " ").slice(0, 220)}`)
          .join("\n");
        const detail = await Promise.all(
          detailed.map(async (n) => {
            const full = (await readNote(user.userId, n.id)) ?? n;
            const quoted = excerpts(full.transcript, body.question);
            return `### ID ${full.id} · ${day(full.start)} · ${full.title}\nParticipants: ${full.attendees.join(", ") || "not recorded"}\n${
              full.enhanced.trim() ? `Note:\n${full.enhanced.slice(0, 4000)}` : full.notes.trim() ? `Notes:\n${full.notes.slice(0, 3000)}` : `Transcript start:\n${full.transcript.slice(0, 2500)}`
            }${quoted ? `\nRelevant transcript lines:\n${quoted}` : ""}`;
          }),
        );
        emit("meetings", { list: notes.slice(0, 200).map((n) => ({ id: n.id, title: n.title, start: n.start })) });
        messages = [
          { role: "system", content: `${HOME}\n- The person asking is ${user.displayName || "the note taker"}; "I", "me" and "my" mean them (match them to participants by first name).` },
          {
            role: "user",
            content: `Today is ${body.today || day(new Date().toISOString())}.\n\nMost relevant meetings:\n\n${detail.join("\n\n")}${
              index ? `\n\nOther meetings:\n${index}` : ""
            }`,
          },
          { role: "assistant", content: "I have your meeting notes. What would you like to know?" },
          ...body.history,
          { role: "user", content: body.question },
        ];
      }

      // Enhance holds back the first characters so the "insufficient" signal is never shown as text.
      let held = body.mode === "enhance" ? "" : null;
      await streamChat(
        ai,
        messages,
        (text) => {
          if (held === null) return emit("delta", { text });
          held += text;
          if (held.length >= 24 || !"INSUFFICIENT_TRANSCRIPT".startsWith(held.trim())) {
            emit("delta", { text: held });
            held = null;
          }
        },
        { maxTokens: body.mode === "enhance" ? 4000 : 1800, signal: request.signal },
      );
      if (held !== null) {
        if (held.trim().startsWith("INSUFFICIENT_TRANSCRIPT")) emit("insufficient", {});
        else if (held) emit("delta", { text: held });
      }
    } catch (e) {
      if (request.signal.aborted) return;
      emit("error", { error: e instanceof ApiError ? e.message : "The AI couldn’t answer just now. Please try again." });
    } finally {
      emit("done", {});
      await writer.close().catch(() => {});
    }
  })();

  return new Response(readable, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}
