"use client";
import "./assistant.css";
import { useState, useEffect, useRef, useCallback, useMemo, useSyncExternalStore, useId } from "react";
import {
  ArrowUp,
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  Bot,
  Building2,
  Brain,
  CalendarDays,
  Camera,
  ChartColumn,
  ChevronLeft,
  ChevronRight,
  CircleStop,
  Pencil,
  Clock,
  Database,
  Download,
  FilePlus,
  Plus,
  FileText,
  Globe,
  Highlighter,
  Image as ImageIcon,
  Keyboard,
  Languages,
  LoaderCircle,
  Lock,
  Mail,
  MessageCircle,
  Mic,
  MicOff,
  Monitor,
  Pause,
  Play,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  StickyNote,
  Target,
  Timer,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { api, downloadText, type Workspace } from "@/lib/client";
import { INTEGRATION_MATCH, SKILL_DEFAULTS, type SkillId } from "@/lib/skills";
import { Badge, PageTitle, Empty } from "./workspaces";

/* ------------------------------------------------------------------ */
/* Preferences                                                         */
/* ------------------------------------------------------------------ */

export type MagicKey = "echo" | "beacon" | "tab" | "desktop";
type AssistantPrefs = {
  magic: Record<MagicKey, boolean>;
  skills: Record<string, boolean>;
  meeting: { autoNotes: boolean; template: string; language: string };
};

const MAGIC_DEFAULTS: Record<MagicKey, boolean> = {
  echo: true,
  beacon: false,
  tab: false,
  desktop: true,
};

type PrefPatch = {
  magic?: Partial<AssistantPrefs["magic"]>;
  skills?: Record<string, boolean>;
  meeting?: Partial<AssistantPrefs["meeting"]>;
};
type Section = keyof PrefPatch;

/*
 * Unsaved and signed-out preference values, shared by every component that
 * reads preferences so a toggle made on one screen applies everywhere.
 */
let pending: PrefPatch = {};
let pendingVersion = 0;
const pendingListeners = new Set<() => void>();
function setPending(next: PrefPatch) {
  pending = next;
  pendingVersion++;
  pendingListeners.forEach((l) => l());
}
function subscribePending(listener: () => void) {
  pendingListeners.add(listener);
  return () => pendingListeners.delete(listener);
}

// Signed-out toggles survive reloads in this tab and are saved once the user signs in.
const PENDING_KEY = "ia-pending-prefs";
function readStoredPending(): PrefPatch | null {
  try {
    const raw = typeof sessionStorage === "undefined" ? null : sessionStorage.getItem(PENDING_KEY);
    const data = raw ? JSON.parse(raw) : null;
    return data && typeof data === "object" ? (data as PrefPatch) : null;
  } catch {
    return null;
  }
}
function writeStoredPending(value: PrefPatch | null) {
  try {
    if (value) sessionStorage.setItem(PENDING_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(PENDING_KEY);
  } catch {}
}
const mergePatch = (a: PrefPatch, b: PrefPatch): PrefPatch => ({
  magic: { ...a.magic, ...b.magic },
  skills: { ...a.skills, ...b.skills },
  meeting: { ...a.meeting, ...b.meeting },
});
// Read on module init; applied after mount so server and client render alike.
const storedAtInit = readStoredPending();
let storedApplied = false;
let storedFlushing = false;

/** Removes patched keys from `pending` if they still hold the patched value. */
function settle(patch: PrefPatch, restore?: PrefPatch) {
  const next: PrefPatch = { ...pending };
  for (const section of Object.keys(patch) as Section[]) {
    const values = { ...(next[section] as Record<string, unknown> | undefined) };
    for (const [key, value] of Object.entries(patch[section] ?? {})) {
      if (values[key] !== value) continue; // a newer change is in flight
      const previous = (restore?.[section] as Record<string, unknown> | undefined)?.[key];
      if (previous === undefined) delete values[key];
      else values[key] = previous;
    }
    (next as Record<string, unknown>)[section] = values;
  }
  setPending(next);
}

/** Reads assistant preferences from the per-user settings record. */
export function useAssistantPrefs(ws: Workspace) {
  useSyncExternalStore(subscribePending, () => pendingVersion, () => 0);
  const record = ws.state.records.find((r) => r.kind === "settings");
  const stored = record?.data ?? {};
  const prefs: AssistantPrefs = {
    magic: { ...MAGIC_DEFAULTS, ...stored.magic, ...pending.magic },
    skills: { ...SKILL_DEFAULTS, ...stored.skills, ...pending.skills },
    meeting: {
      autoNotes: false,
      template: "Client meeting",
      language: "en-GB",
      ...stored.meeting,
      ...pending.meeting,
    },
  };
  const signedIn = !!ws.state.user;
  const { save } = ws;
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (storedApplied) return;
    storedApplied = true;
    if (storedAtInit) setPending(mergePatch(storedAtInit, pending));
  }, []);
  // Once signed in, save what was toggled while signed out, then forget it.
  useEffect(() => {
    if (!signedIn || storedFlushing) return;
    const saved = readStoredPending();
    if (!saved) return;
    storedFlushing = true;
    writeStoredPending(null);
    saveRef
      .current("settings", { ...saved, __merge: true })
      .then(() => settle(saved))
      .catch(() => writeStoredPending(saved))
      .finally(() => {
        storedFlushing = false;
      });
  }, [signedIn]);
  const update = useCallback(
    async (patch: PrefPatch, message?: string) => {
      const before: PrefPatch = {
        magic: { ...pending.magic },
        skills: { ...pending.skills },
        meeting: { ...pending.meeting },
      };
      setPending(mergePatch(pending, patch));
      if (!signedIn) {
        writeStoredPending(pending);
        if (message) toast.success(`${message} · Saved for now · it will be kept when you sign in`);
        return;
      }
      try {
        // The server merges this partial patch into the single settings record.
        await save("settings", { ...patch, __merge: true });
        settle(patch);
        if (message) toast.success(message);
      } catch {
        settle(patch, before); // put the switch back
      }
    },
    [signedIn, save],
  );
  return { prefs, update };
}

/** True when the user never set this skill (it follows the default). */
function skillUnset(ws: Workspace, id: SkillId) {
  const stored = ws.state.records.find((r) => r.kind === "settings")?.data?.skills;
  return stored?.[id] === undefined && pending.skills?.[id] === undefined;
}

/* ------------------------------------------------------------------ */
/* Agent skills                                                        */
/* ------------------------------------------------------------------ */

type Requirement = "none" | "gateway" | "webSearch" | "images" | "notion" | "mcp" | "integration";

type Skill = {
  id: SkillId;
  name: string;
  group: "Core" | "Advanced" | "Integrations";
  icon: typeof Bot;
  requires: Requirement;
  summary: string;
  abilities: string[];
  guardrail: string;
};

