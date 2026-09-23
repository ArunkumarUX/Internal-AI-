"use client";
import { useState, type ReactNode } from "react";
import {
  Brain,
  Check,
  CheckCheck,
  LoaderCircle,
  Plus,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import type { Source } from "@/lib/knowledge";
import type { Answer } from "@/lib/answer";

export type ChatMessage = {
  id: string;
  query: string;
  answer: Answer;
  sources: Source[];
  steps: string[];
  streaming: boolean;
  at: string;
  error?: string;
};

const SYSTEM_STYLE: Record<string, { label: string; className: string }> = {
  Notion: { label: "N", className: "sys-notion" },
  Confluence: { label: "C", className: "sys-confluence" },
  SharePoint: { label: "S", className: "sys-sharepoint" },
  Uploads: { label: "U", className: "sys-uploads" },
  Memory: { label: "M", className: "sys-memory" },
};

export function SystemMark({ system }: { system: string }) {
  const style = SYSTEM_STYLE[system] ?? { label: system.slice(0, 1), className: "" };
  return (
    <span className={`sys-mark ${style.className}`} aria-hidden>
      {system === "Memory" ? <Brain size={10} /> : style.label}
    </span>
  );
}

const INLINE =
  /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|\[[\w-]+(?:\s*,\s*[\w-]+)*\])/g;

function Inline({
  text,
  sources,
  onSource,
}: {
  text: string;
  sources: Source[];
  onSource: (s: Source) => void;
}) {
  return (
    <>
      {text.split(INLINE).map((part, i) => {
        if (!part) return null;
        if (part.startsWith("**") && part.endsWith("**"))
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        if (part.startsWith("`") && part.endsWith("`"))
          return <code key={i}>{part.slice(1, -1)}</code>;
        const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
        if (link)
          return (
            <a key={i} href={link[2]} target="_blank" rel="noreferrer">
              {link[1]}
            </a>
          );
        const cite = part.match(/^\[([\w-]+(?:\s*,\s*[\w-]+)*)\]$/);
        if (cite) {
          const ids = cite[1].split(/\s*,\s*/);
          const found = ids.map((id) => sources.findIndex((s) => s.id === id));
          if (found.every((n) => n >= 0))
            return (
              <span key={i} className="cite-group">
                {found.map((n) => (
                  <button
                    key={n}
                    type="button"
                    className="cite"
                    title={`${sources[n].title} · ${sources[n].system}`}
                    onClick={() => onSource(sources[n])}
                  >
                    {n + 1}
                  </button>
                ))}
              </span>
            );
        }
        return part;
      })}
    </>
  );
}

type Block =
  | { type: "h"; level: number; text: string }
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "table"; rows: string[][] };

function blocks(text: string): Block[] {
  const out: Block[] = [];
  const lines = text.replace(/\r/g, "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;
    const heading = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      out.push({ type: "h", level: heading[1].length, text: heading[2] });
      continue;
    }
    if (trimmed.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const cells = lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      i--;
      out.push({ type: "table", rows });
      continue;
    }
    const bullet = /^(?:[-*•])\s+/;
    const numbered = /^\d+[.)]\s+/;
    if (bullet.test(trimmed) || numbered.test(trimmed)) {
      const type = numbered.test(trimmed) ? "ol" : "ul";
      const pattern = type === "ol" ? numbered : bullet;
      const items: string[] = [];
      while (i < lines.length && pattern.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(pattern, ""));
        i++;
      }
      i--;
      out.push(type === "ol" ? { type: "ol", items } : { type: "ul", items });
      continue;
    }
    const last = out[out.length - 1];
    if (last?.type === "p" && lines[i - 1]?.trim()) last.text += " " + trimmed;
    else out.push({ type: "p", text: trimmed });
  }
  return out;
}

