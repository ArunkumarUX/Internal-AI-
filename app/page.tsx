"use client";
import { useState, useRef, useEffect } from "react";
import {
  Sparkles,
  MessageCircle,
  Search,
  BookOpen,
  Building2,
  Users,
  MessagesSquare,
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
  Trash2,
  Square,
  LogOut,
  Bot,
  Mic,
  WandSparkles,
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
import { useWorkspace, downloadText, readJson, AUTH_EXPIRED, type RequestError, loadDocument } from "@/lib/client";
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
import { LoginScreen, LoginSplash } from "./login-screen";
import { Intelligence } from "./intelligence";
import { ChatExchange, type ChatMessage } from "./chat";
import { MessagesView, useUnreadMessages } from "./messages";
import {
  AgentSkills,
  MeetingAssistant,
  MagicFeatures,
  Beacon,
  EchoAnywhere,
  QuickAssistant,
  GhostText,
  DictateButton,
  SuggestionChip,
  RecordingPill,
  useJobScheduler,
  suggestCompletion,
  useAssistantPrefs,
  useCompletions,
} from "./assistant";
const items = [
  ["Ask", MessageCircle],
  ["My intelligence", Sparkles],
  ["Knowledge", BookOpen],
  ["Clients", Building2],
  ["People", Users],
  ["Messages", MessagesSquare],
  ["Actions", CheckCheck],
  ["Saved work", Bookmark],
] as const;
const workflows = [
  ["Proposals", ClipboardCheck],
  ["Pricing", Calculator],
  ["Claim checker", ShieldCheck],
] as const;
const assistantItems = [
  ["Agent skills", Bot],
  ["Meeting assistant", Mic],
  ["Magic features", WandSparkles],
] as const;
const sections = [
  ...items.map((x) => x[0]),
  ...workflows.map((x) => x[0]),
  ...assistantItems.map((x) => x[0]),
  "Settings",
];
type Message = ChatMessage;
function CloseMobileSidebar({ view, nonce }: { view: string; nonce: number }) {
  const { setOpenMobile } = useSidebar();
  useEffect(() => setOpenMobile(false), [view, nonce, setOpenMobile]);
  return null;
}
const hashFor = (v: string) => `#${v.toLowerCase().replaceAll(" ", "-")}`;
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
  const [reviewClient, setReviewClient] = useState("Your workspace");
  const [saving, setSaving] = useState(false);
  const [claimDraft, setClaimDraft] = useState("");
  const [activeClient, setActiveClient] = useState<string>();
  const [openAddClient, setOpenAddClient] = useState(false);
  useEffect(() => {
    if (view !== "Clients") {
      setActiveClient(undefined);
      setOpenAddClient(false);
    }
  }, [view]);
  // Sidebar groups start collapsed; each viewer's own choice is remembered.
  const GROUPS_KEY = "ia-sidebar-groups";
  const [openGroups, setOpenGroups] = useState({ create: false, assistant: false });
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(GROUPS_KEY) ?? "null");
      if (saved && typeof saved === "object")
        setOpenGroups((g) => ({ create: !!saved.create || g.create, assistant: !!saved.assistant || g.assistant }));
    } catch {}
  }, []);
  // Opening a page that lives in a collapsed group reveals that group.
  useEffect(() => {
    const group = workflows.some((w) => w[0] === view)
      ? "create"
      : assistantItems.some((w) => w[0] === view)
        ? "assistant"
        : null;
    if (group) setOpenGroups((g) => (g[group] ? g : { ...g, [group]: true }));
  }, [view]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [meetingLive, setMeetingLive] = useState<"off" | "recording" | "paused">("off");
  const [stopMeeting, setStopMeeting] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState("");
  const [navNonce, setNavNonce] = useState(0);
  // The workspace list carries only a text preview; load the full text on open.
  useEffect(() => {
    if (!source?.truncated) return;
    let live = true;
    loadDocument(source.id)
      .then((content) => {
        if (live) setSource((s) => (s && s.id === source.id ? { ...s, content, truncated: false } : s));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [source?.id, source?.truncated]);
  const [allHistory, setAllHistory] = useState(false);
  const historyRef = useRef<HTMLDivElement>(null);
  // The History menu closes on Escape or a click outside it.
  useEffect(() => {
    if (!historyOpen) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !historyRef.current?.contains(e.target as Node))
        setHistoryOpen(false);
    };
    document.addEventListener("keydown", close);
    document.addEventListener("pointerdown", close);
    return () => {
      document.removeEventListener("keydown", close);
      document.removeEventListener("pointerdown", close);
    };
  }, [historyOpen]);
  const [deleting, setDeleting] = useState(false);
  const { prefs: assistant } = useAssistantPrefs(ws);
  const completions = useCompletions(ws);
  const unreadMessages = useUnreadMessages(!!ws.state.user, view === "Messages");
  useJobScheduler(ws, !!assistant.skills.jobs);
  const [caretAtEnd, setCaretAtEnd] = useState(true);
  const suggestion = assistant.magic.tab && caretAtEnd
    ? suggestCompletion(prompt, completions)
    : "";
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const preferences = ws.state.records.find((r) => r.kind === "settings")?.data;
  const dismissed = ws.state.records
    .filter((r) => r.kind === "dismissed")
    .map((r) => r.data.insightId);
  const fresh = insights.filter((i) => !dismissed.includes(i.id));
  // One entry per conversation thread, newest first (older answers had no thread id).
  const conversations = ws.state.records.filter((r) => r.kind === "conversation");
  const threads = [...conversations.reduce((map, r) => {
    const key = String(r.data.threadId ?? r.id);
    if (!map.has(key)) map.set(key, r);
    return map;
  }, new Map<string, (typeof conversations)[number]>()).values()];
  const recent = threads.slice(0, 6);
  const userName = ws.state.user?.displayName ?? "Your workspace";
  const desktopRef = useRef(assistant.magic.desktop);
  desktopRef.current = assistant.magic.desktop;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommand((v) => !v);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j" && desktopRef.current) {
        e.preventDefault();
        setQuickOpen((v) => !v);
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
  function toggleGroup(key: "create" | "assistant") {
    setOpenGroups((current) => {
      const opening = !current[key];
      if (opening) {
        const id = `sidebar-${key}`;
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            document
              .getElementById(id)
              ?.scrollIntoView({ block: "nearest" });
          });
        });
      }
      const next = { ...current, [key]: opening };
      try {
        localStorage.setItem(GROUPS_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }
  // Each view is a history entry, so Back and Forward move between views.
  function navigate(v: string) {
    setView(v);
    setCommand(false);
    setNavNonce((n) => n + 1);
    if (typeof window !== "undefined" && !(v === "Settings" && window.location.hash.startsWith("#settings")) && window.location.hash !== hashFor(v))
      window.history.pushState(null, "", `/${hashFor(v)}`);
  }
  useEffect(() => {
    const sync = () => {
      const page = decodeURIComponent(window.location.hash.slice(1));
      const match = page.startsWith("settings")
        ? "Settings"
        : sections.find((x) => x.toLowerCase().replaceAll(" ", "-") === page);
      setView(match ?? "Ask");
      if (!match && page) window.history.replaceState(null, "", `/${hashFor("Ask")}`);
    };
    window.addEventListener("popstate", sync);
    window.addEventListener("hashchange", sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener("hashchange", sync);
    };
  }, []);
  useEffect(() => {
    const page = decodeURIComponent(window.location.hash.slice(1));
    const match = page.startsWith("settings")
      ? "Settings"
      : sections.find((x) => x.toLowerCase().replaceAll(" ", "-") === page);
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
  const abortRef = useRef<AbortController | null>(null);
  const threadRef = useRef<string>(crypto.randomUUID());
  /** Cancels the answer in progress (Stop, New chat, History, unmount). */
  function cancelAnswer() {
    abortRef.current?.abort();
    abortRef.current = null;
  }
  useEffect(() => () => abortRef.current?.abort(), []);
  const HISTORY_ITEM_LIMIT = 6000;
  const QUERY_LIMIT = 12000;
  async function ask(value = prompt, attachmentIds?: string[]) {
    const query = value.trim();
    if (!query || busy || uploading) return;
    if (ws.loading) {
      toast.message("Your workspace is still loading. Your question is kept; send it in a moment.");
      return;
    }
    if (query.length > QUERY_LIMIT) {
      toast.error(`Your question is too long (${query.length.toLocaleString()} of ${QUERY_LIMIT.toLocaleString()} characters).`);
      return;
    }
    navigate("Ask");
    setBusy(true);
    const pendingId = crypto.randomUUID();
    const fromComposer = attachmentIds === undefined;
    const ids = attachmentIds ?? attachments;
    // The server only reads 6,000 characters per turn, so trim before sending.
    const history = messages
      .filter((m) => !m.error && m.answer.text)
      .slice(-4)
      .flatMap((m) => [
        { role: "user", content: m.query.slice(0, HISTORY_ITEM_LIMIT) },
        { role: "assistant", content: m.answer.text.slice(0, HISTORY_ITEM_LIMIT) },
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
        attachmentIds: ids,
      },
    ]);
    setPrompt("");
    if (fromComposer) setAttachments([]);
    const controller = new AbortController();
    abortRef.current = controller;
    let text = "";
    let finished = false;
    try {
      if (!ws.state.user) {
        const answer = localAnswer(query, ws.allSources, scope, evidence);
        answer.mode = "Sample evidence preview · Sign in to save";
        patch((m) => ({
          ...m,
          answer,
          sources: ws.allSources.filter((s) => answer.sourceIds.includes(s.id)),
        }));
        finished = true;
        return;
      }
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({
          query,
          scope,
          verified: evidence,
          attachmentIds: ids,
          history,
          threadId: threadRef.current,
        }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) await readJson(response);
      const reader = response.body!.getReader();
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
          else if (event === "reset") {
            // Text streamed before a tool call is replaced by the real answer.
            text = "";
            patch((m) => ({ ...m, answer: { ...m.answer, text } }));
          } else if (event === "delta") {
            text += data.text;
            patch((m) => ({ ...m, answer: { ...m.answer, text } }));
          } else if (event === "done") {
            finished = true;
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
          } else if (event === "error") {
            if (data.status === 401) window.dispatchEvent(new Event(AUTH_EXPIRED));
            throw new Error(data.error);
          }
        }
      }
      // A stream that ends without "done" was cut off (network, time-out).
      if (!finished) throw new Error("The connection dropped before the answer finished. Retry to try again.");
      void ws.refresh();
    } catch (e) {
      if (controller.signal.aborted) {
        patch((m) => ({ ...m, error: text ? "Stopped. This answer is incomplete." : "Stopped." , stopped: true }));
      } else {
        const err = e as RequestError;
        const message =
          err.status === 401
            ? "Your session has ended. Sign in again, then retry."
            : err.message || "The assistant is unavailable. Please retry.";
        patch((m) => ({ ...m, error: message }));
      }
      if (!text) {
        setPrompt((p) => p || query);
        if (fromComposer) setAttachments((a) => (a.length ? a : ids));
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      patch((m) => ({ ...m, streaming: false }));
      setBusy(false);
    }
  }
  async function deleteDocument(s: Source) {
    setDeleting(true);
    try {
      await readJson(await fetch(`/api/files/${s.id}`, { method: "DELETE" }));
      setSource(null);
      setConfirmDelete("");
      setAttachments((list) => list.filter((x) => x !== s.id));
      await ws.refresh();
      toast.success("Document deleted");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDeleting(false);
    }
  }
  /** Starts a question from another surface; false if one is already running. */
  function tryAsk(q: string, attachmentIds?: string[]) {
    if (ws.loading) {
      toast.error("Your workspace is still loading. Try again in a moment.");
      return false;
    }
    if (busy || uploading) {
      toast.error(uploading ? "Wait for the upload to finish, then try again." : "Wait for the current answer to finish, or stop it, then try again.");
      return false;
    }
    if (!q.trim()) return false;
    void ask(q, attachmentIds);
    return true;
  }
  function retry(m: Message) {
    if (busy || uploading) {
      toast.error("Wait for the current answer to finish, then retry.");
      return;
    }
    setMessages((list) => list.filter((x) => x.id !== m.id));
    setTimeout(() => void ask(m.query, m.attachmentIds ?? []), 0);
  }
  /** Restores a saved conversation thread with its citations. */
  function openThread(r: (typeof conversations)[number]) {
    cancelAnswer();
    const key = String(r.data.threadId ?? r.id);
    const turns = conversations
      .filter((c) => String(c.data.threadId ?? c.id) === key)
      .sort((a, b) => a.updated_at.localeCompare(b.updated_at));
    threadRef.current = r.data.threadId ? String(r.data.threadId) : crypto.randomUUID();
    setMessages(
      turns.map((t) => {
        const saved: Partial<Source>[] = Array.isArray(t.data.sources) ? t.data.sources : [];
        const known = ws.allSources.filter((x) => t.data.sourceIds?.includes(x.id));
        // Prefer the cards saved with the answer; they include web and Notion sources.
        const sources = [
          ...known,
          ...saved
            .filter((x) => !known.some((k) => k.id === x.id))
            .map((x) => ({ owner: "", date: "", kind: "", client: "", tags: [], status: "Unverified", content: "", title: "", system: "", id: "", ...x }) as Source),
        ];
        return {
          id: t.id,
          query: t.data.query,
          answer: {
            text: t.data.answer,
            title: t.data.title,
            sourceIds: t.data.sourceIds ?? [],
            mode: t.data.mode,
            followups: [],
          },
          sources,
          steps: [],
          streaming: false,
          at: t.updated_at,
        };
      }),
    );
    setHistoryOpen(false);
    setAllHistory(false);
    navigate("Ask");
  }
  /** Starts a fresh conversation, cancelling any answer in progress. */
  function newChat() {
    cancelAnswer();
    threadRef.current = crypto.randomUUID();
    setMessages([]);
    setPrompt("");
    setAttachments([]);
    setHistoryOpen(false);
    navigate("Ask");
  }
  const MAX_UPLOADS = 5;
  const MAX_BYTES = 10 * 1024 * 1024;
  const UPLOAD_TYPES = ["txt", "md", "csv", "pdf", "docx", "pptx", "xlsx", "png", "jpg", "jpeg", "webp"];
  async function uploadFiles(files: FileList | null) {
    if (!files?.length) return;
    if (uploading) {
      toast.error("An upload is already in progress.");
      return;
    }
    if (!ws.state.user) {
      toast.error("Sign in to upload and save documents.");
      return;
    }
    const all = Array.from(files);
    const rejected: string[] = [];
    const accepted = all.filter((f) => {
      const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
      if (!UPLOAD_TYPES.includes(ext)) rejected.push(`${f.name} (unsupported type)`);
      else if (f.size === 0) rejected.push(`${f.name} (empty)`);
      else if (f.size > MAX_BYTES) rejected.push(`${f.name} (over 10 MB)`);
      else return true;
      return false;
    });
    const batch = accepted.slice(0, MAX_UPLOADS);
    const skipped = accepted.length - batch.length;
    setUploading(true);
    const added: string[] = [];
    const failed: string[] = [];
    const notices: string[] = [];
    try {
      // Each file succeeds or fails on its own; one failure never hides the rest.
      for (const file of batch) {
        try {
          const form = new FormData();
          form.append("file", file);
          const result = await readJson(await fetch("/api/upload", { method: "POST", body: form }));
          added.push(result.id);
          if (result.duplicateOf) notices.push(`${file.name} matches “${result.duplicateOf.title}”, already in Knowledge.`);
          else if (batch.length === 1) notices.push(result.notice);
        } catch (e) {
          failed.push(`${file.name}: ${(e as Error).message}`);
        }
      }
    } finally {
      await ws.refresh();
      setAttachments((a) => [...new Set([...a, ...added])].slice(0, 10));
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
    if (added.length) {
      toast.success(
        batch.length === 1 && notices[0] ? notices[0] : `${added.length} of ${all.length} file${all.length > 1 ? "s" : ""} uploaded and attached`,
      );
      notices.filter((n) => n !== notices[0] || batch.length > 1).forEach((n) => toast.message(n));
      navigate("Ask");
      inputRef.current?.focus();
    }
    if (skipped > 0) toast.error(`${skipped} file${skipped > 1 ? "s" : ""} skipped: you can upload ${MAX_UPLOADS} at a time.`);
    if (rejected.length) toast.error(`Not uploaded: ${rejected.join(", ")}`);
    failed.forEach((f) => toast.error(f));
  }
  async function exportWord(m: Message) {
    if (!ws.state.user) {
      toast.error("Sign in to create Word documents.");
      return;
    }
    const pending = toast.loading("Creating Word document…");
    try {
      const r = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: m.answer.title || m.query.slice(0, 80), markdown: m.answer.text }),
      });
      if (!r.ok) throw new Error(((await r.json()) as { error?: string }).error ?? "Export failed.");
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url;
      const name = (m.answer.title || "").replace(/[\u0000-\u001f\\/:*?"<>|]+/g, " ").trim().slice(0, 80);
      a.download = `${name || "Internal AI answer"}.docx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      void ws.refresh();
      toast.success("Word document created and saved to Knowledge", { id: pending });
    } catch (e) {
      toast.error((e as Error).message, { id: pending });
    }
  }
  const savingRef = useRef(new Set<string>());
  async function saveAnswer(m: Message) {
    if (!ws.state.user) {
      toast.error("Sign in to save this answer.");
      return;
    }
    if (savingRef.current.has(m.id)) return;
    savingRef.current.add(m.id);
    try {
      await ws.save("saved", {
        title: m.answer.title,
        content: m.answer.text,
        sourceIds: m.answer.sourceIds,
      });
      toast.success("Added to saved work");
    } catch {
    } finally {
      savingRef.current.delete(m.id);
    }
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
                enum: sections,
              },
            },
            required: ["section"],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false },
          execute: (input: any) => {
            if (
              !input ||
              !sections.includes(input.section)
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
      tryAsk(q, options?.attachmentIds),
    openSource: setSource,
    view,
    setView: navigate,
    upload: () => setUploadOpen(true),
    initialClaim: claimDraft,
    client: activeClient,
    setClient: setActiveClient,
    openAddClient,
    setOpenAddClient,
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
      {!ws.state.user && ws.auth !== "loading" && (
        <p className="composer-signin">
          Sample preview · <a href={`/signin-with-chatgpt?return_to=${encodeURIComponent(`/#${view.toLowerCase().replaceAll(" ", "-")}`)}`} target="_top">Sign in</a> to use your own knowledge and save answers.
        </p>
      )}
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
      <div className="ghost-field">
      <GhostText target={inputRef} value={prompt} suggestion={suggestion} />
      <textarea
        ref={inputRef}
        aria-label="Ask your organisation"
        maxLength={QUERY_LIMIT}
        placeholder={
          uploading
            ? "Uploading and indexing your document…"
            : messages.length
              ? "Ask a follow-up…"
              : "Ask a question, explore an idea, or get something done…"
        }
        value={prompt}
        onChange={(e) => {
          setPrompt(e.target.value);
          setCaretAtEnd(e.target.selectionStart === e.target.value.length);
        }}
        onSelect={(e) =>
          setCaretAtEnd(
            e.currentTarget.selectionStart === e.currentTarget.value.length &&
              e.currentTarget.selectionEnd === e.currentTarget.value.length,
          )
        }
        onKeyDown={(e) => {
          // Never act on keys while an input method is composing text.
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Tab" && suggestion && !e.shiftKey) {
            e.preventDefault();
            setPrompt(prompt + suggestion);
            return;
          }
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (busy) toast.error("Wait for the current answer to finish, or stop it.");
            else void ask();
          }
        }}
      />
      </div>
      {suggestion && <SuggestionChip suggestion={suggestion} onAccept={() => setPrompt(prompt + suggestion)} />}
      {prompt.length > QUERY_LIMIT * 0.8 && (
        <p className={`composer-count${prompt.length >= QUERY_LIMIT ? " over" : ""}`} aria-live="polite">
          {prompt.length.toLocaleString()} / {QUERY_LIMIT.toLocaleString()} characters
        </p>
      )}
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
        {assistant.magic.echo && (
          <DictateButton
            lang={assistant.meeting.language}
            onText={(t) => setPrompt((p) => (p && !p.endsWith(" ") ? `${p} ${t}` : p + t))}
          />
        )}
        <label className="evidence" title="Evidence mode: prefer verified sources">
          <ShieldCheck size={14} />
          <span className="evidence-label">Evidence</span>
          <Switch
            aria-label="Evidence mode"
            size="sm"
            checked={evidence}
            onCheckedChange={setEvidence}
          />
        </label>
        {busy ? (
          <button className="send stop" aria-label="Stop the answer" title="Stop" onClick={cancelAnswer}>
            <Square size={14} fill="currentColor" />
          </button>
        ) : (
          <button
            className="send"
            aria-label="Send message"
            disabled={!prompt.trim() || uploading || ws.loading}
            onClick={() => void ask()}
          >
            <ArrowUp size={19} />
          </button>
        )}
      </div>
    </div>
  );
  if (ws.auth === "loading") return <LoginSplash />;
  if (ws.auth !== "signed-in") {
    return (
      <LoginScreen
        expired={ws.auth === "expired"}
        onSignedIn={() => void ws.refresh()}
      />
    );
  }
  return (
    <SidebarProvider>
      <CloseMobileSidebar view={view} nonce={navNonce} />
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
            onClick={newChat}
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
                  onClick={() => {
                    if (label === "Clients") {
                      setActiveClient(undefined);
                      setOpenAddClient(false);
                    }
                    navigate(label);
                  }}
                >
                  <Icon />
                  <span>{label}</span>
                  {label === "My intelligence" && fresh.length > 0 && (
                    <span className="nav-count">{fresh.length}</span>
                  )}
                  {label === "Clients" && (
                    <span className="nav-count">{ws.allClients.length}</span>
                  )}
                  {label === "Messages" && unreadMessages > 0 && (
                    <span className="nav-count nav-unread" aria-label={`${unreadMessages} unread messages`}>
                      {unreadMessages > 99 ? "99+" : unreadMessages}
                    </span>
                  )}
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
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
          <button
            type="button"
            className="side-label side-toggle"
            aria-expanded={openGroups.assistant}
            aria-controls="sidebar-assistant"
            onClick={() => toggleGroup("assistant")}
          >
            <ChevronRight size={14} />
            Assistant
          </button>
          {openGroups.assistant && (
            <SidebarMenu id="sidebar-assistant">
              {assistantItems.map(([label, Icon]) => (
                <SidebarMenuItem key={label}>
                  <SidebarMenuButton
                    isActive={view === label}
                    onClick={() => navigate(label)}
                  >
                    <Icon />
                    <span>{label}</span>
                    {label === "Meeting assistant" && meetingLive === "recording" && (
                      <span className="nav-live" aria-label="Recording">
                        <i />
                        REC
                      </span>
                    )}
                    {label === "Magic features" && (
                      <span className="nav-count">
                        {Object.values(assistant.magic).filter(Boolean).length}
                      </span>
                    )}
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
              <a
                className="icon-button"
                aria-label="Sign out"
                title="Sign out"
                href="/signout-with-chatgpt?return_to=/"
                target="_top"
                onClick={() => {
                  // Nothing from this session should survive on a shared device.
                  try {
                    sessionStorage.clear();
                  } catch {}
                }}
              >
                <LogOut size={15} />
              </a>
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
            {meetingLive !== "off" && (
              <RecordingPill
                state={meetingLive}
                onOpen={() => navigate("Meeting assistant")}
                onStop={() => setStopMeeting((n) => n + 1)}
              />
            )}
            <span
              className="workspace-status"
              title={
                ws.state.aiConfigured
                  ? `Ask uses ${ws.state.aiModel}`
                  : "Sample knowledge"
              }
            >
              <i />
              {ws.state.aiConfigured
                ? `AI · ${ws.state.aiModel}`
                : "Sample knowledge"}
            </span>
            <div className="history-wrap" ref={historyRef}>
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
                          onClick={() => openThread(r)}
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
                            void tryAsk(x);
                          }}
                        >
                          {x}
                        </button>
                      ))}
                  {ws.state.user && threads.length > 0 && (
                    <button
                      role="menuitem"
                      className="history-all"
                      onClick={() => {
                        setHistoryOpen(false);
                        setAllHistory(true);
                      }}
                    >
                      All conversations ({threads.length})
                    </button>
                  )}
                </div>
              )}
            </div>
            <button
              type="button"
              className="new-chat-button"
              onClick={newChat}
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
        {ws.error && (
          <div className="storage-error" role="alert">
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
                    onAsk={(q) => void tryAsk(q)}
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
                      {assistant.skills["create-docs"] && (
                        <button onClick={() => void exportWord(m)}>
                          <FileText size={15} />
                          Word document
                        </button>
                      )}
                      {assistant.skills.claims && (
                      <button
                        onClick={() => {
                          setClaimDraft(m.answer.text);
                          navigate("Claim checker");
                        }}
                      >
                        <ShieldCheck size={15} />
                        Check claims
                      </button>
                      )}
                      <button
                        onClick={() => {
                          if (!ws.state.user) {
                            toast.error("Sign in to save this as knowledge.");
                            return;
                          }
                          setReview({ type: "memory", message: m });
                          setReviewClient(ws.allClients.some((c) => c.name === scope) ? scope : "Your workspace");
                          setMemoryTitle(m.answer.title);
                          setMemoryText(m.answer.text);
                        }}
                      >
                        <Brain size={15} />
                        Save as knowledge
                      </button>
                      <button
                        onClick={() => {
                          if (!ws.state.user) {
                            toast.error("Sign in to prepare an action.");
                            return;
                          }
                          setReview({ type: "action", message: m });
                          setReviewClient(ws.allClients.some((c) => c.name === scope) ? scope : "Your workspace");
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
                    ? "AI can make mistakes. Review sources and approve actions. Conversations are saved to your private workspace."
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
                  <button key={label} onClick={() => void tryAsk(q)}>
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
                        void tryAsk("Prepare me for the Northstar Bank meeting")
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
                        void tryAsk(
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
                    : void tryAsk("Prepare me for the Northstar Bank meeting")
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
        ) : view === "Meeting assistant" ? null : (
          <section className="workspace-page">
            {view === "My intelligence" ? (
              <Intelligence {...props} />
            ) : view === "Knowledge" ? (
              <Knowledge {...props} />
            ) : view === "Clients" ? (
              <ClientsView {...props} />
            ) : view === "People" ? (
              <PeopleView {...props} />
            ) : view === "Messages" ? (
              <MessagesView
                ws={ws}
                openTeam={() => {
                  navigate("Settings");
                  window.history.replaceState(null, "", "/#settings-team");
                }}
              />
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
            ) : view === "Agent skills" ? (
              <AgentSkills ws={ws} setView={navigate} ask={(q) => tryAsk(q)} />
            ) : view === "Magic features" ? (
              <MagicFeatures ws={ws} openAssistant={() => setQuickOpen(true)} />
            ) : (
              <Settings {...props} />
            )}
          </section>
        )}
        {/* Kept mounted so a recording or unsaved transcript survives navigation. */}
        <section className="workspace-page" hidden={view !== "Meeting assistant"}>
          <MeetingAssistant ws={ws} ask={(q) => tryAsk(q)} onRecording={setMeetingLive} stopSignal={stopMeeting} />
        </section>
      </main>
      <Beacon enabled={assistant.magic.beacon} ask={(q) => tryAsk(q)} />
      <EchoAnywhere enabled={assistant.magic.echo} lang={assistant.meeting.language} />
      <QuickAssistant
        ws={ws}
        open={quickOpen}
        onClose={() => setQuickOpen(false)}
        echo={assistant.magic.echo}
        tab={assistant.magic.tab}
        lang={assistant.meeting.language}
        ready={!busy && !uploading}
        ask={(q, o) => tryAsk(q, o?.attachmentIds)}
      />
      <UploadSheet
        open={uploadOpen}
        clientNames={ws.allClients.map((c) => c.name)}
        defaultClient={
          view === "Clients" ? activeClient : undefined
        }
        signedIn={!!ws.state.user}
        onClose={() => setUploadOpen(false)}
        onUploaded={() => void ws.refresh()}
        onDiscuss={(doc, mode) => {
          const started = tryAsk(
            mode === "summarise"
              ? `Summarise the document: ${doc.title}`
              : `Ask about: ${doc.title}`,
            [doc.id],
          );
          if (started) setUploadOpen(false);
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
              {/* One action row: primary AI action first, then open/download, then delete. */}
              <div className="kb-sheet-actions">
                <button
                  className="primary-button"
                  onClick={() => {
                    const s = source;
                    if (tryAsk(`Summarise the document: ${s.title}`, s.system === "Uploads" ? [s.id] : undefined))
                      setSource(null);
                  }}
                >
                  <Sparkles size={16} />
                  Summarise
                </button>
                <button
                  className="secondary-button"
                  onClick={() => {
                    const s = source;
                    if (tryAsk(`Ask about: ${s.title}`, s.system === "Uploads" ? [s.id] : undefined))
                      setSource(null);
                  }}
                >
                  <MessageCircle size={16} />
                  Ask
                </button>
                {source.url?.startsWith("/api/files/") ? (
                  <a href={source.url} download className="secondary-button">
                    <Download size={16} />
                    Download
                  </a>
                ) : source.url ? (
                  <a href={source.url} target="_blank" rel="noreferrer" className="secondary-button">
                    <ExternalLink size={16} />
                    Open in {source.system === "Notion" ? "Notion" : "new tab"}
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
                    Download
                  </button>
                )}
              </div>
              {source.system === "Uploads" && source.url && (
                <div className="kb-sheet-danger">
                  {confirmDelete === source.id ? (
                    <>
                      <span>Delete “{source.title}”? The file and its text are removed.</span>
                      <button
                        className="secondary-button danger-button"
                        disabled={deleting}
                        onClick={() => void deleteDocument(source)}
                      >
                        <Trash2 size={15} />
                        {deleting ? "Deleting…" : "Delete"}
                      </button>
                      <button className="quiet-button" onClick={() => setConfirmDelete("")}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button className="quiet-button danger-link" onClick={() => setConfirmDelete(source.id)}>
                      <Trash2 size={14} />
                      Delete document
                    </button>
                  )}
                </div>
              )}
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
      <Dialog open={allHistory} onOpenChange={setAllHistory}>
        <DialogContent className="detail-dialog wide-dialog">
          <DialogHeader>
            <DialogTitle>Your conversations</DialogTitle>
            <DialogDescription>
              Every question and answer is saved to your private workspace. Open one to continue it, or delete it.
            </DialogDescription>
          </DialogHeader>
          <div className="history-list">
            {threads.length ? (
              threads.map((r) => {
                const key = String(r.data.threadId ?? r.id);
                const turns = conversations.filter((c) => String(c.data.threadId ?? c.id) === key);
                return (
                  <div className="history-row" key={r.id}>
                    <button className="history-open" onClick={() => openThread(r)}>
                      <strong>{r.data.title}</strong>
                      <small>
                        {new Date(r.updated_at).toLocaleString()} · {turns.length} {turns.length === 1 ? "question" : "questions"}
                      </small>
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`Delete conversation ${r.data.title}`}
                      onClick={async () => {
                        try {
                          for (const t of turns) await ws.remove(t.id);
                          toast.success("Conversation deleted");
                        } catch {}
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                );
              })
            ) : (
              <p className="muted-note">No saved conversations yet.</p>
            )}
            {(ws.state.conversationTotal ?? 0) > conversations.length && (
              <p className="muted-note">
                Showing the latest {conversations.length} of {ws.state.conversationTotal} answers.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
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
                {[
                  ...items,
                  ...workflows,
                  ...assistantItems,
                  ["Settings", Settings2] as const,
                ].map(
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
            Client
            <Select value={reviewClient} onValueChange={setReviewClient}>
              <SelectTrigger aria-label="Client">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Your workspace">No specific client</SelectItem>
                {ws.allClients.map((c) => (
                  <SelectItem key={c.id ?? c.name} value={c.name}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
                  const base = {
                    title: memoryTitle.trim(),
                    content: memoryText.trim(),
                    sourceIds: review.message.answer.sourceIds,
                    source: review.message.answer.sourceIds[0],
                    client: reviewClient,
                  };
                  await ws.save(
                    review.type === "memory" ? "memory" : "action",
                    review.type === "memory"
                      ? base
                      : {
                          ...base,
                          owner: ws.state.user?.displayName ?? "You",
                          due: new Date().toISOString().slice(0, 10),
                          status: "Awaiting review",
                          kind: "External draft",
                          custom: true,
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
