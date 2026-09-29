"use client";
import { useState, type ReactNode } from "react";
import {
  Brain,
  Globe,
  Check,
  CheckCheck,
  LoaderCircle,
  Plus,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import type { Source } from "@/lib/knowledge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import type { Answer } from "@/lib/answer";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

export type ChatMessage = {
  id: string;
  query: string;
  answer: Answer;
  sources: Source[];
  steps: string[];
  streaming: boolean;
  at: string;
  error?: string;
  /** Documents sent with the question, so Retry can resend them. */
  attachmentIds?: string[];
  stopped?: boolean;
};

const SYSTEM_STYLE: Record<string, { label: string; className: string }> = {
  Notion: { label: "N", className: "sys-notion" },
  Confluence: { label: "C", className: "sys-confluence" },
  SharePoint: { label: "S", className: "sys-sharepoint" },
  Uploads: { label: "U", className: "sys-uploads" },
  Memory: { label: "M", className: "sys-memory" },
  Web: { label: "W", className: "sys-web" },
};

export function SystemMark({ system }: { system: string }) {
  const style = SYSTEM_STYLE[system] ?? { label: system.slice(0, 1), className: "" };
  return (
    <span className={`sys-mark ${style.className}`} aria-hidden>
      {system === "Memory" ? <Brain size={10} /> : system === "Web" ? <Globe size={10} /> : style.label}
    </span>
  );
}

const INLINE =
  /(!\[[^\]]*\]\(\/api\/files\/[\w-]+\)|\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|\[[\w-]+(?:\s*,\s*[\w-]+)*\])/g;

/** "[a], [b]" and "[a][b]" become "[a, b]" so adjacent citations share one pill. */
function mergeCitations(text: string) {
  const adjacent = /(\[[\w-]+(?:\s*,\s*[\w-]+)*)\]\s*,?\s*\[(?=[\w-]+(?:\s*,\s*[\w-]+)*\](?!\())/g;
  let prev = "";
  let next = text;
  while (next !== prev) {
    prev = next;
    next = next.replace(adjacent, "$1, ");
  }
  // No space before a citation pill that ends a sentence.
  return next.replace(/\s+([.,;:])(?=\s|$)/g, "$1");
}

/** Short name shown for a source: the site for web pages, else the document title. */
export function sourceSite(s: Source) {
  if (s.system === "Web") {
    try {
      if (s.url) return new URL(s.url).hostname.replace(/^www\./, "");
    } catch {}
    return s.owner || "Web";
  }
  return s.title.length > 28 ? `${s.title.slice(0, 26)}…` : s.title;
}

function Inline({
  text,
  sources,
  onSource,
  onCite,
}: {
  text: string;
  sources: Source[];
  onSource: (s: Source) => void;
  onCite?: (list: Source[]) => void;
}) {
  return (
    <>
      {mergeCitations(text).split(INLINE).map((part, i) => {
        if (!part) return null;
        const image = part.match(/^!\[([^\]]*)\]\((\/api\/files\/[\w-]+)\)$/);
        if (image)
          return (
            <a key={i} href={image[2]} target="_blank" rel="noreferrer" className="px-image">
              <img src={image[2]} alt={image[1] || "Generated image"} loading="lazy" />
            </a>
          );
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
          const found = [...new Set(ids.map((id) => sources.findIndex((s) => s.id === id)))].filter((n) => n >= 0);
          // One pill per citation group, named after its first source, like "Reuters +2".
          if (found.length) {
            const first = sources[found[0]];
            return (
              <button
                key={i}
                type="button"
                className="cite-pill"
                title={found.map((n) => `${sources[n].title} · ${sourceSite(sources[n])}`).join("\n")}
                aria-label={`Sources: ${found.map((n) => sources[n].title).join(", ")}`}
                onClick={() => (onCite ? onCite(found.map((n) => sources[n])) : onSource(first))}
              >
                <span className="cite-pill-name">{sourceSite(first)}</span>
                {found.length > 1 && <span className="cite-pill-more">+{found.length - 1}</span>}
              </button>
            );
          }
          // Looks like a source id (uuid, web-/mcp- ids) but isn't available any more.
          if (ids.every((id) => /^([0-9a-f]{8}-|web-|mcp-)/i.test(id)))
            return (
              <span key={i} className="cite cite-missing" title="This source was deleted or is no longer available">
                ?
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
  | { type: "table"; rows: string[][] }
  | { type: "chart"; spec: string; open: boolean }
  | { type: "code"; text: string };

function blocks(text: string): Block[] {
  const out: Block[] = [];
  const lines = text.replace(/\r/g, "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("```")) {
      const lang = trimmed.slice(3).trim().toLowerCase();
      const body: string[] = [];
      let closed = false;
      for (i++; i < lines.length; i++) {
        if (lines[i].trim().startsWith("```")) {
          closed = true;
          break;
        }
        body.push(lines[i]);
      }
      out.push(
        lang === "chart"
          ? { type: "chart", spec: body.join("\n"), open: !closed }
          : { type: "code", text: body.join("\n") },
      );
      continue;
    }
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
  onCite,
  streaming,
}: {
  text: string;
  sources: Source[];
  onSource: (s: Source) => void;
  onCite?: (list: Source[]) => void;
  streaming?: boolean;
}) {
  const inline = (t: string) => <Inline text={t} sources={sources} onSource={onSource} onCite={onCite} />;
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
        // An unclosed fence is only "drawing" while the answer is still streaming.
        if (b.type === "chart") return <Chart key={i} spec={b.spec} pending={b.open && !!streaming} />;
        if (b.type === "code")
          return (
            <pre className="px-code" key={i}>
              <code>{b.text}</code>
            </pre>
          );
        return <p key={i}>{inline(b.text)}</p>;
      })}
    </div>
  );
}

