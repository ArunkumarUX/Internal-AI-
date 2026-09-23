"use client";
import { useEffect, useRef, useState } from "react";
import {
  Check,
  FileText,
  LoaderCircle,
  MessageCircle,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { clients } from "@/lib/knowledge";

export const FIRM_WIDE = "All clients";
export const DOCUMENT_CATEGORIES = [
  "Client brief",
  "Proposal",
  "RFP",
  "Pricing",
  "Case study",
  "Meeting notes",
  "Decision",
  "Project update",
  "Policy",
  "Other",
];
const ACCEPT = ".pdf,.docx,.pptx,.xlsx,.txt,.md,.csv,.png,.jpg,.jpeg,.webp";

type Phase = "uploading" | "processing" | "ready" | null;
export type UploadedDocument = {
  id: string;
  title: string;
  client: string;
  category: string;
  notice: string;
};

function titleFromFile(name: string) {
  return name
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
function today() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function send(form: FormData, onSent: () => void) {
  return new Promise<any>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    xhr.responseType = "json";
    xhr.upload.onload = onSent;
    xhr.onload = () => {
      const body = xhr.response ?? {};
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new Error(body.error ?? "The document could not be uploaded."));
    };
    xhr.onerror = () =>
      reject(new Error("The upload was interrupted. Check your connection and try again."));
    xhr.send(form);
  });
}

function Steps({ step }: { step: 1 | 2 | 3 | 4 }) {
  const labels = ["File", "Details", "Upload"];
  return (
    <ol className="upload-steps" aria-label="Upload progress">
      {labels.map((label, i) => {
        const n = i + 1;
        const done = step > n;
        const active = step === n;
        return (
          <li
            key={label}
            className={`${done ? "done" : ""} ${active ? "active" : ""}`}
            aria-current={active ? "step" : undefined}
          >
            <span className="upload-steps-dot">
              {done ? <Check size={12} strokeWidth={2.5} /> : n}
            </span>
            {label}
          </li>
        );
      })}
    </ol>
  );
}

