"use client";
import "./desktop.css";
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Apple,
  CheckCircle2,
  Download,
  FilePlus,
  FolderPlus,
  HardDrive,
  LoaderCircle,
  Monitor,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, type Workspace } from "@/lib/client";
import { desktopApp } from "./messages";

/* ------------------------------------------------------------------ */
/* Desktop app window chrome                                           */
/* ------------------------------------------------------------------ */

/** Marks the page when it runs inside the desktop app, for window-chrome styles. */
export function useDesktopChrome() {
  useEffect(() => {
    const desktop = desktopApp();
    if (desktop) document.documentElement.dataset.desktop = desktop.platform;
  }, []);
}

/* ------------------------------------------------------------------ */
/* Download the desktop app                                            */
/* ------------------------------------------------------------------ */

type Release = {
  version: string | null;
  releasedAt: string | null;
  platforms: { id: "mac-arm64" | "mac-x64" | "win-x64"; label: string; size: number; name: string }[];
};

/** Best guess at this computer, so the right installer is offered first. */
async function detectPlatform(): Promise<Release["platforms"][number]["id"]> {
  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string; getHighEntropyValues?: (h: string[]) => Promise<{ architecture?: string }> };
  };
  const platform = nav.userAgentData?.platform ?? navigator.platform ?? "";
  if (/win/i.test(platform) || /Windows/.test(navigator.userAgent)) return "win-x64";
  try {
    const hints = await nav.userAgentData?.getHighEntropyValues?.(["architecture"]);
    if (hints?.architecture === "x86") return "mac-x64";
    if (hints?.architecture === "arm") return "mac-arm64";
  } catch {}
  // Safari doesn't say; nearly all Macs sold since 2021 are Apple silicon.
  return "mac-arm64";
}

const megabytes = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;

export function DownloadAppButton({ onOpen }: { onOpen: () => void }) {
  if (desktopApp()) return null; // already in the app
  return (
    <button type="button" className="history-button download-app-button" onClick={onOpen} title="Download the desktop app">
      <Download size={16} />
      <span>Get the app</span>
    </button>
  );
}

