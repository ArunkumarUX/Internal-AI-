"use client";
import { useState, useEffect, useDeferredValue } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  Search,
  Plus,
  FileText,
  ShieldCheck,
  Check,
  Clock,
  Building2,
  Users,
  Lightbulb,
  AlertTriangle,
  GitBranch,
  Link2,
  Download,
  ChevronRight,
  BookOpen,
  Activity,
  Settings2,
  RefreshCw,
  Globe,
  Lock,
  CheckCheck,
  Trash2,
  Send,
  Brain,
  Layers,
  Sparkles,
  MessageCircle,
  Upload,
  Cpu,
  Database,
  MoreHorizontal,
  Pencil,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableHeader,
  TableHead,
  TableRow,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { toast } from "sonner";
import {
  sources,
  people,
  insights,
  initialActions,
  phases,
  CLIENT_STAGES,
  type Client,
  type ClientStage,
  type Source,
} from "@/lib/knowledge";
import { api, downloadText, initialsOf, type Workspace } from "@/lib/client";
type Props = {
  ws: Workspace;
  ask: (q: string, options?: { attachmentIds?: string[] }) => void;
  openSource: (s: Source) => void;
  view: string;
  setView: (v: string) => void;
  upload: () => void;
  initialClaim?: string;
  client?: string;
  setClient?: (name?: string) => void;
  openAddClient?: boolean;
  setOpenAddClient?: (open: boolean) => void;
};
export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function PageTitle({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children}
    </div>
  );
}
export function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-panel">
      <BookOpen size={28} />
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
function SourcesList({
  ids,
  ws,
  openSource,
}: {
  ids: string[];
  ws: Workspace;
  openSource: Props["openSource"];
}) {
  return (
    <div className="source-chips">
      {ids.map((id) => {
        const s = ws.allSources.find((d) => d.id === id);
        return s ? (
          <button key={id} onClick={() => openSource(s)}>
            <FileText size={14} />
            {s.title}
            <ArrowUpRight size={12} />
          </button>
        ) : null;
      })}
    </div>
  );
}
function SearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (s: string) => void;
  placeholder: string;
}) {
  return (
    <div className="filter-search">
      <Search size={17} />
      <input
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button aria-label="Clear search" onClick={() => onChange("")}>
          ×
        </button>
      )}
    </div>
  );
}
export function Knowledge({ ws, openSource, ask, upload }: Props) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All sources");
  const [tab, setTab] = useState("library");
  const [selected, setSelected] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);
  const [hideSamples, setHideSamples] = useState(false);
  // Searching every document's text on each keystroke lags; search the settled value.
  const deferredQuery = useDeferredValue(query);
  const q = deferredQuery.trim().toLowerCase();
  const list = ws.allSources.filter(
    (s) =>
      (filter === "All sources" || s.system === filter) &&
      (!hideSamples || !s.sample) &&
      (!q || `${s.title} ${s.content} ${s.tags.join(" ")} ${s.client}`.toLowerCase().includes(q)),
  );
  // Only rows that still exist and are visible can be compared.
  const chosen = selected.filter((id) => list.some((s) => s.id === id));
  useEffect(() => {
    setSelected((ids) => {
      const next = ids.filter((id) => ws.allSources.some((s) => s.id === id));
      return next.length === ids.length ? ids : next;
    });
  }, [ws.allSources]);
  const hiddenDocs = (ws.state.documentTotal ?? 0) - ws.state.documents.length;
  const discuss = (s: Source, mode: "summarise" | "ask") => {
    const question =
      mode === "summarise"
        ? `Summarise the document: ${s.title}`
        : `Ask about: ${s.title}`;
    ask(
      question,
      s.system === "Uploads" ? { attachmentIds: [s.id] } : undefined,
    );
  };
  return (
    <>
      <PageTitle
        eyebrow="YOUR ORGANISATION’S MEMORY"
        title="Knowledge, with context."
        description="Find the source. Understand the story. Build on what you know."
      >
        <button className="primary-button" onClick={upload}>
          <Upload size={16} />
          Upload document
        </button>
      </PageTitle>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="library">Library</TabsTrigger>
          <TabsTrigger value="health">Knowledge health</TabsTrigger>
          <TabsTrigger value="decisions">Decisions & memory</TabsTrigger>
        </TabsList>
        <TabsContent value="library">
          <div className="toolbar">
            <SearchField
              value={query}
              onChange={setQuery}
              placeholder="Search documents, topics or people"
            />
            <Select value={filter} onValueChange={setFilter}>
              <SelectTrigger className="w-[170px]" aria-label="Filter by source">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[
                  "All sources",
                  "Confluence",
                  "Notion",
                  "SharePoint",
                  "Uploads",
                  "Memory",
                ].map((x) => (
                  <SelectItem value={x} key={x}>
                    {x}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="list-caption">
            <span>
              {list.length} {list.length === 1 ? "document" : "documents"}
              {hiddenDocs > 0 ? ` · showing your latest ${ws.state.documents.length} of ${ws.state.documentTotal} uploads` : ""}
            </span>
            <label className="caption-toggle">
              <Checkbox checked={hideSamples} onCheckedChange={(v) => setHideSamples(!!v)} aria-label="Hide sample sources" />
              Hide samples
            </label>
            {chosen.length > 0 && (
              <span className="caption-actions">
                {chosen.length >= 2 ? (
                  <button className="text-link" onClick={() => setComparing(true)}>
                    Compare {chosen.length} selected <ArrowRight size={14} />
                  </button>
                ) : (
                  <span className="muted-note">Select one more to compare</span>
                )}
                <button className="quiet-button" onClick={() => setSelected([])}>
                  Clear
                </button>
              </span>
            )}
          </div>
          {list.length > 0 && (
          <div className="table-surface">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="col-check">
                    <span className="sr-only">Select</span>
                  </TableHead>
                  <TableHead>Document</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="kb-actions-head">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="col-check">
                      <Checkbox
                        aria-label={`Select ${s.title}`}
                        checked={selected.includes(s.id)}
                        onCheckedChange={(checked) =>
                          setSelected(
                            checked
                              ? [...selected, s.id]
                              : selected.filter((id) => id !== s.id),
                          )
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <button
                        className="doc-title"
                        onClick={() => openSource(s)}
                      >
                        <span className="document-icon">
                          <FileText size={18} />
                        </span>
                        <span>
                          <strong>{s.title}</strong>
                          <small>
                            {s.system} · {s.kind}
                            {s.client && s.client !== "Your workspace"
                              ? ` · ${s.client}`
                              : ""}
                            {s.sample ? " · Sample" : ""}
                          </small>
                        </span>
                      </button>
                    </TableCell>
                    <TableCell>{s.owner}</TableCell>
                    <TableCell>{s.date}</TableCell>
                    <TableCell>
                      <Badge
                        tone={
                          s.status === "Verified"
                            ? "green"
                            : s.status === "Stale"
                              ? "amber"
                              : "neutral"
                        }
                      >
                        {s.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="kb-row-actions">
                      <button
                        type="button"
                        className="kb-icon-btn"
                        aria-label={`Summarise ${s.title}`}
                        title="Summarise"
                        onClick={() => discuss(s, "summarise")}
                      >
                        <Sparkles size={16} />
                      </button>
                      <button
                        type="button"
                        className="kb-icon-btn"
                        aria-label={`Open ${s.title}`}
                        title="Open"
                        onClick={() => openSource(s)}
                      >
                        <ChevronRight size={16} />
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          )}
          {!list.length && (
            <Empty
              title={q || filter !== "All sources" ? "No documents match" : "Your library is empty"}
              description={
                q || filter !== "All sources"
                  ? "Try a broader search, another source, or clear the filters."
                  : "Upload a document to build your organisation’s knowledge."
              }
              action={
                <button className="secondary-button" onClick={upload}>
                  <Upload size={16} />
                  Upload document
                </button>
              }
            />
          )}
        </TabsContent>
        <TabsContent value="health">
          <div className="metric-grid">
            <div>
              <strong>
                {ws.allSources.filter((s) => s.status === "Verified").length}
              </strong>
              <span>
                Verified sources
                {ws.allSources.some((s) => s.sample && s.status === "Verified")
                  ? ` (${ws.allSources.filter((s) => s.sample && s.status === "Verified").length} sample)`
                  : ""}
              </span>
            </div>
            <div>
              <strong>{insights.filter((i) => i.id === "freshness").length}</strong>
              <span>Superseded reference</span>
            </div>
            <div>
              <strong>{insights.filter((i) => i.id === "conflict").length}</strong>
              <span>Potential conflict</span>
            </div>
            <div>
              <strong>{ws.allSources.filter((s) => s.system === "Uploads" && s.status !== "Verified").length}</strong>
              <span>Uploads awaiting review</span>
            </div>
          </div>
          <p className="muted-note">
            Sample knowledge health findings. Uploaded documents are marked
            unverified until reviewed.
          </p>
          {insights
            .filter((i) => ["freshness", "conflict", "gap"].includes(i.id))
            .map((i) => (
              <article className="health-row" key={i.id}>
                <span className={`square-icon ${i.tone}`}>
                  <AlertTriangle size={20} />
                </span>
                <div>
                  <Badge>{i.category}</Badge>
                  <h3>{i.title}</h3>
                  <p>{i.description}</p>
                  <SourcesList
                    ids={i.sources}
                    ws={ws}
                    openSource={openSource}
                  />
                </div>
              </article>
            ))}
          <div className="panel">
            <h3>Related versions</h3>
            <p>
              The current and archived advisory pricing references share a
              document family. The September 2026 reference supersedes the older
              version.
            </p>
            <SourcesList
              ids={["pricing-current", "pricing-old"]}
              ws={ws}
              openSource={openSource}
            />
          </div>
        </TabsContent>
        <TabsContent value="decisions">
          <div className="section-heading padded-heading">
            <h2>A decision is more than a document.</h2>
            <button
              onClick={() =>
                ask("Why did we choose architecture B for Project Atlas?")
              }
            >
              Explore a decision <ArrowUpRight size={14} />
            </button>
          </div>
          {ws.allSources
            .filter((s) => s.kind === "Decision" || s.system === "Memory")
            .map((s) => (
              <article className="panel decision-card" key={s.id}>
                <span className="square-icon lilac">
                  <GitBranch size={20} />
                </span>
                <div>
                  <small>
                    {s.date} · {s.owner}
                  </small>
                  <h3>{s.title}</h3>
                  <p>
                    {s.content.slice(0, 280)}
                    {s.content.length > 280 ? "…" : ""}
                  </p>
                  <button className="text-link" onClick={() => openSource(s)}>
                    Read the decision trail <ArrowRight size={14} />
                  </button>
                </div>
              </article>
            ))}
        </TabsContent>
      </Tabs>
      <Dialog open={comparing} onOpenChange={setComparing}>
        <DialogContent className="detail-dialog wide-dialog">
          <DialogHeader>
            <DialogTitle>Compare selected documents</DialogTitle>
            <DialogDescription>
              Review content, owners, dates and versions side by side.
              Differences require human interpretation.
            </DialogDescription>
          </DialogHeader>
          <div className="two-column">
            {ws.allSources
              .filter((d) => chosen.includes(d.id))
              .slice(0, 4)
              .map((d) => (
                <article className="panel" key={d.id}>
                  <Badge tone={d.status === "Verified" ? "green" : "amber"}>
                    {d.status}
                  </Badge>
                  <h3>{d.title}</h3>
                  <small>
                    {d.owner} · {d.date}
                    {d.version ? ` · Version ${d.version}` : ""}
                  </small>
                  <div className="prose-content">{d.content}</div>
                </article>
              ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
const CLIENT_COLORS = ["sky", "lilac", "mint", "peach", "amber"];
const STAGE_TONES: Record<ClientStage, string> = {
  Prospect: "neutral",
  Discovery: "lilac",
  Pilot: "sky",
  Active: "mint",
  "On hold": "amber",
};
export function ClientsView({
  ws,
  openSource,
  ask,
  upload,
  client,
  setClient,
  openAddClient,
  setOpenAddClient,
}: Props) {
  const [openName, setOpenName] = useState<string | undefined>(client);
  useEffect(() => setOpenName(client), [client]);
  const openClient = (name?: string) => {
    setOpenName(name);
    setClient?.(name);
  };
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState<ClientStage | null>(null);
  const startAdd = (stage: ClientStage = "Prospect") => {
    setAdding(stage);
    setOpenAddClient?.(true);
  };
  const stopAdd = () => {
    setAdding(null);
    setOpenAddClient?.(false);
  };
  useEffect(() => {
    if (openAddClient) setAdding((stage) => stage ?? "Prospect");
    else setAdding(null);
  }, [openAddClient]);
  const [dragging, setDragging] = useState<string>();
  const [dropStage, setDropStage] = useState<ClientStage>();
  const q = query.trim().toLowerCase();
  const visible = ws.allClients.filter(
    (x) =>
      !q ||
      x.name.toLowerCase().includes(q) ||
      x.industry.toLowerCase().includes(q) ||
      x.owner.toLowerCase().includes(q),
  );
  const docCount = (name: string, base: string[]) =>
    new Set([
      ...base,
      ...ws.allSources.filter((s) => s.client === name).map((s) => s.id),
    ]).size;
  // Stage moves show instantly and roll back if the save fails.
  const [pending, setPending] = useState<Record<string, ClientStage>>({});
  const [announce, setAnnounce] = useState("");
  const stageOfClient = (c: Client) => pending[c.name] ?? c.stage;
  const moveClient = async (c: Client, stage: ClientStage) => {
    if (stageOfClient(c) === stage) return;
    if (pending[c.name]) {
      toast.error(`Still saving ${c.name}’s last move.`);
      return;
    }
    if (!ws.state.user) {
      toast.error("Sign in to move clients between stages.");
      return;
    }
    setPending((p) => ({ ...p, [c.name]: stage }));
    try {
      if (c.custom) {
        const rec = ws.state.records.find((r) => r.id === c.id);
        await ws.save("client", { ...(rec?.data ?? {}), stage }, c.id);
      } else {
        // The server gives each sample client one override record.
        await ws.save("client", { override: true, name: c.name, stage }, c.stageRecordId);
      }
      setAnnounce(`${c.name} moved to ${stage}.`);
      toast.success(`${c.name} moved to ${stage}.`);
    } catch {
      setAnnounce(`${c.name} couldn’t be moved.`);
    } finally {
      setPending(({ [c.name]: _done, ...rest }) => rest);
    }
  };
  const [editing, setEditing] = useState<Client | null>(null);
  const current = ws.allClients.find((x) => x.name === openName);
  useEffect(() => {
    // A client removed elsewhere can't stay open.
    if (openName && !ws.loading && !ws.allClients.some((x) => x.name === openName)) {
      toast.error(`${openName} is no longer in your clients.`);
      openClient(undefined);
    }
  }, [openName, ws.allClients, ws.loading]);
  return (
    <>
      <PageTitle
        eyebrow="CLIENT INTELLIGENCE"
        title="The whole relationship."
        description="Every client by stage. Drag a card or use its Move menu to change stage, or open it for the full picture."
      >
        <button className="primary-button" onClick={() => startAdd("Prospect")}>
          <Plus size={16} /> Add client
        </button>
      </PageTitle>
      <div className="kanban-toolbar">
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Search clients, industries or owners"
        />
        <span className="kanban-total">
          {visible.length} of {ws.allClients.length} clients
        </span>
      </div>
      <div className="kanban-board" role="list" aria-label="Clients by stage">
        {CLIENT_STAGES.map((stage) => {
          const items = visible.filter((x) => stageOfClient(x) === stage);
          return (
            <section
              key={stage}
              role="listitem"
              aria-label={`${stage}, ${items.length} clients`}
              className={`kanban-column${dropStage === stage ? " drop-target" : ""}`}
              onDragOver={(e) => {
                if (!dragging) return;
                e.preventDefault();
                setDropStage(stage);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node))
                  setDropStage(undefined);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const c = ws.allClients.find((x) => x.name === dragging);
                setDragging(undefined);
                setDropStage(undefined);
                if (c) void moveClient(c, stage);
              }}
            >
              <header className="kanban-column-head">
                <span className={`kanban-dot ${STAGE_TONES[stage]}`} />
                <strong>{stage}</strong>
                <span className="kanban-count">{items.length}</span>
                <button
                  aria-label={`Add a client to ${stage}`}
                  onClick={() => startAdd(stage)}
                >
                  <Plus size={15} />
                </button>
              </header>
              <div className="kanban-cards">
                {items.map((x) => (
                  <div className="kanban-card-wrap" key={x.id ?? x.name}>
                  <button
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", x.name);
                      setDragging(x.name);
                    }}
                    onDragEnd={() => {
                      setDragging(undefined);
                      setDropStage(undefined);
                    }}
                    className={`kanban-card${openName === x.name ? " selected" : ""}${
                      dragging === x.name ? " dragging" : ""
                    }`}
                    onClick={() => openClient(x.name)}
                  >
                    <span className="kanban-card-top">
                      <span className={`client-mark ${x.color}`}>{x.initials}</span>
                      <span className="kanban-card-title">
                        <strong>{x.name}</strong>
                        <small>{x.industry}</small>
                      </span>
                    </span>
                    {x.opportunity && (
                      <span className="kanban-card-focus">{x.opportunity}</span>
                    )}
                    {x.tags.length > 0 && (
                      <span className="kanban-card-tags">
                        {x.tags.slice(0, 2).map((t) => (
                          <Badge key={t}>{t}</Badge>
                        ))}
                      </span>
                    )}
                    <span className="kanban-card-foot">
                      <span className="kanban-owner">
                        <span className="kanban-avatar">{initialsOf(x.owner)}</span>
                        {x.owner}
                      </span>
                      <span className="kanban-docs">
                        <FileText size={13} />
                        {docCount(x.name, x.documents)}
                      </span>
                    </span>
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className="kanban-move"
                      aria-label={`Move ${x.name} to another stage`}
                      disabled={!!pending[x.name]}
                    >
                      <MoreHorizontal size={16} />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>Move to</DropdownMenuLabel>
                      {CLIENT_STAGES.filter((st) => st !== stageOfClient(x)).map((st) => (
                        <DropdownMenuItem key={st} onSelect={() => void moveClient(x, st)}>
                          {st}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  </div>
                ))}
                {items.length === 0 && (
                  <div className="kanban-empty">
                    {dragging ? "Drop here" : "No clients"}
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
      <span className="sr-only" aria-live="polite">
        {announce}
      </span>
      <Sheet open={!!current} onOpenChange={(o) => !o && openClient(undefined)}>
        <SheetContent className="client-sheet w-full sm:max-w-[680px]">
          {current && (
            <ClientDetail
              key={current.name}
              c={current}
              ws={ws}
              ask={ask}
              openSource={openSource}
              upload={upload}
              onMove={(stage) => void moveClient(current, stage)}
              onEdit={current.custom ? () => setEditing(current) : undefined}
              onDeleted={() => openClient(undefined)}
            />
          )}
        </SheetContent>
      </Sheet>
      <Sheet
        open={!!adding || !!editing}
        onOpenChange={(o) => {
          if (o) return;
          stopAdd();
          setEditing(null);
        }}
      >
        <SheetContent className="client-sheet w-full sm:max-w-[520px]">
          {(adding || editing) && (
            <AddClientForm
              key={editing?.id ?? "new"}
              ws={ws}
              stage={editing?.stage ?? adding ?? "Prospect"}
              existing={editing ?? undefined}
              onDone={(name) => {
                stopAdd();
                setEditing(null);
                if (name) openClient(name);
              }}
            />
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
function AddClientForm({
  ws,
  stage,
  existing,
  onDone,
}: {
  ws: Workspace;
  stage: ClientStage;
  /** A custom client to edit instead of creating a new one. */
  existing?: Client;
  onDone: (name?: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: existing?.name ?? "",
    industry: existing && existing.industry !== "Industry not set" ? existing.industry : "",
    owner: existing && existing.owner !== "Unassigned" ? existing.owner : "",
    stage,
    opportunity: existing?.opportunity ?? "",
    risk: existing?.risk ?? "",
    description: existing?.description ?? "",
    tags: existing?.tags.join(", ") ?? "",
  });
  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm({ ...form, [k]: e.target.value });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) return;
    if (
      ws.allClients.some(
        (x) => x.name.toLowerCase() === name.toLowerCase() && (!existing || x.id !== existing.id),
      )
    ) {
      toast.error(`${name} is already a client.`);
      return;
    }
    setBusy(true);
    try {
      const previous = existing ? ws.state.records.find((r) => r.id === existing.id)?.data ?? {} : {};
      await ws.save("client", {
        ...previous,
        name,
        initials: initialsOf(name),
        industry: form.industry.trim(),
        owner: form.owner.trim(),
        stage: form.stage,
        opportunity: form.opportunity.trim(),
        risk: form.risk.trim(),
        description: form.description.trim(),
        tags: form.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
          .slice(0, 4),
        color: existing?.color ?? CLIENT_COLORS[ws.allClients.length % CLIENT_COLORS.length],
      }, existing?.id);
      toast.success(existing ? `${name} updated.` : `${name} added to ${form.stage}.`);
      onDone(name);
    } catch {
      setBusy(false);
    }
  };
  return (
    <form className="client-sheet-form" onSubmit={submit}>
      <SheetHeader className="client-sheet-header">
        <SheetTitle>{existing ? `Edit ${existing.name}` : "Add a client"}</SheetTitle>
        <SheetDescription>
          Fill in what you know now. Everything except the name can be left for
          later.
        </SheetDescription>
      </SheetHeader>
      <div className="client-sheet-body">
        <fieldset>
          <legend>Basics</legend>
          <label className="field-label">
            Client name *
            <input
              required
              autoFocus
              maxLength={80}
              value={form.name}
              onChange={set("name")}
              placeholder="Harbour Logistics"
            />
          </label>
          <div className="field-row">
            <label className="field-label">
              Industry
              <input
                maxLength={60}
                value={form.industry}
                onChange={set("industry")}
                placeholder="Transport & logistics"
              />
            </label>
            <label className="field-label">
              Stage
              <select value={form.stage} onChange={set("stage")}>
                {CLIENT_STAGES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="field-label">
            Relationship owner
            <input
              maxLength={60}
              value={form.owner}
              onChange={set("owner")}
              placeholder="Who owns the relationship"
            />
          </label>
        </fieldset>
        <fieldset>
          <legend>Relationship</legend>
          <label className="field-label">
            Current focus
            <input
              maxLength={120}
              value={form.opportunity}
              onChange={set("opportunity")}
              placeholder="What are we exploring with them?"
            />
          </label>
          <label className="field-label">
            Key risk or open question
            <input
              maxLength={160}
              value={form.risk}
              onChange={set("risk")}
              placeholder="e.g. Budget not confirmed for next year"
            />
          </label>
          <label className="field-label">
            Description
            <textarea
              maxLength={280}
              rows={3}
              value={form.description}
              onChange={set("description")}
              placeholder="One or two lines about the relationship"
            />
          </label>
          <label className="field-label">
            Tags
            <input
              maxLength={80}
              value={form.tags}
              onChange={set("tags")}
              placeholder="Comma separated, e.g. Priority, Referral"
            />
          </label>
        </fieldset>
      </div>
      <SheetFooter className="client-sheet-footer">
        <button type="button" className="secondary-button" onClick={() => onDone()}>
          Cancel
        </button>
        <button
          className="primary-button"
          disabled={busy || !form.name.trim()}
          type="submit"
        >
          {busy ? "Adding…" : "Add client"}
        </button>
      </SheetFooter>
    </form>
  );
}
function ClientDetail({
  c,
  ws,
  ask,
  openSource,
  upload,
  onMove,
  onEdit,
  onDeleted,
}: {
  c: Client;
  ws: Workspace;
  ask: Props["ask"];
  openSource: Props["openSource"];
  upload: Props["upload"];
  onMove: (stage: ClientStage) => void;
  onEdit?: () => void;
  onDeleted: () => void;
}) {
  const [tab, setTab] = useState("Overview");
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const removeClient = async () => {
    const id = c.custom ? c.id : c.stageRecordId;
    if (!id) return;
    setRemoving(true);
    try {
      await ws.remove(id);
      toast.success(c.custom ? `${c.name} deleted.` : `${c.name} is back in its original stage.`);
      if (c.custom) onDeleted();
    } catch {
    } finally {
      setRemoving(false);
      setConfirming(false);
    }
  };
  const docIds = Array.from(
    new Set([
      ...c.documents,
      ...ws.allSources.filter((s) => s.client === c.name).map((s) => s.id),
    ]),
  ).filter((id) => ws.allSources.some((s) => s.id === id));
  const docs = docIds.map((id) => ws.allSources.find((s) => s.id === id)!);
  const decisions = ws.allSources.filter(
    (s) => s.kind === "Decision" && s.client === c.name,
  );
  const isNorthstar = c.name === "Northstar Bank";
  return (
    <div className="client-sheet-detail">
      <SheetHeader className="client-sheet-header">
        <div className="client-sheet-hero">
          <div className={`client-mark large ${c.color}`}>{c.initials}</div>
          <div>
            <SheetTitle>{c.name}</SheetTitle>
            <SheetDescription>
              {c.description || `${c.industry} · owned by ${c.owner}`}
            </SheetDescription>
          </div>
        </div>
        <div className="client-sheet-meta">
          <label className="stage-select">
            <span className={`kanban-dot ${STAGE_TONES[c.stage]}`} />
            <span className="sr-only">Stage</span>
            <select
              value={c.stage}
              onChange={(e) => onMove(e.target.value as ClientStage)}
            >
              {CLIENT_STAGES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <Badge>{c.custom ? "Added by you" : "Sample account"}</Badge>
          {c.tags.map((t) => (
            <Badge key={t}>{t}</Badge>
          ))}
          {ws.state.user && (c.custom || c.stageRecordId) && (
            <span className="client-manage">
              {onEdit && (
                <button className="quiet-button" onClick={onEdit}>
                  <Pencil size={13} /> Edit
                </button>
              )}
              {confirming ? (
                <>
                  <span>{c.custom ? `Delete ${c.name}?` : "Reset to the original stage?"}</span>
                  <button className="quiet-button danger-link" disabled={removing} onClick={() => void removeClient()}>
                    {removing ? "Working…" : c.custom ? "Delete" : "Reset"}
                  </button>
                  <button className="quiet-button" onClick={() => setConfirming(false)}>
                    Cancel
                  </button>
                </>
              ) : (
                <button className="quiet-button danger-link" onClick={() => setConfirming(true)}>
                  {c.custom ? (
                    <>
                      <Trash2 size={13} /> Delete
                    </>
                  ) : (
                    "Reset stage"
                  )}
                </button>
              )}
            </span>
          )}
        </div>
        <div className="client-sheet-actions">
          <button
            className="primary-button"
            onClick={() => ask(`Prepare me for a meeting with ${c.name}`)}
          >
            Prepare a meeting brief <ArrowUpRight size={16} />
          </button>
          <button className="secondary-button" onClick={upload}>
            <Upload size={15} /> Add document
          </button>
        </div>
      </SheetHeader>
      <div className="client-sheet-body">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="wide-tabs">
            {[
              "Overview",
              "Documents",
              "Decisions",
              "Actions",
              "Projects",
              "Opportunities",
              "People",
            ].map((x) => (
              <TabsTrigger value={x} key={x}>
                {x}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="Overview">
            <article className="panel">
              <h3>Relationship at a glance</h3>
              <dl>
                <dt>Stage</dt>
                <dd>{c.stage}</dd>
                <dt>Relationship owner</dt>
                <dd>{c.owner}</dd>
                <dt>Industry</dt>
                <dd>{c.industry}</dd>
                <dt>Current focus</dt>
                <dd>{c.opportunity || "Not captured yet"}</dd>
              </dl>
              <button
                className="text-link"
                onClick={() => ask(`Tell me everything useful about ${c.name}`)}
              >
                Build a full client brief <ArrowRight size={14} />
              </button>
            </article>
            <article className="panel softly-blue">
              <span className="eyebrow">
                AI INSIGHT · {docs.length ? "SAMPLE EVIDENCE" : "NO EVIDENCE YET"}
              </span>
              <h3>
                {isNorthstar
                  ? "A focused pilot, with a clear path forward."
                  : "An opportunity to build the evidence."}
              </h3>
              <p>
                {c.risk ||
                  "Nothing has been uploaded for this client yet, so there is no evidence to reason over."}
              </p>
              <SourcesList ids={docIds.slice(0, 2)} ws={ws} openSource={openSource} />
            </article>
            <article className="panel">
              <h3>Recent activity</h3>
              {docs.slice(0, 3).map((s) => (
                <button
                  className="activity-row"
                  key={s.id}
                  onClick={() => openSource(s)}
                >
                  <span className="timeline-dot" />
                  <div>
                    <strong>{s.title}</strong>
                    <small>
                      {s.owner} · {s.date}
                    </small>
                  </div>
                  <ArrowUpRight size={16} />
                </button>
              ))}
              {docs.length === 0 && (
                <p className="muted-note">
                  No activity yet. Add a document tagged to {c.name} to start the
                  timeline.
                </p>
              )}
            </article>
          </TabsContent>
          <TabsContent value="Documents">
            {docs.map((s) => (
              <button
                className="document-row"
                key={s.id}
                onClick={() => openSource(s)}
              >
                <FileText size={22} />
                <span>
                  <strong>{s.title}</strong>
                  <small>
                    {s.system} · {s.date}
                  </small>
                </span>
                <Badge>{s.status}</Badge>
                <ArrowUpRight size={16} />
              </button>
            ))}
            {docs.length === 0 && (
              <Empty
                title="No documents yet"
                description={`Upload a file and choose ${c.name} as the client to see it here.`}
              />
            )}
          </TabsContent>
          <TabsContent value="Decisions">
            {decisions.map((s) => (
              <article className="panel" key={s.id}>
                <h3>{s.title}</h3>
                <p>{s.content}</p>
                <SourcesList ids={[s.id]} ws={ws} openSource={openSource} />
              </article>
            ))}
            {decisions.length === 0 && (
              <Empty
                title="No recorded decisions yet"
                description="Approved decisions from conversations will appear in Knowledge → Decisions & memory."
              />
            )}
          </TabsContent>
          <TabsContent value="Actions">
            <ActionsView
              ws={ws}
              openSource={openSource}
              ask={ask}
              compact
              client={c.name}
            />
          </TabsContent>
          <TabsContent value="Projects">
            {c.custom ? (
              <Empty
                title="No projects recorded yet"
                description={`Projects for ${c.name} will appear once documents or decisions reference them.`}
              />
            ) : (
              <article className="panel">
                <Badge tone="blue">
                  {isNorthstar ? "Pilot in delivery" : "Discovery"}
                </Badge>
                <h3>
                  {isNorthstar ? "Project Atlas" : "Claims document triage discovery"}
                </h3>
                <p>
                  {isNorthstar
                    ? "An internal knowledge assistant with permission-aware retrieval, citations and measurable answer quality."
                    : "Research and scope definition. No production claims deployment is recorded."}
                </p>
                <button
                  className="text-link"
                  onClick={() =>
                    ask(`What is the latest project status for ${c.name}?`)
                  }
                >
                  Explore project status <ArrowUpRight size={14} />
                </button>
              </article>
            )}
          </TabsContent>
          <TabsContent value="Opportunities">
            {c.opportunity ? (
              <article className="panel">
                <Badge tone="green">Potential opportunity · requires validation</Badge>
                <h3>{c.opportunity}</h3>
                <p>
                  Connect the client’s requirements with reusable evidence and the
                  right internal experts. Validate fit and avoid inferring a signed
                  opportunity.
                </p>
                <SourcesList
                  ids={c.custom ? docIds.slice(0, 2) : ["banking-cases", ...docIds.slice(0, 1)]}
                  ws={ws}
                  openSource={openSource}
                />
                <button
                  className="text-link"
                  onClick={() =>
                    ask(`Find relevant use cases and evidence gaps for ${c.name}`)
                  }
                >
                  Explore the opportunity <ArrowRight size={14} />
                </button>
              </article>
            ) : (
              <Empty
                title="No opportunity captured"
                description="Add a current focus for this client, or ask the assistant to look for one."
              />
            )}
          </TabsContent>
          <TabsContent value="People">
            <PeopleView ws={ws} openSource={openSource} ask={ask} compact />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
export function PeopleView({
  ws,
  openSource,
  ask,
  compact = false,
}: {
  ws: Workspace;
  openSource: Props["openSource"];
  ask: Props["ask"];
  compact?: boolean;
}) {
  const [q, setQ] = useState("");
  const [person, setPerson] = useState<(typeof people)[number] | null>(null);
  const results = people.filter((p) =>
    (p.name + " " + p.skills.join(" ") + " " + p.role + " " + p.description)
      .toLowerCase()
      .includes(q.toLowerCase()),
  );
  return (
    <>
      {!compact && (
        <PageTitle
          eyebrow="PEOPLE & EXPERTISE"
          title="Find the person behind the knowledge."
          description="Discover relevant experience, with the evidence that connects it."
        />
      )}
      <SearchField
        value={q}
        onChange={setQ}
        placeholder="Search a skill, person or industry"
      />
      <div className="people-grid">
        {results.map((p) => (
          <button
            className={`person-card${p.photo ? " person-card--photo" : ""}`}
            key={p.id}
            onClick={() => setPerson(p)}
            style={p.photo ? { backgroundImage: `url(${p.photo})` } : undefined}
          >
            {p.photo && <span className="person-card-shade" aria-hidden="true" />}
            <div className="person-card-top">
              <span className="person-pill person-pill--role">{p.badge}</span>
              <span className="person-pill person-pill--meta">
                {p.evidence.length} sources
              </span>
            </div>
            <div className="person-card-body">
              {!p.photo && (
                <span className={`person-avatar ${p.color}`}>{p.initials}</span>
              )}
              <h3>{p.name}</h3>
              <p className="person-card-role">
                {p.role} · {p.location}
              </p>
              <p className="person-card-focus">{p.focus}</p>
              <ul className="person-card-highlights">
                {p.highlights.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
              <span className="person-card-cta">
                View profile <ArrowUpRight size={15} />
              </span>
            </div>
          </button>
        ))}
      </div>
      {!results.length && (
        <Empty
          title="No matching expertise found"
          description="Try a broader capability such as Banking, GenAI or Discovery."
        />
      )}
      <Dialog open={!!person} onOpenChange={(o) => !o && setPerson(null)}>
        <DialogContent className="detail-dialog">
          <DialogHeader>
            <DialogTitle>{person?.name}</DialogTitle>
            <DialogDescription>
              {person?.role} · Sample profile
            </DialogDescription>
          </DialogHeader>
          {person && (
            <>
              {person.photo ? (
                <img
                  className="person-dialog-photo"
                  src={person.photo}
                  alt=""
                />
              ) : (
                <span className={`person-avatar ${person.color}`}>
                  {person.initials}
                </span>
              )}
              <p>{person.description}</p>
              <div className="skill-tags">
                {person.skills.map((s) => (
                  <Badge key={s}>{s}</Badge>
                ))}
              </div>
              <div className="notice">
                <Clock size={17} /> Availability is not connected. Ask the
                person or their manager.
              </div>
              <h4>Why this person matches</h4>
              <SourcesList
                ids={person.evidence}
                ws={ws}
                openSource={openSource}
              />
              <button
                className="primary-button"
                onClick={() => {
                  setPerson(null);
                  ask(
                    `Build an evidence-based resume profile for ${person.name}`,
                  );
                }}
              >
                Draft an evidence-based profile <ArrowUpRight size={15} />
              </button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
export function ActionsView({
  ws,
  openSource,
  compact = false,
  client,
}: {
  ws: Workspace;
  openSource: Props["openSource"];
  ask: Props["ask"];
  compact?: boolean;
  client?: string;
}) {
  const [filter, setFilter] = useState("Open");
  const [review, setReviewState] = useState<Record<string, any> | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState("");
  // Each action opens with its own outcome text, never the previous one's.
  const setReview = (a: Record<string, any> | null) => {
    setReviewState(a);
    setOutcome(a?.outcome ?? "");
  };
  const DONE = ["Completed", "Dismissed"];
  const custom: Record<string, any>[] = ws.state.records
    .filter((r) => r.kind === "action")
    .map((r) => ({ ...r.data, id: r.data.id ?? r.id }));
  const actions = [
    ...initialActions.map((a) => custom.find((c) => c.id === a.id) ?? a),
    ...custom.filter((c) => !initialActions.some((a) => a.id === c.id)),
  ].filter((a) => !client || a.client === client);
  const shown = actions.filter(
    (a) =>
      filter === "All" ||
      (filter === "Open" ? !DONE.includes(a.status) : a.status === filter),
  );
  async function change(a: Record<string, any>, status: string) {
    if (busy) return;
    if (!ws.state.user) {
      toast.error("Sign in to update actions.");
      return;
    }
    setBusy(true);
    try {
      const reopening = !DONE.includes(status) && DONE.includes(a.status);
      await ws.save(
        "action",
        {
          ...a,
          status: reopening ? (a.kind === "External draft" ? "Awaiting review" : "Open") : status,
          ...(status === "Completed" ? { outcome: outcome.trim(), completedAt: new Date().toISOString() } : {}),
        },
        a.id,
      );
      // One outcome per action: a fixed id updates it instead of adding another.
      if (status === "Completed" && outcome.trim())
        await ws.save(
          "outcome",
          {
            title: a.title,
            content: outcome.trim(),
            client: a.client,
            source: a.source,
            actionId: a.id,
          },
          `fixed-outcome-${String(a.id).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60)}`,
        );
      toast.success(
        status === "Approved draft"
          ? "Draft approved. No external message has been sent."
          : reopening
            ? "Action reopened"
            : `Action ${status.toLowerCase()}`,
      );
      setReview(null);
      setOutcome("");
    } catch {
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {!compact && (
        <PageTitle
          eyebrow="ACTION INTELLIGENCE"
          title="Move the work forward."
          description="Clear commitments. Accountable owners. You stay in control."
        />
      )}
      <div className="toolbar">
        <Tabs value={filter} onValueChange={setFilter}>
          <TabsList>
            {["Open", "Completed", "Dismissed", "All"].map((x) => (
              <TabsTrigger key={x} value={x}>
                {x}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <span className="muted-note">
          {actions.filter((a) => !DONE.includes(a.status)).length} active commitments
        </span>
      </div>
      <div className="action-list">
        {shown.map((a) => (
          <button
            className="action-row"
            key={a.id}
            onClick={() => setReview(a)}
          >
            <span
              className={`square-icon ${a.kind === "External draft" ? "peach" : "sky"}`}
            >
              {a.kind === "External draft" ? (
                <Send size={19} />
              ) : (
                <CheckCheck size={19} />
              )}
            </span>
            <div>
              <strong>{a.title}</strong>
              <small>
                {a.owner} · {a.client} · Due {a.due}
              </small>
            </div>
            <Badge
              tone={
                a.status === "Completed"
                  ? "green"
                  : a.kind === "External draft"
                    ? "amber"
                    : "neutral"
              }
            >
              {a.status}
            </Badge>
            <ChevronRight size={16} />
          </button>
        ))}
      </div>
      {!shown.length && (
        <Empty
          title="You’re all caught up"
          description="Commitments and drafts requiring review will appear here."
        />
      )}
      <div className="notice">
        <ShieldCheck size={18} /> External drafts require your review. This
        workspace does not send messages to connected systems.
      </div>
      <Dialog open={!!review} onOpenChange={(o) => !o && setReview(null)}>
        <DialogContent className="detail-dialog">
          <DialogHeader>
            <DialogTitle>{review?.title}</DialogTitle>
            <DialogDescription>
              {review?.owner} · Due {review?.due}
            </DialogDescription>
          </DialogHeader>
          {review && (
            <>
              <Badge>{review.status}</Badge>
              <div className="prose-content">{review.content}</div>
              {review.source && (
                <SourcesList
                  ids={[review.source]}
                  ws={ws}
                  openSource={openSource}
                />
              )}
              {DONE.includes(review.status) ? (
                <>
                  {review.outcome && (
                    <div className="field-label">
                      Outcome / learning
                      <p className="prose-content">{review.outcome}</p>
                    </div>
                  )}
                  <div className="dialog-actions">
                    <button className="secondary-button" disabled={busy} onClick={() => void change(review, "Open")}>
                      Reopen
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <label className="field-label">
                    Outcome / learning
                    <textarea
                      value={outcome}
                      maxLength={4000}
                      onChange={(e) => setOutcome(e.target.value)}
                      placeholder="What happened? Capture a lesson for the next engagement."
                    />
                  </label>
                  {review.kind === "External draft" && review.status !== "Approved draft" && (
                    <p className="muted-note">Approve this draft before marking it complete. Approving doesn’t send anything.</p>
                  )}
                  <div className="dialog-actions">
                    <button
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => void change(review, "Dismissed")}
                    >
                      Dismiss
                    </button>
                    {review.kind === "External draft" && review.status !== "Approved draft" ? (
                      <button
                        className="primary-button"
                        disabled={busy}
                        onClick={() => void change(review, "Approved draft")}
                      >
                        Approve draft
                      </button>
                    ) : (
                      <button
                        className="primary-button"
                        disabled={busy}
                        onClick={() => void change(review, "Completed")}
                      >
                        Mark complete
                      </button>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
export function SavedWork({ ws, ask, openSource }: Props) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Record<string, any> | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const list = ws.state.records.filter(
    (r) =>
      ["saved", "memory", "outcome"].includes(r.kind) &&
      String(r.data.title ?? "").toLowerCase().includes(q.trim().toLowerCase()),
  );
  return (
    <>
      <PageTitle
        eyebrow="SAVED WORK"
        title="Good work, ready to build on."
        description="Your briefs, proposals, decisions and lessons. Kept together."
      />
      <SearchField value={q} onChange={setQ} placeholder="Search saved work" />
      {list.length ? (
        <div className="saved-grid">
          {list.map((r) => (
            <button
              className="saved-card"
              key={r.id}
              onClick={() => setOpen({ ...r.data, id: r.id, kind: r.kind })}
            >
              <span className="square-icon sky">
                <FileText size={21} />
              </span>
              <Badge>
                {r.kind === "memory"
                  ? "Organisational memory"
                  : r.kind === "outcome"
                    ? "Outcome & learning"
                    : "Saved draft"}
              </Badge>
              <h3>{r.data.title}</h3>
              <p>{String(r.data.content ?? "").slice(0, 140)}…</p>
              <small>Updated {r.updated_at.slice(0, 10)}</small>
            </button>
          ))}
        </div>
      ) : (
        <Empty
          title="Your next great piece of work starts here"
          description="Save an answer or a generated brief from Ask. Approved decisions and completed-action learnings also appear here."
          action={
            <button
              className="primary-button"
              onClick={() => ask("Prepare me for the Northstar Bank meeting")}
            >
              Create a meeting brief <ArrowUpRight size={15} />
            </button>
          }
        />
      )}
      <Dialog
        open={!!open}
        onOpenChange={(o) => {
          if (!o) {
            setOpen(null);
            setConfirming(false);
          }
        }}
      >
        <DialogContent className="detail-dialog wide-dialog">
          <DialogHeader>
            <DialogTitle>{open?.title}</DialogTitle>
            <DialogDescription>
              {open?.kind === "memory"
                ? "Human-approved knowledge"
                : "Saved workspace document"}
            </DialogDescription>
          </DialogHeader>
          <div className="prose-content scroll-prose">{open?.content}</div>
          <div className="dialog-actions">
            {confirming ? (
              <>
                <span className="muted-note">
                  {open?.kind === "memory"
                    ? "Remove this from organisational memory? Answers will stop using it."
                    : "Delete this permanently?"}
                </span>
                <button className="secondary-button" onClick={() => setConfirming(false)}>
                  Cancel
                </button>
                <button
                  className="secondary-button danger-button"
                  disabled={removing}
                  onClick={async () => {
                    if (!open) return;
                    setRemoving(true);
                    try {
                      await ws.remove(open.id);
                      toast.success("Deleted");
                      setOpen(null);
                    } catch {
                    } finally {
                      setRemoving(false);
                      setConfirming(false);
                    }
                  }}
                >
                  <Trash2 size={15} /> {removing ? "Deleting…" : "Delete"}
                </button>
              </>
            ) : (
              <>
                {ws.state.user && (
                  <button className="secondary-button danger-button" onClick={() => setConfirming(true)}>
                    <Trash2 size={15} /> Delete
                  </button>
                )}
                <button
                  className="primary-button"
                  onClick={() => downloadText(open?.title, open?.content)}
                >
                  Export Markdown <Download size={15} />
                </button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
/** A whole-number field that can be cleared while typing and settles on blur. */
function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const settle = (raw: string) => {
    const n = Math.round(Number(raw));
    const next = raw.trim() === "" || !Number.isFinite(n) ? value : Math.min(max, Math.max(min, n));
    setText(String(next));
    onChange(next);
  };
  return (
    <label className="field-label">
      {label}
      <input
        type="number"
        inputMode="numeric"
        step={1}
        min={min}
        max={max}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value.trim() !== "" && Number.isInteger(n) && n >= min && n <= max) onChange(n);
        }}
        onBlur={(e) => settle(e.target.value)}
      />
    </label>
  );
}
const PRICING_KEY = "ia-pricing-comparison";
export function Pricing({ ws, openSource }: Props) {
  const [weeks, setWeeks] = useState(12);
  const [consultants, setConsultants] = useState(2);
  const [contingency, setContingency] = useState(10);
  const [cost, setCost] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSavedState] = useState<{ label: string; total: number }[]>([]);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(PRICING_KEY);
      if (raw) setSavedState(JSON.parse(raw));
    } catch {}
  }, []);
  const setSaved = (list: { label: string; total: number }[]) => {
    setSavedState(list);
    try {
      sessionStorage.setItem(PRICING_KEY, JSON.stringify(list));
    } catch {}
  };
  const base = weeks * 5 * (1200 * 0.5 + 850 * consultants + 950 * 0.5);
  const total = Math.round(base * (1 + contingency / 100));
  return (
    <>
      <PageTitle
        eyebrow="PRICING INTELLIGENCE"
        title="Make the assumptions visible."
        description="Compare an illustrative delivery model before seeking commercial approval."
      />
      <div className="notice">
        <ShieldCheck size={18} /> Planning model using sample rates. This is not
        an approved quote.
      </div>
      <div className="two-column">
        <div className="panel">
          <h3>Your delivery scenario</h3>
          <NumberField label="Duration (weeks)" value={weeks} min={1} max={104} onChange={setWeeks} />
          <NumberField label="Full-time consultants" value={consultants} min={1} max={30} onChange={setConsultants} />
          <NumberField label="Contingency (%)" value={contingency} min={0} max={100} onChange={setContingency} />
          <NumberField
            label="Your authorised total delivery cost (£, optional)"
            value={cost}
            min={0}
            max={100_000_000}
            onChange={setCost}
          />
          <small className="muted-note">
            Includes an architect and delivery manager, each at 50%. Five
            working days per week.
          </small>
        </div>
        <div className="panel estimate">
          <span className="eyebrow">ILLUSTRATIVE TOTAL</span>
          <h2>£{total.toLocaleString("en-GB")}</h2>
          <p>Excludes tax, expenses and third-party services.</p>
          <dl>
            <dt>Base delivery</dt>
            <dd>£{base.toLocaleString("en-GB")}</dd>
            <dt>Contingency</dt>
            <dd>£{(total - base).toLocaleString("en-GB")}</dd>
            <dt>Duration</dt>
            <dd>{weeks} weeks</dd>
            {cost > 0 && (
              <>
                <dt>Illustrative margin</dt>
                <dd className={cost > total ? "negative" : undefined}>{(((total - cost) / total) * 100).toFixed(1)}%</dd>
              </>
            )}
          </dl>
          {cost > total && (
            <p className="pricing-warning" role="alert">
              Cost is higher than the price. This scenario loses £{(cost - total).toLocaleString("en-GB")}.
            </p>
          )}
          <button
            className="secondary-button"
            onClick={() =>
              setSaved([
                ...saved,
                {
                  label: `${weeks} weeks · ${consultants} consultants · ${contingency}% contingency`,
                  total,
                },
              ])
            }
          >
            <Plus size={16} />
            Add to comparison
          </button>
          <button
            className="primary-button"
            disabled={saving}
            onClick={async () => {
              if (!ws.state.user) {
                toast.error("Sign in to save scenarios.");
                return;
              }
              setSaving(true);
              try {
                const margin = cost > 0 ? `\nAuthorised cost: £${cost.toLocaleString("en-GB")}. Illustrative margin: ${(((total - cost) / total) * 100).toFixed(1)}%.` : "";
                await ws.save("saved", {
                  title: `Pricing scenario · ${weeks} weeks · ${consultants} consultants`,
                  content: `Illustrative planning estimate: £${total.toLocaleString("en-GB")}.\nDuration: ${weeks} weeks. Consultants: ${consultants}. Contingency: ${contingency}%.${margin}\nArchitect and delivery manager at 50%.\nExcludes tax, expenses, third-party services. Sample reference rates; not an approved offer.`,
                  sourceIds: ["pricing-current"],
                });
                toast.success("Scenario saved to Saved work");
              } catch {
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Saving…" : "Save scenario"}
          </button>
        </div>
      </div>
      {saved.length > 0 && (
        <div className="panel">
          <h3>Scenario comparison</h3>
          {saved.map((s, i) => (
            <div className="comparison-row" key={i}>
              <span>{s.label}</span>
              <strong>£{s.total.toLocaleString("en-GB")}</strong>
              <button
                aria-label={`Remove scenario ${i + 1}`}
                onClick={() => setSaved(saved.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <SourcesList
        ids={["pricing-current", "pricing-old"]}
        ws={ws}
        openSource={openSource}
      />
    </>
  );
}
const PROPOSAL_ID = "fixed-proposal-northstar-rfp";
export function Proposal({ ws, ask, openSource, upload }: Props) {
  // Review ticks are stored per RFP so they survive navigation and reloads.
  const stored = ws.state.records.find((r) => r.kind === "proposal" && r.data.rfp === "northstar-rfp");
  const [checks, setChecksState] = useState<string[]>([]);
  const [savingReview, setSavingReview] = useState(false);
  useEffect(() => {
    if (Array.isArray(stored?.data.checks)) setChecksState(stored.data.checks);
  }, [stored?.updated_at]);
  const setChecks = (next: string[]) => {
    setChecksState(next);
    if (!ws.state.user) return;
    void ws
      .save("proposal", { rfp: "northstar-rfp", title: "Northstar RFP review", checks: next }, stored?.id ?? PROPOSAL_ID)
      .catch(() => setChecksState(checks));
  };
  const requirements = [
    [
      "R1",
      "Permission-aware internal knowledge assistant",
      "atlas-decision",
      "Evidence found",
    ],
    [
      "R2",
      "Citations with owners and source dates",
      "banking-cases",
      "Evidence found",
    ],
    ["R3", "Approved UK data residency", "", "Gap — approval needed"],
    ["R4", "Retrieval and answer quality results", "", "Gap — results pending"],
    [
      "R5",
      "12-week discovery and pilot plan",
      "pricing-current",
      "Planning assumption",
    ],
    ["R6", "Case studies, team and pricing", "banking-cases", "Evidence found"],
    [
      "R7",
      "Human approval before external actions",
      "meeting-notes",
      "Decision recorded",
    ],
  ];
  return (
    <>
      <PageTitle
        eyebrow="PROPOSAL INTELLIGENCE"
        title="A stronger response starts with evidence."
        description="Connect requirements, relevant delivery and the gaps still to close."
      >
        <button className="secondary-button" onClick={upload}>
          <Upload size={16} />
          Upload your RFP
        </button>
      </PageTitle>
      <div className="notice">
        <FileText size={18} /> Sample compliance matrix for the Northstar RFP.
        Upload a document and use Ask to work with your own requirements.
      </div>
      <div className="panel proposal-overview">
        <div>
          <Badge tone="blue">Northstar Bank · Sample RFP</Badge>
          <h2>AI transformation response</h2>
          <p>
            {checks.length} of 7 requirements reviewed · Due 30 September 2026
          </p>
        </div>
        <button
          className="primary-button"
          onClick={() =>
            ask(
              "Build an executive pitch and proposal response strategy for the Northstar RFP",
            )
          }
        >
          Draft response strategy <ArrowUpRight size={15} />
        </button>
      </div>
      <div className="table-surface">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="col-check">Reviewed</TableHead>
              <TableHead>Requirement</TableHead>
              <TableHead>Evidence status</TableHead>
              <TableHead>Source</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {requirements.map(([id, title, source, status]) => (
              <TableRow key={id}>
                <TableCell className="col-check">
                  <Checkbox
                    aria-label={`Review requirement ${id}`}
                    checked={checks.includes(id)}
                    onCheckedChange={(c) =>
                      setChecks(
                        c ? [...checks, id] : checks.filter((x) => x !== id),
                      )
                    }
                  />
                </TableCell>
                <TableCell>
                  <small>{id}</small>
                  <strong className="block">{title}</strong>
                </TableCell>
                <TableCell>
                  <Badge tone={source ? "green" : "amber"}>{status}</Badge>
                </TableCell>
                <TableCell>
                  {source ? (
                    <button
                      className="text-link"
                      onClick={() =>
                        openSource(sources.find((s) => s.id === source)!)
                      }
                    >
                      View evidence <ArrowUpRight size={14} />
                    </button>
                  ) : (
                    "Not available"
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="two-column">
        <div className="panel">
          <h3>Proposed response team</h3>
          <p>
            Maya Patel · Architecture
            <br />
            Daniel Okafor · Evaluation
            <br />
            James Wilson · Delivery
          </p>
          <SourcesList ids={["expertise"]} ws={ws} openSource={openSource} />
        </div>
        <div className="panel">
          <h3>Close the gaps before committing</h3>
          <p>
            Confirm residency approval and publish evaluation results. Neither
            requirement is treated as satisfied by a related document.
          </p>
          <button
            className="text-link"
            disabled={savingReview}
            onClick={async () => {
              if (!ws.state.user) {
                toast.error("Sign in to save the compliance review.");
                return;
              }
              setSavingReview(true);
              try {
                // Saving again updates the same review in Saved work.
                const existing = ws.state.records.find(
                  (r) => r.kind === "saved" && r.data.rfpReview === "northstar-rfp",
                );
                await ws.save("saved", {
                  rfpReview: "northstar-rfp",
                  title: "Northstar RFP · Compliance review",
                  content: requirements
                    .map(
                      ([id, title, , status]) =>
                        `${checks.includes(id) ? "[reviewed]" : "[unreviewed]"} ${id}: ${title} — ${status}`,
                    )
                    .join("\n"),
                  sourceIds: ["northstar-rfp"],
                }, existing?.id);
                toast.success(existing ? "Compliance review updated" : "Compliance review saved");
              } catch {
              } finally {
                setSavingReview(false);
              }
            }}
          >
            Save compliance review <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </>
  );
}
export function ClaimChecker({ ws, openSource, initialClaim }: Props) {
  const [text, setText] = useState(
    initialClaim ||
      "Project Atlas will deploy in June 2027.\nWe have delivered a 40% cost reduction for Northstar.",
  );
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <PageTitle
        eyebrow="EVIDENCE & TRUST"
        title="A good claim can show its source."
        description="Check your draft for source matches, gaps and conflicting evidence."
      />
      <div className="panel">
        <label className="field-label">
          Claims to review
          <textarea
            className="large-textarea"
            value={text}
            maxLength={30000}
            onChange={(e) => {
              setText(e.target.value);
              // Results describe the old text, so clear them as soon as it changes.
              setResult(null);
            }}
            placeholder="Paste the important statements from a pitch, proposal, brief or CV…"
          />
        </label>
        <div className="split-row">
          <small className="muted-note">
            Text-based screening. Human review remains essential. {text.length.toLocaleString()} / 30,000 characters.
          </small>
          <button
            className="primary-button"
            disabled={busy || !text.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                setResult(await api("/api/verify", { text }));
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <ShieldCheck size={16} />
            {busy ? "Checking evidence…" : "Check claims"}
          </button>
        </div>
      </div>
      {result && (
        <>
          <div className="notice">
            <AlertTriangle size={17} />
            {result.method}
            {result.total > result.checked
              ? ` Checked the first ${result.checked} of ${result.total} claims; split the rest into another check.`
              : ""}
          </div>
          {!result.claims.length && (
            <Empty
              title="No checkable claims found"
              description="Write each claim as a full sentence on its own line (more than 15 characters)."
            />
          )}
          {result.claims.map((c: any, i: number) => (
            <article className="panel" key={i}>
              <Badge
                tone={
                  c.status === "Exact source match"
                    ? "green"
                    : c.status === "No evidence found"
                      ? "neutral"
                      : "amber"
                }
              >
                {c.status}
              </Badge>
              <h3>{c.claim}</h3>
              {c.sourceIds.length ? (
                <SourcesList
                  ids={c.sourceIds}
                  ws={ws}
                  openSource={openSource}
                />
              ) : (
                <p>No supporting source was found in this workspace.</p>
              )}
            </article>
          ))}
        </>
      )}
    </>
  );
}
function ModelsPanel({ ws }: { ws: Workspace }) {
  const [catalog, setCatalog] = useState<{
    configured: boolean;
    provider: string;
    providerNote: string;
    embedding: string;
    embeddingNote: string;
    store: string;
    storeNote: string;
    selected: { model: string; fast: string };
    presets: {
      id: string;
      label: string;
      name: string;
      model: string;
      fast: string;
      note: string;
      size: string;
    }[];
    models: string[];
  } | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState("");
  const signedIn = !!ws.state.user;
  useEffect(() => {
    if (!signedIn) {
      setCatalog(null);
      setStatus("ready");
      return;
    }
    let live = true;
    setStatus("loading");
    api("/api/models")
      .then((data) => {
        if (!live) return;
        setCatalog(data as NonNullable<typeof catalog>);
        setStatus("ready");
      })
      .catch(() => {
        if (!live) return;
        setCatalog(null);
        setStatus("error");
      });
    return () => {
      live = false;
    };
  }, [signedIn, ws.state.aiModel, ws.state.aiFastModel, reload]);
  async function choose(model: string, fast: string) {
    if (!ws.state.user) {
      toast.error("Sign in to change models.");
      return;
    }
    if (!model) return;
    setBusy("save");
    try {
      await api("/api/models", { model, fastModel: fast || model });
      await ws.refresh();
      toast.success(`Ask will use ${model}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  if (!signedIn) {
    return (
      <div className="panel model-hero">
        <Badge>Sign in required</Badge>
        <h3>Manage the models Ask uses</h3>
        <p>
          Sign in to choose Recommended, Balanced or Fastest, or pick a model
          from your approved gateway. Keys stay on the server.
        </p>
        <a className="primary-button" href="/signin-with-chatgpt?return_to=/#settings-models">
          Sign in
        </a>
      </div>
    );
  }
  if (status === "loading" && !catalog) {
    return (
      <div className="panel model-hero" aria-busy="true">
        <Badge>Loading</Badge>
        <h3>We've picked the best model for Ask</h3>
        <p>Reading your gateway and saved model choice…</p>
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="panel model-hero">
        <Badge tone="amber">Couldn’t load</Badge>
        <h3>Models aren’t available right now</h3>
        <p>
          The gateway list couldn’t be loaded. Check that you are signed in,
          then try again.
        </p>
        <button
          className="secondary-button"
          onClick={() => setReload((n) => n + 1)}
        >
          Retry
        </button>
      </div>
    );
  }
  const selected = catalog?.selected.model || ws.state.aiModel;
  const fast = catalog?.selected.fast || ws.state.aiFastModel;
  const defaults = catalog?.presets ?? [];
  const ids = [
    ...new Set([selected, fast, ...(catalog?.models ?? [])].filter(Boolean)),
  ];
  return (
    <>
      <div className="panel model-hero">
        <Badge tone={catalog?.configured ? "green" : "amber"}>
          {catalog?.configured ? "Gateway connected" : "Not connected"}
        </Badge>
        <h3>We've picked the best model for Ask</h3>
        <p>
          {selected
            ? `Active: ${selected}${fast && fast !== selected ? ` · Fast: ${fast}` : ""}`
            : "Connect an approved gateway to choose a model."}
        </p>
      </div>
      <div className="model-preset-list" role="group" aria-label="Model presets">
        {defaults.map((preset) => {
          const on =
            !!preset.model &&
            selected === preset.model &&
            (fast || selected) === preset.fast;
          return (
            <button
              type="button"
              key={preset.id}
              className={`model-preset${on ? " is-active" : ""}`}
              aria-pressed={on}
              disabled={!!busy || !catalog?.configured || !preset.model}
              onClick={() => void choose(preset.model, preset.fast)}
            >
              <span className="model-preset-label">{preset.label}</span>
              <strong>{preset.name}</strong>
              <small>
                {preset.note}
                {preset.size ? ` · ${preset.size}` : ""}
              </small>
              {on ? <Check size={16} aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>
      {!!ids.length && (
        <div className="panel">
          <h3>Select a different model</h3>
          <p className="muted-note">
            Chat model answers questions. Fast model writes related questions.
          </p>
          <div className="model-select-row">
            <label htmlFor="chat-model">
              Chat model
              <select
                id="chat-model"
                value={selected}
                disabled={!!busy || !catalog?.configured}
                onChange={(e) => void choose(e.target.value, fast || e.target.value)}
              >
                {ids.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </label>
            <label htmlFor="fast-model">
              Fast model
              <select
                id="fast-model"
                value={fast || selected}
                disabled={!!busy || !catalog?.configured}
                onChange={(e) => void choose(selected || e.target.value, e.target.value)}
              >
                {ids.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      )}
      <div className="panel">
        <h3>Data handling & privacy</h3>
        <div className="setting-row">
          <div>
            <strong>LLM provider</strong>
            <p>
              {catalog?.provider ?? "Not connected"}. {catalog?.providerNote}
            </p>
          </div>
          <Cpu size={18} aria-hidden="true" />
        </div>
        <div className="setting-row">
          <div>
            <strong>Embedding preference</strong>
            <p>
              {catalog?.embedding ?? "Lexical retrieval"}. {catalog?.embeddingNote}
            </p>
          </div>
          <Sparkles size={18} aria-hidden="true" />
        </div>
        <div className="setting-row">
          <div>
            <strong>Workspace store</strong>
            <p>
              {catalog?.store ?? "Cloudflare D1 + R2"}. {catalog?.storeNote}
            </p>
          </div>
          <Database size={18} aria-hidden="true" />
        </div>
      </div>
    </>
  );
}
export function Settings({ ws, setView }: Props) {
  const SETTINGS_TABS = ["Integrations", "Models", "MCP servers", "Preferences", "Governance", "Product phases"];
  const slug = (t: string) => t.toLowerCase().replaceAll(" ", "-");
  // #settings-mcp-servers opens that tab directly.
  const [tab, setTabState] = useState(() => {
    if (typeof window === "undefined") return "Integrations";
    const h = window.location.hash.replace(/^#settings-?/, "");
    return SETTINGS_TABS.find((t) => slug(t) === h) ?? "Integrations";
  });
  const setTab = (t: string) => {
    setTabState(t);
    window.history.replaceState(null, "", `/#settings-${slug(t)}`);
  };
  const [add, setAdd] = useState(false);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState("");
  const [selected, setSelected] = useState<any>(null);
  const [connector, setConnector] = useState("");
  const [removingServer, setRemovingServer] = useState("");
  const settings = ws.state.records.find((r) => r.kind === "settings");
  const servers = ws.state.records.filter((r) => r.kind === "mcp");
  const [notion, setNotion] = useState<{
    connected: boolean;
    reauth?: boolean;
    connectedAt?: string;
    server: string;
  } | null>(null);
  const signedIn = !!ws.state.user;
  useEffect(() => {
    if (!signedIn) return;
    fetch("/api/notion")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setNotion(data as typeof notion))
      .catch(() => setNotion(null));
  }, [signedIn]);
  function connectNotion() {
    if (!signedIn) {
      toast.error("Sign in to connect Notion.");
      return;
    }
    window.location.href = "/api/notion/connect";
  }
  async function disconnectNotion() {
    setBusy("notion");
    try {
      const r = await fetch("/api/notion", { method: "DELETE" });
      if (!r.ok) throw new Error("Couldn’t disconnect Notion. Please retry.");
      setNotion(await r.json());
      toast.success("Notion disconnected");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  const integrations = [
    {
      name: "Confluence",
      letter: "C",
      color: "sky",
      description: "Pages, spaces and decision records",
      count: 4,
    },
    {
      name: "Notion",
      letter: "N",
      color: "neutral",
      description: "Client context, people and working knowledge",
      count: 4,
    },
    {
      name: "SharePoint",
      letter: "S",
      color: "mint",
      description: "Proposals, RFPs and commercial references",
      count: 4,
    },
  ];
  async function test(id: string, operation: string) {
    setBusy(id);
    try {
      const result = await api("/api/mcp", { id, operation });
      await ws.refresh();
      toast.success(
        operation === "discover"
          ? `${result.tools.length} tools discovered`
          : "Connection verified",
      );
    } catch (e) {
      await ws.refresh();
      toast.error((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      <PageTitle
        eyebrow="WORKSPACE SETTINGS"
        title="Settings"
        description="Manage knowledge sources, capabilities and the controls that build trust."
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="wide-tabs">
          {[
            "Integrations",
            "Models",
            "MCP servers",
            "Preferences",
            "Governance",
            "Product phases",
          ].map((x) => (
            <TabsTrigger value={x} key={x}>
              {x}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="Integrations">
          <div className="notice">
            <Link2 size={18} /> Source-labelled documents are sample data. No
            enterprise account is connected.
          </div>
          <div className="integration-grid">
            {integrations.map((c) => (
              <article className="integration-card" key={c.name}>
                <span className={`integration-logo ${c.color}`}>
                  {c.letter}
                </span>
                <h3>{c.name}</h3>
                <p>{c.description}</p>
                {c.name === "Notion" ? (
                  <>
                    <Badge tone={notion?.reauth ? "amber" : notion?.connected ? "green" : "neutral"}>
                      {notion?.reauth ? "Reconnect needed" : notion?.connected ? "Connected · MCP" : "Not connected"}
                    </Badge>
                    {notion?.connected ? (
                      <button
                        className="secondary-button"
                        disabled={busy === "notion"}
                        onClick={() => void disconnectNotion()}
                      >
                        Disconnect
                      </button>
                    ) : (
                      <button className="primary-button" onClick={connectNotion}>
                        Connect Notion <ArrowUpRight size={14} />
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <Badge>Not connected</Badge>
                    <button
                      className="secondary-button"
                      onClick={() => setConnector(c.name)}
                    >
                      Connection setup <ArrowUpRight size={14} />
                    </button>
                  </>
                )}
              </article>
            ))}
          </div>
          <div className="panel">
            <h3>One intelligence layer, across your channels</h3>
            <p>
              Teams, Slack and WhatsApp can use the same knowledge and
              permission model through your approved integration. Channel
              adapters are not connected in this build.
            </p>
            <div className="channel-list">
              {[
                "Microsoft Teams",
                "Slack",
                "WhatsApp",
                "Google Drive",
                "OneDrive",
                "CRM",
                "HR systems",
                "Git repositories",
                "Analytics",
                "Internal APIs",
              ].map((c) => (
                <button key={c} onClick={() => setConnector(c)}>
                  <Globe size={15} />
                  {c}
                  <Badge>Setup required</Badge>
                </button>
              ))}
            </div>
          </div>
          <div className="panel">
            <h3>Approved AI gateway</h3>
            <Badge tone={ws.state.aiConfigured ? "green" : "amber"}>
              {ws.state.aiConfigured ? "Configured" : "Not connected"}
            </Badge>
            <p>
              {ws.state.aiConfigured
                ? `Ask uses ${ws.state.aiModel || "the configured model"}. Change it in Models.`
                : "Ask currently returns searchable evidence and structured draft templates. Connect an approved OpenAI-compatible gateway to enable generated answers."}
            </p>
            <button className="secondary-button" onClick={() => setTab("Models")}>
              Manage models
            </button>
          </div>
        </TabsContent>
        <TabsContent value="Models">
          <ModelsPanel ws={ws} />
        </TabsContent>
        <TabsContent value="MCP servers">
          <div className="toolbar">
            <div>
              <h3>Capabilities behind the conversation</h3>
              <p className="muted-note">
                Connect approved HTTPS MCP endpoints and review their tools.
              </p>
            </div>
            <button className="primary-button" onClick={() => setAdd(true)}>
              <Plus size={16} />
              Add server
            </button>
          </div>
          <article className="panel server-card">
            <div className="split-row">
              <div>
                <h3>Notion · hosted MCP</h3>
                <p>{notion?.server ?? "https://mcp.notion.com/mcp"}</p>
              </div>
              <Badge tone={notion?.connected ? "green" : "neutral"}>
                {notion?.connected ? "Connected" : "Not connected"}
              </Badge>
            </div>
            <p className="muted-note">
              Signs in with your Notion account (OAuth). Ask calls the read-only
              tools notion-search and notion-fetch, and only sees pages your
              Notion account can access.
              {notion?.connectedAt
                ? ` Connected ${new Date(notion.connectedAt).toLocaleDateString()}.`
                : ""}
            </p>
            <div className="button-row">
              {notion?.connected ? (
                <button
                  className="secondary-button"
                  disabled={busy === "notion"}
                  onClick={() => void disconnectNotion()}
                >
                  Disconnect
                </button>
              ) : (
                <button className="primary-button" onClick={connectNotion}>
                  Connect Notion <ArrowUpRight size={14} />
                </button>
              )}
            </div>
          </article>
          {servers.length ? (
            servers.map((r) => (
              <article className="panel server-card" key={r.id}>
                <div className="split-row">
                  <div>
                    <h3>{r.data.title}</h3>
                    <p>{r.data.url}</p>
                  </div>
                  <Switch
                    aria-label={`Enable ${r.data.title}`}
                    checked={!!r.data.enabled}
                    // A server can only be switched on after a successful test.
                    disabled={!r.data.enabled && r.data.status !== "Connected"}
                    title={!r.data.enabled && r.data.status !== "Connected" ? "Test the connection first" : undefined}
                    onCheckedChange={async (enabled) => {
                      try {
                        await ws.save("mcp", { title: r.data.title, url: r.data.url, enabled }, r.id);
                      } catch {}
                    }}
                  />
                </div>
                <div className="split-row">
                  <Badge
                    tone={r.data.status === "Connected" ? "green" : "neutral"}
                  >
                    {r.data.status ?? "Not tested"}
                  </Badge>
                  <div className="button-row">
                    <button
                      className="secondary-button"
                      disabled={busy === r.id}
                      onClick={() => void test(r.id, "test")}
                    >
                      Test connection
                    </button>
                    <button
                      className="secondary-button"
                      disabled={busy === r.id}
                      onClick={() => void test(r.id, "discover")}
                    >
                      Discover tools
                    </button>
                    <button
                      className="secondary-button"
                      onClick={() => setSelected(r)}
                    >
                      Permissions
                    </button>
                    <button
                      className="secondary-button danger-button"
                      disabled={busy === r.id}
                      onClick={async () => {
                        if (removingServer !== r.id) {
                          setRemovingServer(r.id);
                          return;
                        }
                        setBusy(r.id);
                        try {
                          await ws.remove(r.id);
                          toast.success(`${r.data.title} removed`);
                        } catch {
                        } finally {
                          setBusy("");
                          setRemovingServer("");
                        }
                      }}
                    >
                      {removingServer === r.id ? "Confirm remove" : "Remove"}
                    </button>
                  </div>
                </div>
                <p className="muted-note">
                  {(r.data.tools ?? []).length} discovered tools · Credentials
                  are managed on the server.
                </p>
              </article>
            ))
          ) : (
            <Empty
              title="No MCP servers yet"
              description="Add an approved endpoint, test authentication, discover tools and choose their permissions."
              action={
                <button
                  className="secondary-button"
                  onClick={() => setAdd(true)}
                >
                  <Plus size={16} />
                  Add your first server
                </button>
              }
            />
          )}
          <div className="notice">
            <Lock size={17} /> Ask can call the read-only tools you enable on a
            connected server (Agent skills → Custom MCP tools). Write tools are
            never called automatically. Nothing is written back to Notion.
          </div>
        </TabsContent>
        <TabsContent value="Preferences">
          <div className="panel">
            <h3>Your intelligence preferences</h3>
            {[
              [
                "evidence",
                "Evidence mode by default",
                "Prefer verified organisational sources when starting a conversation.",
              ],
              [
                "proactive",
                "Show proactive insights",
                "Surface the sample intelligence feed on your home screen.",
              ],
            ].map(([key, label, description]) => (
              <div className="setting-row" key={key}>
                <div>
                  <strong>{label}</strong>
                  <p>{description}</p>
                </div>
                <Switch
                  aria-label={label}
                  checked={settings?.data[key] ?? true}
                  onCheckedChange={async (value) => {
                    try {
                      // Partial patch: the server merges it into the one settings record.
                      await ws.save("settings", { [key]: value, __merge: true });
                      toast.success("Preference saved");
                    } catch {}
                  }}
                />
              </div>
            ))}
          </div>
        </TabsContent>
        <TabsContent value="Governance">
          <div className="two-column">
            <div className="panel">
              <ShieldCheck size={23} />
              <h3>Identity & access</h3>
              <p>
                Private site access protects this workspace. Uploaded documents,
                conversations and saved records are scoped to the authenticated
                user on the server.
              </p>
              <Badge tone="green">User-scoped records</Badge>
              <p>
                Enterprise group synchronisation and source ACL ingestion
                require your connector implementation.
              </p>
            </div>
            <div className="panel">
              <Lock size={23} />
              <h3>Human control</h3>
              <p>
                External updates are staged as drafts. Approving a draft records
                approval without sending it. Claims with missing evidence remain
                visible.
              </p>
              <Badge>External execution disabled</Badge>
            </div>
          </div>
          <div className="panel">
            <h3>Audit trail</h3>
            <p>Recent workspace activity, recorded on the server.</p>
            {ws.state.audit.length ? (
              ws.state.audit.map((a) => (
                <div className="audit-row" key={a.id}>
                  <Activity size={15} />
                  <div>
                    <strong>{a.event}</strong>
                    <small>{a.detail}</small>
                  </div>
                  <time>{new Date(a.created_at).toLocaleString()}</time>
                </div>
              ))
            ) : (
              <Empty
                title="No activity yet"
                description="Searches, uploads, saved work and approvals appear here."
              />
            )}
          </div>
        </TabsContent>
        <TabsContent value="Product phases">
          <div className="notice">
            <Layers size={18} /> All four phases have working product surfaces.
            Live enterprise retrieval, autonomous agents and channel execution
            require additional integration work.
          </div>
          <div className="phase-grid">
            {phases.map((p, i) => (
              <article className="panel phase-card" key={p.name}>
                <span className="phase-number">0{i + 1}</span>
                <h2>{p.name}</h2>
                <p>{p.promise}</p>
                <ul>
                  {p.features.map((f) => (
                    <li key={f}>
                      <Check size={14} />
                      {f}
                    </li>
                  ))}
                </ul>
                <button
                  className="text-link"
                  onClick={() =>
                    setView(["Ask", "Clients", "Actions", "My intelligence"][i])
                  }
                >
                  Explore {p.name.toLowerCase()} <ArrowRight size={14} />
                </button>
              </article>
            ))}
          </div>
          <div className="panel">
            <h3>Implementation boundaries</h3>
            <p>
              Search is lexical, with AI synthesis and tool use through your
              gateway: web search, page reading, CSV analysis, charts, Word
              export, image reading, scheduled jobs and read-only MCP tools.
              Relationships, conflicts and proactive insights use a curated
              sample corpus. Claim checking finds text overlap; it does not
              independently establish truth. Scheduled jobs run while the app is
              open. Enterprise ACL sync, automatic knowledge-graph construction
              and autonomous write actions are not implemented.
            </p>
          </div>
        </TabsContent>
      </Tabs>
      <Dialog open={add} onOpenChange={setAdd}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add an MCP server</DialogTitle>
            <DialogDescription>
              Use an approved HTTPS endpoint. Authentication secrets stay on the
              server.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                const u = new URL(url);
                if (u.protocol !== "https:" || u.username || u.password)
                  throw new Error(
                    "Use an HTTPS URL without embedded credentials.",
                  );
                setBusy("new");
                await ws.save("mcp", {
                  title: title.trim(),
                  url: u.toString(),
                  enabled: false,
                  status: "Not tested",
                  tools: [],
                });
                setAdd(false);
                setTitle("");
                setUrl("");
                toast.success(
                  "Server added. Test the connection before enabling it.",
                );
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setBusy("");
              }
            }}
          >
            <label className="field-label">
              Server name
              <input
                required
                maxLength={80}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Project intelligence"
              />
            </label>
            <label className="field-label">
              Endpoint URL
              <input
                required
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://your-approved-server.example/mcp"
              />
            </label>
            <button
              className="primary-button"
              disabled={busy === "new" || !title.trim()}
              type="submit"
            >
              Add server
            </button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="detail-dialog">
          <DialogHeader>
            <DialogTitle>Tool permissions</DialogTitle>
            <DialogDescription>
              {selected?.data.title} · All discovered tools begin disabled.
            </DialogDescription>
          </DialogHeader>
          {(selected?.data.tools ?? []).length ? (
            (selected.data.tools as any[]).map((t, i) => (
              <div className="setting-row" key={t.name}>
                <div>
                  <strong>{t.name}</strong>
                  <p>{t.description}</p>
                  <Badge tone={t.access === "Read" ? "green" : "amber"}>
                    {t.access} ·{" "}
                    {t.access === "Write"
                      ? "Approval required"
                      : "Review server trust"}
                  </Badge>
                </div>
                <Switch
                  aria-label={`Allow ${t.name}`}
                  checked={t.enabled}
                  onCheckedChange={(enabled) =>
                    setSelected({
                      ...selected,
                      data: {
                        ...selected.data,
                        tools: selected.data.tools.map((x: any, j: number) =>
                          j === i ? { ...x, enabled } : x,
                        ),
                      },
                    })
                  }
                />
              </div>
            ))
          ) : (
            <p>Discover tools first to review permissions.</p>
          )}
          <button
            className="primary-button"
            onClick={async () => {
              try {
                // Only the per-tool switches are editable; the server keeps its discovery.
                await ws.save(
                  "mcp",
                  {
                    title: selected.data.title,
                    url: selected.data.url,
                    enabled: selected.data.enabled,
                    tools: (selected.data.tools ?? []).map((t: any) => ({ name: t.name, enabled: !!t.enabled })),
                  },
                  selected.id,
                );
                setSelected(null);
                toast.success("Tool permissions saved");
              } catch {}
            }}
          >
            Save permissions
          </button>
          <p className="muted-note">
            Administrator setup: add this server’s exact hostname to
            MCP_ALLOWED_HOSTS. If authentication is required, configure the
            secret named MCP_TOKEN_
            {selected?.id?.toUpperCase().replace(/-/g, "_")}.
          </p>
        </DialogContent>
      </Dialog>
      <Dialog open={!!connector} onOpenChange={(o) => !o && setConnector("")}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect {connector}</DialogTitle>
            <DialogDescription>Enterprise connection setup</DialogDescription>
          </DialogHeader>
          <p>
            To use live {connector} data, connect an approved MCP adapter with
            read access to the intended sources. Your adapter must preserve user
            permissions and source provenance.
          </p>
          <p className="muted-note">
            A native {connector} OAuth connector is not implemented in this
            build. No account access has been requested or granted.
          </p>
          <button
            className="primary-button"
            onClick={() => {
              setConnector("");
              setTab("MCP servers");
              setAdd(true);
            }}
          >
            Add approved MCP endpoint <ArrowRight size={15} />
          </button>
        </DialogContent>
      </Dialog>
    </>
  );
}
