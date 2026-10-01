import { z } from "zod";
import { failure, identity, ApiError } from "@/lib/server";
import { deleteNote, listNotes, notePatch, readNote, writeNote } from "@/lib/meeting-notes";

export const dynamic = "force-dynamic";
const noStore = { headers: { "Cache-Control": "private, no-store" } };

/** One note in full (?id=), or every note without its transcript. */
export async function GET(request: Request) {
  try {
    const user = await identity(request);
    const id = new URL(request.url).searchParams.get("id");
    if (id) {
      const note = await readNote(user.userId, id);
      if (!note) throw new ApiError("That meeting note wasn’t found.", 404);
      return Response.json(note, noStore);
    }
    const notes = (await listNotes(user.userId)).map(({ transcript, versions, enhanced, notes, ...n }) => ({
      ...n,
      hasTranscript: !!transcript.trim(),
      hasEnhanced: !!enhanced.trim(),
      preview: (enhanced || notes)
        .split("\n")
        .filter((l) => !/^\s*#/.test(l))
        .join(" ")
        .replace(/[*_>`[\]]|^\s*-\s/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 160),
    }));
    return Response.json({ notes }, noStore);
  } catch (e) {
    return failure(e);
  }
}

/** Creates or updates a note; only the fields sent change. */
export async function POST(request: Request) {
  try {
    const user = await identity(request);
    const parsed = z
      .object({ id: z.string().max(100).optional(), patch: notePatch })
      .safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new ApiError("That note couldn’t be saved.");
    const id = await writeNote(user.userId, parsed.data.id, parsed.data.patch);
    return Response.json({ id, savedAt: new Date().toISOString() });
  } catch (e) {
    return failure(e);
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await identity(request);
    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new ApiError("Choose a note to delete.");
    await deleteNote(user.userId, id);
    return Response.json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