type ChartSpec = {
  type?: "bar" | "line" | "pie";
  title?: string;
  unit?: string;
  data: { label: string; value: number }[];
};

const PALETTE = ["#5146e5", "#5aa9f5", "#22a06b", "#f5a524", "#e5484d", "#8b5cf6", "#14b8a6", "#64748b"];

function parseChart(spec: string): ChartSpec | null {
  try {
    const raw = JSON.parse(spec);
    const data = (Array.isArray(raw?.data) ? raw.data : [])
      .filter((d: any) => d && d.value !== null && d.value !== "" && d.value !== undefined)
      .map((d: any) => ({ label: String(d.label ?? d.name ?? ""), value: Number(d.value) }))
      .filter((d: { label: string; value: number }) => d.label && Number.isFinite(d.value))
      .slice(0, 24);
    return data.length ? { type: raw.type, title: raw.title, unit: raw.unit, data } : null;
  } catch {
    return null;
  }
}

function Chart({ spec, pending }: { spec: string; pending: boolean }) {
  const chart = pending ? null : parseChart(spec);
  if (!chart)
    return <div className="px-chart px-chart-pending">{pending ? "Drawing chart…" : "This chart couldn’t be drawn."}</div>;
  // Currency symbols lead ("£k" → £1,000k); other units trail ("%" → 12%).
  const unit = chart.unit ?? "";
  const lead = unit.match(/^[£$€₹¥]/)?.[0] ?? "";
  const trail = lead ? unit.slice(1) : unit;
  const format = (v: unknown) => `${lead}${Number(v).toLocaleString()}${trail}`;
  return (
    <figure className="px-chart" aria-label={chart.title ?? "Chart"}>
      {chart.title && <figcaption>{chart.title}</figcaption>}
      <div className="px-chart-canvas">
        <ResponsiveContainer width="100%" height="100%">
          {chart.type === "pie" ? (
            <PieChart>
              <Tooltip formatter={format} />
              <Pie data={chart.data} dataKey="value" nameKey="label" innerRadius="45%" outerRadius="80%" paddingAngle={2}>
                {chart.data.map((_, i) => (
                  <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                ))}
              </Pie>
            </PieChart>
          ) : chart.type === "line" ? (
            <LineChart data={chart.data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e7ebf3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} tickFormatter={format} width={56} />
              <Tooltip formatter={format} />
              <Line type="monotone" dataKey="value" stroke={PALETTE[0]} strokeWidth={2.5} dot={{ r: 3 }} />
            </LineChart>
          ) : (
            <BarChart data={chart.data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e7ebf3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} interval={0} />
              <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} tickFormatter={format} width={56} />
              <Tooltip formatter={format} cursor={{ fill: "#eef0ff" }} />
              <Bar dataKey="value" fill={PALETTE[0]} radius={[6, 6, 0, 0]} maxBarSize={48} />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
      {chart.type === "pie" && (
        <ul className="px-chart-legend">
          {chart.data.map((d, i) => (
            <li key={`${d.label}-${i}`}>
              <i style={{ background: PALETTE[i % PALETTE.length] }} />
              {d.label} · {format(d.value)}
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}

/** A letter badge per source; web sources use their site's initial. */
function SourceIcon({ s }: { s: Source }) {
  if (s.system !== "Web") return <SystemMark system={s.system} />;
  const site = sourceSite(s);
  const hue = [...site].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
  return (
    <span className="src-icon" style={{ background: `hsl(${hue} 55% 92%)`, color: `hsl(${hue} 45% 32%)` }} aria-hidden>
      {site.replace(/^www\./, "").charAt(0).toUpperCase()}
    </span>
  );
}

/** ChatGPT-style "Sources" button: overlapping icons, opens the full list. */
function SourcesButton({ sources, onOpen }: { sources: Source[]; onOpen: () => void }) {
  // One face per system (internal) or site (web), so two Confluence pages show one "C".
  const key = (s: Source) => (s.system === "Web" ? sourceSite(s) : s.system);
  const faces = sources.filter((s, i, all) => all.findIndex((x) => key(x) === key(s)) === i).slice(0, 4);
  return (
    <button type="button" className="sources-button" onClick={onOpen} aria-label={`Show ${sources.length} sources`}>
      <span className="sources-faces">
        {faces.map((s) => (
          <SourceIcon key={s.id} s={s} />
        ))}
      </span>
      Sources
    </button>
  );
}

function SourceRow({ s, onSource }: { s: Source; onSource: (s: Source) => void }) {
  const body = (
    <>
      <span className="src-row-site">
        <SourceIcon s={s} />
        {s.system === "Web" ? sourceSite(s) : s.system}
        {s.date ? <span className="src-row-date"> · {s.date}</span> : null}
      </span>
      <strong>{s.title}</strong>
      {s.content && <span className="src-row-snippet">{s.content.replace(/\s+/g, " ").slice(0, 220)}</span>}
    </>
  );
  return s.system === "Web" && s.url ? (
    <a className="src-row" href={s.url} target="_blank" rel="noreferrer">
      {body}
    </a>
  ) : (
    <button type="button" className="src-row" onClick={() => onSource(s)}>
      {body}
    </button>
  );
}

/** Side panel listing every source: citations first, then the rest. */
function SourcesPanel({
  open,
  onClose,
  sources,
  cited,
  focus,
  onSource,
}: {
  open: boolean;
  onClose: () => void;
  sources: Source[];
  cited: Set<string>;
  focus: Source[] | null;
  onSource: (s: Source) => void;
}) {
  const lead = focus?.length ? focus : sources.filter((s) => cited.has(s.id));
  const rest = sources.filter((s) => !lead.includes(s));
  const internal = (list: Source[]) => list.filter((s) => s.system !== "Web");
  const web = (list: Source[]) => list.filter((s) => s.system === "Web");
  const section = (title: string, list: Source[]) =>
    list.length > 0 && (
      <section className="src-section">
        <h3>{title}</h3>
        {list.map((s) => (
          <SourceRow
            key={s.id}
            s={s}
            onSource={(x) => {
              onClose();
              onSource(x);
            }}
          />
        ))}
      </section>
    );
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="sources-sheet">
        <SheetHeader>
          <SheetTitle>{focus?.length ? "Citation" : "Sources"}</SheetTitle>
          <SheetDescription>
            {internal(sources).length} from your knowledge · {web(sources).length} from the web
          </SheetDescription>
        </SheetHeader>
        <div className="src-list">
          {section(focus?.length ? "Cited here" : "Citations", lead)}
          {section("More from your knowledge", internal(rest))}
          {section("More from the web", web(rest))}
        </div>
      </SheetContent>
    </Sheet>
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
  const [panel, setPanel] = useState<{ focus: Source[] | null } | null>(null);
  const cited = new Set(m.sources.filter((s) => m.answer.text.includes(s.id)).map((s) => s.id));
  const text = m.answer.text;
  const pending = m.streaming && !text;
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
          {!m.streaming && /Web sources/.test(m.answer.mode) && (
            <p className="px-basis external">
              <Globe size={14} /> Your internal knowledge doesn’t cover this, so this answer uses public web sources. Check them before relying on it.
            </p>
          )}
          {!m.streaming && /Internal \+ web/.test(m.answer.mode) && (
            <p className="px-basis mixed">
              <Globe size={14} /> Combines your internal knowledge with public web sources. Web facts are cited separately below.
            </p>
          )}
          <Markdown
            text={text}
            sources={m.sources}
            onSource={onSource}
            onCite={(list) => setPanel({ focus: list })}
            streaming={m.streaming}
          />
          {m.sources.length > 0 && !m.streaming && (
            <SourcesButton sources={m.sources} onOpen={() => setPanel({ focus: null })} />
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

      {/* Incomplete or failed answers can't be saved or exported as if final. */}
      {!m.streaming && text && !m.error && <div className="px-actions">{actions}</div>}
      <span className="sr-only" aria-live="polite">
        {!m.streaming && last ? (m.error ? `Answer failed: ${m.error}` : text ? "Answer ready." : "") : ""}
      </span>

      <SourcesPanel
        open={!!panel}
        onClose={() => setPanel(null)}
        sources={m.sources}
        cited={cited}
        focus={panel?.focus ?? null}
        onSource={onSource}
      />
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
