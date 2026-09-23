"use client";
import { useState, useRef, useEffect } from "react";
import {
  Sparkles,
  MessageCircle,
  Search,
  BookOpen,
  Building2,
  Users,
  CheckCheck,
  Lightbulb,
  Bookmark,
  Settings2,
  ArrowUp,
  Plus,
  ArrowUpRight,
  ChevronRight,
  ShieldCheck,
  Bell,
  History,
  FileText,
  Download,
  Copy,
  Check,
  Brain,
  Send,
  LoaderCircle,
  X,
  Calculator,
  ClipboardCheck,
  Layers,
  Globe,
  ExternalLink,
  ArrowLeft,
  RefreshCw,
} from "lucide-react";
import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { Toaster, toast } from "sonner";
import { sources, insights, type Source } from "@/lib/knowledge";
import { useWorkspace, downloadText } from "@/lib/client";
import { localAnswer } from "@/lib/answer";
import {
  Knowledge,
  ClientsView,
  PeopleView,
  ActionsView,
  SavedWork,
  Pricing,
  Proposal,
  ClaimChecker,
  Settings,
  Badge,
} from "./workspaces";
import { UploadSheet } from "./upload-sheet";
import { Intelligence } from "./intelligence";
import { ChatExchange, type ChatMessage } from "./chat";
const items = [
  ["Ask", MessageCircle],
  ["My intelligence", Sparkles],
  ["Knowledge", BookOpen],
  ["Clients", Building2],
  ["People", Users],
  ["Actions", CheckCheck],
  ["Saved work", Bookmark],
] as const;
const workflows = [
  ["Proposals", ClipboardCheck],
  ["Pricing", Calculator],
  ["Claim checker", ShieldCheck],
] as const;
type Message = ChatMessage;
function CloseMobileSidebar({ view }: { view: string }) {
  const { setOpenMobile } = useSidebar();
  useEffect(() => setOpenMobile(false), [view, setOpenMobile]);
  return null;
}
export default function Home() {
  const ws = useWorkspace();
  const [view, setView] = useState("Ask");
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState("All knowledge");
  const [evidence, setEvidence] = useState(true);
  const [source, setSource] = useState<Source | null>(null);
  const [command, setCommand] = useState(false);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [review, setReview] = useState<{
    type: string;
    message: Message;
  } | null>(null);
  const [memoryTitle, setMemoryTitle] = useState("");
  const [memoryText, setMemoryText] = useState("");
  const [saving, setSaving] = useState(false);
  const [claimDraft, setClaimDraft] = useState("");
  const [openGroups, setOpenGroups] = useState({
    workspaces: true,
    create: true,
  });
  const [historyOpen, setHistoryOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const preferences = ws.state.records.find((r) => r.kind === "settings")?.data;
  const dismissed = ws.state.records
    .filter((r) => r.kind === "dismissed")
    .map((r) => r.data.insightId);
  const fresh = insights.filter((i) => !dismissed.includes(i.id));
  const recent = ws.state.records
    .filter((r) => r.kind === "conversation")
    .slice(0, 3);
  const userName = ws.state.user?.displayName ?? "Your workspace";
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommand((v) => !v);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (preferences?.evidence !== undefined)
      setEvidence(!!preferences.evidence);
  }, [preferences?.evidence]);
  const lastId = messages[messages.length - 1]?.id;
  useEffect(() => {
    if (!lastId) return;
    document
      .querySelector(`[data-exchange="${lastId}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [lastId]);
  function toggleGroup(key: "workspaces" | "create") {
    setOpenGroups((current) => {
      const opening = !current[key];
      if (opening) {
        const id =
          key === "workspaces" ? "sidebar-workspaces" : "sidebar-create";
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            document
              .getElementById(id)
              ?.scrollIntoView({ block: "nearest" });
          });
        });
      }
      return { ...current, [key]: opening };
    });
  }
  function navigate(v: string) {
    setView(v);
    setCommand(false);
    if (typeof window !== "undefined")
      window.history.replaceState(
        null,
        "",
        `/#${v.toLowerCase().replaceAll(" ", "-")}`,
      );
  }
  useEffect(() => {
    const page = decodeURIComponent(window.location.hash.slice(1));
    const match = [
      ...items.map((x) => x[0]),
      ...workflows.map((x) => x[0]),
      "Settings",
    ].find((x) => x.toLowerCase().replaceAll(" ", "-") === page);
    if (match) setView(match);
    const notion = new URLSearchParams(window.location.search).get("notion");
    if (notion) {
      if (notion === "connected")
        toast.success("Notion connected. Ask now searches your Notion pages.");
      else if (notion === "signin") toast.error("Sign in, then connect Notion again.");
      else toast.error("Notion couldn’t be connected. Please try again.");
      window.history.replaceState(null, "", `/${window.location.hash}`);
    }
  }, []);
  async function ask(value = prompt, attachmentIds?: string[]) {
    const query = value.trim();
    if (!query || busy || uploading) return;
    navigate("Ask");
    setBusy(true);
    const pendingId = crypto.randomUUID();
    const ids = attachmentIds ?? attachments;
    const history = messages
      .filter((m) => !m.error && m.answer.text)
      .slice(-4)
      .flatMap((m) => [
        { role: "user", content: m.query },
        { role: "assistant", content: m.answer.text },
      ]);
    const patch = (fn: (m: Message) => Message) =>
      setMessages((list) => list.map((m) => (m.id === pendingId ? fn(m) : m)));
    setMessages((list) => [
      ...list,
      {
        id: pendingId,
        query,
        answer: { text: "", title: query.slice(0, 80), sourceIds: [], mode: "", followups: [] },
        sources: [],
        steps: [],
        streaming: true,
        at: new Date().toISOString(),
      },
    ]);
    setPrompt("");
    setAttachments([]);
    let text = "";
    try {
      if (!ws.state.user) {
        const answer = localAnswer(query, ws.allSources, scope, evidence);
        answer.mode = "Sample evidence preview · Sign in to save";
        patch((m) => ({
          ...m,
          answer,
          sources: ws.allSources.filter((s) => answer.sourceIds.includes(s.id)),
        }));
        return;
      }
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ query, scope, verified: evidence, attachmentIds: ids, history }),
      });
      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "The assistant is unavailable. Please retry.");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let split;
        while ((split = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          const event = frame.match(/^event: (.*)$/m)?.[1];
          const raw = frame.match(/^data: (.*)$/m)?.[1];
          if (!event || !raw) continue;
          const data = JSON.parse(raw);
          if (event === "status") patch((m) => ({ ...m, steps: [...m.steps, data.step] }));
          else if (event === "sources") patch((m) => ({ ...m, sources: data.sources }));
          else if (event === "delta") {
            text += data.text;
            patch((m) => ({ ...m, answer: { ...m.answer, text } }));
          } else if (event === "done")
            patch((m) => ({
              ...m,
              answer: {
                text: data.text,
                title: data.title,
                sourceIds: data.sourceIds,
                mode: data.mode,
                followups: data.followups ?? [],
              },
            }));
          else if (event === "error") throw new Error(data.error);
        }
      }
      void ws.refresh();
    } catch (e) {
      const message = (e as Error).message || "The assistant is unavailable. Please retry.";
      patch((m) => ({ ...m, error: message }));
      if (!text) setPrompt(query);
    } finally {
      patch((m) => ({ ...m, streaming: false }));
      setBusy(false);
    }
  }
  function retry(m: Message) {
    setMessages((list) => list.filter((x) => x.id !== m.id));
    setTimeout(() => void ask(m.query), 0);
  }
  async function uploadFiles(files: FileList | null) {
    if (!files?.length) return;
    if (!ws.state.user) {
      toast.error("Sign in to upload and save documents.");
      return;
    }
    setUploading(true);
    try {
      const added: string[] = [];
      for (const file of Array.from(files).slice(0, 5)) {
        const form = new FormData();
        form.append("file", file);
        const response = await fetch("/api/upload", {
          method: "POST",
          body: form,
        });
        const result: any = await response.json();
        if (!response.ok) throw new Error(result.error);
        added.push(result.id);
        toast.success(result.notice);
      }
      await ws.refresh();
      setAttachments((a) => [...a, ...added].slice(0, 10));
      navigate("Ask");
      inputRef.current?.focus();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  async function saveAnswer(m: Message) {
    try {
      await ws.save("saved", {
        title: m.answer.title,
        content: m.answer.text,
        sourceIds: m.answer.sourceIds,
      });
      toast.success("Added to saved work");
    } catch {}
  }
  useEffect(() => {
    const context = (document as any).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    Promise.resolve(
      context.registerTool(
        {
          name: "navigate_internal_ai",
          description:
            "Open a workspace section. Does not execute actions or send messages.",
          inputSchema: {
            type: "object",
            properties: {
              section: {
                type: "string",
                enum: [
                  "Ask",
                  "My intelligence",
                  "Knowledge",
                  "Clients",
                  "People",
                  "Actions",
                  "Saved work",
                  "Proposals",
                  "Pricing",
                  "Claim checker",
                  "Settings",
                ],
              },
            },
            required: ["section"],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false },
          execute: (input: any) => {
            if (
              !input ||
              ![
                "Ask",
                "My intelligence",
                "Knowledge",
                "Clients",
                "People",
                "Actions",
                "Saved work",
                "Proposals",
                "Pricing",
                "Claim checker",
                "Settings",
              ].includes(input.section)
            )
              throw new Error("Unknown section");
            navigate(input.section);
            return { section: input.section };
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => {});
    return () => lifecycle.abort();
  }, []);
  const props = {
    ws,
    ask: (q: string, options?: { attachmentIds?: string[] }) =>
      void ask(q, options?.attachmentIds),
    openSource: setSource,
    view,
    setView: navigate,
    upload: () => setUploadOpen(true),
    initialClaim: claimDraft,
  };
  const composer = (
    <div
      className="composer"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void uploadFiles(e.dataTransfer.files);
      }}
    >
      {attachments.length > 0 && (
        <div className="attachment-chips">
          {attachments.map((id) => (
            <span key={id}>
              <FileText size={13} />
              {ws.allSources.find((s) => s.id === id)?.title ?? "Document"}
              <button
                aria-label="Remove attachment"
                onClick={() => setAttachments((a) => a.filter((x) => x !== id))}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <textarea
        ref={inputRef}
        aria-label="Ask your organisation"
        placeholder={
          uploading
            ? "Uploading and indexing your document…"
            : messages.length
              ? "Ask a follow-up…"
              : "Ask a question, explore an idea, or get something done…"
        }
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void ask();
          }
        }}
      />
      <div className="composer-bottom">
        <button
          className="icon-button"
          aria-label="Attach documents"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? (
            <LoaderCircle size={19} className="spin" />
          ) : (
            <Plus size={21} />
          )}
        </button>
        <Select value={scope} onValueChange={setScope}>
          <SelectTrigger aria-label="Knowledge scope" className="scope-trigger">
            <BookOpen size={14} />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[
              "All knowledge",
              "Confluence",
              "Notion",
              "SharePoint",
              "Uploads",
              "Memory",
              "Northstar Bank",
              "Harbour Insurance",
            ].map((x) => (
              <SelectItem key={x} value={x}>
                {x}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="composer-spacer" />
        <label className="evidence">
          <ShieldCheck size={14} />
          Evidence
          <Switch
            aria-label="Evidence mode"
            size="sm"
            checked={evidence}
            onCheckedChange={setEvidence}
          />
        </label>
        <button
          className="send"
          aria-label="Send message"
          disabled={!prompt.trim() || busy || uploading}
          onClick={() => void ask()}
        >
          {busy ? (
            <LoaderCircle className="spin" size={18} />
          ) : (
            <ArrowUp size={19} />
          )}
        </button>
      </div>
    </div>
  );
  return (
    <SidebarProvider>
      <CloseMobileSidebar view={view} />
      <Toaster richColors position="bottom-right" />
      <input
        type="file"
        ref={fileRef}
        hidden
        multiple
        accept=".txt,.md,.csv,.pdf,.docx,.pptx,.xlsx,.png,.jpg,.jpeg,.webp"
        onChange={(e) => void uploadFiles(e.target.files)}
      />
      <Sidebar className="app-sidebar">
        <SidebarHeader>
          <button
            className="brand"
            onClick={() => {
              navigate("Ask");
              setMessages([]);
            }}
          >
            <span className="brand-icon">
              <Sparkles size={21} />
            </span>
            <span>
              Internal<span className="brand-ai">AI</span>
            </span>
          </button>
          <button className="search-button" onClick={() => setCommand(true)}>
            <Search size={16} />
            Search anything<kbd>⌘ K</kbd>
          </button>
        </SidebarHeader>
        <SidebarContent>
          <SidebarMenu>
            {items.map(([label, Icon]) => (
              <SidebarMenuItem key={label}>
                <SidebarMenuButton
                  isActive={view === label}
                  onClick={() => navigate(label)}
                >
                  <Icon />
                  <span>{label}</span>
                  {label === "My intelligence" && fresh.length > 0 && (
                    <span className="nav-count">{fresh.length}</span>
                  )}
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
          <button
            type="button"
            className="side-label side-toggle"
            aria-expanded={openGroups.workspaces}
            aria-controls="sidebar-workspaces"
            onClick={() => toggleGroup("workspaces")}
          >
            <ChevronRight size={14} />
            Workspaces
          </button>
          {openGroups.workspaces && (
            <div id="sidebar-workspaces" className="side-group">
              <button className="workspace" onClick={() => navigate("Clients")}>
                <span className="workspace-dot blue" />
                Northstar Bank
                <ChevronRight size={14} />
              </button>
              <button
                className="workspace"
                onClick={() =>
                  void ask("What is the latest Project Atlas status?")
                }
              >
                <span className="workspace-dot purple" />
                Project Atlas
                <ChevronRight size={14} />
              </button>
            </div>
          )}
          <button
            type="button"
            className="side-label side-toggle"
            aria-expanded={openGroups.create}
            aria-controls="sidebar-create"
            onClick={() => toggleGroup("create")}
          >
            <ChevronRight size={14} />
            Create & review
          </button>
          {openGroups.create && (
            <SidebarMenu id="sidebar-create">
              {workflows.map(([label, Icon]) => (
                <SidebarMenuItem key={label}>
                  <SidebarMenuButton
                    isActive={view === label}
                    onClick={() => navigate(label)}
                  >
                    <Icon />
                    <span>{label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          )}
        </SidebarContent>
        <SidebarFooter>
          <button className="workspace settings-link" aria-current={view === "Settings" ? "page" : undefined} onClick={() => navigate("Settings")}>
            <Settings2 size={17} />
            <span>Settings & integrations</span>
          </button>
          <div className="profile">
            <span className="avatar">
              {ws.state.user ? userName.slice(0, 2).toUpperCase() : "AI"}
            </span>
            <div>
              <strong>
                {userName.length > 24 ? userName.slice(0, 21) + "…" : userName}
              </strong>
              <small>
                {ws.state.user ? "Private workspace" : "Sample preview"}
              </small>
            </div>
            {!ws.state.user ? (
              <a
                className="text-link"
                href="/signin-with-chatgpt?return_to=/"
                target="_top"
              >
                Sign in
              </a>
            ) : (
              <button
                className="icon-button"
                aria-label="Workspace account"
                onClick={() => navigate("Settings")}
              >
                <ChevronRight size={15} />
              </button>
            )}
          </div>
        </SidebarFooter>
      </Sidebar>
      <main className="app-main">
        <header className="topbar">
          <div>
            <SidebarTrigger />
            <span>{view}</span>
          </div>
          <div className="top-actions">
            <span className="workspace-status">
              <i />
              {ws.state.aiConfigured
                ? "AI gateway connected"
                : "Sample knowledge"}
            </span>
            <div className="history-wrap">
              <button
                type="button"
                className="history-button"
                aria-expanded={historyOpen}
                aria-controls="chat-history"
                onClick={() => setHistoryOpen((open) => !open)}
              >
                <History size={16} />
                History
              </button>
              {historyOpen && (
                <div className="history-menu" id="chat-history" role="menu">
                  {recent.length
                    ? recent.map((r) => (
                        <button
                          role="menuitem"
                          key={r.id}
                          onClick={() => {
                            setMessages([
                              {
                                id: r.id,
                                query: r.data.query,
                                answer: {
                                  text: r.data.answer,
                                  title: r.data.title,
                                  sourceIds: r.data.sourceIds,
                                  mode: r.data.mode,
                                  followups: [],
                                },
                                sources: ws.allSources.filter((s) =>
                                  r.data.sourceIds?.includes(s.id),
                                ),
                                steps: [],
                                streaming: false,
                                at: r.updated_at,
                              },
                            ]);
                            setHistoryOpen(false);
                            navigate("Ask");
                          }}
                        >
                          {r.data.title}
                        </button>
                      ))
                    : [
                        "Banking AI use cases",
                        "Northstar meeting preparation",
                      ].map((x) => (
                        <button
                          role="menuitem"
                          key={x}
                          onClick={() => {
                            setHistoryOpen(false);
                            void ask(x);
                          }}
                        >
                          {x}
                        </button>
                      ))}
                </div>
              )}
            </div>
            <button
              type="button"
              className="new-chat-button"
              onClick={() => {
                setMessages([]);
                setPrompt("");
                setAttachments([]);
                setHistoryOpen(false);
                navigate("Ask");
              }}
            >
              <Plus size={16} />
              New chat
            </button>
            <button
              className="icon-button"
              aria-label="Notifications"
              onClick={() => navigate("My intelligence")}
            >
              <Bell size={18} />
            </button>
          </div>
        </header>
        {ws.error && ws.state.user && (
          <div className="storage-error">
            {ws.error}
            <button onClick={() => void ws.refresh()}>Retry</button>
          </div>
        )}
        {view === "Ask" ? (
          messages.length || busy ? (
            <section className="chat-layout">
              <div className="conversation">
                {messages.map((m, i) => (
                  <ChatExchange
                    key={m.id}
                    m={m}
                    last={i === messages.length - 1}
                    onSource={setSource}
                    onAsk={(q) => void ask(q)}
                    onRetry={() => retry(m)}
                    actions={
                      <>
                      <button onClick={() => void saveAnswer(m)}>
                        <Bookmark size={15} />
                        Save
                      </button>
                      <button
                        onClick={() => {
                          navigator.clipboard
                            .writeText(m.answer.text)
                            .then(() => toast.success("Answer copied"))
                            .catch(() =>
                              toast.error("Copy failed. Use Export instead."),
                            );
                        }}
                      >
                        <Copy size={15} />
                        Copy
                      </button>
                      <button
                        onClick={() =>
                          downloadText(m.answer.title, m.answer.text)
                        }
                      >
                        <Download size={15} />
                        Export
                      </button>
                      <button
                        onClick={() => {
                          setClaimDraft(m.answer.text);
                          navigate("Claim checker");
                        }}
                      >
                        <ShieldCheck size={15} />
                        Check claims
                      </button>
                      <button
                        onClick={() => {
                          setReview({ type: "memory", message: m });
                          setMemoryTitle(m.answer.title);
                          setMemoryText(m.answer.text);
                        }}
                      >
                        <Brain size={15} />
                        Save as knowledge
                      </button>
                      <button
                        onClick={() => {
                          setReview({ type: "action", message: m });
                          setMemoryTitle(`Client update · ${m.answer.title}`);
                          setMemoryText(m.answer.text);
                        }}
                      >
                        <Send size={15} />
                        Prepare action
                      </button>
                      </>
                    }
                  />
                ))}
              </div>
              <div className="chat-composer">
                {composer}
                <p className="composer-note">
                  {ws.state.aiConfigured
                    ? "AI can make mistakes. Review sources and approve actions."
                    : "Evidence extracts and draft templates · Connect your approved gateway for AI synthesis."}
                </p>
              </div>
            </section>
          ) : (
            <section className="home">
              <div className="greeting">
                <div className="intelligence-symbol">
                  <Sparkles size={29} />
                </div>
                <p>Your organisation. Connected.</p>
                <h1>What can I help you with?</h1>
                <p className="subtitle">
                  Turn what your organisation knows into what you do next.
                </p>
              </div>
              {composer}
              <div className="suggestions">
                {[
                  [
                    "Prepare for a meeting",
                    "Prepare me for the Northstar Bank meeting",
                  ],
                  [
                    "Explore our expertise",
                    "Who has GenAI experience in banking?",
                  ],
                  [
                    "Build a proposal",
                    "Build a proposal response strategy for the Northstar RFP",
                  ],
                ].map(([label, q]) => (
                  <button key={label} onClick={() => void ask(q)}>
                    {label}
                    <ArrowUpRight size={14} />
                  </button>
                ))}
              </div>
              {preferences?.proactive !== false && (
                <>
                  <div className="section-heading">
                    <h2>A little ahead of your day</h2>
                    <button onClick={() => navigate("My intelligence")}>
                      My intelligence
                      <ArrowUpRight size={14} />
                    </button>
                  </div>
                  <div className="insights">
                    <button
                      className="insight"
                      onClick={() =>
                        void ask("Prepare me for the Northstar Bank meeting")
                      }
                    >
                      <span className="insight-icon blue">
                        <Building2 size={19} />
                      </span>
                      <small>MEETING INTELLIGENCE</small>
                      <h3>Walk in one step ahead.</h3>
                      <p>
                        Your Northstar Bank brief brings the relationship, open
                        actions and latest work together.
                      </p>
                      <span className="card-link">
                        Prepare my brief
                        <ArrowUpRight size={15} />
                      </span>
                    </button>
                    <button
                      className="insight"
                      onClick={() =>
                        void ask(
                          "Find relevant banking use cases for the Northstar RFP",
                        )
                      }
                    >
                      <span className="insight-icon amber">
                        <Lightbulb size={19} />
                      </span>
                      <small>KNOWLEDGE CONNECTION</small>
                      <h3>You may already have the answer.</h3>
                      <p>
                        Three banking engagements could strengthen your next AI
                        transformation proposal.
                      </p>
                      <span className="card-link">
                        Explore the connection
                        <ArrowUpRight size={15} />
                      </span>
                    </button>
                  </div>
                </>
              )}
              <div className="section-heading recent-heading">
                <h2>Pick up where you left off</h2>
                <button onClick={() => navigate("Saved work")}>
                  View all
                  <ArrowUpRight size={14} />
                </button>
              </div>
              <button
                className="recent-work full-width"
                onClick={() =>
                  ws.state.records.some((r) => r.kind === "saved")
                    ? navigate("Saved work")
                    : void ask("Prepare me for the Northstar Bank meeting")
                }
              >
                <span className="document-icon">
                  <FileText size={20} />
                </span>
                <div>
                  <strong>
                    {ws.state.records.find((r) => r.kind === "saved")?.data
                      .title ?? "Northstar Bank · Executive brief"}
                  </strong>
                  <p>
                    {ws.state.records.some((r) => r.kind === "saved")
                      ? "Your saved work"
                      : "Client intelligence · Sample starting point"}
                  </p>
                </div>
                <ArrowUpRight size={18} className="ml-auto" />
              </button>
              <footer className="trust">
                <ShieldCheck size={13} />
                Grounded in your knowledge. Always in your control.
              </footer>
            </section>
          )
        ) : (
          <section className="workspace-page">
            {view === "My intelligence" ? (
              <Intelligence {...props} />
            ) : view === "Knowledge" ? (
              <Knowledge {...props} />
            ) : view === "Clients" ? (
              <ClientsView {...props} />
            ) : view === "People" ? (
              <PeopleView {...props} />
            ) : view === "Actions" ? (
              <ActionsView {...props} />
            ) : view === "Saved work" ? (
              <SavedWork {...props} />
            ) : view === "Pricing" ? (
              <Pricing {...props} />
            ) : view === "Proposals" ? (
              <Proposal {...props} />
            ) : view === "Claim checker" ? (
              <ClaimChecker {...props} />
            ) : (
              <Settings {...props} />
            )}
          </section>
        )}
      </main>
      <UploadSheet
        open={uploadOpen}
        signedIn={!!ws.state.user}
        onClose={() => setUploadOpen(false)}
        onUploaded={ws.refresh}
        onDiscuss={(doc, mode) => {
          setUploadOpen(false);
          void ask(
            mode === "summarise"
              ? `Summarise the document: ${doc.title}`
              : `Ask about: ${doc.title}`,
            [doc.id],
          );
        }}
      />
      <Sheet open={!!source} onOpenChange={(o) => !o && setSource(null)}>
        <SheetContent className="source-sheet">
          <SheetHeader>
            <span className="eyebrow">SOURCE & PROVENANCE</span>
            <SheetTitle>{source?.title}</SheetTitle>
            <SheetDescription>
              {source?.system} · {source?.kind}
            </SheetDescription>
          </SheetHeader>
          {source && (
            <div className="source-sheet-body">
              <div className="inline-badges">
                <Badge tone={source.status === "Verified" ? "green" : "amber"}>
                  {source.status}
                </Badge>
                {source.sample && <Badge>Fictional sample source</Badge>}
              </div>
              <dl>
                <dt>Owner</dt>
                <dd>{source.owner}</dd>
                <dt>Updated</dt>
                <dd>{source.date}</dd>
                {source.version && (
                  <>
                    <dt>Version</dt>
                    <dd>{source.version}</dd>
                  </>
                )}
                <dt>Context</dt>
                <dd>{source.client}</dd>
              </dl>
              <h3>Relevant extract</h3>
              <div className="source-extract">
                {source.content ||
                  "No text could be extracted. Download the original to inspect this document."}
              </div>
              {source.url ? (
                <a href={source.url} className="primary-button">
                  <Download size={16} />
                  Download original
                </a>
              ) : (
                <button
                  className="secondary-button"
                  onClick={() =>
                    downloadText(
                      source.title,
                      `Sample source: ${source.title}\nOwner: ${source.owner}\nUpdated: ${source.date}\n\n${source.content}`,
                    )
                  }
                >
                  <Download size={16} />
                  Download sample source
                </button>
              )}
              <div className="kb-sheet-actions">
                <button
                  className="primary-button"
                  onClick={() => {
                    const s = source;
                    setSource(null);
                    void ask(
                      `Summarise the document: ${s.title}`,
                      s.system === "Uploads" ? [s.id] : undefined,
                    );
                  }}
                >
                  <Sparkles size={16} />
                  Summarise
                </button>
                <button
                  className="secondary-button"
                  onClick={() => {
                    const s = source;
                    setSource(null);
                    void ask(
                      `Ask about: ${s.title}`,
                      s.system === "Uploads" ? [s.id] : undefined,
                    );
                  }}
                >
                  <MessageCircle size={16} />
                  Ask
                </button>
              </div>
              <div className="notice">
                <ShieldCheck size={17} />
                {source.sample
                  ? "This is fictional reference material for exploring the product."
                  : "Uploaded content is scoped to your signed-in workspace."}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
      <Dialog open={command} onOpenChange={setCommand}>
        <DialogContent className="command-dialog">
          <DialogHeader className="sr-only">
            <DialogTitle>Search your workspace</DialogTitle>
            <DialogDescription>
              Find a page, document or workflow.
            </DialogDescription>
          </DialogHeader>
          <Command>
            <CommandInput placeholder="Search pages and knowledge…" />
            <CommandList>
              <CommandEmpty>No matching result.</CommandEmpty>
              <CommandGroup heading="Workspace">
                {[...items, ...workflows, ["Settings", Settings2] as const].map(
                  ([label, Icon]) => (
                    <CommandItem
                      key={label}
                      value={label}
                      onSelect={() => navigate(label)}
                    >
                      <Icon size={16} />
                      {label}
                    </CommandItem>
                  ),
                )}
              </CommandGroup>
              <CommandGroup heading="Knowledge">
                {ws.allSources.map((s) => (
                  <CommandItem
                    value={`${s.title} ${s.tags.join(" ")}`}
                    key={s.id}
                    onSelect={() => {
                      setCommand(false);
                      setSource(s);
                    }}
                  >
                    <FileText size={15} />
                    {s.title}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
      <Dialog open={!!review} onOpenChange={(o) => !o && setReview(null)}>
        <DialogContent className="detail-dialog wide-dialog">
          <DialogHeader>
            <DialogTitle>
              {review?.type === "memory"
                ? "Save as organisational knowledge?"
                : "Review your action draft"}
            </DialogTitle>
            <DialogDescription>
              {review?.type === "memory"
                ? "Review and edit the content before marking it as human-approved knowledge."
                : "This creates a draft in Actions. It does not send a message or modify an external system."}
            </DialogDescription>
          </DialogHeader>
          <label className="field-label">
            Title
            <input
              value={memoryTitle}
              onChange={(e) => setMemoryTitle(e.target.value)}
            />
          </label>
          <label className="field-label">
            Content
            <textarea
              className="large-textarea"
              value={memoryText}
              onChange={(e) => setMemoryText(e.target.value)}
            />
          </label>
          <div className="dialog-actions">
            <button
              className="secondary-button"
              onClick={() => setReview(null)}
            >
              Cancel
            </button>
            <button
              className="primary-button"
              disabled={saving || !memoryTitle.trim() || !memoryText.trim()}
              onClick={async () => {
                if (!review) return;
                setSaving(true);
                try {
                  await ws.save(
                    review.type === "memory" ? "memory" : "action",
                    {
                      title: memoryTitle,
                      content: memoryText,
                      sourceIds: review.message.answer.sourceIds,
                      source: review.message.answer.sourceIds[0],
                      client: "Your workspace",
                      owner: ws.state.user?.displayName ?? "You",
                      due: new Date().toISOString().slice(0, 10),
                      status: "Awaiting review",
                      kind: "External draft",
                    },
                  );
                  toast.success(
                    review.type === "memory"
                      ? "Approved knowledge saved"
                      : "Draft added to the approval queue",
                  );
                  setReview(null);
                } catch {
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving
                ? "Saving…"
                : review?.type === "memory"
                  ? "Approve & save knowledge"
                  : "Create action draft"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  );
}
