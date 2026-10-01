import { z } from "zod";
import { database, saveRecord, ApiError } from "@/lib/server";

/*
 * Meeting notes are "saved" records with data.type = "meeting", so they also
 * appear in Saved work and older saved meetings open in the notebook.
 *   notes      what the person typed (never overwritten by AI)
 *   enhanced   the AI-enhanced note (markdown); versions keeps earlier ones
 *   content    the transcript, one "[mm:ss] Speaker: text" line per phrase
 */

export type NoteVersion = { at: string; text: string };

export type MeetingNote = {
  id: string;
  title: string;
  start: string;
  end: string;
  provider: string;
  joinUrl: string;
  meetingId: string;
  attendees: string[];
  notes: string;
  enhanced: string;
  versions: NoteVersion[];
  template: string;
  transcript: string;
  duration: number;
  client: string;
  created_at: string;
  updated_at: string;
};

export const notePatch = z
  .object({
    title: z.string().max(200),
    start: z.string().max(40),
    end: z.string().max(40),
    provider: z.string().max(20),
    joinUrl: z.string().max(2000),
    meetingId: z.string().max(400),
    attendees: z.array(z.string().max(200)).max(200),
    notes: z.string().max(60_000),
    enhanced: z.string().max(80_000),
    versions: z.array(z.object({ at: z.string().max(40), text: z.string().max(80_000) })).max(6),
    template: z.string().max(60),
    transcript: z.string().max(400_000),
    duration: z.number().int().min(0).max(86_400),
    client: z.string().max(200),
  })
  .partial();

const str = (v: unknown) => (typeof v === "string" ? v : "");

function fromRecord(row: { id: unknown; data: unknown; created_at: unknown; updated_at: unknown }): MeetingNote | null {
  let d: Record<string, unknown>;
  try {
    d = JSON.parse(String(row.data));
  } catch {
    return null;
  }
  if (d.type !== "meeting") return null;
  return {
    id: String(row.id),
    title: str(d.title) || "Untitled meeting",
    start: str(d.start) || String(row.created_at),
    end: str(d.end),
    provider: str(d.provider),
    joinUrl: str(d.joinUrl),
    meetingId: str(d.meetingId),
    attendees: Array.isArray(d.attendees) ? d.attendees.map(String) : [],
    notes: str(d.notes),
    enhanced: str(d.enhanced),
    versions: Array.isArray(d.versions) ? (d.versions as NoteVersion[]) : [],
    template: str(d.template) || "Automatic",
    transcript: str(d.content),
    duration: Number(d.duration) || 0,
    client: str(d.client),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function toData(n: Omit<MeetingNote, "id" | "created_at" | "updated_at">) {
  const { transcript, ...rest } = n;
  return { type: "meeting", ...rest, content: transcript, sourceIds: [] };
}

export async function listNotes(userId: string): Promise<MeetingNote[]> {
  const rows = await database()
    .prepare("SELECT id,data,created_at,updated_at FROM records WHERE user_id=? AND kind='saved' ORDER BY updated_at DESC LIMIT 600")
    .bind(userId)
    .all<{ id: string; data: string; created_at: string; updated_at: string }>();
  return (rows.results ?? []).flatMap((r) => fromRecord(r) ?? []);
}

export async function readNote(userId: string, id: string) {
  const row = await database()
    .prepare("SELECT id,data,created_at,updated_at FROM records WHERE id=? AND user_id=? AND kind='saved'")
    .bind(id, userId)
    .first<{ id: string; data: string; created_at: string; updated_at: string }>();
  return row ? fromRecord(row) : null;
}

/** Creates a note, or merges the patch into an existing one. */
export async function writeNote(userId: string, id: string | undefined, patch: z.infer<typeof notePatch>) {
  const existing = id ? await readNote(userId, id) : null;
  if (id && !existing) throw new ApiError("That meeting note wasn’t found.", 404);
  const base: Omit<MeetingNote, "id" | "created_at" | "updated_at"> = existing ?? {
    title: "",
    start: new Date().toISOString(),
    end: "",
    provider: "",
    joinUrl: "",
    meetingId: "",
    attendees: [],
    notes: "",
    enhanced: "",
    versions: [],
    template: "Automatic",
    transcript: "",
    duration: 0,
    client: "",
  };
  const rest = { ...base } as Partial<MeetingNote>;
  delete rest.id;
  delete rest.created_at;
  delete rest.updated_at;
  const merged = { ...(rest as Omit<MeetingNote, "id" | "created_at" | "updated_at">), ...patch };
  merged.title = merged.title.trim() || "Untitled meeting";
  return saveRecord(userId, "saved", toData(merged), id);
}

export async function deleteNote(userId: string, id: string) {
  await database().prepare("DELETE FROM records WHERE id=? AND user_id=? AND kind='saved'").bind(id, userId).run();
}

/** "[12:31] Sarah: text" → plain words, for judging how much was really captured. */
export function spokenWords(transcript: string) {
  return transcript
    .split("\n")
    .map((l) => l.replace(/^\[\d+:\d+\]\s*/, "").replace(/^[^:]{1,40}:\s/, ""))
    .join(" ")
    .match(/[\p{L}\p{N}']+/gu) ?? [];
}

/**
 * Whether a transcript holds enough real conversation to write notes from:
 * enough words, and not just the same few fragments over and over.
 */
export function transcriptReliable(transcript: string) {
  const words = spokenWords(transcript);
  if (words.length < 60) return false;
  const distinct = new Set(words.map((w) => w.toLowerCase())).size;
  return distinct >= 30 && distinct / words.length > 0.12;
}
