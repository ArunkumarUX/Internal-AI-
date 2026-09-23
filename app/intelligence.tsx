"use client";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Building2,
  Crown,
  Info,
  Lightbulb,
  RefreshCw,
  SearchCheck,
  Sparkles,
  Sunrise,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  clients,
  initialActions,
  insights,
  sources as sampleSources,
  type Source,
} from "@/lib/knowledge";
import type { Workspace } from "@/lib/client";

type Props = {
  ws: Workspace;
  ask: (q: string, options?: { attachmentIds?: string[] }) => void;
  openSource: (s: Source) => void;
  setView: (v: string) => void;
};

const FIRM_WIDE = "All clients";
const DIMENSIONS = [
  { d: "Relationship context", short: "Relationship", kinds: ["Client brief", "Meeting notes"] },
  { d: "Decisions", short: "Decisions", kinds: ["Decision"] },
  { d: "Delivery evidence", short: "Delivery", kinds: ["Project update", "Case study"] },
  { d: "Commercials", short: "Commercials", kinds: ["Pricing", "Proposal", "RFP"] },
  { d: "Expertise", short: "Expertise", kinds: ["People"] },
  { d: "Policy & governance", short: "Governance", kinds: ["Policy"] },
];
const SYSTEMS = ["Notion", "Confluence", "SharePoint", "Uploads", "Memory"];
const OPPORTUNITIES = [
  {
    t: "Northstar AI transformation RFP",
    note: "Reusable banking delivery evidence and an approved architecture decision",
    client: "Northstar Bank",
    ids: ["northstar-rfp", "banking-cases", "atlas-decision", "expertise"],
    gaps: ["Data residency sign-off pending"],
    query: "Build a proposal response strategy for the Northstar RFP",
  },
  {
    t: "Harbour claims triage discovery",
    note: "Strong discovery notes, but no insurance deployment case study yet",
    client: "Harbour Insurance",
    ids: ["harbour-brief", "banking-cases"],
    gaps: ["No insurance deployment case study"],
    query: "What are our knowledge gaps for Harbour Insurance?",
  },
  {
    t: "Q4 pricing for new proposals",
    note: "Current reference supersedes the 2025 archive — confirm assumptions",
    client: FIRM_WIDE,
    ids: ["pricing-current", "pricing-old"],
    gaps: [] as string[],
    query: "Compare our current and archived pricing references",
  },
  {
    t: "Banking AI case study reuse",
    note: "Three engagements with named experts ready to cite",
    client: FIRM_WIDE,
    ids: ["banking-cases", "expertise"],
    gaps: [] as string[],
    query: "Which banking case studies and experts can we reuse for new pitches?",
  },
];

function weight(s?: Source) {
  if (!s) return 0;
  if (s.status === "Verified") return 1;
  if (s.status === "Stale" || s.status === "Superseded") return 0.3;
  return 0.6;
}
function coverage(all: Source[], client: string, kinds: string[]) {
  const docs = all.filter(
    (s) =>
      kinds.includes(s.kind) && (s.client === client || s.client === FIRM_WIDE),
  );
  return Math.min(
    100,
    Math.round(docs.reduce((sum, s) => sum + weight(s) * 38, 0)),
  );
}

function InfoTip({ text }: { text: string }) {
  return (
    <span className="mi-info" tabIndex={0} aria-label={text} title={text}>
      <Info size={13} />
    </span>
  );
}
function SectionHead({
  eyebrow,
  title,
  info,
  action,
}: {
  eyebrow: string;
  title: React.ReactNode;
  info?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mi-section-head">
      <div>
        <span className="mi-eyebrow">
          {eyebrow}
          {info && <InfoTip text={info} />}
        </span>
        <h3>{title}</h3>
      </div>
      {action}
    </div>
  );
}
function SourceNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="mi-source-note">
      <BookOpen size={12} />
      {children}
    </p>
  );
}