export function Markdown({
  text,
  sources,
  onSource,
  streaming,
}: {
  text: string;
  sources: Source[];
  onSource: (s: Source) => void;
  streaming?: boolean;
}) {
  const inline = (t: string) => <Inline text={t} sources={sources} onSource={onSource} />;
  const list = blocks(text);
  return (
    <div className={`px-markdown ${streaming ? "is-streaming" : ""}`}>
      {list.map((b, i) => {
        if (b.type === "h")
          return b.level <= 2 ? <h2 key={i}>{inline(b.text)}</h2> : <h3 key={i}>{inline(b.text)}</h3>;
        if (b.type === "ul")
          return <ul key={i}>{b.items.map((t, j) => <li key={j}>{inline(t)}</li>)}</ul>;
        if (b.type === "ol")
          return <ol key={i}>{b.items.map((t, j) => <li key={j}>{inline(t)}</li>)}</ol>;
        if (b.type === "table")
          return (
            <div className="px-table" key={i}>
              <table>
                <thead>
                  <tr>{b.rows[0]?.map((c, j) => <th key={j}>{inline(c)}</th>)}</tr>
                </thead>
                <tbody>
                  {b.rows.slice(1).map((r, j) => (
                    <tr key={j}>{r.map((c, k) => <td key={k}>{inline(c)}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        return <p key={i}>{inline(b.text)}</p>;
      })}
    </div>
  );
}

function time(at: string) {
  const d = new Date(at);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function ChatExchange({
  m,
  last,
  onSource,
  onAsk,
  onRetry,
  actions,
}: {
  m: ChatMessage;
  last: boolean;
  onSource: (s: Source) => void;
  onAsk: (q: string) => void;
  onRetry: () => void;
  actions: ReactNode;
}) {
  const [allSources, setAllSources] = useState(false);
  const text = m.answer.text;
  const pending = m.streaming && !text;
  const shown = allSources ? m.sources : m.sources.slice(0, 3);
  const more = m.sources.length - shown.length;
  return (
    <article className={`px-exchange ${last ? "is-last" : ""}`} data-exchange={m.id}>
      <div className="px-user">
        <p className="px-user-bubble">{m.query}</p>
        <span className="px-time">{time(m.at)}</span>
      </div>

      {pending && (
        <div className="px-bubble px-bubble-pending">
          <ol className="px-steps" aria-live="polite">
            {(m.steps.length ? m.steps : ["Thinking"]).map((step, i, all) => (
              <li key={i} className={i === all.length - 1 ? "is-active" : ""}>
                {i === all.length - 1 ? (
                  <LoaderCircle size={14} className="spin" />
                ) : (
                  <Check size={14} />
                )}
                {step}
              </li>
            ))}
          </ol>
        </div>
      )}

      {text && (
        <div className="px-bubble">
          <Markdown text={text} sources={m.sources} onSource={onSource} streaming={m.streaming} />
          {m.sources.length > 0 && (
            <div className="px-chips" aria-label="Sources">
              {shown.map((s, i) => (
                <button
                  type="button"
                  key={s.id}
                  className="px-chip"
                  title={`${s.title} · ${s.system} · ${s.date}`}
                  onClick={() => onSource(s)}
                >
                  <SystemMark system={s.system} />
                  <span>{s.title}</span>
                  <span className="px-chip-n">{i + 1}</span>
                </button>
              ))}
              {more > 0 && (
                <button type="button" className="px-chip px-chip-more" onClick={() => setAllSources(true)}>
                  +{more} more
                </button>
              )}
            </div>
          )}
          <div className="px-bubble-foot">
            {m.answer.mode && !m.streaming && <span className="px-mode">{m.answer.mode}</span>}
            <span className="px-time">{time(m.at)}</span>
            {m.streaming ? (
              <Check size={15} aria-label="Writing" />
            ) : (
              <CheckCheck size={15} className="px-read" aria-label="Delivered" />
            )}
          </div>
        </div>
      )}

      {m.error && (
        <div className="px-error" role="alert">
          <TriangleAlert size={16} />
          <span>{m.error}</span>
          <button type="button" onClick={onRetry}>
            <RefreshCw size={14} />
            Retry
          </button>
        </div>
      )}

      {!m.streaming && text && <div className="px-actions">{actions}</div>}

      {!m.streaming && m.answer.followups.length > 0 && (
        <div className="px-related">
          <h3>Related</h3>
          {m.answer.followups.map((q) => (
            <button type="button" key={q} onClick={() => onAsk(q)}>
              {q}
              <Plus size={16} />
            </button>
          ))}
        </div>
      )}
    </article>
  );
}
