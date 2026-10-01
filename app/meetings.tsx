"use client";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export type Provider = "teams" | "meet" | "zoom" | "";

/** A calendar event from Outlook/Teams or Google Calendar. */
export type Meeting = {
  id: string;
  title: string;
  start: string;
  end: string;
  organizer: string;
  attendees: { name: string; email: string }[];
  joinUrl: string;
  teams: boolean;
  provider: Provider;
  calendar: "microsoft" | "google";
  location: string;
  preview: string;
};

type Connection = { configured: boolean; connected: boolean; account: string; name: string };
export type Calendars = { microsoft: Connection; google: Connection; meetings: Meeting[]; error: string };

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