export const SKILLS: Skill[] = [
  {
    id: "memory",
    name: "RAG & long-term memory",
    group: "Core",
    icon: Brain,
    requires: "none",
    summary: "Retrieve approved organisational knowledge and remember recent turns of the conversation.",
    abilities: [
      "Searches knowledge you approved from answers",
      "Carries the last few turns into follow-up questions",
      "Cites every memory it uses",
    ],
    guardrail: "Only human-approved knowledge is treated as memory. Off = no memory and no conversation history.",
  },
  {
    id: "documents",
    name: "View & summarise documents",
    group: "Core",
    icon: FileText,
    requires: "none",
    summary: "Read documents you attach to a question and summarise or compare them.",
    abilities: [
      "PDF, Word, PowerPoint, Excel, CSV, Markdown and text",
      "Images and screen captures are read by the vision model",
      "Links each claim to the document",
    ],
    guardrail: "Attachments are only read when you add them to a question.",
  },
  {
    id: "claims",
    name: "Claim checking",
    group: "Core",
    icon: ShieldCheck,
    requires: "none",
    summary: "Offer a claim check on answers before they are shared.",
    abilities: ["Matches statements against the knowledge library", "Flags claims without supporting evidence"],
    guardrail: "Finds text overlap; it does not establish truth on its own.",
  },
  {
    id: "web",
    name: "Web search",
    group: "Core",
    icon: Globe,
    requires: "webSearch",
    summary: "Internal knowledge is always searched first. When it doesn’t fully answer a question, Internal AI searches the public web automatically to fill the gap.",
    abilities: [
      "Runs only when your internal sources don’t cover the question",
      "Web facts appear under “From the web” with their own citations",
      "Every web link is checked before it’s cited",
      "Only used when the scope is All knowledge",
    ],
    guardrail: "Your question is sent to the gateway’s search provider. Workspace documents are not searched on the web.",
  },
  {
    id: "scrape",
    name: "Read websites",
    group: "Core",
    icon: ScanSearch,
    requires: "gateway",
    summary: "Read public web pages you link, or pages the assistant decides to open, and cite them.",
    abilities: ["Paste a link in your question to read it", "Extracts readable text and cites the page", "Treats page content as untrusted data"],
    guardrail: "Public http(s) pages only. Private and internal network addresses are blocked.",
  },
  {
    id: "data",
    name: "Data analysis",
    group: "Advanced",
    icon: Database,
    requires: "gateway",
    summary: "Answer questions from CSV files you upload — filters, totals, averages and rankings.",
    abilities: ["Groups, filters, sorts and aggregates", "Shows the resulting table", "Cites the file it used"],
    guardrail: "Queries run as structured, read-only operations on your uploads. Nothing is executed as code.",
  },
  {
    id: "create-docs",
    name: "Document creation",
    group: "Advanced",
    icon: FilePlus,
    requires: "none",
    summary: "Turn any answer into a formatted Word document with headings, lists and tables.",
    abilities: ["One click from an answer: Word document", "Saved to your uploads for reuse", "Keeps citations as references"],
    guardrail: "Documents are drafts for you to review before sharing.",
  },
  {
    id: "charts",
    name: "Generate charts",
    group: "Advanced",
    icon: ChartColumn,
    requires: "gateway",
    summary: "Chart figures found in your knowledge and data directly in the answer.",
    abilities: ["Bar, line and pie charts", "Only charts figures present in the evidence"],
    guardrail: "Charts are generated from cited numbers, never invented ones.",
  },
  {
    id: "images",
    name: "Generate images",
    group: "Advanced",
    icon: ImageIcon,
    requires: "images",
    summary: "Create illustrative images for decks and proposals.",
    abilities: ["Concept visuals and diagram sketches", "Saved to your uploads"],
    guardrail: "Uses your gateway’s image model; generated images are labelled as AI-generated.",
  },
  {
    id: "jobs",
    name: "Scheduled jobs",
    group: "Advanced",
    icon: Timer,
    requires: "gateway",
    summary: "Run a saved question on a schedule and keep every result.",
    abilities: ["Daily, weekday or weekly runs", "Run now on demand", "Results keep their sources"],
    guardrail: "Jobs run while Internal AI is open in a browser. Missed runs catch up the next time you open it.",
  },
  {
    id: "notion",
    name: "Notion",
    group: "Integrations",
    icon: StickyNote,
    requires: "notion",
    summary: "Search the Notion pages your account can access.",
    abilities: ["notion-search and notion-fetch (read-only)", "Cites live pages"],
    guardrail: "Nothing is written back to Notion.",
  },
  {
    id: "mcp",
    name: "Custom MCP tools",
    group: "Integrations",
    icon: Bot,
    requires: "mcp",
    summary: "Let the assistant call read-only tools from MCP servers you connected.",
    abilities: ["Uses tools you allowed in Settings → MCP servers", "Cites each tool result"],
    guardrail: "Only tools marked read-only and enabled are offered. Write tools are never called automatically.",
  },
  {
    id: "gmail",
    name: "Gmail",
    group: "Integrations",
    icon: Mail,
    requires: "integration",
    summary: "Find client threads and commitments in your mail through a Gmail MCP server.",
    abilities: ["Search threads", "Summarise conversations"],
    guardrail: "Read-only tools only. Add an MCP server whose name includes “Gmail”.",
  },
  {
    id: "calendar",
    name: "Google Calendar",
    group: "Integrations",
    icon: CalendarDays,
    requires: "integration",
    summary: "Prepare briefs for upcoming meetings from your calendar.",
    abilities: ["Read upcoming events", "Link attendees to Client 360"],
    guardrail: "Read-only tools only. Add an MCP server whose name includes “Calendar”.",
  },
  {
    id: "outlook",
    name: "Outlook",
    group: "Integrations",
    icon: Mail,
    requires: "integration",
    summary: "Search Outlook mail and calendar through a Microsoft 365 MCP server.",
    abilities: ["Search mail", "Read calendar"],
    guardrail: "Read-only tools only. Add an MCP server whose name includes “Outlook” or “Microsoft”.",
  },
];

type Caps = { chat: boolean; vision: boolean; webSearch: boolean; images: boolean };

/** Live capability and connection status for the Agent skills page. */
export function useSkillContext(ws: Workspace) {
  const [caps, setCaps] = useState<Caps | null>(null);
  const [notion, setNotion] = useState(false);
  const signedIn = !!ws.state.user;
  useEffect(() => {
    if (!signedIn) return;
    fetch("/api/capabilities")
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => setCaps(c as Caps | null))
      .catch(() => {});
    fetch("/api/notion")
      .then((r) => (r.ok ? r.json() : null))
      .then((n: any) => setNotion(!!n?.connected))
      .catch(() => {});
  }, [signedIn]);
  const servers = ws.state.records.filter((r) => r.kind === "mcp");
  const csvCount = ws.state.documents.filter((d) => /csv/i.test(d.mime) || /\.csv$/i.test(d.title)).length;
  return { caps, notion, servers, csvCount, signedIn, ai: ws.state.aiConfigured };
}

type SkillContext = ReturnType<typeof useSkillContext>;

function serversFor(skill: Skill, ctx: SkillContext) {
  const connected = ctx.servers.filter(
    (s) =>
      s.data.enabled &&
      s.data.status === "Connected" &&
      (s.data.tools ?? []).some((t: any) => t.enabled && t.access === "Read"),
  );
  const match = INTEGRATION_MATCH[skill.id];
  if (match) return connected.filter((s) => match.test(`${s.data.title} ${s.data.url}`));
  return connected.filter(
    (s) => !Object.values(INTEGRATION_MATCH).some((re) => re!.test(`${s.data.title} ${s.data.url}`)),
  );
}

/** Returns [label, tone, ready] for a skill. */
export function skillStatus(skill: Skill, ctx: SkillContext): [string, string, boolean] {
  if (!ctx.signedIn && skill.requires !== "none") return ["Sign in to use", "neutral", false];
  const noGateway: [string, string, boolean] = ["Needs AI gateway", "amber", false];
  switch (skill.requires) {
    case "none":
      return ["Live", "green", true];
    case "gateway":
      if (!ctx.ai) return noGateway;
      if (skill.id === "data" && !ctx.csvCount) return ["Live · upload a CSV", "green", true];
      return ["Live", "green", true];
    case "webSearch":
      if (!ctx.ai) return noGateway;
      if (!ctx.caps) return ["Checking…", "neutral", false];
      return ctx.caps.webSearch ? ["Live", "green", true] : ["Gateway has no web search", "amber", false];
    case "images":
      if (!ctx.ai) return noGateway;
      if (!ctx.caps) return ["Checking…", "neutral", false];
      return ctx.caps.images ? ["Live", "green", true] : ["Blocked by gateway key", "amber", false];
    case "notion":
      return ctx.notion ? ["Connected", "green", true] : ["Connect Notion", "amber", false];
    case "mcp":
    case "integration":
      if (!ctx.ai) return noGateway;
      return serversFor(skill, ctx).length
        ? [`Live · ${serversFor(skill, ctx).length} server${serversFor(skill, ctx).length > 1 ? "s" : ""}`, "green", true]
        : ["Needs MCP server", "amber", false];
  }
}

