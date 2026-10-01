"use client";
import "./notebook.css";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronDown,
  Copy,
  Download,
  FileText,
  Languages,
  LoaderCircle,
  Mic,
  Monitor,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Search,
  Sparkles,
  Square,
  Trash2,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api, downloadText, type Workspace } from "@/lib/client";
import { setMeetingSeconds, useAssistantPrefs, useSpeech, type RecordingState } from "./assistant";
import { useCallCapture, type Calendars, type Meeting, type Provider } from "./meetings";

/* ------------------------------------------------------------------ */
/* Types and helpers                                                   */
/* ------------------------------------------------------------------ */

type Version = { at: string; text: string };

type Note = {
  /** Stable while the note is open, before and after it gets a server id. */
  key: string;
  id?: string;
  title: string;
  start: string;
  end: string;
  provider: Provider | string;
  joinUrl: string;
  meetingId: string;
  attendees: string[];
  notes: string;
  enhanced: string;
  versions: Version[];
  template: string;
  transcript: string;
  duration: number;
  client: string;
};

type NoteSummary = {
  id: string;
  title: string;
  start: string;
  provider: string;
  meetingId: string;
  attendees: string[];
  updated_at: string;
  hasTranscript: boolean;
  hasEnhanced: boolean;
  preview: string;
};

type Segment = { at: number; speaker: string; text: string };
type Turn = { q: string; a: string; streaming: boolean; error?: string };
type Status = "idle" | "recording" | "paused" | "processing";

const SAVED_FIELDS = [
  "title",
  "start",
  "end",
  "provider",
  "joinUrl",
  "meetingId",
  "attendees",
  "notes",
  "enhanced",
  "versions",
  "template",
  "transcript",
  "duration",
  "client",
] as const;

export const TEMPLATES = [
  "Automatic",
  "1:1",
  "Team meeting",
  "Customer call",
  "Interview",
  "Sales",
  "Project update",
  "Research interview",
  "Stand-up",
  "Custom",
];

const LANGUAGES: [string, string][] = [
  ["en-GB", "English (UK)"],
  ["en-US", "English (US)"],
  ["fr-FR", "French"],
  ["de-DE", "German"],
  ["es-ES", "Spanish"],
  ["ar-SA", "Arabic"],
  ["hi-IN", "Hindi"],
  ["ta-IN", "Tamil"],
];

const PROVIDER_LABEL: Record<string, string> = { teams: "Teams", meet: "Meet", zoom: "Zoom" };

const newKey = () => Math.random().toString(36).slice(2);

function blankNote(partial: Partial<Note> = {}): Note {
  return {
    key: newKey(),
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
    ...partial,
  };
}