export function UploadSheet({
  open,
  signedIn,
  defaultClient,
  onClose,
  onUploaded,
  onDiscuss,
}: {
  open: boolean;
  signedIn: boolean;
  defaultClient?: string;
  onClose: () => void;
  onUploaded: () => Promise<void> | void;
  onDiscuss: (doc: UploadedDocument, mode: "summarise" | "ask") => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [client, setClient] = useState("");
  const [category, setCategory] = useState("");
  const [docDate, setDocDate] = useState(today);
  const [phase, setPhase] = useState<Phase>(null);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState<UploadedDocument | null>(null);

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setTitle("");
    setClient(defaultClient ?? "");
    setCategory("");
    setDocDate(today());
    setPhase(null);
    setError("");
    setResult(null);
  }, [open, defaultClient]);

  const busy = phase === "uploading" || phase === "processing";
  const complete = !!(file && client && category && docDate && title.trim());
  const step: 1 | 2 | 3 | 4 =
    phase === "ready" ? 4 : phase ? 3 : file ? 2 : 1;

  function choose(list: FileList | null) {
    const picked = list?.[0];
    if (!picked) return;
    setFile(picked);
    setTitle(titleFromFile(picked.name));
    setError("");
    if (fileRef.current) fileRef.current.value = "";
  }

  async function submit() {
    if (!file || !complete || busy) return;
    setError("");
    setPhase("uploading");
    const form = new FormData();
    form.append("file", file);
    form.append("title", title.trim());
    form.append("client", client);
    form.append("category", category);
    form.append("docDate", docDate);
    try {
      const body = await send(form, () => setPhase("processing"));
      await onUploaded();
      setResult({
        id: body.id,
        title: body.title,
        client: body.client,
        category: body.category,
        notice: body.notice,
      });
      setPhase("ready");
    } catch (e) {
      setPhase(null);
      setError((e as Error).message);
    }
  }

  const heading =
    phase === "ready"
      ? "Ready to use"
      : busy
        ? "Adding to knowledge"
        : "Document details";

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o && !busy) onClose();
      }}
    >
      <SheetContent
        className="upload-sheet"
        showCloseButton={false}
        onInteractOutside={(e) => busy && e.preventDefault()}
        onEscapeKeyDown={(e) => busy && e.preventDefault()}
      >
        <header className="upload-sheet-head">
          <div>
            <span className="eyebrow">NEW DOCUMENT</span>
            <SheetTitle>{heading}</SheetTitle>
            <SheetDescription>
              {phase === "ready"
                ? "Indexed for search and Ask, with source citations."
                : "Choose the client, category and date. The document is filed to that client’s knowledge."}
            </SheetDescription>
          </div>
          <button
            type="button"
            className="upload-close"
            aria-label="Close"
            disabled={busy}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>

        <Steps step={step} />

        <div className="upload-sheet-body">
          {!signedIn ? (
            <div className="upload-signin">
              <Upload size={22} />
              <strong>Sign in to add documents</strong>
              <p>Uploads are saved to your private workspace and indexed for Ask.</p>
              <a
                className="primary-button"
                href="/signin-with-chatgpt?return_to=/%23knowledge"
                target="_top"
              >
                Sign in
              </a>
            </div>
          ) : phase ? (
            <div className={`upload-phase ${phase === "ready" ? "ready" : ""}`}>
              <span className="upload-phase-icon">
                {phase === "ready" ? (
                  <Check size={26} strokeWidth={2.4} />
                ) : (
                  <LoaderCircle size={26} className="spin" />
                )}
              </span>
              <strong>
                {phase === "uploading"
                  ? "Uploading your document…"
                  : phase === "processing"
                    ? "Extracting and indexing text…"
                    : (result?.title ?? title)}
              </strong>
              <div className="upload-phase-tags">
                <span>{result?.client ?? client}</span>
                <span>{result?.category ?? category}</span>
              </div>
              <ol className="upload-progress" aria-label="Processing status">
                {(["uploading", "processing", "ready"] as const).map((p, i) => {
                  const order = { uploading: 0, processing: 1, ready: 2 }[phase];
                  return (
                    <li
                      key={p}
                      className={order > i || phase === "ready" ? "done" : order === i ? "active" : ""}
                    >
                      {p === "uploading" ? "Upload" : p === "processing" ? "Index" : "Ready"}
                    </li>
                  );
                })}
              </ol>
              {phase === "ready" && result && <p className="upload-note">{result.notice}</p>}
            </div>
          ) : !file ? (
            <button
              type="button"
              className={`upload-drop ${dragOver ? "over" : ""}`}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                choose(e.dataTransfer.files);
              }}
            >
              <span className="upload-drop-icon">
                <Upload size={24} />
              </span>
              <strong>{dragOver ? "Drop file here" : "Choose a file from your device"}</strong>
              <small>PDF · DOCX · PPTX · XLSX · TXT · CSV — or drag and drop · up to 10 MB</small>
            </button>
          ) : (
            <div className="upload-form">
              <div className="upload-file">
                <FileText size={22} />
                <div>
                  <strong>{file.name}</strong>
                  <small>{formatSize(file.size)}</small>
                  <button type="button" className="text-link" onClick={() => fileRef.current?.click()}>
                    Change file
                  </button>
                </div>
                <button
                  type="button"
                  className="upload-close"
                  aria-label="Remove file"
                  onClick={() => setFile(null)}
                >
                  <X size={16} />
                </button>
              </div>
              <label>
                <span>Client *</span>
                <select value={client} onChange={(e) => setClient(e.target.value)}>
                  <option value="">Select client…</option>
                  {clients.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                  <option value={FIRM_WIDE}>All clients (firm-wide)</option>
                </select>
              </label>
              <label>
                <span>Display title *</span>
                <input
                  value={title}
                  maxLength={250}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Northstar steering pack · Q3 2026"
                />
              </label>
              <label>
                <span>Category *</span>
                <select value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="">Select category…</option>
                  {DOCUMENT_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Document date *</span>
                <input type="date" value={docDate} max={today()} onChange={(e) => setDocDate(e.target.value)} />
              </label>
              <p className="upload-note">
                Uploads are marked unverified until reviewed. Ask cites them as sources once indexed.
              </p>
            </div>
          )}
          {error && (
            <p className="upload-error" role="alert">
              {error}
            </p>
          )}
        </div>

        <footer className="upload-sheet-foot">
          {phase === "ready" && result ? (
            <>
              <button type="button" className="primary-button" onClick={() => onDiscuss(result, "summarise")}>
                <Sparkles size={16} />
                Summarise
              </button>
              <button type="button" className="secondary-button" onClick={() => onDiscuss(result, "ask")}>
                <MessageCircle size={16} />
                Ask about it
              </button>
              <button type="button" className="ghost-button" onClick={onClose}>
                Done
              </button>
            </>
          ) : (
            <>
              {signedIn && file && (
                <button
                  type="button"
                  className="primary-button"
                  disabled={!complete || busy}
                  onClick={() => void submit()}
                >
                  {busy ? <LoaderCircle size={16} className="spin" /> : <Upload size={16} />}
                  {busy ? "Uploading…" : "Upload document"}
                </button>
              )}
              <button type="button" className="ghost-button" disabled={busy} onClick={onClose}>
                Cancel
              </button>
            </>
          )}
        </footer>
        <input
          ref={fileRef}
          type="file"
          hidden
          accept={ACCEPT}
          onChange={(e) => choose(e.target.files)}
        />
      </SheetContent>
    </Sheet>
  );
}
