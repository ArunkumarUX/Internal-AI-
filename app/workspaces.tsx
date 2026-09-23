"use client";
import { useState, useEffect } from "react";
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
  ExternalLink,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
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
  clients,
  insights,
  initialActions,
  phases,
  type Source,
} from "@/lib/knowledge";
import { api, downloadText, type Workspace } from "@/lib/client";
type Props = {
  ws: Workspace;
  ask: (q: string, options?: { attachmentIds?: string[] }) => void;
  openSource: (s: Source) => void;
  view: string;
  setView: (v: string) => void;
  upload: () => void;
  initialClaim?: string;
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
  const list = ws.allSources.filter(
    (s) =>
      (filter === "All sources" || s.system === filter) &&
      `${s.title} ${s.content} ${s.tags.join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
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
              <SelectTrigger className="w-[170px]">
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
            <span>{list.length} documents · sample sources are labelled</span>
            {selected.length > 0 && (
              <button className="text-link" onClick={() => setComparing(true)}>
                Compare {selected.length} selected <ArrowRight size={14} />
              </button>
            )}
          </div>
          <div className="table-surface">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"> </TableHead>
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
                    <TableCell>
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
          {!list.length && (
            <Empty
              title="No documents found"
              description="Try a broader search or upload a document."
            />
          )}
        </TabsContent>
        <TabsContent value="health">
          <div className="metric-grid">
            <div>
              <strong>
                {ws.allSources.filter((s) => s.status === "Verified").length}
              </strong>
              <span>Verified sources</span>
            </div>
            <div>
              <strong>1</strong>
              <span>Superseded reference</span>
            </div>
            <div>
              <strong>1</strong>
              <span>Potential conflict</span>
            </div>
            <div>
              <strong>1</strong>
              <span>Evidence gap</span>
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
              .filter((d) => selected.includes(d.id))
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
export function ClientsView({ ws, openSource, ask }: Props) {
  const [selected, setSelected] = useState(clients[0].name);
  const [tab, setTab] = useState("Overview");
  const c = clients.find((x) => x.name === selected)!;
  return (
    <>
      <PageTitle
        eyebrow="CLIENT INTELLIGENCE"
        title="The whole relationship."
        description="Documents, decisions and people. One connected client view."
      />
      <div className="client-switcher">
        {clients.map((x) => (
          <button
            className={selected === x.name ? "selected" : ""}
            key={x.name}
            onClick={() => setSelected(x.name)}
          >
            <span className={`client-mark ${x.color}`}>{x.initials}</span>
            <div>
              <strong>{x.name}</strong>
              <small>{x.industry}</small>
            </div>
            <ChevronRight size={16} />
          </button>
        ))}
      </div>
      <div className="client-hero">
        <div className={`client-mark large ${c.color}`}>{c.initials}</div>
        <div>
          <div className="inline-badges">
            <Badge>Sample account</Badge>
            {c.tags.map((t) => (
              <Badge key={t}>{t}</Badge>
            ))}
          </div>
          <h2>{c.name}</h2>
          <p>{c.description}</p>
        </div>
        <button
          className="primary-button"
          onClick={() => ask(`Prepare me for a meeting with ${c.name}`)}
        >
          Prepare a meeting brief <ArrowUpRight size={16} />
        </button>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="wide-tabs">
          {[
            "Overview",
            "Projects",
            "Opportunities",
            "Documents",
            "People",
            "Decisions",
            "Actions",
          ].map((x) => (
            <TabsTrigger value={x} key={x}>
              {x}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="Overview">
          <div className="two-column">
            <article className="panel">
              <h3>Relationship at a glance</h3>
              <dl>
                <dt>Relationship owner</dt>
                <dd>{c.owner}</dd>
                <dt>Industry</dt>
                <dd>{c.industry}</dd>
                <dt>Current focus</dt>
                <dd>{c.opportunity}</dd>
                <dt>Commercial status</dt>
                <dd>Discovery / pilot · unconfirmed expansion</dd>
              </dl>
              <button
                className="text-link"
                onClick={() => ask(`Tell me everything useful about ${c.name}`)}
              >
                Build a full client brief <ArrowRight size={14} />
              </button>
            </article>
            <article className="panel softly-blue">
              <span className="eyebrow">AI INSIGHT · SAMPLE EVIDENCE</span>
              <h3>
                {c.name === "Northstar Bank"
                  ? "A focused pilot, with a clear path forward."
                  : "An opportunity to build the evidence."}
              </h3>
              <p>{c.risk}</p>
              <p>
                Use the next conversation to clarify the decision, accountable
                owner and evidence required.
              </p>
              <SourcesList
                ids={c.documents.slice(0, 2)}
                ws={ws}
                openSource={openSource}
              />
            </article>
          </div>
          <article className="panel">
            <h3>Recent activity</h3>
            {c.documents.slice(0, 3).map((id) => {
              const s = ws.allSources.find((d) => d.id === id)!;
              return (
                <button
                  className="activity-row"
                  key={id}
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
              );
            })}
          </article>
        </TabsContent>
        <TabsContent value="Projects">
          <article className="panel">
            <Badge tone="blue">
              {c.name === "Northstar Bank" ? "Pilot in delivery" : "Discovery"}
            </Badge>
            <h3>
              {c.name === "Northstar Bank"
                ? "Project Atlas"
                : "Claims document triage discovery"}
            </h3>
            <p>
              {c.name === "Northstar Bank"
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
        </TabsContent>
        <TabsContent value="Opportunities">
          <article className="panel">
            <Badge tone="green">
              Potential opportunity · requires validation
            </Badge>
            <h3>{c.opportunity}</h3>
            <p>
              Connect the client’s requirements with reusable banking evidence
              and the right internal experts. Validate domain fit and avoid
              inferring a signed opportunity.
            </p>
            <SourcesList
              ids={["banking-cases", ...c.documents.slice(0, 1)]}
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
        </TabsContent>
        <TabsContent value="Documents">
          {c.documents.map((id) => {
            const s = ws.allSources.find((d) => d.id === id)!;
            return (
              <button
                className="document-row"
                key={id}
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
            );
          })}
        </TabsContent>
        <TabsContent value="People">
          <PeopleView ws={ws} openSource={openSource} ask={ask} compact />
        </TabsContent>
        <TabsContent value="Decisions">
          {ws.allSources
            .filter((s) => s.kind === "Decision" && s.client === c.name)
            .map((s) => (
              <article className="panel" key={s.id}>
                <h3>{s.title}</h3>
                <p>{s.content}</p>
                <SourcesList ids={[s.id]} ws={ws} openSource={openSource} />
              </article>
            ))}
          {c.name !== "Northstar Bank" && (
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
      </Tabs>
    </>
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
            className="person-card"
            key={p.id}
            onClick={() => setPerson(p)}
          >
            <span className={`person-avatar ${p.color}`}>{p.initials}</span>
            <h3>{p.name}</h3>
            <p>{p.role}</p>
            <small>{p.location} · Sample profile</small>
            <div className="skill-tags">
              {p.skills.map((s) => (
                <Badge key={s}>{s}</Badge>
              ))}
            </div>
            <div className="person-reason">{p.description}</div>
            <span className="card-link">
              {p.evidence.length} supporting sources <ArrowUpRight size={15} />
            </span>
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
              <span className={`person-avatar ${person.color}`}>
                {person.initials}
              </span>
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
  const [review, setReview] = useState<Record<string, any> | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState("");
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
      (filter === "Open"
        ? !["Completed", "Dismissed", "Approved draft"].includes(a.status)
        : a.status === filter),
  );
  async function change(a: Record<string, any>, status: string) {
    setBusy(true);
    try {
      await ws.save(
        "action",
        { ...a, status, ...(status === "Completed" ? { outcome } : {}) },
        a.id,
      );
      if (status === "Completed" && outcome.trim())
        await ws.save("outcome", {
          title: a.title,
          content: outcome,
          client: a.client,
          source: a.source,
        });
      toast.success(
        status === "Approved draft"
          ? "Draft approved. No external message has been sent."
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
            {["Open", "Completed", "All"].map((x) => (
              <TabsTrigger key={x} value={x}>
                {x}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <span className="muted-note">
          {
            actions.filter(
              (a) => !["Completed", "Dismissed"].includes(a.status),
            ).length
          }{" "}
          active commitments
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
              <label className="field-label">
                Outcome / learning
                <textarea
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value)}
                  placeholder="What happened? Capture a lesson for the next engagement."
                />
              </label>
              <div className="dialog-actions">
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => void change(review, "Dismissed")}
                >
                  Dismiss
                </button>
                {review.kind === "External draft" &&
                  review.status !== "Approved draft" && (
                    <button
                      className="primary-button"
                      disabled={busy}
                      onClick={() => void change(review, "Approved draft")}
                    >
                      Approve draft
                    </button>
                  )}
                <button
                  className="primary-button"
                  disabled={busy}
                  onClick={() => void change(review, "Completed")}
                >
                  Mark complete
                </button>
              </div>
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
  const list = ws.state.records.filter(
    (r) =>
      ["saved", "memory", "outcome"].includes(r.kind) &&
      String(r.data.title).toLowerCase().includes(q.toLowerCase()),
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
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
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
          <button
            className="primary-button"
            onClick={() => downloadText(open?.title, open?.content)}
          >
            Export Markdown <Download size={15} />
          </button>
        </DialogContent>
      </Dialog>
    </>
  );
}
export function Pricing({ ws, openSource }: Props) {
  const [weeks, setWeeks] = useState(12);
  const [consultants, setConsultants] = useState(2);
  const [contingency, setContingency] = useState(10);
  const [cost, setCost] = useState(0);
  const [saved, setSaved] = useState<{ label: string; total: number }[]>([]);
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
          <label className="field-label">
            Duration (weeks)
            <input
              type="number"
              min="1"
              max="104"
              value={weeks}
              onChange={(e) =>
                setWeeks(Math.min(104, Math.max(1, Number(e.target.value))))
              }
            />
          </label>
          <label className="field-label">
            Full-time consultants
            <input
              type="number"
              min="1"
              max="30"
              value={consultants}
              onChange={(e) =>
                setConsultants(
                  Math.min(30, Math.max(1, Number(e.target.value))),
                )
              }
            />
          </label>
          <label className="field-label">
            Contingency (%)
            <input
              type="number"
              min="0"
              max="100"
              value={contingency}
              onChange={(e) =>
                setContingency(
                  Math.min(100, Math.max(0, Number(e.target.value))),
                )
              }
            />
          </label>
          <label className="field-label">
            Your authorised total delivery cost (£, optional)
            <input
              type="number"
              min="0"
              value={cost}
              onChange={(e) => setCost(Math.max(0, Number(e.target.value)))}
            />
          </label>
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
                <dd>{(((total - cost) / total) * 100).toFixed(1)}%</dd>
              </>
            )}
          </dl>
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
            onClick={async () => {
              try {
                await ws.save("saved", {
                  title: `Pricing scenario · ${weeks} weeks`,
                  content: `Illustrative planning estimate: £${total.toLocaleString()}.\nDuration: ${weeks} weeks. Consultants: ${consultants}. Contingency: ${contingency}%.\nArchitect and delivery manager at 50%.\nExcludes tax, expenses, third-party services. Sample reference rates; not an approved offer.`,
                  sourceIds: ["pricing-current"],
                });
                toast.success("Scenario saved");
              } catch {}
            }}
          >
            Save scenario
          </button>
        </div>
      </div>
      {saved.length > 0 && (
        <div className="panel">
          <h3>Scenario comparison</h3>
          {saved.map((s, i) => (
            <div className="comparison-row" key={i}>
              <span>{s.label}</span>
              <strong>£{s.total.toLocaleString()}</strong>
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
export function Proposal({ ws, ask, openSource, upload }: Props) {
  const [checks, setChecks] = useState<string[]>([]);
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
              <TableHead>Reviewed</TableHead>
              <TableHead>Requirement</TableHead>
              <TableHead>Evidence status</TableHead>
              <TableHead>Source</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {requirements.map(([id, title, source, status]) => (
              <TableRow key={id}>
                <TableCell>
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
            onClick={async () => {
              try {
                await ws.save("saved", {
                  title: "Northstar RFP · Compliance review",
                  content: requirements
                    .map(
                      ([id, title, , status]) =>
                        `${checks.includes(id) ? "[reviewed]" : "[unreviewed]"} ${id}: ${title} — ${status}`,
                    )
                    .join("\n"),
                  sourceIds: ["northstar-rfp"],
                });
                toast.success("Compliance review saved");
              } catch {}
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
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste the important statements from a pitch, proposal, brief or CV…"
          />
        </label>
        <div className="split-row">
          <small className="muted-note">
            Text-based screening. Human review remains essential.
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
          </div>
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
export function Settings({ ws, setView }: Props) {
  const [tab, setTab] = useState("Integrations");
  const [add, setAdd] = useState(false);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState("");
  const [selected, setSelected] = useState<any>(null);
  const [connector, setConnector] = useState("");
  const settings = ws.state.records.find((r) => r.kind === "settings");
  const servers = ws.state.records.filter((r) => r.kind === "mcp");
  const [notion, setNotion] = useState<{
    connected: boolean;
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
                    <Badge tone={notion?.connected ? "green" : "neutral"}>
                      {notion?.connected ? "Connected · MCP" : "Not connected"}
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
                ? "Ask uses the configured gateway and supplies accessible evidence with each question."
                : "Ask currently returns searchable evidence and structured draft templates. Connect an approved OpenAI-compatible gateway, such as LiteLLM, to enable generated answers."}
            </p>
            <details>
              <summary>Administrator configuration</summary>
              <p>
                Configure AI_GATEWAY_URL, AI_GATEWAY_KEY and AI_MODEL as
                server-side runtime values. Credentials never belong in a
                browser form or saved document.
              </p>
            </details>
          </div>
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
                    onCheckedChange={async (enabled) => {
                      try {
                        await ws.save("mcp", { ...r.data, enabled }, r.id);
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
            <Lock size={17} /> Custom servers support discovery only. The Notion
            connection runs read-only search and fetch tools; nothing is written
            back to Notion.
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
              [
                "compact",
                "Compact evidence cards",
                "Use a denser layout when reviewing document sources.",
              ],
            ].map(([key, label, description]) => (
              <div className="setting-row" key={key}>
                <div>
                  <strong>{label}</strong>
                  <p>{description}</p>
                </div>
                <Switch
                  aria-label={label}
                  checked={settings?.data[key] ?? key !== "compact"}
                  onCheckedChange={async (value) => {
                    try {
                      await ws.save(
                        "settings",
                        { ...settings?.data, [key]: value },
                        settings?.id,
                      );
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
              Search is lexical, with optional AI synthesis through your
              gateway. Relationships, conflicts and proactive insights use a
              curated sample corpus. Claim checking finds text overlap; it does
              not independently establish truth. Office files are extracted as
              text; spreadsheet calculations, image OCR, enterprise ACL sync,
              automatic knowledge-graph construction, scheduled insight
              generation and autonomous multi-agent execution are not
              implemented.
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
                await ws.save("mcp", selected.data, selected.id);
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