/** 83 → "01:23"; 3723 → "1:02:03". */
const clock = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${m}:${sec}` : `${m}:${sec}`;
};
/** Transcript stamps count minutes past 59: [62:10]. */
const stamp = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
const time = (iso: string) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  if (d.toDateString() === tomorrow.toDateString()) return "Tomorrow";
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(d.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}),
  });
}

/** "sarah.jones@x.com" → "Sarah"; "Sarah Jones" → "Sarah". */
function firstName(person: string) {
  const base = person.includes("@") ? person.split("@")[0].split(/[._-]/)[0] : person.trim().split(/\s+/)[0];
  return base ? base[0].toUpperCase() + base.slice(1) : person;
}
const initials = (person: string) =>
  (person.includes("@") ? person.split("@")[0].split(/[._-]/) : person.trim().split(/\s+/))
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || "•";

function people(list: string[], max = 3) {
  const names = list.map(firstName);
  return names.length > max ? `${names.slice(0, max).join(", ")} +${names.length - max}` : names.join(", ");
}

const LINE = /^\[(\d{1,3}):(\d{2})\]\s*(.*)$/;
const SPEAKER = /^([A-Z][\w.'’-]*(?: [A-Z0-9][\w.'’-]*){0,3}):\s(.*)$/;

function parseTranscript(text: string): Segment[] {
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((line) => {
      const m = line.match(LINE);
      const body = m ? m[3] : line.trim();
      const at = m ? Number(m[1]) * 60 + Number(m[2]) : 0;
      const s = body.match(SPEAKER);
      return s ? { at, speaker: s[1], text: s[2] } : { at, speaker: "", text: body };
    });
}
const serialize = (segments: Segment[]) =>
  segments.map((s) => `[${stamp(s.at)}] ${s.speaker ? `${s.speaker}: ` : ""}${s.text}`).join("\n");

/** WebVTT or SRT captions → transcript lines; plain text is kept as it is. */
function captionsToTranscript(raw: string) {
  if (!/-->/.test(raw)) return raw.trim();
  const out: string[] = [];
  let at = "";
  for (const r of raw.split(/\r?\n/)) {
    const line = r.trim();
    const cue = line.match(/^(\d{2}):(\d{2}):(\d{2})[.,]\d+\s+-->/);
    if (cue) {
      at = `${String(Number(cue[1]) * 60 + Number(cue[2])).padStart(2, "0")}:${cue[3]}`;
      continue;
    }
    if (!line || line === "WEBVTT" || /^\d+$/.test(line) || /^NOTE\b/.test(line)) continue;
    const voice = line.match(/^<v ([^>]+)>(.*?)(<\/v>)?$/);
    const text = (voice ? `${voice[1]}: ${voice[2]}` : line).replace(/<[^>]+>/g, "").trim();
    if (text) out.push(`[${at || "00:00"}] ${text}`);
  }
  return out.join("\n");
}

function whenText(n: Pick<Note, "start" | "end">) {
  if (!n.start) return "";
  const d = new Date(n.start);
  return `${d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}, ${time(n.start)}${
    n.end ? `–${time(n.end)}` : ""
  }`;
}

const isEditable = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

/** Posts to the notebook's AI endpoint and dispatches its server-sent events. */
async function streamAI(
  body: Record<string, unknown>,
  on: {
    delta?: (text: string) => void;
    meetings?: (list: { id: string; title: string; start: string }[]) => void;
    insufficient?: () => void;
    error?: (message: string) => void;
  },
  signal?: AbortSignal,
) {
  const response = await fetch("/api/meetings/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    credentials: "include",
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok || !response.body) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    on.error?.(data.error || "The AI couldn’t answer just now. Please try again.");
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut;
    while ((cut = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      const event = frame.match(/^event: (.*)$/m)?.[1];
      const raw = frame.match(/^data: (.*)$/m)?.[1];
      if (!event || !raw) continue;
      const data = JSON.parse(raw);
      if (event === "delta") on.delta?.(data.text);
      else if (event === "meetings") on.meetings?.(data.list);
      else if (event === "insufficient") on.insufficient?.();
      else if (event === "error") on.error?.(data.error);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Light markdown for notes and answers                                */
/* ------------------------------------------------------------------ */

const INLINE = /(\*\*[^*]+\*\*|\[\[meeting:[^\]\s]+\]\]|\[\d{1,3}:\d{2}(?:\s*[–-]\s*\d{1,3}:\d{2})?\])/g;

function Inline({
  text,
  onTime,
  onMeeting,
  meetingTitle,
}: {
  text: string;
  onTime?: (seconds: number) => void;
  onMeeting?: (id: string) => void;
  meetingTitle?: (id: string) => string;
}) {
  return (
    <>
      {text.split(INLINE).map((part, i) => {
        if (!part) return null;
        if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
        const meeting = part.match(/^\[\[meeting:([^\]]+)\]\]$/);
        if (meeting)
          return (
            <button key={i} type="button" className="nb-cite" onClick={() => onMeeting?.(meeting[1])}>
              <FileText size={11} /> {meetingTitle?.(meeting[1]) || "Open meeting"}
            </button>
          );
        const t = part.match(/^\[(\d{1,3}):(\d{2})(?:\s*[–-]\s*(\d{1,3}):(\d{2}))?\]$/);
        if (t)
          return (
            <button
              key={i}
              type="button"
              className="nb-cite time"
              title="View in transcript"
              onClick={() => onTime?.(Number(t[1]) * 60 + Number(t[2]))}
            >
              {part.slice(1, -1)}
            </button>
          );
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </>
  );
}

function NoteMarkdown({
  text,
  onToggle,
  ...inline
}: {
  text: string;
  /** Ticks or unticks the task on this line of `text`. */
  onToggle?: (line: number) => void;
  onTime?: (seconds: number) => void;
  onMeeting?: (id: string) => void;
  meetingTitle?: (id: string) => string;
}) {
  type Block =
    | { kind: "h"; level: number; text: string }
    | { kind: "p"; text: string }
    | { kind: "list"; ordered: boolean; items: { text: string; task?: boolean; done?: boolean; line: number }[] };
  const blocks: Block[] = [];
  text.split("\n").forEach((raw, line) => {
    const l = raw.trimEnd();
    const last = blocks.at(-1);
    const h = l.match(/^(#{1,4})\s+(.*)$/);
    const task = l.match(/^\s*[-*•]\s+\[( |x|X)\]\s+(.*)$/);
    const bullet = l.match(/^\s*[-*•]\s+(.*)$/);
    const num = l.match(/^\s*\d+[.)]\s+(.*)$/);
    if (!l.trim()) blocks.push({ kind: "p", text: "" });
    else if (h) blocks.push({ kind: "h", level: h[1].length, text: h[2] });
    else if (task || bullet || num) {
      const item = task
        ? { text: task[2], task: true, done: task[1] !== " ", line }
        : { text: (bullet ?? num)![1], line };
      const ordered = !!num && !task && !bullet;
      if (last?.kind === "list" && last.ordered === ordered) last.items.push(item);
      else blocks.push({ kind: "list", ordered, items: [item] });
    } else if (last?.kind === "p" && last.text) last.text += ` ${l.trim()}`;
    else blocks.push({ kind: "p", text: l.trim() });
  });
  return (
    <div className="nb-md">
      {blocks.map((b, i) => {
        if (b.kind === "h") return b.level <= 1 ? <h2 key={i}>{b.text}</h2> : <h3 key={i}>{b.text}</h3>;
        if (b.kind === "p") return b.text ? <p key={i}><Inline text={b.text} {...inline} /></p> : null;
        const items = b.items.map((it) =>
          it.task ? (
            <li key={it.line} className={`task${it.done ? " done" : ""}`}>
              <button
                type="button"
                role="checkbox"
                aria-checked={!!it.done}
                aria-label={it.done ? "Mark as not done" : "Mark as done"}
                disabled={!onToggle}
                onClick={() => onToggle?.(it.line)}
              >
                {it.done && <Check size={11} strokeWidth={3} />}
              </button>
              <span>
                <Inline text={it.text} {...inline} />
              </span>
            </li>
          ) : (
            <li key={it.line}>
              <Inline text={it.text} {...inline} />
            </li>
          ),
        );
        return b.ordered ? <ol key={i}>{items}</ol> : <ul key={i}>{items}</ul>;
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Notebook                                                            */
/* ------------------------------------------------------------------ */

export function Notebook({
  ws,
  active,
  onRecording,
  stopSignal,
}: {
  ws: Workspace;
  /** True while the meeting page is on screen (shortcuts only work then). */
  active: boolean;
  onRecording?: (state: RecordingState) => void;
  /** Incrementing this ends the transcription, like pressing Stop. */
  stopSignal?: number;
}) {
  const { prefs, update } = useAssistantPrefs(ws);
  const signedIn = !!ws.state.user;

  /* ---------------- Calendar and notes ---------------- */
  const [calendar, setCalendar] = useState<Calendars | null>(null);
  const [summaries, setSummaries] = useState<NoteSummary[] | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const loadCalendar = useCallback(async () => {
    try {
      setCalendar(await api("/api/meetings"));
    } catch {
      setCalendar((c) => c);
    }
  }, []);
  const loadNotes = useCallback(async () => {
    try {
      const { notes } = await api("/api/meetings/notes");
      setSummaries(notes);
    } catch {
      setSummaries((s) => s ?? []);
    }
  }, []);
  useEffect(() => {
    if (!signedIn) return;
    void loadCalendar();
    void loadNotes();
    const t = window.setInterval(() => document.visibilityState === "visible" && void loadCalendar(), 5 * 60_000);
    // Back from a calendar sign-in: say how it went.
    const params = new URLSearchParams(window.location.search);
    for (const [key, label] of [
      ["microsoft", "Outlook"],
      ["google", "Google Calendar"],
    ] as const) {
      const outcome = params.get(key);
      if (!outcome) continue;
      if (outcome === "connected") toast.success(`${label} connected. Your meetings will appear under Coming up.`);
      else if (outcome === "failed") toast.error(`${label} didn’t connect. Please try again.`);
      window.history.replaceState(null, "", `/${window.location.hash}`);
    }
    return () => window.clearInterval(t);
  }, [signedIn, loadCalendar, loadNotes]);

  /* ---------------- The open note ---------------- */
  const [view, setView] = useState<"home" | "note">("home");
  const [note, setNote] = useState<Note | null>(null);
  const [opening, setOpening] = useState("");
  const noteRef = useRef(note);
  noteRef.current = note;
  const [tab, setTab] = useState<"enhanced" | "notes">("notes");
  const [editingEnhanced, setEditingEnhanced] = useState(false);
  const [saveState, setSaveState] = useState<"" | "saving" | "saved" | "error">("");

  // Saving: only fields that changed since the last save are sent.
  const lastSaved = useRef<Partial<Record<(typeof SAVED_FIELDS)[number], string>>>({});
  const saving = useRef(false);
  const saveTimer = useRef(0);
  const flush = useCallback(async () => {
    window.clearTimeout(saveTimer.current);
    const n = noteRef.current;
    if (!n || saving.current || !signedIn) return;
    if (!n.id && !n.notes.trim() && !n.transcript.trim() && !n.enhanced.trim() && !n.title.trim()) return;
    const patch: Record<string, unknown> = {};
    const snapshot: Record<string, string> = {};
    for (const f of SAVED_FIELDS) {
      const value = JSON.stringify(n[f]);
      snapshot[f] = value;
      if (!n.id || lastSaved.current[f] !== value) patch[f] = n[f];
    }
    if (!Object.keys(patch).length) return;
    if (!patch.title && !n.id) patch.title = n.title || "Untitled meeting";
    saving.current = true;
    setSaveState("saving");
    try {
      const { id } = await api("/api/meetings/notes", { id: n.id, patch });
      lastSaved.current = snapshot;
      if (!n.id) setNote((cur) => (cur && cur.key === n.key ? { ...cur, id } : cur));
      setSaveState("saved");
    } catch {
      setSaveState("error");
    } finally {
      saving.current = false;
      // Anything typed while saving goes out next.
      saveTimer.current = window.setTimeout(() => void flushRef.current(), 1200);
    }
  }, [signedIn]);
  const flushRef = useRef(flush);
  flushRef.current = flush;
  const scheduleSave = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void flushRef.current(), 900);
  }, []);
  const change = useCallback(
    (patch: Partial<Note> | ((n: Note) => Partial<Note>)) => {
      setNote((n) => (n ? { ...n, ...(typeof patch === "function" ? patch(n) : patch) } : n));
      scheduleSave();
    },
    [scheduleSave],
  );

  /* ---------------- Transcription ---------------- */
  const [status, setStatus] = useState<Status>("idle");
  const [seconds, setSeconds] = useState(0);
  const secondsRef = useRef(0);
  secondsRef.current = seconds;
  const [source, setSource] = useState<"mic" | "call">("mic");
  const language = prefs.meeting.language;
  const append = useCallback(
    (segment: Segment) => {
      change((n) => {
        const segments = [...parseTranscript(n.transcript), segment].sort((a, b) => a.at - b.at);
        return { transcript: serialize(segments) };
      });
    },
    [change],
  );
  const speech = useSpeech((text) => text && append({ at: secondsRef.current, speaker: "", text }), language, "meeting");
  const capture = useCallCapture((text, at) => append({ at, speaker: "", text }), language.slice(0, 2));
  const live = status === "recording" || status === "paused";
  const liveKey = useRef("");

  useEffect(() => {
    if (status !== "recording") return;
    const t = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(t);
  }, [status]);
  // Recognition that stops on its own (mic lost, permission revoked) pauses the clock.
  useEffect(() => {
    if (status !== "recording") return;
    if (source === "mic" ? !speech.listening : !capture.active) setStatus("paused");
  }, [status, speech.listening, capture.active, source]);
  useEffect(
    () => onRecording?.(status === "recording" ? "recording" : status === "paused" ? "paused" : "off"),
    [status, onRecording],
  );
  useEffect(() => () => onRecording?.("off"), [onRecording]);
  useEffect(() => setMeetingSeconds(live ? seconds : 0), [live, seconds]);
  useEffect(() => {
    if (status !== "recording") return;
    const prefix = "● Listening · ";
    document.title = prefix + document.title.replace(prefix, "");
    return () => {
      document.title = document.title.replace(prefix, "");
    };
  }, [status]);
  // Warn before a live transcription or unsaved typing is lost with the tab.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (!live && saveState !== "saving" && saveState !== "error") return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [live, saveState]);

  async function startCapture(from: "mic" | "call" = source) {
    const n = noteRef.current;
    if (!n) return;
    if (!signedIn) {
      toast.error("Sign in to transcribe meetings.");
      return;
    }
    setSource(from);
    const started = from === "call" ? await capture.start(secondsRef.current) : speech.start();
    if (!started) return;
    if (status === "idle") {
      // Continue the meeting clock after earlier capture.
      const segments = parseTranscript(n.transcript);
      setSeconds(Math.max(n.duration, segments.at(-1)?.at ?? 0));
      toast.message("Transcribing. Let everyone in the meeting know.");
    }
    liveKey.current = n.key;
    setInsufficient(false);
    setStatus("recording");
  }
  function pauseCapture() {
    speech.stop();
    capture.stop();
    setStatus("paused");
  }
  function switchSource(next: "mic" | "call") {
    if (next === source) return;
    if (status === "recording") {
      speech.stop();
      capture.stop();
      void startCapture(next);
    } else setSource(next);
  }
  function stopCapture() {
    speech.stop();
    capture.stop();
    change({ duration: secondsRef.current });
    setStatus("processing");
  }
  const stopRef = useRef(stopCapture);
  stopRef.current = stopCapture;
  const lastSignal = useRef(stopSignal);
  useEffect(() => {
    if (stopSignal === lastSignal.current) return;
    lastSignal.current = stopSignal;
    if (live) stopRef.current();
  }, [stopSignal, live]);

  /* ---------------- Enhance ---------------- */
  const [enhancing, setEnhancing] = useState(false);
  const [stream, setStream] = useState("");
  const [insufficient, setInsufficient] = useState(false);
  const [ready, setReady] = useState(false);
  const enhanceAbort = useRef<AbortController | null>(null);

  async function enhance(auto = false) {
    const n = noteRef.current;
    if (!n || enhancing) return;
    if (!n.transcript.trim() && !n.notes.trim()) {
      if (!auto) toast.message("Write a few notes or start transcribing first.");
      return;
    }
    await flush();
    enhanceAbort.current?.abort();
    const controller = new AbortController();
    enhanceAbort.current = controller;
    setEnhancing(true);
    setInsufficient(false);
    setReady(false);
    setEditingEnhanced(false);
    setTab("enhanced");
    setStream("");
    let text = "";
    let poor = false;
    try {
      await streamAI(
        {
          mode: "enhance",
          id: n.id,
          title: n.title,
          when: whenText(n),
          attendees: n.attendees,
          template: n.template,
          notes: n.notes,
          transcript: n.transcript,
        },
        {
          delta: (t) => {
            text += t;
            setStream(text);
          },
          insufficient: () => {
            poor = true;
          },
          error: (message) => toast.error(message),
        },
        controller.signal,
      );
    } catch (e) {
      if ((e as Error).name !== "AbortError") toast.error("Enhancing stopped. Your notes are unchanged.");
    } finally {
      setEnhancing(false);
      setStream("");
    }
    if (poor) {
      setInsufficient(true);
      setTab("notes");
      return;
    }
    if (!text.trim()) {
      if (!noteRef.current?.enhanced) setTab("notes");
      return;
    }
    change((cur) => ({
      enhanced: text.trim(),
      versions: cur.enhanced ? [...cur.versions, { at: new Date().toISOString(), text: cur.enhanced }].slice(-5) : cur.versions,
    }));
    setReady(true);
  }
  const enhanceRef = useRef(enhance);
  enhanceRef.current = enhance;

  // After Stop: wait for the last audio chunks, then write the notes.
  useEffect(() => {
    if (status !== "processing" || capture.pending > 0) return;
    setStatus("idle");
    void enhanceRef.current(true);
  }, [status, capture.pending]);

  function undoEnhancement() {
    const n = noteRef.current;
    if (!n) return;
    const previous = n.versions.at(-1);
    change({ enhanced: previous?.text ?? "", versions: n.versions.slice(0, -1) });
    setReady(false);
    if (!previous) setTab("notes");
    toast.success(previous ? "Restored the previous version" : "Enhancement removed. Your notes are as you wrote them.");
  }

  /* ---------------- Opening notes ---------------- */
  const [drawer, setDrawer] = useState<{ open: boolean; focus?: number; paste?: boolean }>({ open: false });
  const [palette, setPalette] = useState(false);

  function resetNoteUi(n: Note) {
    lastSaved.current = n.id ? Object.fromEntries(SAVED_FIELDS.map((f) => [f, JSON.stringify(n[f])])) : {};
    setTab(n.enhanced ? "enhanced" : "notes");
    setEditingEnhanced(false);
    setInsufficient(false);
    setReady(false);
    setSaveState("");
    setDrawer({ open: false });
    setAsk((a) => ({ ...a, open: false }));
  }
  async function show(next: Note) {
    await flush();
    resetNoteUi(next);
    setNote(next);
    setView("note");
    window.scrollTo({ top: 0 });
  }
  function busyElsewhere(key?: string) {
    if (live && noteRef.current && noteRef.current.key !== key) {
      toast.error("Stop the current transcription first.");
      setView("note");
      return true;
    }
    return false;
  }
  async function openSummary(s: { id: string }) {
    if (noteRef.current?.id === s.id) {
      setView("note");
      return;
    }
    if (busyElsewhere()) return;
    setOpening(s.id);
    try {
      const full = (await api(`/api/meetings/notes?id=${encodeURIComponent(s.id)}`)) as Omit<Note, "key">;
      await show({ ...blankNote(), ...full, key: newKey() });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setOpening("");
    }
  }
  function openMeeting(m: Meeting) {
    const existing = summaries?.find((s) => s.meetingId === m.id);
    if (existing) return void openSummary(existing);
    if (noteRef.current?.meetingId === m.id) return setView("note");
    if (busyElsewhere()) return;
    const defaultTemplate = TEMPLATES.includes(prefs.meeting.template) ? prefs.meeting.template : "Automatic";
    void show(
      blankNote({
        title: m.title,
        start: m.start,
        end: m.end,
        provider: m.provider || (m.teams ? "teams" : ""),
        joinUrl: m.joinUrl,
        meetingId: m.id,
        attendees: [m.organizer, ...m.attendees.map((a) => a.name || a.email)].filter(Boolean),
        template: defaultTemplate,
      }),
    );
  }
  function newNote() {
    if (busyElsewhere()) return;
    void show(blankNote());
    window.setTimeout(() => document.querySelector<HTMLTextAreaElement>(".nb-body textarea")?.focus(), 50);
  }
  async function goHome() {
    await flush();
    setView("home");
    setAsk((a) => ({ ...a, open: false }));
    void loadNotes();
    // A note left behind (not live) is closed.
    if (!live) setNote(null);
  }
  async function removeNote() {
    const n = noteRef.current;
    if (!n || live) return;
    if (!window.confirm("Delete this note, its transcript and AI notes? This can’t be undone.")) return;
    try {
      if (n.id) await api(`/api/meetings/notes?id=${encodeURIComponent(n.id)}`, undefined, "DELETE");
      setNote(null);
      setView("home");
      void loadNotes();
      toast.success("Note deleted");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  // Teams transcripts are attached on their own once the meeting has ended.
  const triedTeams = useRef(new Set<string>());
  useEffect(() => {
    const n = note;
    if (!n || view !== "note" || live || n.transcript.trim() || !calendar?.microsoft.connected) return;
    if (n.provider !== "teams" || !/^https:\/\/teams\.microsoft\.com\//.test(n.joinUrl)) return;
    if (!n.end || Date.parse(n.end) > now || triedTeams.current.has(n.key)) return;
    triedTeams.current.add(n.key);
    void api("/api/meetings/transcript", { joinUrl: n.joinUrl })
      .then(({ text }: { text: string }) => {
        if (!text?.trim() || noteRef.current?.key !== n.key || noteRef.current.transcript.trim()) return;
        change({ transcript: text });
        toast.success("The Teams transcript was added to this note.");
      })
      .catch(() => {});
  }, [note, view, live, calendar, now, change]);

  /* ---------------- Ask anything ---------------- */
  const [ask, setAsk] = useState<{ open: boolean; scope: "note" | "home"; turns: Turn[] }>({
    open: false,
    scope: "home",
    turns: [],
  });
  const [question, setQuestion] = useState("");
  const askInput = useRef<HTMLInputElement>(null);
  const askAbort = useRef<AbortController | null>(null);
  const [meetingIndex, setMeetingIndex] = useState<Record<string, string>>({});
  const answerEnd = useRef<HTMLDivElement>(null);

  async function askAI(q: string) {
    const text = q.trim();
    if (!text) return;
    if (!signedIn) {
      toast.error("Sign in to ask about your meetings.");
      return;
    }
    const scope = view === "note" && note ? "note" : "home";
    const previous = ask.scope === scope ? ask.turns.filter((t) => !t.error && t.a) : [];
    const history = previous.slice(-3).flatMap((t) => [
      { role: "user" as const, content: t.q.slice(0, 4000) },
      { role: "assistant" as const, content: t.a.slice(0, 8000) },
    ]);
    setQuestion("");
    setAsk({ open: true, scope, turns: [...previous, { q: text, a: "", streaming: true }] });
    const patch = (fn: (t: Turn) => Turn) =>
      setAsk((a) => ({ ...a, turns: a.turns.map((t, i) => (i === a.turns.length - 1 ? fn(t) : t)) }));
    askAbort.current?.abort();
    const controller = new AbortController();
    askAbort.current = controller;
    const n = noteRef.current;
    try {
      await streamAI(
        scope === "note" && n
          ? {
              mode: "ask",
              question: text,
              title: n.title,
              when: whenText(n),
              attendees: n.attendees,
              notes: n.notes,
              enhanced: n.enhanced,
              transcript: n.transcript,
              history,
            }
          : {
              mode: "home",
              question: text,
              today: new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
              history,
            },
        {
          delta: (t) => patch((turn) => ({ ...turn, a: turn.a + t })),
          meetings: (list) => setMeetingIndex(Object.fromEntries(list.map((m) => [m.id, m.title]))),
          error: (message) => patch((turn) => ({ ...turn, error: message })),
        },
        controller.signal,
      );
    } catch (e) {
      if ((e as Error).name !== "AbortError") patch((turn) => ({ ...turn, error: "The answer stopped. Please try again." }));
    } finally {
      patch((turn) => ({ ...turn, streaming: false }));
    }
  }
  useEffect(() => {
    answerEnd.current?.scrollIntoView({ block: "nearest" });
  }, [ask.turns]);

  /* ---------------- Keyboard ---------------- */
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e: KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    if (mod && k === "k") {
      e.preventDefault();
      e.stopPropagation();
      askInput.current?.focus();
    } else if (mod && k === "n" && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      newNote();
    } else if (mod && e.key === "Enter" && view === "note") {
      e.preventDefault();
      void enhance();
    } else if (e.key === "Escape") {
      if (palette) setPalette(false);
      else if (ask.open) setAsk((a) => ({ ...a, open: false }));
      else if (drawer.open) setDrawer({ open: false });
      else return;
      e.preventDefault();
    } else if (e.key === "/" && !mod && !e.altKey && !isEditable(e.target)) {
      e.preventDefault();
      e.stopPropagation();
      setPalette(true);
    }
  };
  useEffect(() => {
    if (!active) return;
    const listener = (e: KeyboardEvent) => keys.current(e);
    // Capture phase, so ⌘K reaches the notebook before the app's search.
    window.addEventListener("keydown", listener, true);
    return () => window.removeEventListener("keydown", listener, true);
  }, [active]);

  /* ---------------- Derived ---------------- */
  const segments = useMemo(() => parseTranscript(note?.transcript ?? ""), [note?.transcript]);
  const upcoming = (calendar?.meetings ?? []).filter((m) => Date.parse(m.end) >= now).slice(0, 8);
  const connected = !!(calendar?.microsoft.connected || calendar?.google.connected);
  const ended = !!note?.end && Date.parse(note.end) < now;
  const showSuggestions = ready || (!!note && !note.enhanced && !enhancing && !live && segments.length > 0 && status === "idle");

  type Command = { label: string; hint?: string; run: () => void; when?: boolean };
  const commands: Command[] = [
    { label: "Enhance notes", hint: "⌘↵", run: () => void enhance(), when: view === "note" },
    {
      label: status === "recording" ? "Pause transcription" : live ? "Resume transcription" : "Start transcription",
      run: () => (status === "recording" ? pauseCapture() : void startCapture()),
      when: view === "note",
    },
    { label: "Stop transcription", run: stopCapture, when: live },
    { label: "View transcript", run: () => setDrawer({ open: true }), when: view === "note" },
    { label: "Ask anything", hint: "⌘K", run: () => askInput.current?.focus() },
    { label: "New note", hint: "⌘N", run: newNote },
    { label: "Undo enhancement", run: undoEnhancement, when: view === "note" && !!note?.enhanced },
    { label: "Back to home", run: () => void goHome(), when: view === "note" },
  ];

  if (!signedIn && !ws.loading)
    return (
      <div className="nb">
        <div className="nb-home">
          <h1 className="nb-display">Coming up</h1>
          <p className="nb-quiet">Sign in to see your meetings and notes.</p>
        </div>
      </div>
    );

  return (
    <div className={`nb${drawer.open ? " has-drawer" : ""}`}>
      {view === "home" || !note ? (
        <Home
          upcoming={upcoming}
          calendar={calendar}
          connected={connected}
          summaries={summaries}
          now={now}
          opening={opening}
          liveNote={live ? note : null}
          onOpenMeeting={openMeeting}
          onOpenSummary={(s) => void openSummary(s)}
          onOpenLive={() => setView("note")}
          onNew={newNote}
          onCalendarChange={loadCalendar}
        />
      ) : (
        <article className="nb-note">
          <div className="nb-note-top">
            <button type="button" className="nb-ghost" onClick={() => void goHome()}>
              <ArrowLeft size={15} /> Home
            </button>
            <div className="nb-note-top-right">
              {saveState && (
                <span className={`nb-saved ${saveState}`} role="status">
                  {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : "Not saved yet. Retrying…"}
                </span>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className="nb-icon" aria-label="Note options">
                    <MoreHorizontal size={17} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="nb-menu">
                  <DropdownMenuItem onSelect={() => setDrawer({ open: true })}>
                    <FileText size={14} /> View transcript
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={!note.enhanced && !note.versions.length}
                    onSelect={undoEnhancement}
                  >
                    <Undo2 size={14} /> Undo enhancement
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      const body = note.enhanced || note.notes;
                      void navigator.clipboard.writeText(`${note.title}\n\n${body}`).then(() => toast.success("Note copied"));
                    }}
                  >
                    <Copy size={14} /> Copy note
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() =>
                      downloadText(
                        note.title || "Meeting note",
                        `# ${note.title || "Meeting note"}\n\n${whenText(note)}${note.attendees.length ? `\nWith ${note.attendees.join(", ")}` : ""}\n\n${
                          note.enhanced ? `${note.enhanced}\n\n` : ""
                        }## My notes\n\n${note.notes || "(none)"}\n\n## Transcript\n\n${note.transcript || "(none)"}`,
                      )
                    }
                  >
                    <Download size={14} /> Download
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="danger" disabled={live} onSelect={() => void removeNote()}>
                    <Trash2 size={14} /> Delete note
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <input
            className="nb-title"
            value={note.title}
            placeholder="New note"
            maxLength={200}
            aria-label="Meeting title"
            onChange={(e) => change({ title: e.target.value })}
          />
          <div className="nb-meta">
            <span>{dayLabel(note.start)}</span>
            {note.end && (
              <span>
                {time(note.start)} – {time(note.end)}
              </span>
            )}
            {note.attendees.length > 0 && <span title={note.attendees.join(", ")}>{people(note.attendees, 4)}</span>}
            {note.provider && PROVIDER_LABEL[note.provider] && (
              <span className="nb-provider">
                {PROVIDER_LABEL[note.provider]}
                {note.joinUrl && !ended && (
                  <a href={note.joinUrl} target="_blank" rel="noreferrer">
                    Join
                  </a>
                )}
              </span>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="nb-chip" aria-label={`Note style: ${note.template}`}>
                  {note.template} <ChevronDown size={12} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="nb-menu">
                <DropdownMenuLabel>Note style</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={note.template} onValueChange={(v) => change({ template: v })}>
                  {TEMPLATES.map((t) => (
                    <DropdownMenuRadioItem key={t} value={t}>
                      {t}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {(note.enhanced || enhancing) && (
            <div className="nb-tabs" role="tablist" aria-label="Note version">
              <button type="button" role="tab" aria-selected={tab === "enhanced"} onClick={() => setTab("enhanced")}>
                <Sparkles size={13} /> Enhanced
              </button>
              <button type="button" role="tab" aria-selected={tab === "notes"} onClick={() => setTab("notes")}>
                My notes
              </button>
            </div>
          )}

          {(enhancing || status === "processing") && (
            <p className="nb-status" role="status">
              <span className="nb-shimmer">
                <Sparkles size={14} /> {status === "processing" ? "Processing meeting…" : "Enhancing your notes…"}
              </span>
            </p>
          )}
          {ready && !enhancing && (
            <p className="nb-status ready" role="status">
              <Sparkles size={14} /> Notes ready
            </p>
          )}

          {insufficient && (
            <div className="nb-insufficient" role="alert">
              <strong>Not enough reliable conversation was captured to write accurate notes.</strong>
              <p>Nothing was made up. Your own notes are kept as you wrote them.</p>
              <div>
                <button type="button" className="nb-pill" onClick={() => void startCapture()}>
                  <Mic size={14} /> Continue listening
                </button>
                <button type="button" className="nb-pill" onClick={() => setDrawer({ open: true, paste: true })}>
                  <Upload size={14} /> Upload transcript
                </button>
                <button type="button" className="nb-pill quiet" onClick={() => setInsufficient(false)}>
                  Keep my notes
                </button>
              </div>
            </div>
          )}

          <div className="nb-body">
            {tab === "enhanced" && (note.enhanced || enhancing) ? (
              enhancing ? (
                <NoteMarkdown text={stream || " "} />
              ) : editingEnhanced ? (
                <textarea
                  className="nb-editor"
                  value={note.enhanced}
                  autoFocus
                  onChange={(e) => change({ enhanced: e.target.value })}
                  onBlur={() => setEditingEnhanced(false)}
                  aria-label="Enhanced note"
                />
              ) : (
                <div
                  className="nb-enhanced"
                  onDoubleClick={() => setEditingEnhanced(true)}
                  title="Double-click to edit"
                >
                  <NoteMarkdown
                    text={note.enhanced}
                    onToggle={(line) =>
                      change((n) => ({
                        enhanced: n.enhanced
                          .split("\n")
                          .map((l, i) => (i === line ? l.replace(/\[( |x|X)\]/, (_, c) => (c === " " ? "[x]" : "[ ]")) : l))
                          .join("\n"),
                      }))
                    }
                    onTime={(at) => setDrawer({ open: true, focus: at })}
                  />
                  <button type="button" className="nb-ghost nb-edit" onClick={() => setEditingEnhanced(true)}>
                    Edit
                  </button>
                </div>
              )
            ) : (
              <AutoTextarea
                value={note.notes}
                placeholder={live ? "Start typing… the conversation is being captured quietly." : "Start typing…"}
                onChange={(v) => change({ notes: v })}
                onSlash={() => setPalette(true)}
              />
            )}
          </div>

          {showSuggestions && (
            <div className="nb-suggest">
              {!note.enhanced && (
                <button type="button" className="nb-pill" onClick={() => void enhance()}>
                  <Sparkles size={13} /> Generate notes
                </button>
              )}
              <button type="button" className="nb-pill" onClick={() => void askAI("What are the action items, with owners and due dates?")}>
                Review actions
              </button>
              <button type="button" className="nb-pill" onClick={() => void askAI("Write a short follow-up email to the participants.")}>
                Write follow-up
              </button>
            </div>
          )}
        </article>
      )}

      {/* Dock: capture control, Enhance and Ask anything, always at hand. */}
      <div className="nb-dock">
        {ask.open && (
          <section className="nb-answers" aria-label="Answers" aria-live="polite">
            <header>
              <span>
                <Sparkles size={13} /> {ask.scope === "note" ? "About this meeting" : "Across your meetings"}
              </span>
              <button type="button" className="nb-icon" aria-label="Close answers (Esc)" onClick={() => setAsk((a) => ({ ...a, open: false }))}>
                <X size={15} />
              </button>
            </header>
            <div className="nb-answers-body">
              {ask.turns.map((t, i) => (
                <div key={i} className="nb-turn">
                  <p className="nb-q">{t.q}</p>
                  {t.error ? (
                    <p className="nb-error">{t.error}</p>
                  ) : t.a ? (
                    <NoteMarkdown
                      text={t.a}
                      onTime={(at) => setDrawer({ open: true, focus: at })}
                      onMeeting={(id) => void openSummary({ id })}
                      meetingTitle={(id) => meetingIndex[id] || summaries?.find((s) => s.id === id)?.title || ""}
                    />
                  ) : (
                    <p className="nb-thinking">
                      <span className="nb-dots" aria-hidden>
                        <i />
                        <i />
                        <i />
                      </span>
                      Looking through {ask.scope === "note" ? "the meeting" : "your meetings"}…
                    </p>
                  )}
                </div>
              ))}
              <div ref={answerEnd} />
            </div>
          </section>
        )}
        <div className="nb-dock-row">
          {view === "note" && note ? (
            <CaptureControl
              status={status}
              seconds={seconds}
              source={source}
              language={language}
              pending={capture.pending}
              callSupported={capture.supported}
              speechSupported={speech.supported}
              error={capture.error}
              onStart={(s) => void startCapture(s)}
              onPause={pauseCapture}
              onResume={() => void startCapture()}
              onStop={stopCapture}
              onSource={switchSource}
              onLanguage={(v) => void update({ meeting: { ...prefs.meeting, language: v } })}
            />
          ) : live && note ? (
            <button type="button" className="nb-control mini" onClick={() => setView("note")}>
              <span className={`nb-bars${status === "recording" ? "" : " still"}`} aria-hidden>
                <i />
                <i />
                <i />
              </span>
              {status === "recording" ? "Listening" : "Paused"} · {note.title || "New note"}
              <time>{clock(seconds)}</time>
            </button>
          ) : (
            <span />
          )}
          {view === "note" && note && (
            <button
              type="button"
              className="nb-enhance"
              disabled={enhancing || status === "processing" || (!note.notes.trim() && !note.transcript.trim())}
              onClick={() => void enhance()}
              title="Enhance notes (⌘↵)"
            >
              {enhancing ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />}
              {note.enhanced ? "Enhance again" : "Enhance notes"}
            </button>
          )}
        </div>
        <form
          className="nb-ask"
          onSubmit={(e) => {
            e.preventDefault();
            void askAI(question);
          }}
        >
          <Sparkles size={16} aria-hidden />
          <input
            ref={askInput}
            value={question}
            maxLength={4000}
            onChange={(e) => setQuestion(e.target.value)}
            onFocus={() => ask.turns.length && setAsk((a) => ({ ...a, open: true }))}
            placeholder={view === "note" ? "Ask anything about this meeting" : "Ask anything about your meetings"}
            aria-label="Ask anything"
          />
          <kbd>⌘K</kbd>
          <button type="submit" className="nb-send" disabled={!question.trim()} aria-label="Ask">
            <ArrowUp size={15} />
          </button>
        </form>
      </div>

      {drawer.open && note && (
        <TranscriptDrawer
          segments={segments}
          focus={drawer.focus}
          startPaste={!!drawer.paste}
          canImportTeams={note.provider === "teams" && !!note.joinUrl && !!calendar?.microsoft.connected}
          onClose={() => setDrawer({ open: false })}
          onChange={(next) => change({ transcript: serialize(next) })}
          onReplace={(text) => {
            change({ transcript: text });
            setInsufficient(false);
            toast.success("Transcript added. Enhance notes when you’re ready.");
          }}
          joinUrl={note.joinUrl}
        />
      )}

      {palette && (
        <Palette
          commands={commands.filter((c) => c.when !== false)}
          onClose={() => setPalette(false)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Home                                                                */
/* ------------------------------------------------------------------ */

function Home({
  upcoming,
  calendar,
  connected,
  summaries,
  now,
  opening,
  liveNote,
  onOpenMeeting,
  onOpenSummary,
  onOpenLive,
  onNew,
  onCalendarChange,
}: {
  upcoming: Meeting[];
  calendar: Calendars | null;
  connected: boolean;
  summaries: NoteSummary[] | null;
  now: number;
  opening: string;
  liveNote: Note | null;
  onOpenMeeting: (m: Meeting) => void;
  onOpenSummary: (s: NoteSummary) => void;
  onOpenLive: () => void;
  onNew: () => void;
  onCalendarChange: () => void;
}) {
  // Earlier meetings from the calendar that have no note yet sit in the timeline too.
  type Row = { key: string; start: string; title: string; who: string[]; provider: string; note?: NoteSummary; meeting?: Meeting };
  const noted = new Set((summaries ?? []).map((s) => s.meetingId).filter(Boolean));
  const rows: Row[] = [
    ...(summaries ?? []).map((s) => ({ key: s.id, start: s.start, title: s.title, who: s.attendees, provider: s.provider, note: s })),
    ...(calendar?.meetings ?? [])
      .filter((m) => Date.parse(m.end) < now && !noted.has(m.id))
      .map((m) => ({
        key: m.id,
        start: m.start,
        title: m.title,
        who: [m.organizer, ...m.attendees.map((a) => a.name || a.email)].filter(Boolean),
        provider: m.provider,
        meeting: m,
      })),
  ].sort((a, b) => b.start.localeCompare(a.start));
  const groups = rows.reduce<[string, Row[]][]>((all, r) => {
    const label = dayLabel(r.start);
    const last = all.at(-1);
    if (last && last[0] === label) last[1].push(r);
    else all.push([label, [r]]);
    return all;
  }, []);

  async function disconnect(which: "microsoft" | "google") {
    try {
      await api(`/api/${which}`, undefined, "DELETE");
      onCalendarChange();
      toast.success(`${which === "microsoft" ? "Outlook" : "Google Calendar"} disconnected`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="nb-home">
      <header className="nb-home-head">
        <h1 className="nb-display">Coming up</h1>
        <button type="button" className="nb-new" onClick={onNew} title="New note (⌘N)">
          <Plus size={15} /> New note
        </button>
      </header>

      {liveNote && (
        <button type="button" className="nb-live-banner" onClick={onOpenLive}>
          <span className="nb-bars" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          Transcribing <strong>{liveNote.title || "New note"}</strong>
          <span>Return to note</span>
        </button>
      )}

      {calendar === null ? (
        <div className="nb-skeleton" aria-label="Loading meetings" />
      ) : upcoming.length ? (
        <ul className="nb-upcoming">
          {upcoming.map((m) => {
            const d = new Date(m.start);
            const isLive = Date.parse(m.start) <= now && Date.parse(m.end) >= now;
            const soon = !isLive && Date.parse(m.start) - now < 10 * 60_000;
            return (
              <li key={m.id}>
                <button type="button" className={`nb-meeting${isLive ? " live" : ""}`} onClick={() => onOpenMeeting(m)}>
                  <span className="nb-date" aria-hidden>
                    <b>{d.getDate()}</b>
                    <small>{d.toLocaleDateString(undefined, { month: "long" })}</small>
                    <small>{d.toLocaleDateString(undefined, { weekday: "short" })}</small>
                  </span>
                  <span className="nb-meeting-main">
                    <strong>{m.title}</strong>
                    <small>
                      {time(m.start)} – {time(m.end)}
                      {m.provider && PROVIDER_LABEL[m.provider] ? <em>{PROVIDER_LABEL[m.provider]}</em> : null}
                    </small>
                  </span>
                  {isLive ? <span className="nb-now">Now</span> : soon ? <span className="nb-now soon">Soon</span> : null}
                </button>
                {(isLive || soon) && m.joinUrl && (
                  <a className="nb-join" href={m.joinUrl} target="_blank" rel="noreferrer" onClick={() => onOpenMeeting(m)}>
                    Join
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      ) : connected ? (
        <p className="nb-quiet">Nothing scheduled in the next seven days.</p>
      ) : null}

      {calendar && !connected && (
        <div className="nb-connect">
          <p>Connect your calendar and meetings will appear here on their own.</p>
          <div>
            {calendar.microsoft.configured ? (
              <a className="nb-pill" href="/api/microsoft/connect">
                Outlook &amp; Teams
              </a>
            ) : (
              <span className="nb-pill off" title="Your admin needs to add the Microsoft app first.">
                Outlook &amp; Teams · not set up
              </span>
            )}
            {calendar.google.configured ? (
              <a className="nb-pill" href="/api/google/connect">
                Google Calendar
              </a>
            ) : (
              <span className="nb-pill off" title="Your admin needs to add the Google app first.">
                Google Calendar · not set up
              </span>
            )}
          </div>
        </div>
      )}
      {calendar?.error && <p className="nb-quiet warn">{calendar.error}</p>}

      <div className="nb-timeline">
        {summaries === null ? (
          <div className="nb-skeleton tall" aria-label="Loading notes" />
        ) : groups.length ? (
          groups.map(([label, items]) => (
            <section key={label}>
              <h2>{label}</h2>
              <ul>
                {items.map((r) => (
                  <li key={r.key}>
                    <button
                      type="button"
                      className={`nb-row${r.note ? "" : " empty"}`}
                      onClick={() => (r.note ? onOpenSummary(r.note) : r.meeting && onOpenMeeting(r.meeting))}
                    >
                      <span className="nb-avatar" aria-hidden>
                        {opening === r.key ? <LoaderCircle size={14} className="spin" /> : r.who[0] ? initials(r.who[0]) : <FileText size={14} />}
                      </span>
                      <span className="nb-row-main">
                        <strong>{r.title}</strong>
                        <small>
                          {r.who.length ? people(r.who) : r.note?.preview || "Just you"}
                          {!r.note && " · no notes yet"}
                          {r.note?.hasEnhanced && (
                            <Sparkles size={11} aria-label="Enhanced" className="nb-spark" />
                          )}
                        </small>
                      </span>
                      <time>{time(r.start)}</time>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))
        ) : (
          <p className="nb-quiet">Your meeting notes will collect here. Press New note to write one now.</p>
        )}
      </div>

      {connected && (
        <p className="nb-calendars">
          {calendar?.microsoft.connected && (
            <span>
              {calendar.microsoft.account || "Outlook"}
              <button type="button" onClick={() => void disconnect("microsoft")}>
                Disconnect
              </button>
            </span>
          )}
          {calendar?.google.connected && (
            <span>
              {calendar.google.account || "Google Calendar"}
              <button type="button" onClick={() => void disconnect("google")}>
                Disconnect
              </button>
            </span>
          )}
          {calendar?.microsoft.configured && !calendar.microsoft.connected && <a href="/api/microsoft/connect">Add Outlook</a>}
          {calendar?.google.configured && !calendar.google.connected && <a href="/api/google/connect">Add Google Calendar</a>}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Writing surface                                                     */
/* ------------------------------------------------------------------ */

function AutoTextarea({
  value,
  placeholder,
  onChange,
  onSlash,
}: {
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
  onSlash: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(el.scrollHeight, 320)}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      className="nb-editor"
      value={value}
      placeholder={placeholder}
      aria-label="Your notes"
      spellCheck
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        // "/" at the start of a line opens commands.
        if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
        const el = e.currentTarget;
        const before = el.value.slice(0, el.selectionStart);
        if (before === "" || before.endsWith("\n")) {
          e.preventDefault();
          onSlash();
        }
      }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Compact meeting control                                             */
/* ------------------------------------------------------------------ */

function CaptureControl({
  status,
  seconds,
  source,
  language,
  pending,
  callSupported,
  speechSupported,
  error,
  onStart,
  onPause,
  onResume,
  onStop,
  onSource,
  onLanguage,
}: {
  status: Status;
  seconds: number;
  source: "mic" | "call";
  language: string;
  pending: number;
  callSupported: boolean;
  speechSupported: boolean;
  error: string;
  onStart: (source: "mic" | "call") => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onSource: (s: "mic" | "call") => void;
  onLanguage: (lang: string) => void;
}) {
  const languageMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="nb-icon" aria-label="Spoken language" title="Spoken language">
          <Languages size={15} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="nb-menu">
        <DropdownMenuLabel>Spoken language</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={language} onValueChange={onLanguage}>
          {LANGUAGES.map(([code, label]) => (
            <DropdownMenuRadioItem key={code} value={code}>
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const sourceMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="nb-icon" aria-label="What to listen to" title="What to listen to">
          {source === "call" ? <Monitor size={15} /> : <Mic size={15} />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="nb-menu">
        <DropdownMenuLabel>Listen to</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={source} onValueChange={(v) => onSource(v as "mic" | "call")}>
          <DropdownMenuRadioItem value="mic" disabled={!speechSupported}>
            Microphone · people in the room
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="call" disabled={!callSupported}>
            Call audio + mic · Teams, Zoom, Meet
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  if (status === "idle" || status === "processing")
    return (
      <div className="nb-control">
        <button
          type="button"
          className="nb-start"
          disabled={status === "processing" || (source === "mic" ? !speechSupported : !callSupported)}
          onClick={() => onStart(source)}
          title={source === "call" ? "Choose the call’s window or tab and turn on Share audio" : "Transcribe with your microphone"}
        >
          <span className="nb-dot" aria-hidden /> {status === "processing" ? "Finishing…" : "Start transcribing"}
        </button>
        {sourceMenu}
        {languageMenu}
        {error && <span className="nb-control-error">{error}</span>}
      </div>
    );

  return (
    <div className={`nb-control ${status}`} role="status">
      <span className={`nb-bars${status === "recording" ? "" : " still"}`} aria-hidden>
        <i />
        <i />
        <i />
      </span>
      <span className="nb-control-label">
        {status === "recording" ? (pending > 0 ? "Transcribing" : "Listening") : "Paused"}
      </span>
      <time>{clock(seconds)}</time>
      {status === "recording" ? (
        <button type="button" className="nb-icon" aria-label="Pause" title="Pause" onClick={onPause}>
          <Pause size={15} />
        </button>
      ) : (
        <button type="button" className="nb-icon" aria-label="Resume" title="Resume" onClick={onResume}>
          <Play size={15} />
        </button>
      )}
      <button type="button" className="nb-icon stop" aria-label="Stop and write notes" title="Stop" onClick={onStop}>
        <Square size={13} />
      </button>
      {sourceMenu}
      {languageMenu}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Transcript (secondary)                                              */
/* ------------------------------------------------------------------ */

function TranscriptDrawer({
  segments,
  focus,
  startPaste,
  canImportTeams,
  joinUrl,
  onClose,
  onChange,
  onReplace,
}: {
  segments: Segment[];
  focus?: number;
  startPaste: boolean;
  canImportTeams: boolean;
  joinUrl: string;
  onClose: () => void;
  onChange: (segments: Segment[]) => void;
  onReplace: (text: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [paste, setPaste] = useState(startPaste || !segments.length);
  const [pasted, setPasted] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const list = useRef<HTMLOListElement>(null);
  const q = query.trim().toLowerCase();

  // Jump to the closest line at or before the cited time.
  const target = useMemo(() => {
    if (focus === undefined || !segments.length) return -1;
    let best = 0;
    segments.forEach((s, i) => {
      if (s.at <= focus) best = i;
    });
    return best;
  }, [focus, segments]);
  useEffect(() => {
    if (target < 0) return;
    list.current?.querySelector(`[data-i="${target}"]`)?.scrollIntoView({ block: "center" });
  }, [target]);

  function rename(from: string, to: string) {
    const name = to.trim();
    setRenaming(null);
    if (!name || name === from) return;
    onChange(segments.map((s) => (s.speaker === from || (!from && !s.speaker) ? { ...s, speaker: name } : s)));
  }
  async function importTeams() {
    setImporting(true);
    try {
      const { text } = await api("/api/meetings/transcript", { joinUrl });
      onReplace(text);
      setPaste(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <aside className="nb-drawer" aria-label="Transcript">
      <header>
        <h2>Transcript</h2>
        <div>
          <button
            type="button"
            className="nb-icon"
            aria-label="Copy transcript"
            title="Copy"
            disabled={!segments.length}
            onClick={() => void navigator.clipboard.writeText(serialize(segments)).then(() => toast.success("Transcript copied"))}
          >
            <Copy size={15} />
          </button>
          <button type="button" className="nb-icon" aria-label="Close transcript (Esc)" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
      </header>
      {segments.length > 0 && (
        <label className="nb-search">
          <Search size={14} aria-hidden />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the transcript" aria-label="Search the transcript" />
        </label>
      )}
      <ol ref={list} className="nb-lines">
        {segments.map((s, i) => {
          if (q && !`${s.speaker} ${s.text}`.toLowerCase().includes(q)) return null;
          const name = s.speaker || "Speaker";
          return (
            <li key={i} data-i={i} className={i === target ? "focus" : ""}>
              <div className="nb-line-head">
                {renaming === `${i}` ? (
                  <input
                    autoFocus
                    defaultValue={s.speaker}
                    aria-label="Speaker name"
                    onBlur={(e) => rename(s.speaker, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") rename(s.speaker, e.currentTarget.value);
                      if (e.key === "Escape") {
                        e.stopPropagation();
                        setRenaming(null);
                      }
                    }}
                  />
                ) : (
                  <button type="button" className="nb-speaker" title="Rename this speaker everywhere" onClick={() => setRenaming(`${i}`)}>
                    {name}
                  </button>
                )}
                <time>{stamp(s.at)}</time>
              </div>
              <p
                contentEditable
                suppressContentEditableWarning
                spellCheck={false}
                onBlur={(e) => {
                  const text = e.currentTarget.textContent?.replace(/\s+/g, " ").trim() ?? "";
                  if (text === s.text) return;
                  onChange(text ? segments.map((x, k) => (k === i ? { ...x, text } : x)) : segments.filter((_, k) => k !== i));
                }}
              >
                {s.text}
              </p>
            </li>
          );
        })}
      </ol>
      <div className="nb-paste">
        {paste ? (
          <>
            <p>{segments.length ? "Replace the transcript with one from your meeting tool." : "Nothing was captured yet. Paste or upload a transcript from Teams, Zoom or Meet."}</p>
            <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Paste a transcript…" rows={5} aria-label="Paste a transcript" />
            <div>
              <button type="button" className="nb-pill" disabled={!pasted.trim()} onClick={() => {
                  onReplace(captionsToTranscript(pasted));
                  setPasted("");
                  setPaste(false);
                }}
              >
                Use this transcript
              </button>
              <label className="nb-pill">
                <Upload size={13} /> Upload file
                <input
                  type="file"
                  accept=".txt,.vtt,.srt,.md,text/plain,text/vtt"
                  hidden
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > 2_000_000) return void toast.error("That file is too large (2 MB at most).");
                    onReplace(captionsToTranscript(await file.text()));
                    setPaste(false);
                  }}
                />
              </label>
              {canImportTeams && (
                <button type="button" className="nb-pill" disabled={importing} onClick={() => void importTeams()}>
                  {importing ? <LoaderCircle size={13} className="spin" /> : <FileText size={13} />} Import from Teams
                </button>
              )}
            </div>
          </>
        ) : (
          <button type="button" className="nb-ghost" onClick={() => setPaste(true)}>
            <Upload size={13} /> Paste or upload a transcript
          </button>
        )}
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* "/" commands                                                        */
/* ------------------------------------------------------------------ */

function Palette({ commands, onClose }: { commands: { label: string; hint?: string; run: () => void }[]; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const shown = commands.filter((c) => c.label.toLowerCase().includes(query.trim().toLowerCase()));
  const run = (c?: (typeof commands)[number]) => {
    if (!c) return;
    onClose();
    window.setTimeout(c.run, 0);
  };
  return (
    <div className="nb-palette-backdrop" onMouseDown={onClose}>
      <div className="nb-palette" role="dialog" aria-label="Commands" onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          value={query}
          placeholder="Type a command"
          aria-label="Type a command"
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setIndex((i) => Math.min(i + 1, shown.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              run(shown[index]);
            }
          }}
        />
        <ul role="listbox">
          {shown.map((c, i) => (
            <li key={c.label} role="option" aria-selected={i === index}>
              <button type="button" onMouseEnter={() => setIndex(i)} onClick={() => run(c)}>
                {c.label}
                {c.hint && <kbd>{c.hint}</kbd>}
              </button>
            </li>
          ))}
          {!shown.length && <li className="nb-quiet">No matching command</li>}
        </ul>
      </div>
    </div>
  );
}
