"use client";
import "./meetings.css";
import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarDays, ExternalLink, FileText, LoaderCircle, NotebookPen, RefreshCw, Unplug, Users, Video } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/client";

export type Meeting = {
  id: string;
  title: string;
  start: string;
  end: string;
  organizer: string;
  attendees: { name: string; email: string }[];
  joinUrl: string;
  teams: boolean;
  location: string;
  preview: string;
};

type Calendar = { configured: boolean; connected: boolean; account: string; name: string; meetings: Meeting[] };

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === tomorrow.toDateString()) return "Tomorrow";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
}

/* ------------------------------------------------------------------ */
/* Your meetings (Microsoft 365)                                       */
/* ------------------------------------------------------------------ */

export function UpcomingMeetings({
  activeId,
  onTakeNotes,
  onTranscript,
}: {
  activeId?: string;
  onTakeNotes: (meeting: Meeting) => void;
  onTranscript: (meeting: Meeting, text: string) => void;
}) {
  const [calendar, setCalendar] = useState<Calendar | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  // "Now" for live / past grouping, refreshed every minute.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    try {
      setCalendar(await api("/api/meetings"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
    const t = window.setInterval(() => document.visibilityState === "visible" && void load(), 5 * 60_000);
    // Coming back from the Microsoft sign-in: say how it went.
    const outcome = new URLSearchParams(window.location.search).get("microsoft");
    if (outcome) {
      if (outcome === "connected") toast.success("Microsoft 365 connected. Your meetings are listed here.");
      else if (outcome === "failed") toast.error("Microsoft 365 didn’t connect. Please try again.");
      window.history.replaceState(null, "", `/${window.location.hash}`);
    }
    return () => window.clearInterval(t);
  }, [load]);

  async function importTranscript(m: Meeting) {
    setBusy(`t-${m.id}`);
    try {
      const { text } = await api("/api/meetings/transcript", { joinUrl: m.joinUrl });
      onTranscript(m, text);
      toast.success("Teams transcript imported");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function disconnect() {
    setBusy("disconnect");
    try {
      await api("/api/microsoft", undefined, "DELETE");
      await load();
      toast.success("Microsoft 365 disconnected");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  if (!calendar && !error)
    return (
      <div className="panel meetings-panel">
        <h3>
          <CalendarDays size={16} /> Your meetings
        </h3>
        <p className="muted-note">
          <LoaderCircle size={14} className="spin" /> Loading…
        </p>
      </div>
    );

  if (!calendar?.connected)
    return (
      <div className="panel meetings-panel">
        <h3>
          <CalendarDays size={16} /> Your meetings
        </h3>
        {error ? <p className="notice">{error}</p> : null}
        <p className="muted-note">
          See your Teams and Outlook meetings here, take notes in one click, and import Teams transcripts.
        </p>
        {calendar?.configured === false ? (
          <p className="notice">Microsoft 365 isn’t set up for this workspace yet. Ask your admin to add the Microsoft app.</p>
        ) : (
          <a className="primary-button meetings-connect" href="/api/microsoft/connect">
            <Video size={16} /> Connect Microsoft 365
          </a>
        )}
      </div>
    );

  const meetings = calendar.meetings;
  const upcoming = meetings.filter((m) => Date.parse(m.end) >= now);
  const recent = meetings.filter((m) => Date.parse(m.end) < now).reverse().slice(0, 5);
  const groups = upcoming.reduce<[string, Meeting[]][]>((all, m) => {
    const label = dayLabel(m.start);
    const last = all.at(-1);
    if (last && last[0] === label) last[1].push(m);
    else all.push([label, [m]]);
    return all;
  }, []);

  const row = (m: Meeting, past: boolean) => {
    const live = Date.parse(m.start) <= now && Date.parse(m.end) >= now;
    return (
      <li key={m.id} className={`meeting-row${m.id === activeId ? " active" : ""}${live ? " live" : ""}`}>
        <div className="meeting-row-time">
          <strong>{time(m.start)}</strong>
          <small>{time(m.end)}</small>
        </div>
        <div className="meeting-row-main">
          <strong title={m.title}>
            {live && <span className="meeting-live">Now</span>}
            {m.title}
          </strong>
          <small>
            {m.teams && <Video size={12} aria-label="Teams meeting" />}
            <Users size={12} aria-hidden /> {m.attendees.length + 1}
            {m.organizer ? ` · ${m.organizer}` : ""}
          </small>
          <div className="meeting-row-actions">
            {!past && (
              <button className="secondary-button" onClick={() => onTakeNotes(m)}>
                <NotebookPen size={14} /> Take notes
              </button>
            )}
            {!past && m.joinUrl && (
              <a className="quiet-button" href={m.joinUrl} target="_blank" rel="noreferrer">
                <ExternalLink size={14} /> Join
              </a>
            )}
            {past && m.teams && m.joinUrl && (
              <button className="quiet-button" disabled={busy === `t-${m.id}`} onClick={() => void importTranscript(m)}>
                {busy === `t-${m.id}` ? <LoaderCircle size={14} className="spin" /> : <FileText size={14} />} Import Teams
                transcript
              </button>
            )}
          </div>
        </div>
      </li>
    );
  };

  return (
    <div className="panel meetings-panel">
      <div className="meetings-head">
        <h3>
          <CalendarDays size={16} /> Your meetings
        </h3>
        <button className="icon-button" aria-label="Refresh meetings" title="Refresh" onClick={() => void load()}>
          <RefreshCw size={15} />
        </button>
      </div>
      {error && <p className="notice">{error}</p>}
      {groups.length ? (
        groups.map(([label, items]) => (
          <section key={label} className="meetings-day">
            <h4>{label}</h4>
            <ul>{items.map((m) => row(m, false))}</ul>
          </section>
        ))
      ) : (
        <p className="muted-note">No meetings in the next 7 days.</p>
      )}
      {recent.length > 0 && (
        <section className="meetings-day">
          <h4>Earlier</h4>
          <ul>{recent.map((m) => row(m, true))}</ul>
        </section>
      )}
      <p className="meetings-account">
        {calendar.account || calendar.name}
        <button className="quiet-button" disabled={busy === "disconnect"} onClick={() => void disconnect()}>
          <Unplug size={13} /> Disconnect
        </button>
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Capture call audio (any app: Teams, Zoom, Meet …)                   */
/* ------------------------------------------------------------------ */

const CHUNK_SECONDS = 30;

/**
 * Records the call's audio (a shared tab, window or the whole screen, with
 * "share audio" on) mixed with your microphone, and sends ~30-second chunks
 * for transcription. Each chunk is a complete file, so it can be sent on its own.
 */
export function useCallCapture(onText: (text: string, atSeconds: number) => void, language?: string) {
  const [active, setActive] = useState(false);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState("");
  const streams = useRef<MediaStream[]>([]);
  const context = useRef<AudioContext | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef(0);
  const startedAt = useRef(0);
  const offset = useRef(0);
  const textRef = useRef(onText);
  textRef.current = onText;

  const supported =
    typeof window !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia && typeof MediaRecorder !== "undefined";

  function stopAll() {
    window.clearTimeout(timer.current);
    const r = recorder.current;
    recorder.current = null;
    if (r && r.state !== "inactive") r.stop();
    streams.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    streams.current = [];
    void context.current?.close().catch(() => {});
    context.current = null;
    setActive(false);
  }

  async function send(blob: Blob, at: number) {
    if (blob.size < 2000) return; // silence or a stub
    setPending((n) => n + 1);
    try {
      const form = new FormData();
      form.append("audio", new File([blob], `call-${at}.webm`, { type: blob.type || "audio/webm" }));
      if (language) form.append("language", language);
      const response = await fetch("/api/meetings/transcribe", { method: "POST", body: form, credentials: "include" });
      const data = (await response.json().catch(() => ({}))) as { text?: string; error?: string; code?: string };
      if (!response.ok) {
        if (data.code === "asr_unavailable") {
          setError(data.error || "Call transcription isn’t available yet.");
          stopAll();
        } else toast.error(data.error || "Part of the call couldn’t be transcribed.");
        return;
      }
      if (data.text) textRef.current(data.text, at);
    } catch {
      toast.error("Part of the call couldn’t be sent for transcription.");
    } finally {
      setPending((n) => n - 1);
    }
  }

  /** Records one chunk at a time; each finished chunk is sent and the next one starts. */
  function record(mixed: MediaStream) {
    const type = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "";
    const next = () => {
      const r = new MediaRecorder(mixed, type ? { mimeType: type } : undefined);
      const parts: Blob[] = [];
      const at = Math.round(offset.current + (Date.now() - startedAt.current) / 1000);
      r.ondataavailable = (e) => e.data.size && parts.push(e.data);
      r.onstop = () => {
        void send(new Blob(parts, { type: r.mimeType || "audio/webm" }), at);
        if (recorder.current === r) next();
      };
      recorder.current = r;
      r.start();
      timer.current = window.setTimeout(() => r.state === "recording" && r.stop(), CHUNK_SECONDS * 1000);
    };
    next();
  }

  /** Starts capturing; `startSeconds` lines chunks up with the meeting clock. */
  async function start(startSeconds: number) {
    setError("");
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      display.getVideoTracks().forEach((t) => t.stop()); // only the sound is kept
      if (!display.getAudioTracks().length) {
        display.getTracks().forEach((t) => t.stop());
        toast.error("No call audio was shared. Choose the call’s tab or window and turn on “Share audio”.");
        return false;
      }
      const mic = await navigator.mediaDevices
        .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
        .catch(() => null);
      streams.current = [display, ...(mic ? [mic] : [])];
      const ctx = new AudioContext();
      const out = ctx.createMediaStreamDestination();
      for (const s of streams.current) if (s.getAudioTracks().length) ctx.createMediaStreamSource(s).connect(out);
      context.current = ctx;
      // Sharing stopped from the browser's own bar ends the capture too.
      display.getAudioTracks()[0].addEventListener("ended", stopAll);
      startedAt.current = Date.now();
      offset.current = startSeconds;
      setActive(true);
      record(out.stream);
      return true;
    } catch (e) {
      if ((e as Error).name !== "NotAllowedError") toast.error("Call audio couldn’t be captured in this browser.");
      stopAll();
      return false;
    }
  }

  const stopRef = useRef(stopAll);
  stopRef.current = stopAll;
  useEffect(() => () => stopRef.current(), []);
  return { supported, active, pending, error, start, stop: stopAll };
}