function Radar({
  dims,
  a,
  b,
  size = 300,
}: {
  dims: string[];
  a: number[];
  b: number[];
  size?: number;
}) {
  const c = size / 2;
  const r = size / 2 - 44;
  const point = (i: number, v: number) => {
    const angle = (Math.PI * 2 * i) / dims.length - Math.PI / 2;
    return [c + Math.cos(angle) * r * (v / 100), c + Math.sin(angle) * r * (v / 100)];
  };
  const path = (vals: number[]) =>
    vals.map((v, i) => point(i, Math.max(v, 4)).join(",")).join(" ");
  return (
    <svg
      viewBox={`-24 0 ${size + 48} ${size}`}
      className="mi-radar"
      role="img"
      aria-label="Evidence coverage radar"
    >
      {[25, 50, 75, 100].map((ring) => (
        <polygon
          key={ring}
          points={dims.map((_, i) => point(i, ring).join(",")).join(" ")}
          className="mi-radar-ring"
        />
      ))}
      {dims.map((d, i) => {
        const [x, y] = point(i, 100);
        const [lx, ly] = point(i, 128);
        return (
          <g key={d}>
            <line x1={c} y1={c} x2={x} y2={y} className="mi-radar-axis" />
            <text
              x={lx}
              y={ly}
              textAnchor={Math.abs(lx - c) < 8 ? "middle" : lx > c ? "start" : "end"}
              dominantBaseline="middle"
              className="mi-radar-label"
            >
              {d}
            </text>
          </g>
        );
      })}
      <polygon points={path(b)} className="mi-radar-b" />
      <polygon points={path(a)} className="mi-radar-a" />
      {a.map((v, i) => {
        const [x, y] = point(i, Math.max(v, 4));
        return <circle key={i} cx={x} cy={y} r={3.5} className="mi-radar-dot" />;
      })}
    </svg>
  );
}

function Ring({ value }: { value: number }) {
  const r = 25;
  const len = 2 * Math.PI * r;
  const tone = value >= 75 ? "#15803d" : value >= 50 ? "var(--kit-indigo)" : "#c2410c";
  return (
    <svg
      viewBox="0 0 62 62"
      className="mi-ring"
      role="img"
      aria-label={`Evidence readiness ${value} out of 100`}
    >
      <circle cx="31" cy="31" r={r} className="mi-ring-track" />
      <circle
        cx="31"
        cy="31"
        r={r}
        stroke={tone}
        className="mi-ring-value"
        strokeDasharray={`${(len * value) / 100} ${len}`}
      />
      <text x="31" y="31" textAnchor="middle" dominantBaseline="central">
        {value}
      </text>
    </svg>
  );
}