const reducedMotion = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function AgentSkills({
  ws,
  setView,
  ask,
}: {
  ws: Workspace;
  setView: (v: string) => void;
  /** Returns false when the question couldn't start (e.g. an answer is streaming). */
  ask: (q: string) => boolean;
}) {
  const { prefs, update } = useAssistantPrefs(ws);
  const ctx = useSkillContext(ws);
  const [selected, setSelected] = useState<SkillId>("memory");
  const detail = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const skill = SKILLS.find((s) => s.id === selected) ?? SKILLS[0];
  const [label, tone, ready] = skillStatus(skill, ctx);
  const groups = [
    ["Core", "Core skills"],
    ["Advanced", "Advanced skills"],
    ["Integrations", "App integrations"],
  ] as const;
  const active = SKILLS.filter((s) => prefs.skills[s.id] && skillStatus(s, ctx)[2]).length;
  function choose(id: SkillId) {
    setSelected(id);
    // In the single-column layout the detail sits below the list; bring it into view.
    if (!window.matchMedia?.("(max-width: 1040px)").matches) return;
    requestAnimationFrame(() => {
      detail.current?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
      headingRef.current?.focus({ preventScroll: true });
    });
  }
  const tryIt =
    ready &&
    prefs.skills[skill.id] &&
    TRY[skill.id] &&
    (skill.id !== "data" || ctx.csvCount > 0)
      ? TRY[skill.id]!
      : "";
  return (
    <>
      <PageTitle
        eyebrow="AGENT SKILLS"
        title="Agent skills"
        description="Choose what Internal AI may do when it answers. Every switch is enforced on the server."
      >
        <Badge tone="blue">{active} active</Badge>
      </PageTitle>
      <div className="skills-layout">
        <div className="skills-list">
          {groups.map(([group, heading]) => (
            <section key={group} aria-label={heading}>
              <h2 className="skills-group-label">{heading}</h2>
              <div className="skills-card">
                {SKILLS.filter((s) => s.group === group).map((s) => {
                  const on = !!prefs.skills[s.id];
                  const [, , ok] = skillStatus(s, ctx);
                  return (
                    <button
                      key={s.id}
                      className="skill-row"
                      aria-current={selected === s.id ? "true" : undefined}
                      onClick={() => choose(s.id)}
                    >
                      <s.icon size={17} />
                      <span className="skill-name">{s.name}</span>
                      <span className={`skill-state${on && ok ? " on" : ""}${on && !ok ? " pending" : ""}`}>
                        {on ? (ok ? "On" : "Setup") : "Off"}
                      </span>
                      <ChevronRight size={15} />
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
        <aside className="skill-detail panel" aria-live="polite" ref={detail}>
          <div className="skill-detail-head">
            <span className="skill-detail-icon">
              <skill.icon size={22} />
            </span>
            <div>
              <h2 ref={headingRef} tabIndex={-1}>
                {skill.name}
              </h2>
              <Badge tone={tone}>{label}</Badge>
            </div>
            <Switch
              aria-label={`Enable ${skill.name}`}
              checked={!!prefs.skills[skill.id]}
              onCheckedChange={(v) =>
                void update({ skills: { [skill.id]: v } }, `${skill.name} ${v ? "enabled" : "disabled"}`)
              }
            />
          </div>
          <p>{skill.summary}</p>
          {skill.id === "web" && !prefs.skills.web && skillUnset(ws, "web") && (
            <p className="muted-note skill-hint">
              When internal knowledge falls short, your question is sent to your gateway’s web search.
            </p>
          )}
          <h3>What it can do</h3>
          <ul className="skill-abilities">
            {skill.abilities.map((a) => (
              <li key={a}>
                <Sparkles size={14} />
                {a}
              </li>
            ))}
          </ul>
          <div className="notice">
            <Lock size={16} />
            {skill.guardrail}
          </div>
          {skill.id === "jobs" && ctx.signedIn && (
            <JobsManager
              ws={ws}
              paused={
                !prefs.skills.jobs
                  ? "Scheduled jobs are paused while the skill is off."
                  : !ready
                    ? "Scheduled jobs are paused until an AI gateway is configured."
                    : ""
              }
            />
          )}
          {(skill.requires === "mcp" || skill.requires === "integration") && (
            <div className="skill-servers">
              {serversFor(skill, ctx).map((s) => (
                <div key={s.id} className="skill-server">
                  <Bot size={15} />
                  <span>
                    <strong>{s.data.title}</strong>
                    <small>
                      {(s.data.tools ?? []).filter((t: any) => t.enabled && t.access === "Read").length} read tools allowed
                    </small>
                  </span>
                </div>
              ))}
              <button className="secondary-button" onClick={() => setView("Settings")}>
                {serversFor(skill, ctx).length ? "Manage MCP servers" : "Connect an MCP server"}
                <ArrowRight size={14} />
              </button>
            </div>
          )}
          {skill.id === "notion" && (
            <button className="secondary-button" onClick={() => setView("Settings")}>
              {ctx.notion ? "Manage Notion connection" : "Connect Notion"} <ArrowRight size={14} />
            </button>
          )}
          {skill.id === "data" && ctx.csvCount === 0 && ctx.signedIn && (
            <p className="muted-note">Upload a CSV in Knowledge, then ask a question about it.</p>
          )}
          {tryIt && (
            <button className="text-link" onClick={() => ask(tryIt)}>
              Try it: “{tryIt}” <ArrowUpRight size={14} />
            </button>
          )}
        </aside>
      </div>
    </>
  );
}

const TRY: Partial<Record<SkillId, string>> = {
  memory: "What decisions have we approved for Northstar Bank?",
  web: "What are the latest EU AI Act obligations for banks?",
  scrape: "Summarise https://en.wikipedia.org/wiki/Retrieval-augmented_generation",
  data: "Which rows in my CSV have the highest values? Show a chart.",
  charts: "Compare the three Northstar pricing options as a chart",
  images: "Create a concept image for a banking AI transformation proposal",
};

/* ------------------------------------------------------------------ */
/* Scheduled jobs                                                      */
/* ------------------------------------------------------------------ */

const CADENCES = [
  ["daily", "Every day"],
  ["weekdays", "Weekdays"],
  ["weekly", "Weekly"],
] as const;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const MAX_JOBS = 25;

type JobForm = { title: string; prompt: string; cadence: string; time: string; weekday: number };
type JobErrors = Partial<Record<"title" | "prompt", string>>;

function validateJob(form: JobForm): JobErrors {
  const errors: JobErrors = {};
  if (!form.title.trim()) errors.title = "Give the job a name.";
  if (!form.prompt.trim()) errors.prompt = "Enter the question to run.";
  else if (form.prompt.trim().length < 3) errors.prompt = "The question needs at least 3 characters.";
  return errors;
}

const zoneFields = () => ({
  tzOffset: new Date().getTimezoneOffset(),
  // The named zone keeps the job at the same local time across DST.
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
});

/** Name, question and schedule fields shared by the create and edit forms. */
function JobFields({
  idPrefix,
  form,
  errors,
  onChange,
  children,
}: {
  idPrefix: string;
  form: JobForm;
  errors: JobErrors;
  onChange: (next: JobForm) => void;
  children?: React.ReactNode;
}) {
  return (
    <>
      <label className="field-label">
        Name
        <input
          maxLength={120}
          value={form.title}
          aria-invalid={!!errors.title}
          aria-describedby={errors.title ? `${idPrefix}-title-error` : undefined}
          onChange={(e) => onChange({ ...form, title: e.target.value })}
          placeholder="Morning client brief"
        />
        {errors.title && (
          <small className="field-error" id={`${idPrefix}-title-error`}>
            {errors.title}
          </small>
        )}
      </label>
      <label className="field-label">
        Question
        <textarea
          maxLength={4000}
          value={form.prompt}
          aria-invalid={!!errors.prompt}
          aria-describedby={errors.prompt ? `${idPrefix}-prompt-error` : undefined}
          onChange={(e) => onChange({ ...form, prompt: e.target.value })}
          placeholder="What changed for Northstar Bank since yesterday, and what should I do today?"
        />
        {errors.prompt && (
          <small className="field-error" id={`${idPrefix}-prompt-error`}>
            {errors.prompt}
          </small>
        )}
      </label>
      <div className="job-schedule">
        <Select value={form.cadence} onValueChange={(v) => onChange({ ...form, cadence: v })}>
          <SelectTrigger aria-label="Repeat">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CADENCES.map(([v, l]) => (
              <SelectItem key={v} value={v}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {form.cadence === "weekly" && (
          <Select value={String(form.weekday)} onValueChange={(v) => onChange({ ...form, weekday: Number(v) })}>
            <SelectTrigger aria-label="Day">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WEEKDAYS.map((d, i) => (
                <SelectItem key={d} value={String(i)}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <input
          type="time"
          aria-label="Time"
          required
          value={form.time}
          onChange={(e) => onChange({ ...form, time: e.target.value })}
        />
        {children}
      </div>
    </>
  );
}

function JobsManager({ ws, paused }: { ws: Workspace; /** Why jobs can't run now, or "". */ paused: string }) {
  const jobs = ws.state.records.filter((r) => r.kind === "job");
  const runs = ws.state.records.filter((r) => r.kind === "job-run");
  const [form, setForm] = useState<JobForm>({
    title: "",
    prompt: "",
    cadence: "weekdays",
    time: "08:30",
    weekday: 1,
  });
  const [errors, setErrors] = useState<JobErrors>({});
  const [editing, setEditing] = useState<{ id: string; form: JobForm; errors: JobErrors } | null>(null);
  const [busy, setBusy] = useState<Set<string>>(() => new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [showAll, setShowAll] = useState<Set<string>>(() => new Set());
  const full = jobs.length >= MAX_JOBS;
  const mark = (key: string, on: boolean) =>
    setBusy((b) => {
      const next = new Set(b);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  async function call(key: string, body: Record<string, unknown>, done?: string) {
    mark(key, true);
    try {
      const r = await api("/api/jobs", body);
      await ws.refresh();
      if (done) toast.success(done);
      return r ?? {};
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      mark(key, false);
    }
  }
  async function runNow(id: string) {
    const r: any = await call(id, { op: "run", id });
    if (!r) return;
    const status = typeof r.status === "string" ? r.status : "";
    if (r.ok === false || status.startsWith("Failed"))
      toast.error(status ? `Job run failed · ${status.replace(/^Failed:?\s*/, "") || "no reason given"}` : "Job run failed.");
    else toast.success("Job finished — result saved below");
  }
  async function saveEdit() {
    if (!editing) return;
    const errs = validateJob(editing.form);
    if (Object.keys(errs).length) {
      setEditing({ ...editing, errors: errs });
      return;
    }
    const { id, form: f } = editing;
    const r = await call(
      id,
      { op: "update", id, ...f, title: f.title.trim(), prompt: f.prompt.trim(), ...zoneFields() },
      "Job updated",
    );
    if (r) setEditing(null);
  }
  return (
    <div className="jobs">
      <h3>Your scheduled jobs</h3>
      {paused && (
        <div className="notice jobs-paused" role="status">
          <Pause size={16} /> {paused}
        </div>
      )}
      {jobs.length ? (
        jobs.map((j) => {
          const latest = runs
            .filter((r) => r.data.jobId === j.id)
            .sort((a, b) => String(b.data.at ?? "").localeCompare(String(a.data.at ?? "")));
          const isBusy = busy.has(j.id);
          const all = showAll.has(j.id);
          if (editing?.id === j.id)
            return (
              <form
                className="job job-form job-edit"
                key={j.id}
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveEdit();
                }}
              >
                <strong className="job-edit-title">Edit “{j.data.title}”</strong>
                <JobFields
                  idPrefix={`job-${j.id}`}
                  form={editing.form}
                  errors={editing.errors}
                  onChange={(next) => setEditing({ ...editing, form: next, errors: {} })}
                />
                <div className="button-row">
                  <button className="primary-button" type="submit" disabled={isBusy}>
                    {isBusy ? <LoaderCircle size={14} className="spin" /> : null} Save changes
                  </button>
                  <button className="quiet-button" type="button" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </div>
              </form>
            );
          return (
            <div className="job" key={j.id} aria-busy={isBusy || undefined}>
              <div className="job-head">
                <div>
                  <strong>{j.data.title}</strong>
                  <small>
                    {CADENCES.find((c) => c[0] === j.data.cadence)?.[1]}
                    {j.data.cadence === "weekly" ? ` · ${WEEKDAYS[j.data.weekday]}` : ""} at {j.data.time} ·{" "}
                    {j.data.enabled && !paused
                      ? `next ${new Date(j.data.nextRun).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}`
                      : "Paused"}
                  </small>
                  {j.data.lastStatus && (
                    <small className={String(j.data.lastStatus).startsWith("Failed") ? "job-failed" : ""}>
                      Last run {new Date(j.data.lastRun).toLocaleString()} · {j.data.lastStatus}
                    </small>
                  )}
                </div>
                <Switch
                  aria-label={`Enable ${j.data.title}`}
                  checked={!!j.data.enabled}
                  disabled={isBusy}
                  onCheckedChange={(enabled) =>
                    void call(j.id, { op: "update", id: j.id, enabled }, enabled ? "Job resumed" : "Job paused")
                  }
                />
              </div>
              <p className="job-prompt">{j.data.prompt}</p>
              <div className="button-row">
                <button
                  className="secondary-button"
                  disabled={isBusy || !!paused}
                  title={paused || undefined}
                  onClick={() => void runNow(j.id)}
                >
                  {isBusy ? <LoaderCircle size={14} className="spin" /> : <Play size={14} />} Run now
                </button>
                {latest.length > 0 && (
                  <button
                    className="secondary-button"
                    aria-expanded={open === j.id}
                    onClick={() => setOpen(open === j.id ? null : j.id)}
                  >
                    {open === j.id ? "Hide results" : `Results (${latest.length})`}
                  </button>
                )}
                <button
                  className="quiet-button"
                  disabled={isBusy}
                  onClick={() =>
                    setEditing({
                      id: j.id,
                      errors: {},
                      form: {
                        title: j.data.title ?? "",
                        prompt: j.data.prompt ?? "",
                        cadence: j.data.cadence ?? "weekdays",
                        time: j.data.time ?? "08:30",
                        weekday: Number(j.data.weekday ?? 1),
                      },
                    })
                  }
                >
                  <Pencil size={13} /> Edit
                </button>
                <button
                  className="quiet-button"
                  disabled={isBusy}
                  onClick={() => void call(j.id, { op: "delete", id: j.id }, "Job deleted")}
                >
                  Delete
                </button>
              </div>
              {open === j.id && (
                <>
                  {(all ? latest : latest.slice(0, 5)).map((r) => (
                    <details className="job-run" key={r.id}>
                      <summary>
                        {new Date(r.data.at).toLocaleString()} <span>{r.data.mode}</span>
                      </summary>
                      <pre>{r.data.text}</pre>
                    </details>
                  ))}
                  {latest.length > 5 && (
                    <button
                      className="text-link job-more"
                      onClick={() =>
                        setShowAll((set) => {
                          const next = new Set(set);
                          if (all) next.delete(j.id);
                          else next.add(j.id);
                          return next;
                        })
                      }
                    >
                      {all ? "Show latest 5" : `Show all (${latest.length})`}
                    </button>
                  )}
                </>
              )}
            </div>
          );
        })
      ) : (
        <p className="muted-note">No jobs yet. Schedule a question below.</p>
      )}
      <form
        className="job-form"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          if (full || paused) return;
          const errs = validateJob(form);
          setErrors(errs);
          if (Object.keys(errs).length) return;
          const r = await call(
            "create",
            { op: "create", ...form, title: form.title.trim(), prompt: form.prompt.trim(), ...zoneFields() },
            "Job scheduled",
          );
          if (r) setForm((f) => ({ ...f, title: "", prompt: "" }));
        }}
      >
        <p className="job-count" aria-live="polite">
          {jobs.length} of {MAX_JOBS} jobs
          {full && " · Delete a job to schedule another."}
        </p>
        <JobFields
          idPrefix="job-new"
          form={form}
          errors={errors}
          onChange={(next) => {
            setForm(next);
            if (Object.keys(errors).length) setErrors({});
          }}
        >
          <button
            className="primary-button"
            disabled={busy.has("create") || full || !!paused}
            title={full ? `You can keep up to ${MAX_JOBS} jobs.` : paused || undefined}
            type="submit"
          >
            <Plus size={15} /> Schedule
          </button>
        </JobFields>
      </form>
    </div>
  );
}

/** Runs due scheduled jobs while the workspace is open. */
export function useJobScheduler(ws: Workspace, enabled: boolean) {
  const signedIn = !!ws.state.user;
  const hasJobs = ws.state.records.some((r) => r.kind === "job" && r.data.enabled);
  const refresh = ws.refresh;
  useEffect(() => {
    if (!signedIn || !enabled || !hasJobs) return;
    let stopped = false;
    const tick = async () => {
      try {
        const r: any = await api("/api/jobs", { op: "run-due" });
        if (!stopped && r.ran?.length) {
          await refresh();
          toast.success(`${r.ran.length} scheduled job${r.ran.length > 1 ? "s" : ""} ran · see Agent skills`);
        }
      } catch {
        /* Scheduler retries on the next tick. */
      }
    };
    void tick();
    const t = window.setInterval(tick, 5 * 60 * 1000);
    return () => {
      stopped = true;
      window.clearInterval(t);
    };
  }, [signedIn, enabled, hasJobs, refresh]);
}

/* ------------------------------------------------------------------ */
/* Speech recognition (Echo + Meeting assistant)                       */
/* ------------------------------------------------------------------ */

type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: (() => void) | null;
};

function recognitionCtor(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as any;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/*
 * One microphone owner at a time. A live meeting recording can't be
 * interrupted by dictation; a new dictation replaces an older one.
 */
type MicKind = "meeting" | "dictation";
let micOwner: { token: object; kind: MicKind; stop: () => void } | null = null;
const micListeners = new Set<() => void>();
function setMicOwner(next: typeof micOwner) {
  micOwner = next;
  micListeners.forEach((l) => l());
}
function subscribeMic(listener: () => void) {
  micListeners.add(listener);
  return () => micListeners.delete(listener);
}

/** True while the meeting assistant is recording. */
export function useMicBusy() {
  return useSyncExternalStore(subscribeMic, () => micOwner?.kind === "meeting", () => false);
}

/**
 * Wraps the browser speech API. `onFinal` receives each finished phrase;
 * `interim` holds the phrase still being spoken.
 */
export function useSpeech(onFinal: (text: string) => void, lang = "en-GB", owner: MicKind = "dictation") {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const rec = useRef<Recognition | null>(null);
  const wanted = useRef(false);
  const final = useRef(onFinal);
  final.current = onFinal;
  const token = useRef({}).current;
  useEffect(() => setSupported(!!recognitionCtor()), []);
  const retire = (r: Recognition | null) => {
    if (!r) return;
    r.onresult = r.onerror = r.onend = null;
    r.abort();
  };
  const release = () => {
    if (micOwner?.token === token) setMicOwner(null);
  };
  const stop = useCallback(() => {
    wanted.current = false;
    retire(rec.current);
    rec.current = null;
    setListening(false);
    setInterim("");
    release();
  }, []);
  /** Returns false when recognition couldn't start. */
  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) {
      toast.error("Voice input isn’t supported in this browser. Try Chrome or Safari.");
      return false;
    }
    if (micOwner && micOwner.token !== token) {
      if (micOwner.kind === "meeting" && owner === "dictation") {
        toast.error("Pause the meeting recording before dictating.");
        return false;
      }
      micOwner.stop();
    }
    // Never leave an earlier recogniser running (e.g. Pause then Resume quickly).
    retire(rec.current);
    const r = new Ctor();
    r.continuous = true;
    r.interimResults = true;
    r.lang = lang;
    r.onresult = (e) => {
      let pending = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = e.results[i][0].transcript;
        if (e.results[i].isFinal) final.current(text.trim());
        else pending += text;
      }
      setInterim(pending);
    };
    r.onerror = (e) => {
      // Silence and our own aborts are routine; anything else is permanent,
      // so stop instead of restarting into the same error forever.
      if (e.error === "no-speech" || e.error === "aborted") return;
      wanted.current = false;
      toast.error(
        e.error === "not-allowed" || e.error === "service-not-allowed"
          ? "Microphone access was blocked. Allow it in your browser to use voice."
          : e.error === "audio-capture"
            ? "No microphone was found."
            : e.error === "language-not-supported"
              ? "This browser can’t transcribe the selected language."
              : e.error === "network"
                ? "Voice input needs a network connection."
                : "Voice input stopped unexpectedly.",
      );
    };
    // Browsers end recognition after silence; restart while the user still wants it.
    r.onend = () => {
      if (rec.current !== r) return;
      if (wanted.current) {
        try {
          r.start();
          return;
        } catch {}
      }
      rec.current = null;
      setListening(false);
      setInterim("");
      release();
    };
    rec.current = r;
    wanted.current = true;
    try {
      r.start();
      setListening(true);
      setMicOwner({ token, kind: owner, stop });
      return true;
    } catch {
      rec.current = null;
      wanted.current = false;
      release();
      toast.error("Voice input couldn’t start. Please retry.");
      return false;
    }
  }, [lang, owner, stop]);
  useEffect(
    () => () => {
      wanted.current = false;
      retire(rec.current);
      release();
    },
    [],
  );
  return { supported, listening, interim, start, stop };
}

/** Echo: dictation button for any text field. */
export function DictateButton({
  onText,
  className = "icon-button",
  lang,
}: {
  onText: (text: string) => void;
  className?: string;
  lang?: string;
}) {
  const speech = useSpeech(onText, lang, "dictation");
  const meetingLive = useMicBusy();
  if (!speech.supported) return null;
  const blocked = meetingLive && !speech.listening;
  return (
    <span className="echo-wrap">
      <button
        type="button"
        className={`${className}${speech.listening ? " dictating" : ""}`}
        aria-label={speech.listening ? "Stop dictation" : "Dictate with Echo"}
        aria-pressed={speech.listening}
        disabled={blocked}
        title={
          blocked ? "Pause the meeting recording to dictate" : speech.listening ? "Stop dictation" : "Dictate (Echo)"
        }
        onClick={() => (speech.listening ? speech.stop() : speech.start())}
      >
        {speech.listening ? <AudioLines size={18} /> : <Mic size={18} />}
      </button>
      {speech.listening && <EchoCaption interim={speech.interim} />}
    </span>
  );
}

/** Live words while Echo is listening, so speech is visible before it's final. */
function EchoCaption({ interim, style }: { interim: string; style?: React.CSSProperties }) {
  return (
    <span className="echo-caption" role="status" aria-live="polite" style={style}>
      <i aria-hidden />
      {interim ? <em>{interim.trim().slice(-120)}</em> : "Listening… click the mic to stop"}
    </span>
  );
}

/** Text inputs Echo can dictate into. Passwords, emails, numbers and dates are left alone. */
function echoField(el: Element | null): HTMLTextAreaElement | HTMLInputElement | null {
  if (!el || !(el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement)) return null;
  if (el instanceof HTMLInputElement && !["text", "search", ""].includes(el.type)) return null;
  if (el.disabled || el.readOnly) return null;
  // These fields already have their own Echo button, or aren't prose.
  if (el.closest(".composer, .qa-composer, .beacon, [data-echo='off'], [role='combobox']")) return null;
  return el;
}

/** Inserts dictated text at the caret so React's onChange and the undo stack both see it. */
function insertAtCaret(el: HTMLTextAreaElement | HTMLInputElement, text: string) {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  const before = el.value.slice(0, start);
  const after = el.value.slice(end);
  const spaced = (before && !/\s$/.test(before) ? " " : "") + text + (after && !/^\s/.test(after) ? " " : "");
  const room = el.maxLength > 0 ? el.maxLength - (el.value.length - (end - start)) : Infinity;
  const insert = spaced.slice(0, Math.max(0, room));
  if (!insert) {
    toast.error("This field is full.");
    return;
  }
  if (document.activeElement !== el) el.focus({ preventScroll: true });
  if (document.execCommand?.("insertText", false, insert)) return;
  // Fallback: set the value the way React expects, then announce the change.
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, el.value.slice(0, start) + insert + el.value.slice(end));
  el.setSelectionRange(start + insert.length, start + insert.length);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

const ECHO_SIZE = 30;

/**
 * Echo everywhere: a small mic appears in whichever text field has focus,
 * so any note, description or outcome can be dictated.
 */
export function EchoAnywhere({ enabled, lang }: { enabled: boolean; lang?: string }) {
  const [field, setField] = useState<HTMLTextAreaElement | HTMLInputElement | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const fieldRef = useRef(field);
  fieldRef.current = field;
  const button = useRef<HTMLButtonElement>(null);
  const speech = useSpeech(
    (text) => {
      const el = fieldRef.current;
      if (el?.isConnected && text) insertAtCaret(el, text);
    },
    lang,
    "dictation",
  );
  const listening = speech.listening;
  const stopRef = useRef(speech.stop);
  stopRef.current = speech.stop;
  const toggle = () => (listening ? speech.stop() : speech.start());
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;
  const meetingLive = useMicBusy();
  // Follow focus into supported fields.
  useEffect(() => {
    if (!enabled || !speech.supported) {
      setField(null);
      return;
    }
    const onFocusIn = (e: FocusEvent) => {
      if (button.current?.contains(e.target as Node)) return;
      const next = echoField(e.target as Element);
      if (next !== fieldRef.current) stopRef.current();
      setField(next);
    };
    const onFocusOut = () => {
      // Moving to the mic itself keeps the field; anywhere else closes it.
      window.setTimeout(() => {
        const active = document.activeElement;
        if (button.current?.contains(active) || active === fieldRef.current) return;
        stopRef.current();
        setField(null);
      }, 0);
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    setField(echoField(document.activeElement));
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, [enabled, speech.supported]);
  // Keep the mic pinned to the field while the page scrolls or resizes.
  useEffect(() => {
    if (!field) {
      setRect(null);
      return;
    }
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!field.isConnected) {
          stopRef.current();
          setField(null);
          return;
        }
        setRect(field.getBoundingClientRect());
      });
    };
    setRect(field.getBoundingClientRect());
    const ro = new ResizeObserver(measure);
    ro.observe(field);
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [field]);
  // ⌥⌘D / Alt+Ctrl+D toggles dictation in the focused field.
  useEffect(() => {
    if (!field) return;
    const key = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "d" || !e.altKey || !(e.metaKey || e.ctrlKey) || e.shiftKey) return;
      e.preventDefault();
      toggleRef.current();
    };
    const el: HTMLElement = field;
    el.addEventListener("keydown", key);
    return () => el.removeEventListener("keydown", key);
  }, [field]);
  if (!field || !rect || rect.width < 120 || rect.height === 0) return null;
  const multiline = field instanceof HTMLTextAreaElement && rect.height > ECHO_SIZE * 1.6;
  const left = rect.right - ECHO_SIZE - 6;
  const top = multiline ? rect.bottom - ECHO_SIZE - 6 : rect.top + (rect.height - ECHO_SIZE) / 2;
  if (top < 0 || top > window.innerHeight) return null;
  const blocked = meetingLive && !listening;
  const shortcut = isMac() ? "⌥⌘D" : "Alt+Ctrl+D";
  return (
    <>
      <button
        ref={button}
        type="button"
        className={`echo-anywhere${listening ? " dictating" : ""}`}
        style={{ left, top }}
        aria-label={listening ? "Stop dictation" : "Dictate into this field with Echo"}
        aria-pressed={listening}
        aria-keyshortcuts={isMac() ? "Alt+Meta+D" : "Alt+Control+D"}
        disabled={blocked}
        title={blocked ? "Pause the meeting recording to dictate" : `${listening ? "Stop" : "Dictate"} (${shortcut})`}
        // Keep the caret in the field so dictated words land where you were typing.
        onPointerDown={(e) => e.preventDefault()}
        onClick={toggle}
      >
        {listening ? <AudioLines size={15} /> : <Mic size={15} />}
      </button>
      {listening && (
        <EchoCaption
          interim={speech.interim}
          style={{
            position: "fixed",
            right: Math.max(EDGE, window.innerWidth - rect.right),
            top: top > 64 ? top - 44 : top + ECHO_SIZE + 8,
          }}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Tab: inline autocomplete                                            */
/* ------------------------------------------------------------------ */

const PROMPT_STARTERS = [
  "Prepare me for the Northstar Bank meeting",
  "Prepare a brief for the Harbour Insurance renewal",
  "Summarise the latest decisions on the Northstar programme",
  "Summarise the document: ",
  "Who has GenAI experience in banking?",
  "Who should I talk to about claims automation?",
  "What are the open actions for Northstar Bank?",
  "What changed since the last steering committee?",
  "Find relevant banking use cases for the Northstar RFP",
  "Find evidence for our data privacy claims",
  "Build a proposal response strategy for the Northstar RFP",
  "Draft a follow-up email summarising the meeting",
  "Compare our pricing options for the Harbour Insurance bid",
  "Create meeting notes with decisions and action items",
];

export type Completions = {
  /** Whole prompts, most relevant first. */
  starters: string[];
  /** Document titles, completed after "Summarise the document: ". */
  documents: string[];
  /** Single words and names, shortest first. */
  vocabulary: string[];
};

const DOCUMENT_PREFIX = /(summari[sz]e|compare|explain) the document:\s*/i;

/**
 * Suggests the rest of the prompt: a document title after "the document:",
 * then a whole prompt, then the word being typed. Case-insensitive; the
 * suggestion only ever adds text after what was typed.
 */
export function suggestCompletion(prompt: string, { starters, documents, vocabulary }: Completions) {
  if (prompt.length < 3 || prompt.endsWith("\n")) return "";
  const doc = prompt.match(DOCUMENT_PREFIX);
  if (doc && doc.index !== undefined) {
    const typed = prompt.slice(doc.index + doc[0].length).toLowerCase();
    const title = documents.find((t) => t.toLowerCase().startsWith(typed) && t.length > typed.length);
    if (title) return title.slice(typed.length);
  }
  const lower = prompt.toLowerCase();
  const sentence = starters.find((s) => s.toLowerCase().startsWith(lower) && s.length > prompt.length);
  if (sentence) return sentence.slice(prompt.length);
  const word = prompt.match(/([A-Za-z][\w-]{2,})$/)?.[1];
  if (!word) return "";
  const match = vocabulary.find(
    (v) => v.toLowerCase().startsWith(word.toLowerCase()) && v.length > word.length,
  );
  return match ? match.slice(word.length) : "";
}

/** Everything Tab can suggest, built in the browser from this workspace. */
export function useCompletions(ws: Workspace): Completions {
  const records = ws.state.records;
  return useMemo(() => {
    // Your own recent single-line questions come first: they are what you ask.
    const asked = new Set<string>();
    for (const r of records) {
      if (r.kind !== "conversation") continue;
      const q = String(r.data.query ?? "").trim();
      if (q.length >= 12 && q.length <= 160 && !q.includes("\n")) asked.add(q);
      if (asked.size >= 30) break;
    }
    const perClient = ws.allClients.flatMap((c) => [
      `Prepare me for the ${c.name} meeting`,
      `What are the open actions for ${c.name}?`,
      `Summarise the latest decisions for ${c.name}`,
      `Draft a follow-up email to ${c.name}`,
      `What are the risks on the ${c.name} account?`,
    ]);
    const starters = [...new Set([...asked, ...PROMPT_STARTERS, ...perClient])];
    const documents = [...new Set(ws.allSources.map((s) => s.title).filter(Boolean))];
    const words = new Set<string>();
    for (const text of [...documents, ...ws.allClients.map((c) => c.name)])
      for (const w of text.split(/[^\w-]+/)) if (w.length > 4) words.add(w);
    ws.allClients.forEach((c) => words.add(c.name));
    return {
      starters,
      documents,
      vocabulary: [...words].sort((a, b) => a.length - b.length),
    };
  }, [records, ws.allSources, ws.allClients]);
}

/** True on touch-first devices, where there's no Tab key to accept a suggestion. */
export function isCoarsePointer() {
  return typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;
}

function subscribeCoarse(listener: () => void) {
  const mq = typeof window !== "undefined" ? window.matchMedia?.("(pointer: coarse)") : undefined;
  mq?.addEventListener?.("change", listener);
  return () => mq?.removeEventListener?.("change", listener);
}
function useCoarsePointer() {
  return useSyncExternalStore(subscribeCoarse, isCoarsePointer, () => false);
}

/** Tappable version of the Tab suggestion, for touch devices. */
export function SuggestionChip({
  suggestion,
  onAccept,
}: {
  suggestion: string;
  onAccept: () => void;
}) {
  const coarse = useCoarsePointer();
  if (!coarse || !suggestion.trim()) return null;
  return (
    <button
      type="button"
      className="suggestion-chip"
      aria-label={`Add suggestion: ${suggestion.trim()}`}
      // Keep focus (and the on-screen keyboard) in the text field.
      onPointerDown={(e) => e.preventDefault()}
      onClick={onAccept}
    >
      <em>…{suggestion.trim()}</em>
      <span aria-hidden>↵ Tap to add</span>
    </button>
  );
}

/** Renders a textarea's value plus greyed suggestion, aligned under the textarea. */
export function GhostText({
  target,
  value,
  suggestion,
}: {
  target: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  suggestion: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = target.current;
    const g = ref.current;
    if (!t || !g) return;
    const cs = getComputedStyle(t);
    for (const p of [
      "paddingTop",
      "paddingRight",
      "paddingBottom",
      "paddingLeft",
      "fontSize",
      "fontFamily",
      "fontWeight",
      "lineHeight",
      "letterSpacing",
    ] as const)
      g.style[p] = cs[p];
    g.scrollTop = t.scrollTop;
  });
  const coarse = useCoarsePointer();
  if (!suggestion || coarse) return null;
  return (
    <div className="ghost-text" ref={ref} aria-hidden>
      <span>{value}</span>
      <em>{suggestion}</em>
      <kbd>Tab</kbd>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Beacon: highlight to act                                            */
/* ------------------------------------------------------------------ */

const BEACON_ACTIONS = [
  ["Revise", "Revise this text so it is clear and concise"],
  ["Summarise", "Summarise this in three bullet points"],
  ["Explain", "Explain this in plain language"],
  ["Find evidence", "Find evidence in our knowledge for this"],
] as const;

const TRANSLATE_TO = ["English", "French", "German", "Spanish", "Hindi", "Tamil"] as const;

const BEACON_HEIGHT = 96;
const EDGE = 16;

export function Beacon({
  enabled,
  ask,
}: {
  enabled: boolean;
  /** Returns false when the request couldn't start (e.g. an answer is streaming). */
  ask: (q: string) => boolean;
}) {
  const [target, setTarget] = useState<{ text: string; x: number; y: number; focus: boolean } | null>(
    null,
  );
  const [value, setValue] = useState("");
  const [translating, setTranslating] = useState(false);
  const pill = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const shown = useRef("");
  const open = !!target;
  useEffect(() => {
    if (!enabled) {
      setTarget(null);
      return;
    }
    // How the latest selection was made decides whether to steal focus.
    let source: "mouse" | "touch" | "pen" | "keyboard" = "mouse";
    let pillPress = 0;
    let viewportChanged = 0;
    let debounce = 0;
    let lastHeight = window.visualViewport?.height ?? window.innerHeight;
    const read = () => {
      const sel = window.getSelection();
      if (pill.current?.contains(document.activeElement) && sel?.isCollapsed !== false) return;
      const text = sel?.toString().trim() ?? "";
      const node = sel?.anchorNode?.parentElement;
      if (node && pill.current?.contains(node)) return;
      if (
        !sel ||
        sel.isCollapsed ||
        text.length < 3 ||
        !node?.closest(".app-main, .source-sheet") ||
        node.closest("textarea, input, [contenteditable], .composer")
      ) {
        setTarget(null);
        return;
      }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.visualViewport?.height ?? window.innerHeight;
      const width = Math.min(460, vw - EDGE * 2);
      const above = rect.top - BEACON_HEIGHT - 8;
      const y = above >= EDGE ? above : rect.bottom + 12;
      const next = {
        text: text.slice(0, 6000),
        x: Math.max(EDGE, Math.min(rect.left + rect.width / 2 - width / 2, vw - width - EDGE)),
        y: Math.max(EDGE, Math.min(y, vh - BEACON_HEIGHT - EDGE)),
        focus: source === "mouse" && !isCoarsePointer(),
      };
      if (shown.current !== next.text) {
        setValue("");
        setTranslating(false);
      }
      shown.current = next.text;
      setTarget(next);
    };
    const onPointerDown = (e: PointerEvent) => {
      source = (e.pointerType as typeof source) || "mouse";
      if (pill.current?.contains(e.target as Node)) pillPress = Date.now();
    };
    const onMouseUp = (e: MouseEvent) => {
      if (pill.current?.contains(e.target as Node)) return;
      source = "mouse";
      window.setTimeout(read, 10);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (pill.current?.contains(e.target as Node)) return;
      source = "keyboard";
      window.setTimeout(read, 10);
    };
    // Touch selections have no mouseup; follow the selection itself instead.
    const onSelectionChange = () => {
      if (source === "mouse" && !isCoarsePointer()) return;
      if (Date.now() - pillPress < 600) return;
      window.clearTimeout(debounce);
      debounce = window.setTimeout(read, 250);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTarget(null);
    };
    const onResize = () => {
      const h = window.visualViewport?.height ?? window.innerHeight;
      if (h !== lastHeight) viewportChanged = Date.now();
      lastHeight = h;
    };
    const onScroll = (e: Event) => {
      if (pill.current?.contains(e.target as Node)) return;
      // The on-screen keyboard opening scrolls the page; that isn't the user leaving.
      if (Date.now() - viewportChanged < 800) return;
      setTarget(null);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("mouseup", onMouseUp);
    document.addEventListener("keyup", onKeyUp);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("scroll", onScroll, true);
    window.visualViewport?.addEventListener("resize", onResize);
    window.addEventListener("resize", onResize);
    return () => {
      window.clearTimeout(debounce);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("mouseup", onMouseUp);
      document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("scroll", onScroll, true);
      window.visualViewport?.removeEventListener("resize", onResize);
      window.removeEventListener("resize", onResize);
    };
  }, [enabled]);
  const focusText = target?.focus ? target.text : "";
  useEffect(() => {
    if (focusText) input.current?.focus({ preventScroll: true });
  }, [focusText]);
  useEffect(() => {
    if (open) return;
    shown.current = "";
    setValue("");
    setTranslating(false);
  }, [open]);
  // "/" jumps into the pill's instruction field.
  useEffect(() => {
    if (!open) return;
    const slash = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement).closest?.("input, textarea, [contenteditable]")) return;
      e.preventDefault();
      input.current?.focus({ preventScroll: true });
    };
    document.addEventListener("keydown", slash);
    return () => document.removeEventListener("keydown", slash);
  }, [open]);
  if (!target) return null;
  const run = (instruction: string) => {
    if (!ask(`${instruction}:\n\n"""\n${target.text}\n"""`)) return;
    window.getSelection()?.removeAllRanges();
    setTarget(null);
  };
  return (
    <div
      ref={pill}
      className="beacon"
      role="dialog"
      aria-label="Beacon · act on the selected text"
      style={{ left: target.x, top: target.y }}
    >
      <form
        className="beacon-input"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) run(value.trim());
        }}
      >
        <WandSparkles size={17} />
        <input
          ref={input}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Ask about the selection…"
          aria-label="Instruction for the selected text"
          aria-keyshortcuts="/"
        />
        {!target.focus && !value && (
          <kbd className="beacon-slash" aria-hidden>
            /
          </kbd>
        )}
        <button type="submit" aria-label="Run" disabled={!value.trim()}>
          <ArrowUp size={15} />
        </button>
      </form>
      <div className="beacon-actions">
        {translating ? (
          <>
            <button type="button" aria-label="Back to actions" onClick={() => setTranslating(false)}>
              <ChevronLeft size={13} />
            </button>
            {TRANSLATE_TO.map((language) => (
              <button key={language} type="button" onClick={() => run(`Translate this into ${language}`)}>
                {language}
              </button>
            ))}
          </>
        ) : (
          <>
            {BEACON_ACTIONS.map(([label, instruction]) => (
              <button key={label} type="button" onClick={() => run(instruction)}>
                {label}
              </button>
            ))}
            <button type="button" onClick={() => setTranslating(true)}>
              Translate…
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Desktop assistant: summon with ⌘J                                   */
/* ------------------------------------------------------------------ */

const noopSubscribe = () => () => {};

async function captureScreen(): Promise<Blob | null> {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    toast.error("Screen capture isn’t supported in this browser.");
    return null;
  }
  let stream: MediaStream | undefined;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    await new Promise((r) => requestAnimationFrame(r));
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    return await new Promise((r) => canvas.toBlob(r, "image/png"));
  } catch (e) {
    if ((e as Error).name !== "NotAllowedError") toast.error("Screen capture failed.");
    return null;
  } finally {
    stream?.getTracks().forEach((t) => t.stop());
  }
}

export function QuickAssistant({
  ws,
  open,
  onClose,
  ask,
  echo,
  tab,
  lang,
  ready,
}: {
  ws: Workspace;
  /** False while another answer is streaming. */
  ready: boolean;
  open: boolean;
  onClose: () => void;
  ask: (q: string, options?: { attachmentIds?: string[] }) => boolean;
  echo: boolean;
  /** Magic Tab: inline completions in the quick assistant too. */
  tab: boolean;
  lang?: string;
}) {
  const [value, setValue] = useState("");
  const [caretAtEnd, setCaretAtEnd] = useState(true);
  const completions = useCompletions(ws);
  const suggestion = tab && caretAtEnd ? suggestCompletion(value, completions) : "";
  // Keep the latest onClose without re-running the open effect each render.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [selection, setSelection] = useState("");
  const [shot, setShot] = useState<{ blob: Blob; url: string } | null>(null);
  const [shotId, setShotId] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const canCapture = useSyncExternalStore(
    noopSubscribe,
    () => typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia,
    () => false,
  );
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    setSelection(window.getSelection()?.toString().trim().slice(0, 6000) ?? "");
    requestAnimationFrame(() => input.current?.focus());
    const esc = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("keydown", esc);
      // Give focus back to whatever opened the assistant.
      if (opener?.isConnected && opener !== document.body) requestAnimationFrame(() => opener.focus());
    };
  }, [open]);
  function trapTab(e: React.KeyboardEvent) {
    if (e.key !== "Tab" || !dialog.current) return;
    const items = [
      ...dialog.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || !dialog.current.contains(document.activeElement))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
  useEffect(
    () => () => {
      if (shot) URL.revokeObjectURL(shot.url);
    },
    [shot],
  );
  if (!open) return null;
  async function send() {
    const q = value.trim();
    if (!q || busy) return;
    if (!ready) {
      toast.error("Wait for the current answer to finish, then send.");
      return;
    }
    setBusy(true);
    try {
      const ids: string[] = shotId ? [shotId] : [];
      if (shot && !shotId) {
        if (!ws.state.user) toast.error("Sign in to attach screen captures. Asking without it.");
        else {
          const form = new FormData();
          form.append(
            "file",
            new File([shot.blob], `Screen capture ${new Date().toLocaleString()}.png`, {
              type: "image/png",
            }),
          );
          const r = await fetch("/api/upload", { method: "POST", body: form });
          const json: any = await r.json();
          if (!r.ok) throw new Error(json.error);
          ids.push(json.id);
          setShotId(json.id); // a retry reuses the upload
          void ws.refresh();
        }
      }
      const started = ask(
        selection ? `${q}\n\nSelected text:\n"""\n${selection}\n"""` : q,
        ids.length ? { attachmentIds: ids } : undefined,
      );
      if (!started) return; // keep the question so nothing is lost
      setValue("");
      setShot(null);
      setShotId("");
      setSelection("");
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      ref={dialog}
      className="quick-assistant"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={trapTab}
    >
      <header>
        <span>
          <Sparkles size={15} /> Internal AI
        </span>
        <button className="qa-close" aria-label="Close quick assistant" onClick={onClose}>
          <X size={16} />
        </button>
      </header>
      <h2 id={titleId}>What can I help with?</h2>
      <p>Ask from anywhere in the workspace. Selected text and screen captures come along as context.</p>
      {(selection || shot) && (
        <div className="qa-context">
          {selection && (
            <span className="qa-chip">
              <Highlighter size={13} />
              <span>“{selection.slice(0, 60)}{selection.length > 60 ? "…" : ""}”</span>
              <button aria-label="Remove selected text" onClick={() => setSelection("")}>
                <X size={12} />
              </button>
            </span>
          )}
          {shot && (
            <span className="qa-chip qa-shot">
              <img src={shot.url} alt="Screen capture preview" />
              <span>Screen capture</span>
              <button
                aria-label="Remove screen capture"
                onClick={() => {
                  setShot(null);
                  setShotId("");
                }}
              >
                <X size={12} />
              </button>
            </span>
          )}
        </div>
      )}
      <div className="qa-composer">
        <div className="ghost-field">
          <GhostText target={input} value={value} suggestion={suggestion} />
          <textarea
            ref={input}
            value={value}
            rows={2}
            placeholder="Summarise, draft, explain…"
            aria-label="Ask the quick assistant"
            onChange={(e) => {
              setValue(e.target.value);
              setCaretAtEnd(e.target.selectionStart === e.target.value.length);
            }}
            onSelect={(e) =>
              setCaretAtEnd(
                e.currentTarget.selectionStart === e.currentTarget.value.length &&
                  e.currentTarget.selectionEnd === e.currentTarget.value.length,
              )
            }
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              // Accept the suggestion before the focus trap sees Tab.
              if (e.key === "Tab" && suggestion && !e.shiftKey) {
                e.preventDefault();
                e.stopPropagation();
                setValue(value + suggestion);
                return;
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
        </div>
        {suggestion && <SuggestionChip suggestion={suggestion} onAccept={() => setValue(value + suggestion)} />}
        <div className="qa-bar">
          {canCapture && (
          <button
            className="qa-icon"
            aria-label="Capture your screen"
            title="Capture your screen"
            onClick={async () => {
              const blob = await captureScreen();
              if (blob) {
                setShot({ blob, url: URL.createObjectURL(blob) });
                setShotId("");
              }
              input.current?.focus();
            }}
          >
            <Camera size={16} />
          </button>
          )}
          <span className="composer-spacer" />
          {echo && (
            <DictateButton
              className="qa-icon"
              lang={lang}
              onText={(t) => setValue((v) => (v ? `${v} ${t}` : t))}
            />
          )}
          <button
            className="qa-send"
            aria-label="Send"
            disabled={!value.trim() || busy}
            onClick={() => void send()}
          >
            {busy ? <LoaderCircle size={15} className="spin" /> : <ArrowUp size={16} />}
          </button>
        </div>
      </div>
      {shot && (
        <small className="qa-note">
          The capture is saved to your uploads and read by the vision model so the answer can use it.
        </small>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Magic features onboarding                                           */
/* ------------------------------------------------------------------ */

type Slide = {
  key: MagicKey;
  title: string;
  kicker: string;
  description: string;
  features: [typeof Bot, string, string][];
  quota: string;
};

const SLIDES: Slide[] = [
  {
    key: "echo",
    kicker: "Echo · Smart dictation",
    title: "Enable Magic Echo",
    description:
      "Speak instead of typing. Dictate questions, notes and follow-ups into any Internal AI text field.",
    features: [
      [Mic, "Voice to text", "Talk naturally, see words appear"],
      [Languages, "Your language", "Uses your meeting language setting"],
      [Zap, "Hands-free follow-ups", "Keeps listening between pauses"],
      [ShieldCheck, "You stay in control", "Stops the moment you click"],
    ],
    quota: "Uses your browser’s speech recognition, which may process audio on the browser provider’s servers.",
  },
  {
    key: "beacon",
    kicker: "Beacon · Smart highlight",
    title: "Enable Magic Beacon",
    description:
      "Select text anywhere in Internal AI and instantly revise, summarise, explain or find evidence for it.",
    features: [
      [Target, "Highlight to act", "Select text, get AI actions"],
      [Zap, "Quick actions", "Revise, summarise, translate"],
      [FileText, "Works across pages", "Answers, sources and documents"],
      [ShieldCheck, "Grounded", "Answers cite your knowledge"],
    ],
    quota: "Runs through Ask, so it follows your evidence mode and agent skills.",
  },
  {
    key: "tab",
    kicker: "Tab · Smart autocomplete",
    title: "Enable Magic Tab",
    description:
      "Get suggestions as you type. Press Tab to accept, keep typing to ignore.",
    features: [
      [Keyboard, "Tab to accept", "Natural inline completions"],
      [Building2, "Knows your context", "Clients, documents and workflows"],
      [Zap, "Instant", "Suggested on your device, no round trip"],
      [ShieldCheck, "Private", "Your typing isn’t sent anywhere"],
    ],
    quota: "Suggestions come from your workspace titles and common requests, computed in the browser.",
  },
  {
    key: "desktop",
    kicker: "Desktop assistant",
    title: "Quick assistant",
    description:
      "Summon Internal AI from any page with ⌘J — no switching views, no breaking focus. Capture your screen and ask in context.",
    features: [
      [Camera, "Screen capture", "Share what you see"],
      [Zap, "Instant popup", "Summon with ⌘J / Ctrl J"],
      [Monitor, "Everywhere in the app", "Brings your selection along"],
      [ShieldCheck, "Your permission", "Screen access asks every time"],
    ],
    quota: "In the browser, ⌘J works inside this tab. In the Internal AI desktop app, ⌥Space opens it from any app on your computer.",
  },
];

const isMac = () =>
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/i.test((navigator as any).userAgentData?.platform ?? navigator.platform ?? navigator.userAgent);

export function MagicFeatures({
  ws,
  openAssistant,
}: {
  ws: Workspace;
  openAssistant: () => void;
}) {
  const { prefs, update } = useAssistantPrefs(ws);
  const [index, setIndex] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const mac = useSyncExternalStore(noopSubscribe, isMac, () => true);
  const coarse = useCoarsePointer();
  const shortcut = mac ? "⌘J" : "Ctrl J";
  const slide = SLIDES[index];
  const go = (d: number) => setIndex((i) => (i + d + SLIDES.length) % SLIDES.length);
  const arrow = (e: React.KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return null;
    if (e.key === "ArrowRight") return 1;
    if (e.key === "ArrowLeft") return -1;
    return null;
  };
  function onTabKey(e: React.KeyboardEvent) {
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    const n = SLIDES.length;
    const d = arrow(e);
    const next = d !== null ? (index + d + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : null;
    if (next === null) return;
    e.preventDefault();
    setIndex(next);
    tabs.current[next]?.focus();
  }
  function onStageKey(e: React.KeyboardEvent) {
    const el = e.target as HTMLElement;
    if (el.closest("input, textarea, [contenteditable], [role='switch']")) return;
    const d = arrow(e);
    if (d === null) return;
    e.preventDefault();
    go(d);
  }
  return (
    <>
      <PageTitle
        eyebrow="MAGIC FEATURES"
        title="Magic features"
        description="Small assists that make Internal AI feel like part of how you already work."
      />
      <div className="magic-tabs" role="tablist" aria-label="Magic features" onKeyDown={onTabKey}>
        {SLIDES.map((s, i) => (
          <button
            key={s.key}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            id={`magic-tab-${s.key}`}
            role="tab"
            aria-selected={i === index}
            aria-controls="magic-panel"
            tabIndex={i === index ? 0 : -1}
            onClick={() => setIndex(i)}
          >
            {s.kicker}
            <span className={`magic-dot${prefs.magic[s.key] ? " on" : ""}`} aria-hidden />
            <span className="sr-only">{prefs.magic[s.key] ? " (on)" : " (off)"}</span>
          </button>
        ))}
      </div>
      <div
        className="magic-stage"
        id="magic-panel"
        role="tabpanel"
        aria-labelledby={`magic-tab-${slide.key}`}
        onKeyDown={onStageKey}
      >
        <div className="magic-preview" data-variant={slide.key}>
          <MagicPreview kind={slide.key} />
          <button className="magic-nav prev" aria-label="Previous feature" onClick={() => go(-1)}>
            <ChevronLeft size={22} />
          </button>
          <button className="magic-nav next" aria-label="Next feature" onClick={() => go(1)}>
            <ChevronRight size={22} />
          </button>
        </div>
        <article className="magic-card" key={slide.key}>
          <span className="eyebrow">{slide.kicker.toUpperCase()}</span>
          <h2>{slide.title}</h2>
          <p className="magic-description">{slide.description}</p>
          <div className="magic-features">
            {slide.features.map(([Icon, title, sub]) => (
              <div key={title}>
                <span className="magic-icon">
                  <Icon size={18} />
                </span>
                <span>
                  <strong>{title}</strong>
                  <small>{sub}</small>
                </span>
              </div>
            ))}
          </div>
          <div className="magic-toggle">
            <div>
              <strong>
                {slide.key === "desktop" ? `Enable ${shortcut} shortcut` : slide.title}
              </strong>
              <small>{slide.quota}</small>
            </div>
            <Switch
              aria-label={slide.title}
              checked={prefs.magic[slide.key]}
              onCheckedChange={(v) =>
                void update(
                  { magic: { [slide.key]: v } as AssistantPrefs["magic"] },
                  `${slide.kicker.split(" · ")[0]} ${v ? "on" : "off"}`,
                )
              }
            />
          </div>
          {slide.key === "desktop" ? (
            <button className="primary-button magic-cta" onClick={openAssistant}>
              Open the assistant {!coarse && <kbd>{shortcut}</kbd>}
            </button>
          ) : (
            <MagicTry ws={ws} kind={slide.key} on={prefs.magic[slide.key]} />
          )}
          <div className="magic-dots" role="group" aria-label="Feature slides">
            {SLIDES.map((s, i) => (
              <button
                key={s.key}
                aria-label={`Show ${s.kicker}`}
                aria-controls="magic-panel"
                aria-current={i === index ? "true" : undefined}
                onClick={() => setIndex(i)}
              />
            ))}
          </div>
        </article>
      </div>
    </>
  );
}

/** A live field to try the feature right where it's switched on. */
function MagicTry({ ws, kind, on }: { ws: Workspace; kind: Exclude<MagicKey, "desktop">; on: boolean }) {
  const [text, setText] = useState("");
  const [caretAtEnd, setCaretAtEnd] = useState(true);
  const field = useRef<HTMLTextAreaElement>(null);
  const completions = useCompletions(ws);
  const suggestion = kind === "tab" && on && caretAtEnd ? suggestCompletion(text, completions) : "";
  const label = { echo: "Try Echo", tab: "Try Tab", beacon: "Try Beacon" }[kind];
  if (!on)
    return (
      <p className="magic-try muted-note" id={`magic-try-${kind}`}>
        Turn this on to try it here.
      </p>
    );
  if (kind === "beacon")
    return (
      <div className="magic-try">
        <strong>{label}</strong>
        <p className="magic-try-sample">
          Northstar Bank wants on-device inference for sensitive workloads and a clear answer on data
          residency before procurement signs off.
        </p>
        <small className="muted-note">Select any part of the sentence above, then pick an action.</small>
      </div>
    );
  return (
    <label className="magic-try">
      <strong>{label}</strong>
      <div className="ghost-field">
        <GhostText target={field} value={text} suggestion={suggestion} />
        <textarea
          ref={field}
          rows={2}
          value={text}
          placeholder={kind === "echo" ? "Click the mic in this field, then speak…" : "Start typing “Prepare me for”…"}
          onChange={(e) => {
            setText(e.target.value);
            setCaretAtEnd(e.target.selectionStart === e.target.value.length);
          }}
          onSelect={(e) =>
            setCaretAtEnd(
              e.currentTarget.selectionStart === e.currentTarget.value.length &&
                e.currentTarget.selectionEnd === e.currentTarget.value.length,
            )
          }
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Tab" && suggestion && !e.shiftKey) {
              e.preventDefault();
              setText(text + suggestion);
            }
          }}
        />
      </div>
      {suggestion && <SuggestionChip suggestion={suggestion} onAccept={() => setText(text + suggestion)} />}
    </label>
  );
}

function MagicPreview({ kind }: { kind: MagicKey }) {
  if (kind === "beacon")
    return (
      <div className="mp-doc">
        <h3>Northstar Bank · Discovery notes</h3>
        <p>
          <mark>
            The client wants on-device inference for sensitive workloads and a clear
            answer on data residency before procurement
          </mark>{" "}
          signs off. Legal has asked for the partnership draft by Thursday.
        </p>
        <div className="mp-beacon">
          <WandSparkles size={15} /> Summarise this for the steering committee
          <span className="mp-caret" />
          <span className="mp-send">
            <ArrowUp size={12} />
          </span>
        </div>
      </div>
    );
  if (kind === "tab")
    return (
      <div className="mp-chat">
        {[
          "The client is asking about on-device inference and whether we can guarantee data privacy.",
          "Also make sure we address model size — they want it on standard enterprise hardware.",
        ].map((t, i) => (
          <div className="mp-msg" key={i}>
            <span className="mp-avatar">JD</span>
            <p>{t}</p>
          </div>
        ))}
        <div className="mp-field">
          Sure — I’ll prepare a brief on local deployment
          <em> options and hardware sizing for Thursday</em>
          <kbd>Tab</kbd>
        </div>
      </div>
    );
  if (kind === "desktop")
    return (
      <div className="mp-desktop">
        <div className="mp-sheet">
          <strong>Evaluation results</strong>
          <table>
            <tbody>
              {[
                ["Category", "Participants", "Accuracy"],
                ["Retrieval", "5", "94.5%"],
                ["Summaries", "5", "98.3%"],
                ["Citations", "4", "97.1%"],
              ].map((r) => (
                <tr key={r[0]}>
                  {r.map((c) => (
                    <td key={c}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mp-popup">
          <span>
            <Sparkles size={12} /> Internal AI
          </span>
          <strong>What can I help with?</strong>
          <div className="mp-popup-input">
            <Camera size={12} /> Summarise this table<span className="mp-caret" />
          </div>
        </div>
      </div>
    );
  return (
    <div className="mp-echo">
      <div className="mp-wave" aria-hidden>
        {Array.from({ length: 28 }, (_, i) => (
          <i key={i} style={{ animationDelay: `${(i % 7) * 0.11}s` }} />
        ))}
      </div>
      <p>
        “Prepare me for the Northstar meeting and list the open actions
        <span className="mp-interim"> for this week</span>”
      </p>
      <span className="mp-mic">
        <Mic size={20} />
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Meeting assistant                                                   */
/* ------------------------------------------------------------------ */

const clock = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

export type RecordingState = "off" | "recording" | "paused";

// Elapsed seconds of the live meeting, for the pill shown outside the meeting page.
let meetingSeconds = 0;
const clockListeners = new Set<() => void>();
export function setMeetingSeconds(s: number) {
  if (s === meetingSeconds) return;
  meetingSeconds = s;
  clockListeners.forEach((l) => l());
}
function subscribeClock(listener: () => void) {
  clockListeners.add(listener);
  return () => clockListeners.delete(listener);
}

/** Compact recording indicator for the page top bar. */
export function RecordingPill({
  state,
  onOpen,
  onStop,
}: {
  state: RecordingState;
  onOpen?: () => void;
  onStop?: () => void;
}) {
  const seconds = useSyncExternalStore(subscribeClock, () => meetingSeconds, () => 0);
  if (state === "off") return null;
  return (
    <div className={`rec-pill ${state}`} role="status">
      <button
        type="button"
        className="rec-pill-open"
        onClick={onOpen}
        aria-label={`${state === "recording" ? "Recording" : "Recording paused"}, ${clock(seconds)}. Open the meeting assistant`}
      >
        <i aria-hidden />
        {state === "recording" ? "REC" : "Paused"}
        <time>{clock(seconds)}</time>
      </button>
      {onStop && (
        <button type="button" className="rec-pill-stop" onClick={onStop} aria-label="End the recording">
          <CircleStop size={14} /> Stop
        </button>
      )}
    </div>
  );
}