export function DownloadAppDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [release, setRelease] = useState<Release | null>(null);
  const [error, setError] = useState("");
  const [mine, setMine] = useState<Release["platforms"][number]["id"]>("mac-arm64");
  useEffect(() => {
    if (!open) return;
    void detectPlatform().then(setMine);
    api("/api/desktop")
      .then((data) => {
        setRelease(data as Release);
        setError("");
      })
      .catch((e) => setError((e as Error).message));
  }, [open]);
  const platforms = release?.platforms ?? [];
  const recommended = platforms.find((p) => p.id === mine) ?? platforms[0];
  const others = platforms.filter((p) => p !== recommended);
  const icon = (id: string) => (id.startsWith("mac") ? <Apple size={18} /> : <Monitor size={18} />);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="download-dialog">
        <DialogHeader>
          <DialogTitle>Internal AI for desktop</DialogTitle>
          <DialogDescription>
            Your workspace in its own window, with ⌥ Space from any app, notifications for team messages, and your
            local files and folders.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="notice">{error}</p>
        ) : !release ? (
          <p className="download-loading">
            <LoaderCircle size={16} className="spin" /> Checking the latest version…
          </p>
        ) : !recommended ? (
          <p className="notice">The desktop app hasn’t been published yet. Check back soon.</p>
        ) : (
          <>
            <a className="primary-button download-primary" href={`/api/desktop/download?platform=${recommended.id}`}>
              <Download size={17} />
              Download for {recommended.label.replace(" 10 and 11", "")}
              <small>{megabytes(recommended.size)}</small>
            </a>
            {others.length > 0 && (
              <div className="download-others">
                <span>Other versions</span>
                {others.map((p) => (
                  <a key={p.id} href={`/api/desktop/download?platform=${p.id}`}>
                    {icon(p.id)} {p.label} <small>{megabytes(p.size)}</small>
                  </a>
                ))}
              </div>
            )}
            <ol className="download-steps">
              {recommended.id.startsWith("mac") ? (
                <>
                  <li>Open the downloaded file and drag Internal AI into Applications.</li>
                  <li>
                    Open Internal AI. If macOS says it can’t verify the app, go to{" "}
                    <strong>System Settings → Privacy &amp; Security</strong>, scroll down and click{" "}
                    <strong>Open Anyway</strong>. You only do this once.
                  </li>
                  <li>Sign in with your work email. Press ⌥ Space from any app to ask.</li>
                </>
              ) : (
                <>
                  <li>Run the downloaded installer.</li>
                  <li>
                    If Windows shows “Windows protected your PC”, choose <strong>More info → Run anyway</strong>.
                  </li>
                  <li>Sign in with your work email. Press Alt + Space from any app to ask.</li>
                </>
              )}
            </ol>
            <p className="download-meta">
              Version {release.version}
              {release.releasedAt ? ` · released ${new Date(release.releasedAt).toLocaleDateString()}` : ""}
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Files on this computer (desktop app only)                           */
/* ------------------------------------------------------------------ */

type LocalFolder = {
  id: string;
  name: string;
  path: string;
  files: number;
  lastSync: string | null;
  status: "idle" | "syncing" | "warning" | "error";
  message: string;
};
type Progress = { id: string; done: number; total: number; current: string };
type LocalBridge = {
  list: () => Promise<LocalFolder[]>;
  addFiles: () => Promise<{ added: number; failed: string[] }>;
  addFolder: () => Promise<LocalFolder[]>;
  sync: (id?: string) => Promise<LocalFolder[]>;
  remove: (id: string, removeFiles: boolean) => Promise<LocalFolder[]>;
  onChange: (callback: (folders: LocalFolder[]) => void) => () => void;
  onProgress: (callback: (progress: Progress) => void) => () => void;
};
const localBridge = () => (desktopApp() as unknown as { local?: LocalBridge } | null)?.local ?? null;

export function LocalFiles({ ws, onDownload }: { ws: Workspace; onDownload: () => void }) {
  const bridge = localBridge();
  const [folders, setFolders] = useState<LocalFolder[]>([]);
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [busy, setBusy] = useState("");
  const [removing, setRemoving] = useState("");
  const refresh = useCallback(() => void ws.refresh(), [ws]);

  useEffect(() => {
    if (!bridge) return;
    void bridge.list().then(setFolders);
    const stopChange = bridge.onChange((next) => {
      setFolders(next);
      refresh();
    });
    const stopProgress = bridge.onProgress((p) => setProgress((all) => ({ ...all, [p.id]: p })));
    return () => {
      stopChange();
      stopProgress();
    };
  }, [bridge, refresh]);

  if (!bridge)
    return (
      <div className="local-files local-files-promo">
        <HardDrive size={20} aria-hidden />
        <div>
          <strong>Use files from your computer</strong>
          <p>The desktop app can add local files and keep whole folders in sync with your knowledge.</p>
        </div>
        <button className="secondary-button" onClick={onDownload}>
          <Download size={15} /> Get the desktop app
        </button>
      </div>
    );

  async function run<T>(key: string, action: () => Promise<T>) {
    setBusy(key);
    try {
      return await action();
    } catch (e) {
      toast.error((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
      return null;
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="local-files" aria-labelledby="local-files-title">
      <header>
        <div>
          <h3 id="local-files-title">
            <HardDrive size={17} aria-hidden /> On this computer
          </h3>
          <p>
            Add files, or connect a folder to keep it in sync. Their text joins your private knowledge, so Ask can
            search and cite it. Nothing is shared with your team.
          </p>
        </div>
        <div className="local-actions">
          <button
            className="secondary-button"
            disabled={!!busy}
            onClick={async () => {
              const result = await run("files", () => bridge.addFiles());
              if (!result) return;
              if (result.added) toast.success(`${result.added} file${result.added === 1 ? "" : "s"} added to your knowledge`);
              if (result.failed.length) toast.error(`Couldn’t add ${result.failed.join("; ")}`);
              refresh();
            }}
          >
            {busy === "files" ? <LoaderCircle size={15} className="spin" /> : <FilePlus size={15} />} Add files
          </button>
          <button
            className="primary-button"
            disabled={!!busy}
            onClick={async () => {
              const next = await run("folder", () => bridge.addFolder());
              if (next) setFolders(next);
            }}
          >
            <FolderPlus size={15} /> Connect a folder
          </button>
        </div>
      </header>
      {folders.length > 0 && (
        <ul className="local-folders">
          {folders.map((f) => {
            const p = progress[f.id];
            const syncing = f.status === "syncing";
            return (
              <li key={f.id}>
                <span className={`local-status ${f.status}`} aria-hidden>
                  {syncing ? (
                    <LoaderCircle size={16} className="spin" />
                  ) : f.status === "idle" ? (
                    <CheckCircle2 size={16} />
                  ) : (
                    <AlertTriangle size={16} />
                  )}
                </span>
                <span className="local-folder-text">
                  <strong title={f.path}>{f.name}</strong>
                  <small>
                    {syncing
                      ? p && p.total
                        ? `Syncing ${Math.min(p.done + 1, p.total)} of ${p.total}${p.current ? ` · ${p.current}` : ""}`
                        : "Looking for changes…"
                      : `${f.files} file${f.files === 1 ? "" : "s"} synced${f.lastSync ? ` · ${new Date(f.lastSync).toLocaleString()}` : ""}`}
                  </small>
                  {f.message && <small className="local-message">{f.message}</small>}
                </span>
                {removing === f.id ? (
                  <span className="local-confirm">
                    <button
                      className="quiet-button"
                      onClick={async () => {
                        const next = await run(`rm-${f.id}`, () => bridge.remove(f.id, false));
                        if (next) setFolders(next);
                        setRemoving("");
                      }}
                    >
                      Disconnect, keep files
                    </button>
                    <button
                      className="quiet-button danger-button"
                      onClick={async () => {
                        const next = await run(`rm-${f.id}`, () => bridge.remove(f.id, true));
                        if (next) setFolders(next);
                        setRemoving("");
                        refresh();
                      }}
                    >
                      Disconnect and remove files
                    </button>
                    <button className="quiet-button" onClick={() => setRemoving("")}>
                      Cancel
                    </button>
                  </span>
                ) : (
                  <span className="local-confirm">
                    <button
                      className="icon-button"
                      aria-label={`Sync ${f.name} now`}
                      title="Sync now"
                      disabled={syncing}
                      onClick={() => void run(`sync-${f.id}`, () => bridge.sync(f.id))}
                    >
                      <RefreshCw size={16} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`Disconnect ${f.name}`}
                      title="Disconnect"
                      onClick={() => setRemoving(f.id)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
