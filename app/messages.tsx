"use client";
import "./messages.css";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ArrowLeft, ArrowUp, Check, LoaderCircle, MessageSquarePlus, Search, Users, X } from "lucide-react";
import { toast } from "sonner";
import { api, initialsOf, type Workspace } from "@/lib/client";
import { PageTitle } from "./workspaces";

type Person = { id: string; name: string; role: "admin" | "member" };
type Conversation = {
  id: string;
  kind: "dm" | "group";
  title: string;
  updatedAt: string;
  members: string[];
  last: { body: string; userId: string; at: string } | null;
  unread: number;
};
type Inbox = { me: string; people: Person[]; conversations: Conversation[]; unread: number };
type Message = { id: string; userId: string; body: string; at: string; pending?: boolean };

const LIST_POLL_MS = 5000;
const THREAD_POLL_MS = 3000;
const BADGE_POLL_MS = 20000;
const MESSAGE_LIMIT = 4000;

/* ------------------------------------------------------------------ */
/* Inbox store: shared by the sidebar badge and the Messages page      */
/* ------------------------------------------------------------------ */

let inbox: Inbox | null = null;
let inboxError = "";
const listeners = new Set<() => void>();
let inflight: Promise<void> | null = null;

function emit() {
  listeners.forEach((l) => l());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Reloads the inbox; concurrent callers share one request. */
export function refreshInbox() {
  if (inflight) return inflight;
  inflight = api("/api/messages")
    .then((data) => {
      inbox = data as Inbox;
      inboxError = "";
    })
    .catch((e) => {
      inboxError = (e as Error).message;
    })
    .finally(() => {
      inflight = null;
      emit();
    });
  return inflight;
}

function useInbox() {
  const data = useSyncExternalStore(subscribe, () => inbox, () => null);
  const error = useSyncExternalStore(subscribe, () => inboxError, () => "");
  return { data, error };
}

/** The bridge the Internal AI desktop app adds to the page (see desktop/preload.js). */
type DesktopBridge = {
  isDesktop: true;
  platform: string;
  onQuickAsk: (callback: () => void) => () => void;
  setUnread: (count: number) => void;
  focus: () => void;
};
export function desktopApp(): DesktopBridge | null {
  return typeof window === "undefined" ? null : ((window as { internalAIDesktop?: DesktopBridge }).internalAIDesktop ?? null);
}

/** Unread message count for the sidebar, refreshed in the background. */
export function useUnreadMessages(signedIn: boolean, onMessagesPage: boolean) {
  const { data } = useInbox();
  useEffect(() => {
    if (!signedIn) return;
    void refreshInbox();
    // The Messages page polls faster on its own.
    if (onMessagesPage) return;
    const desktop = !!desktopApp();
    const t = window.setInterval(() => {
      // The desktop app keeps checking in the background so it can notify.
      if (desktop || document.visibilityState === "visible") void refreshInbox();
    }, BADGE_POLL_MS);
    return () => window.clearInterval(t);
  }, [signedIn, onMessagesPage]);
  const unread = signedIn ? (data?.unread ?? 0) : 0;
  useDesktopNotifications(data, unread, onMessagesPage);
  return unread;
}

/**
 * In the desktop app: show the unread count on the Dock icon, and a native
 * notification when a new message arrives while you're elsewhere.
 */
function useDesktopNotifications(data: Inbox | null, unread: number, onMessagesPage: boolean) {
  const seen = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    desktopApp()?.setUnread(unread);
  }, [unread]);
  useEffect(() => {
    const desktop = desktopApp();
    if (!desktop || !data) return;
    const latest = new Map(data.conversations.map((c) => [c.id, c.last?.at ?? ""]));
    const before = seen.current;
    seen.current = latest;
    if (!before) return; // first load: don't announce old messages
    const looking = onMessagesPage && document.visibilityState === "visible" && document.hasFocus();
    if (looking || typeof Notification === "undefined") return;
    const names = new Map(data.people.map((p) => [p.id, p.name]));
    for (const c of data.conversations) {
      if (!c.last || c.last.userId === data.me || !c.unread) continue;
      if ((before.get(c.id) ?? "") >= c.last.at) continue;
      const sender = names.get(c.last.userId) ?? "Someone on your team";
      const show = () => {
        const n = new Notification(c.kind === "group" && c.title ? `${sender} · ${c.title}` : sender, {
          body: c.last!.body.slice(0, 140),
          tag: `message-${c.id}`,
          silent: false,
        });
        n.onclick = () => {
          desktop.focus();
          window.location.hash = "messages";
        };
      };
      if (Notification.permission === "granted") show();
      else if (Notification.permission !== "denied") void Notification.requestPermission().then((p) => p === "granted" && show());
    }
  }, [data, onMessagesPage]);
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

function shortTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  if (sameDay(d, now)) return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const days = (now.getTime() - d.getTime()) / 86400000;
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: "short" });
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  if (sameDay(d, now)) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}

function Avatar({ name, group }: { name: string; group?: boolean }) {
  return (
    <span className={`dm-avatar${group ? " group" : ""}`} aria-hidden>
      {group ? <Users size={15} /> : initialsOf(name) || "?"}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Messages page                                                       */
/* ------------------------------------------------------------------ */

export function MessagesView({ ws, openTeam }: { ws: Workspace; openTeam: () => void }) {
  const { data, error } = useInbox();
  const [openId, setOpenId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [query, setQuery] = useState("");
  const isAdmin = ws.state.user?.role === "admin";

  // Faster polling while this page is open and visible.
  useEffect(() => {
    void refreshInbox();
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshInbox();
    }, LIST_POLL_MS);
    return () => window.clearInterval(t);
  }, []);

  const people = useMemo(() => new Map((data?.people ?? []).map((p) => [p.id, p])), [data?.people]);
  const nameOf = useCallback(
    (id: string) => (id === data?.me ? "You" : (people.get(id)?.name ?? "Former teammate")),
    [people, data?.me],
  );
  const titleOf = useCallback(
    (c: Conversation) =>
      c.title ||
      c.members
        .filter((m) => m !== data?.me)
        .map((m) => people.get(m)?.name ?? "Former teammate")
        .join(", ") ||
      "Just you",
    [people, data?.me],
  );
  const conversations = data?.conversations ?? [];
  const visible = query.trim()
    ? conversations.filter((c) => titleOf(c).toLowerCase().includes(query.trim().toLowerCase()))
    : conversations;
  const open = conversations.find((c) => c.id === openId) ?? null;
  const teammates = (data?.people ?? []).filter((p) => p.id !== data?.me);

  async function start(ids: string[], title: string) {
    try {
      const { id } = await api("/api/messages", { action: "open", with: ids, title: title || undefined });
      await refreshInbox();
      setComposing(false);
      setOpenId(id);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  if (!data && !error)
    return (
      <>
        <MessagesTitle />
        <div className="dm-shell dm-loading" aria-busy="true">
          <LoaderCircle className="spin" size={20} /> Loading messages…
        </div>
      </>
    );

  return (
    <>
      <MessagesTitle />
      {error && !data && (
        <p className="notice" role="alert">
          {error}{" "}
          <button className="quiet-button" onClick={() => void refreshInbox()}>
            Retry
          </button>
        </p>
      )}
      <div className={`dm-shell${open || composing ? " has-thread" : ""}`}>
        <aside className="dm-list" aria-label="Conversations">
          <div className="dm-list-head">
            <label className="dm-search">
              <Search size={15} aria-hidden />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search conversations"
                aria-label="Search conversations"
                data-echo="off"
              />
            </label>
            <button
              className="dm-new"
              aria-label="New message"
              title="New message"
              onClick={() => {
                setComposing(true);
                setOpenId(null);
              }}
            >
              <MessageSquarePlus size={17} />
            </button>
          </div>
          {visible.length ? (
            <ul>
              {visible.map((c) => {
                const title = titleOf(c);
                return (
                  <li key={c.id}>
                    <button
                      className={`dm-row${c.id === openId ? " active" : ""}${c.unread ? " unread" : ""}`}
                      aria-current={c.id === openId ? "true" : undefined}
                      onClick={() => {
                        setOpenId(c.id);
                        setComposing(false);
                      }}
                    >
                      <Avatar name={title} group={c.kind === "group"} />
                      <span className="dm-row-text">
                        <span className="dm-row-top">
                          <strong>{title}</strong>
                          {c.last && <time dateTime={c.last.at}>{shortTime(c.last.at)}</time>}
                        </span>
                        <span className="dm-row-bottom">
                          <span className="dm-preview">
                            {c.last
                              ? `${c.last.userId === data?.me ? "You: " : c.kind === "group" ? `${nameOf(c.last.userId).split(" ")[0]}: ` : ""}${c.last.body}`
                              : "No messages yet"}
                          </span>
                          {c.unread > 0 && (
                            <span className="dm-unread" aria-label={`${c.unread} unread`}>
                              {c.unread > 99 ? "99+" : c.unread}
                            </span>
                          )}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="dm-list-empty">
              {query.trim() ? (
                <p>No conversations match “{query.trim()}”.</p>
              ) : teammates.length ? (
                <>
                  <p>No conversations yet.</p>
                  <button className="secondary-button" onClick={() => setComposing(true)}>
                    Start a conversation
                  </button>
                </>
              ) : (
                <>
                  <p>{isAdmin ? "Add teammates to start messaging." : "No one else is on the team yet."}</p>
                  {isAdmin && (
                    <button className="secondary-button" onClick={openTeam}>
                      Add teammates
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </aside>
        <section className="dm-main">
          {composing ? (
            <NewConversation
              people={teammates}
              isAdmin={isAdmin}
              onAddTeam={openTeam}
              onCancel={() => setComposing(false)}
              onStart={start}
            />
          ) : open && data ? (
            <Thread
              key={open.id}
              conversation={open}
              me={data.me}
              title={titleOf(open)}
              nameOf={nameOf}
              canSend={open.members.some((m) => m !== data.me && people.has(m))}
              onBack={() => setOpenId(null)}
            />
          ) : (
            <div className="dm-placeholder">
              <MessageSquarePlus size={28} aria-hidden />
              <h3>Your messages</h3>
              <p>Pick a conversation, or start a new one with someone on your team.</p>
              {teammates.length > 0 && (
                <button className="primary-button" onClick={() => setComposing(true)}>
                  New message
                </button>
              )}
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function MessagesTitle() {
  return (
    <PageTitle
      eyebrow="TEAM"
      title="Messages"
      description="Direct and group conversations with your team. Only the people in a conversation can read it."
    />
  );
}

/* ------------------------------------------------------------------ */
/* New conversation                                                    */
/* ------------------------------------------------------------------ */

function NewConversation({
  people,
  isAdmin,
  onAddTeam,
  onCancel,
  onStart,
}: {
  people: Person[];
  isAdmin: boolean;
  onAddTeam: () => void;
  onCancel: () => void;
  onStart: (ids: string[], title: string) => Promise<void>;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const shown = people.filter((p) => p.name.toLowerCase().includes(filter.trim().toLowerCase()));
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  return (
    <div className="dm-new-panel">
      <header className="dm-thread-head">
        <button className="dm-back" aria-label="Back to conversations" onClick={onCancel}>
          <ArrowLeft size={18} />
        </button>
        <h2>New message</h2>
        <button className="dm-close" aria-label="Cancel" onClick={onCancel}>
          <X size={17} />
        </button>
      </header>
      {people.length ? (
        <>
          <label className="dm-search dm-people-search">
            <Search size={15} aria-hidden />
            <input
              autoFocus
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Find a teammate"
              aria-label="Find a teammate"
              data-echo="off"
            />
          </label>
          <ul className="dm-people" aria-label="Teammates">
            {shown.map((p) => {
              const on = selected.includes(p.id);
              return (
                <li key={p.id}>
                  <button className={`dm-person${on ? " on" : ""}`} aria-pressed={on} onClick={() => toggle(p.id)}>
                    <Avatar name={p.name} />
                    <span>
                      <strong>{p.name}</strong>
                      <small>{p.role === "admin" ? "Admin" : "Teammate"}</small>
                    </span>
                    <span className="dm-check" aria-hidden>
                      {on && <Check size={14} />}
                    </span>
                  </button>
                </li>
              );
            })}
            {!shown.length && <li className="dm-list-empty">No teammate matches “{filter.trim()}”.</li>}
          </ul>
          <footer className="dm-new-foot">
            {selected.length > 1 && (
              <label className="field-label">
                Group name (optional)
                <input
                  value={title}
                  maxLength={80}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Northstar bid team"
                />
              </label>
            )}
            <button
              className="primary-button"
              disabled={!selected.length || busy}
              onClick={async () => {
                setBusy(true);
                await onStart(selected, title.trim());
                setBusy(false);
              }}
            >
              {busy && <LoaderCircle size={15} className="spin" />}
              {selected.length > 1 ? `Start group with ${selected.length} people` : "Start conversation"}
            </button>
          </footer>
        </>
      ) : (
        <div className="dm-placeholder">
          <Users size={28} aria-hidden />
          <h3>No teammates yet</h3>
          <p>{isAdmin ? "Add people in Settings → Team, then message them here." : "Ask your admin to add people to the team."}</p>
          {isAdmin && (
            <button className="primary-button" onClick={onAddTeam}>
              Add teammates
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Thread                                                              */
/* ------------------------------------------------------------------ */

function Thread({
  conversation,
  me,
  title,
  nameOf,
  canSend,
  onBack,
}: {
  conversation: Conversation;
  me: string;
  title: string;
  nameOf: (id: string) => string;
  /** False when everyone else has left the team. */
  canSend: boolean;
  onBack: () => void;
}) {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [reads, setReads] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState("");
  const [loadError, setLoadError] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const lastAt = useRef("");
  const pinned = useRef(true);
  const id = conversation.id;

  const markRead = useCallback(async () => {
    await api("/api/messages", { action: "read", conversationId: id }).catch(() => {});
    void refreshInbox();
  }, [id]);

  const load = useCallback(
    async (initial: boolean) => {
      try {
        const q = !initial && lastAt.current ? `?after=${encodeURIComponent(lastAt.current)}` : "";
        const data = await api(`/api/messages/${id}${q}`);
        const incoming = data.messages as Message[];
        setReads(data.reads ?? {});
        setLoadError("");
        if (initial) setMessages(incoming);
        else if (incoming.length)
          setMessages((current) => {
            const known = new Set((current ?? []).map((m) => m.id));
            return [...(current ?? []).filter((m) => !m.pending), ...incoming.filter((m) => !known.has(m.id))];
          });
        if (incoming.length) {
          lastAt.current = incoming[incoming.length - 1].at;
          if (incoming.some((m) => m.userId !== me)) void markRead();
        }
      } catch (e) {
        setLoadError((e as Error).message);
      }
    },
    [id, me, markRead],
  );

  useEffect(() => {
    lastAt.current = "";
    void load(true).then(() => markRead());
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(false);
    }, THREAD_POLL_MS);
    input.current?.focus();
    return () => window.clearInterval(t);
  }, [load, markRead]);

  // Stay at the bottom when new messages arrive, unless the reader scrolled up.
  useEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function send() {
    const body = draft.trim();
    if (!body) return;
    if (body.length > MESSAGE_LIMIT) {
      toast.error(`Messages are limited to ${MESSAGE_LIMIT.toLocaleString()} characters.`);
      return;
    }
    const temp: Message = { id: `pending-${Date.now()}`, userId: me, body, at: new Date().toISOString(), pending: true };
    pinned.current = true;
    setMessages((m) => [...(m ?? []), temp]);
    setDraft("");
    try {
      const sent = await api("/api/messages", { action: "send", conversationId: id, body });
      setMessages((m) => {
        const rest = (m ?? []).filter((x) => x.id !== temp.id);
        return rest.some((x) => x.id === sent.id) ? rest : [...rest, { id: sent.id, userId: me, body, at: sent.at }];
      });
      if (sent.at > lastAt.current) lastAt.current = sent.at;
      void refreshInbox();
    } catch (e) {
      // Put the text back so nothing is lost.
      setMessages((m) => (m ?? []).filter((x) => x.id !== temp.id));
      setDraft((d) => (d ? `${body}\n${d}` : body));
      toast.error((e as Error).message);
    }
  }

  const others = conversation.members.filter((m) => m !== me);
  const mine = (messages ?? []).filter((m) => m.userId === me && !m.pending);
  const lastMine = mine[mine.length - 1];
  const seenBy = lastMine ? others.filter((o) => (reads[o] ?? "") >= lastMine.at) : [];

  return (
    <div className="dm-thread">
      <header className="dm-thread-head">
        <button className="dm-back" aria-label="Back to conversations" onClick={onBack}>
          <ArrowLeft size={18} />
        </button>
        <Avatar name={title} group={conversation.kind === "group"} />
        <div className="dm-thread-title">
          <h2>{title}</h2>
          <small>
            {conversation.kind === "group"
              ? `${conversation.members.length} people · ${conversation.members.map((m) => nameOf(m).split(" ")[0]).join(", ")}`
              : "Direct message"}
          </small>
        </div>
      </header>
      <div
        className="dm-messages"
        ref={scroller}
        role="log"
        aria-live="polite"
        aria-label={`Conversation with ${title}`}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
      >
        {messages === null ? (
          <p className="dm-thread-status">
            {loadError || (
              <>
                <LoaderCircle size={16} className="spin" /> Loading…
              </>
            )}
          </p>
        ) : messages.length === 0 ? (
          <p className="dm-thread-status">No messages yet. Say hello 👋</p>
        ) : (
          messages.map((m, i) => {
            const prev = messages[i - 1];
            const newDay = !prev || !sameDay(new Date(prev.at), new Date(m.at));
            const grouped =
              !newDay && prev?.userId === m.userId && new Date(m.at).getTime() - new Date(prev.at).getTime() < 5 * 60000;
            const own = m.userId === me;
            return (
              <div key={m.id}>
                {newDay && (
                  <div className="dm-day" role="separator">
                    <span>{dayLabel(m.at)}</span>
                  </div>
                )}
                <div className={`dm-msg${own ? " own" : ""}${grouped ? " grouped" : ""}${m.pending ? " pending" : ""}`}>
                  {!own && !grouped && <Avatar name={nameOf(m.userId)} />}
                  <div className="dm-bubble-wrap">
                    {!grouped && (
                      <span className="dm-meta">
                        {!own && conversation.kind === "group" && <strong>{nameOf(m.userId)}</strong>}
                        <time dateTime={m.at}>
                          {new Date(m.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                        </time>
                      </span>
                    )}
                    <p className="dm-bubble">{m.body}</p>
                    {m.id === lastMine?.id && seenBy.length > 0 && (
                      <span className="dm-seen">
                        {conversation.kind === "dm" ? "Seen" : `Seen by ${seenBy.map((s) => nameOf(s).split(" ")[0]).join(", ")}`}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
      {loadError && messages !== null && (
        <p className="dm-error" role="alert">
          Couldn’t refresh: {loadError}
        </p>
      )}
      {!canSend ? (
        <p className="dm-closed">No one else in this conversation is on the team any more, so it’s read-only.</p>
      ) : (
      <form
        className="dm-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          ref={input}
          rows={1}
          value={draft}
          maxLength={MESSAGE_LIMIT}
          placeholder={`Message ${title}`}
          aria-label={`Message ${title}`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button type="submit" className="dm-send" aria-label="Send message" disabled={!draft.trim()}>
          <ArrowUp size={16} />
        </button>
      </form>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Settings → Team                                                     */
/* ------------------------------------------------------------------ */

type TeamMember = Person & { email?: string };

export function TeamSettings({ ws }: { ws: Workspace }) {
  const [team, setTeam] = useState<{ me: string; admin: boolean; people: TeamMember[]; domains?: string[] } | null>(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ name: "", email: "" });
  const [busy, setBusy] = useState("");
  const [removing, setRemoving] = useState("");
  const signedIn = !!ws.state.user;

  const load = useCallback(async () => {
    try {
      setTeam(await api("/api/team"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    if (signedIn) void load();
  }, [signedIn, load]);

  async function act(key: string, body: Record<string, unknown>, success: string) {
    setBusy(key);
    try {
      await api("/api/team", body);
      toast.success(success);
      await load();
      void refreshInbox();
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    } finally {
      setBusy("");
    }
  }

  if (!signedIn) return <div className="notice">Sign in to see your team.</div>;
  if (!team) return <div className="panel">{error || "Loading the team…"}</div>;
  return (
    <>
      {team.domains && team.domains.length > 0 && (
        <div className="notice">
          Anyone with an {team.domains.map((d) => `@${d}`).join(" or ")} email can sign in with an emailed code. Their
          account is created the first time they sign in. Add people from other domains below.
        </div>
      )}
      {team.admin && (
        <div className="panel">
          <h3>Add a teammate</h3>
          <p className="muted-note">
            They sign in with a one-time code emailed to this address. No password needed. They get their own private
            workspace and can message anyone on the team.
          </p>
          <form
            className="team-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const ok = await act(
                "add",
                { action: "add", ...form },
                `${form.name.trim()} was added. They can sign in with their email now.`,
              );
              if (ok) setForm({ name: "", email: "" });
            }}
          >
            <label className="field-label">
              Name
              <input
                required
                maxLength={80}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Alex Morgan"
                autoComplete="off"
              />
            </label>
            <label className="field-label">
              Work email
              <input
                required
                type="email"
                maxLength={200}
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="name@company.com"
                autoComplete="off"
              />
            </label>
            <button className="primary-button" disabled={busy === "add"}>
              {busy === "add" ? "Adding…" : "Add teammate"}
            </button>
          </form>
        </div>
      )}
      <div className="panel">
        <h3>Team · {team.people.length} {team.people.length === 1 ? "person" : "people"}</h3>
        <ul className="team-list">
          {team.people.map((p) => (
            <li className="team-row" key={p.id}>
              <Avatar name={p.name} />
              <span>
                <strong>
                  {p.name}
                  {p.id === team.me ? " (you)" : ""}
                </strong>
                <small>
                  {p.role === "admin" ? "Admin" : "Teammate"}
                  {p.email ? ` · ${p.email}` : ""}
                </small>
              </span>
              {team.admin && p.role !== "admin" && (
                <span className="team-actions">
                  {removing === p.id ? (
                    <>
                      <span className="muted-note">Remove {p.name.split(" ")[0]}? They’ll be signed out and can’t sign in again until you add them back.</span>
                      <button
                        className="secondary-button danger-button"
                        disabled={busy === `remove-${p.id}`}
                        onClick={async () => {
                          if (await act(`remove-${p.id}`, { action: "remove", id: p.id }, `${p.name} was removed.`))
                            setRemoving("");
                        }}
                      >
                        Remove
                      </button>
                      <button className="quiet-button" onClick={() => setRemoving("")}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button className="quiet-button" onClick={() => setRemoving(p.id)}>
                      Remove
                    </button>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
        {team.admin && (
          <p className="muted-note">
            Your own sign-in email is set in the deployment settings (AUTH_EMAIL), so it can’t be removed here.
          </p>
        )}
      </div>
    </>
  );
}