export function Intelligence({ ws, ask, openSource, setView }: Props) {
  const all = ws.allSources;
  const [clientTab, setClientTab] = useState(clients[0].name);
  const [compare, setCompare] = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);
  const byId = (id: string) => all.find((s) => s.id === id);
  const today = new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  const dismissed = ws.state.records
    .filter((r) => r.kind === "dismissed")
    .map((r) => r.data.insightId as string);
  const custom: Record<string, any>[] = ws.state.records
    .filter((r) => r.kind === "action")
    .map((r) => ({ ...r.data, id: r.data.id ?? r.id }));
  const openActions = [
    ...initialActions.map((a) => custom.find((c) => c.id === a.id) ?? a),
    ...custom.filter((c) => !initialActions.some((a) => a.id === c.id)),
  ]
    .filter((a) => !["Completed", "Dismissed", "Approved draft"].includes(a.status))
    .sort((x, y) => String(x.due ?? "").localeCompare(String(y.due ?? "")));
  const latestUpload = ws.state.documents[0];

  const briefing: {
    text: string;
    pill?: string;
    onPill?: () => void;
  }[] = [
    openActions.length
      ? {
          text: `${openActions.length} open commitment${openActions.length === 1 ? "" : "s"} — next: ${openActions[0].title} (${openActions[0].owner}, due ${openActions[0].due}).`,
          pill: "Actions",
          onPill: () => setView("Actions"),
        }
      : { text: "No open commitments. Every action has been reviewed." },
    {
      text: "Project Atlas has two deployment dates in circulation — June 2027 in the pitch, August 2027 in the September update.",
      pill: "Compare",
      onPill: () => setCompare(true),
    },
    {
      text: "Advisory pricing: the September 2026 reference supersedes the February 2025 archive. Check before quoting.",
      pill: "Pricing reference",
      onPill: () => {
        const s = byId("pricing-current");
        if (s) openSource(s);
      },
    },
    latestUpload
      ? {
          text: `New in Knowledge: ${latestUpload.title}${latestUpload.client ? ` · ${latestUpload.client}` : ""}${latestUpload.category ? ` · ${latestUpload.category}` : ""}.`,
          pill: "Open",
          onPill: () => {
            const s = byId(latestUpload.id);
            if (s) openSource(s);
          },
        }
      : {
          text: "Harbour Insurance is exploring claims automation, but there is no validated insurance deployment case study yet.",
          pill: "Harbour brief",
          onPill: () => {
            const s = byId("harbour-brief");
            if (s) openSource(s);
          },
        },
  ];

  const dims = DIMENSIONS.map((d) => d.short);
  const centres = [...clients.map((c) => c.name), FIRM_WIDE];
  const matrix = useMemo(
    () =>
      DIMENSIONS.map((dim) => ({
        d: dim.d,
        v: centres.map((c) =>
          c === FIRM_WIDE
            ? Math.min(
                100,
                Math.round(
                  all
                    .filter((s) => dim.kinds.includes(s.kind))
                    .reduce((sum, s) => sum + weight(s) * 22, 0),
                ),
              )
            : coverage(all, c, dim.kinds),
        ),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all],
  );
  const clientIndex = centres.indexOf(clientTab);
  const aVals = matrix.map((m) => m.v[clientIndex]);
  const avgVals = matrix.map((m) =>
    Math.round(
      clients.reduce((sum, _, ci) => sum + m.v[ci], 0) / clients.length,
    ),
  );
  const avg = (vals: number[]) =>
    Math.round(vals.reduce((s, x) => s + x, 0) / vals.length);
  const totals = centres.map((_, ci) => avg(matrix.map((m) => m.v[ci])));

  const systemCounts = SYSTEMS.map((k) => ({
    k,
    n: all.filter((s) => s.system === k).length,
    verified: all.filter((s) => s.system === k && s.status === "Verified").length,
  }));
  const maxCount = Math.max(1, ...systemCounts.map((s) => s.n));
  const leader = [...systemCounts].sort((x, y) => y.n - x.n)[0];

  const opportunities = OPPORTUNITIES.map((o) => ({
    ...o,
    score: Math.round(
      (o.ids.reduce((sum, id) => sum + weight(byId(id)), 0) /
        (o.ids.length + o.gaps.length)) *
        100,
    ),
  })).sort((x, y) => y.score - x.score);

  const actFirst = insights.filter(
    (i) => showDismissed || !dismissed.includes(i.id),
  );

  return (
    <div className="mi-page">
      <div className="mi-page-head">
        <div>
          <span className="mi-eyebrow">PERSONAL INTELLIGENCE</span>
          <h1>What’s moving across your clients — and where you can act first</h1>
        </div>
        <span className="mi-pill">
          <SearchCheck size={13} />
          Notion · Confluence · SharePoint · Uploads
        </span>
      </div>

      <section className="mi-card mi-featured">
        <header className="mi-featured-head">
          <span className="mi-featured-icon">
            <Sunrise size={20} />
          </span>
          <div>
            <h2>Morning briefing</h2>
            <p>From your workspace · actions, conflicts, freshness and new documents · {today}</p>
          </div>
          <span className="mi-live">
            <i />
            Live
          </span>
        </header>
        <ol className="mi-brief-list">
          {briefing.map((item, i) => (
            <li key={i}>
              <span className="mi-brief-index">{i + 1}</span>
              <span>
                {item.text}
                {item.pill && (
                  <button type="button" className="mi-brief-pill" onClick={item.onPill}>
                    {item.pill}
                  </button>
                )}
              </span>
            </li>
          ))}
        </ol>
        <div className="mi-featured-foot">
          <button
            type="button"
            className="mi-brief-button"
            onClick={() =>
              ask(
                "Give me my morning briefing: open commitments, conflicting evidence, stale references and new documents, with what I should do first.",
              )
            }
          >
            <Sparkles size={15} />
            Brief me in chat
          </button>
        </div>
      </section>

      <div className="mi-grid-2">
        <section className="mi-card">
          <SectionHead
            eyebrow="EVIDENCE FOOTPRINT"
            title={
              <>
                {clientTab} <span className="mi-muted">vs. firm average</span>
              </>
            }
            info="How much trustworthy evidence we hold for this client in each area. Verified sources count fully; unverified uploads count partly; stale references count little."
          />
          <div className="mi-seg" role="tablist" aria-label="Select client">
            {centres.map((c) => (
              <button
                key={c}
                type="button"
                role="tab"
                aria-selected={clientTab === c}
                className={clientTab === c ? "on" : ""}
                onClick={() => setClientTab(c)}
              >
                {c === FIRM_WIDE ? "Firm-wide" : c}
              </button>
            ))}
          </div>
          <div className="mi-chart">
            <Radar dims={dims} a={aVals} b={avgVals} />
          </div>
          <div className="mi-legend">
            <span>
              <i className="mi-swatch" />
              <strong>{clientTab === FIRM_WIDE ? "Firm-wide" : clientTab}</strong>
              <em>{avg(aVals)}</em>
            </span>
            <span>
              <i className="mi-swatch dashed" />
              Client average
              <em>{avg(avgVals)}</em>
            </span>
          </div>
          <SourceNote>
            Coverage score computed from the sources in your workspace, weighted by verification status.
          </SourceNote>
        </section>

        <section className="mi-card">
          <SectionHead
            eyebrow="KNOWLEDGE FLOW"
            title="Where your evidence lives"
            info="How many documents each connected system contributes, and how many of them are verified."
            action={
              <span className="mi-pill good">
                <RefreshCw size={12} />
                {all.length} sources
              </span>
            }
          />
          <div className="mi-flow">
            {systemCounts.map((s) => (
              <div key={s.k} className="mi-flow-row">
                <span className="mi-flow-label">{s.k}</span>
                <div className="mi-track">
                  <span
                    className="mi-track-total"
                    style={{ transform: `scaleX(${s.n / maxCount})` }}
                  />
                  <span
                    className="mi-track-verified"
                    style={{ transform: `scaleX(${s.verified / maxCount})` }}
                  />
                </div>
                <span className="mi-flow-value">{s.n}</span>
              </div>
            ))}
          </div>
          <div className="mi-legend">
            <span>
              <i className="mi-swatch" />
              Verified
            </span>
            <span>
              <i className="mi-swatch soft" />
              All documents
            </span>
            <span>
              <strong>{leader.k}</strong>
              <em>leads with {leader.n}</em>
            </span>
          </div>
          <SourceNote>
            Counts include sample sources, your uploads and approved memory. Sample sources are fictional.
          </SourceNote>
        </section>
      </div>

      <div className="mi-grid-split">
        <section className="mi-card">
          <SectionHead
            eyebrow="6-DIMENSION BENCHMARK"
            title="Evidence depth by client"
            info="Compare how well-evidenced each client relationship is, area by area. The crown marks the strongest in each row."
          />
          <div className="mi-bench-legend">
            {centres.map((c, i) => (
              <span key={c}>
                <i className={i === 0 ? "mi-swatch" : "mi-swatch soft"} />
                <strong className={i === 0 ? "" : "mi-muted"}>
                  {c === FIRM_WIDE ? "Firm-wide" : c}
                </strong>
                <em>{totals[i]}</em>
              </span>
            ))}
          </div>
          <div className="mi-bench">
            {matrix.map((row) => {
              const max = Math.max(...row.v);
              return (
                <div key={row.d}>
                  <span className="mi-bench-title">{row.d}</span>
                  {row.v.map((val, ci) => (
                    <div key={ci} className={`mi-bench-row ${ci === 0 ? "lead" : ""}`}>
                      <span className="mi-bench-name">
                        {centres[ci] === FIRM_WIDE ? "Firm-wide" : centres[ci]}
                      </span>
                      <div className="mi-track">
                        <span style={{ transform: `scaleX(${val / 100})` }} />
                      </div>
                      <span className="mi-bench-value">{val}</span>
                      {val === max && val > 0 ? (
                        <Crown size={13} className="mi-crown" />
                      ) : (
                        <span className="mi-crown-space" />
                      )}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
          <SourceNote>
            Firm-wide counts every source of that type. Validate before quoting coverage externally.
          </SourceNote>
        </section>

        <section className="mi-card">
          <SectionHead
            eyebrow="OPPORTUNITIES"
            title="Scored by evidence readiness"
            info="How ready our evidence is to support each opportunity today. Higher means more verified, current sources."
          />
          <div className="mi-opps">
            {opportunities.map((o, i) => (
              <button
                type="button"
                key={o.t}
                className="mi-opp"
                onClick={() => ask(o.query)}
              >
                <Ring value={o.score} />
                <span className="mi-opp-text">
                  <strong>{o.t}</strong>
                  <small>{o.note}</small>
                  <em>
                    {o.client === FIRM_WIDE ? "Firm-wide" : o.client}
                    {o.gaps.length ? ` · Gap: ${o.gaps.join(", ")}` : ""}
                  </em>
                </span>
                <span className="mi-opp-rank">#{i + 1}</span>
              </button>
            ))}
          </div>
          <SourceNote>
            Readiness = verified sources count 1, unverified 0.6, stale 0.3, known gaps 0 — averaged across the evidence each opportunity needs.
          </SourceNote>
        </section>
      </div>

      <section className="mi-card mi-featured mi-featured-soft">
        <header className="mi-featured-head">
          <span className="mi-featured-icon">
            <Lightbulb size={20} />
          </span>
          <div>
            <h2>Where you can act first</h2>
            <p>Connections, conflicts and gaps worth your attention — not generic commentary</p>
          </div>
          {dismissed.length > 0 && (
            <button
              type="button"
              className="mi-toggle"
              onClick={() => setShowDismissed((v) => !v)}
            >
              {showDismissed ? "Hide dismissed" : `Show dismissed (${dismissed.length})`}
            </button>
          )}
        </header>
        <div className="mi-act-grid">
          {actFirst.map((i) => (
            <article key={i.id} className={dismissed.includes(i.id) ? "dismissed" : ""}>
              <span className={`mi-act-icon ${i.tone}`}>
                {i.id === "conflict" ? (
                  <AlertTriangle size={17} />
                ) : i.id === "meeting" ? (
                  <Building2 size={17} />
                ) : (
                  <Lightbulb size={17} />
                )}
              </span>
              <div>
                <span className="mi-act-category">{i.category}</span>
                <strong>{i.title}</strong>
                <p>{i.description}</p>
                <div className="mi-act-actions">
                  <button
                    type="button"
                    className="text-link"
                    onClick={() => (i.id === "conflict" ? setCompare(true) : ask(i.query!))}
                  >
                    {i.action}
                    <ArrowRight size={14} />
                  </button>
                  {!dismissed.includes(i.id) && (
                    <button
                      type="button"
                      className="quiet-button"
                      onClick={async () => {
                        try {
                          await ws.save("dismissed", { insightId: i.id, title: i.title });
                          toast.success("Insight dismissed");
                        } catch {}
                      }}
                    >
                      Dismiss
                    </button>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
        {!actFirst.length && (
          <p className="mi-empty">You’ve reviewed every insight. Show dismissed to revisit them.</p>
        )}
      </section>

      <Dialog open={compare} onOpenChange={setCompare}>
        <DialogContent className="detail-dialog wide-dialog">
          <DialogHeader>
            <DialogTitle>One project. Two deployment dates.</DialogTitle>
            <DialogDescription>
              Potential conflict · Neither date has been silently chosen.
            </DialogDescription>
          </DialogHeader>
          <div className="two-column">
            {["pitch-old", "atlas-status"].map((id) => {
              const s = sampleSources.find((d) => d.id === id)!;
              return (
                <div className="panel" key={id}>
                  <span className="badge neutral">{s.date}</span>
                  <h3>{id === "pitch-old" ? "June 2027" : "August 2027"}</h3>
                  <p>{s.title}</p>
                  <small>{s.owner}</small>
                  <button className="text-link" onClick={() => openSource(s)}>
                    Inspect source <ArrowUpRight size={14} />
                  </button>
                </div>
              );
            })}
          </div>
          <div className="notice">
            <AlertTriangle size={18} /> Ask James Wilson to confirm the
            authoritative delivery date before updating the pitch.
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
