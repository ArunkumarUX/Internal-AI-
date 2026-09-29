"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import {
  sources,
  clients,
  CLIENT_STAGES,
  type Client,
  type ClientStage,
  type Source,
} from "./knowledge";
export type WorkRecord = {
  id: string;
  kind: string;
  data: Record<string, any>;
  updated_at: string;
};
export type WorkspaceState = {
  records: WorkRecord[];
  documents: Record<string, any>[];
  audit: Record<string, any>[];
  user: { displayName: string; email: string; userId: string } | null;
  aiConfigured: boolean;
  aiModel: string;
  aiFastModel: string;
  documentTotal?: number;
  conversationTotal?: number;
};
/** An API failure that keeps the HTTP status so callers can tell auth from outages. */
export class RequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}
export const AUTH_EXPIRED = "ia-auth-expired";
/** Parses any response safely; a 401 also tells the workspace the session ended. */
export async function readJson(r: Response) {
  const json: any = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401 && typeof window !== "undefined")
      window.dispatchEvent(new Event(AUTH_EXPIRED));
    throw new RequestError(
      json.error ??
        (r.status >= 500
          ? "The workspace is temporarily unavailable. Please try again."
          : "Could not complete the request."),
      r.status,
      json.code,
    );
  }
  return json;
}
export async function api(path: string, body?: unknown, method?: string) {
  const r = await fetch(path, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return readJson(r);
}
export type AuthStatus = "loading" | "signed-in" | "signed-out" | "expired" | "error";
export function useWorkspace() {
  const [state, setState] = useState<WorkspaceState>({
    records: [],
    documents: [],
    audit: [],
    user: null,
    aiConfigured: false,
    aiModel: "",
    aiFastModel: "",
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [auth, setAuth] = useState<AuthStatus>("loading");
  const signedInRef = useRef(false);
  /** Returns true when fresh data was loaded. */
  const refresh = useCallback(async (): Promise<boolean> => {
    const load = async () => {
      const next: WorkspaceState = await api("/api/workspace");
      setState(next);
      setError("");
      signedInRef.current = !!next.user;
      setAuth(next.user ? "signed-in" : "signed-out");
      try {
        sessionStorage.removeItem("ia-signin-tried");
      } catch {}
    };
    try {
      await load();
      return true;
    } catch (e) {
      const err = e as RequestError;
      if (err.status === 401) {
        let tried = true;
        try {
          tried = !!sessionStorage.getItem("ia-signin-tried");
          sessionStorage.setItem("ia-signin-tried", "1");
        } catch {}
        if (!tried && !signedInRef.current && process.env.NODE_ENV !== "production") {
          // Local development signs in silently; hosted sign-in uses the login screen.
          try {
            await fetch("/signin-with-chatgpt?return_to=/", { credentials: "include" });
            await load();
            return true;
          } catch {}
        }
        const wasSignedIn = signedInRef.current;
        signedInRef.current = false;
        setState((s) => ({ ...s, user: null, records: [], documents: [], audit: [] }));
        setAuth(wasSignedIn ? "expired" : "signed-out");
        setError("");
        return false;
      }
      // Storage or network trouble: keep what's on screen and say so.
      setAuth((a) => (a === "loading" ? "error" : a));
      setError(err.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  // Any API call that hits a 401 re-checks the session once.
  useEffect(() => {
    const expired = () => {
      if (signedInRef.current) void refresh();
    };
    window.addEventListener(AUTH_EXPIRED, expired);
    return () => window.removeEventListener(AUTH_EXPIRED, expired);
  }, [refresh]);
  const save = useCallback(
    async (kind: string, data: Record<string, any>, id?: string) => {
      try {
        const r = await api("/api/workspace", { kind, data, id });
        if (!(await refresh()))
          toast.warning("Saved, but the latest workspace couldn’t be loaded. Refresh to see it.");
        return r.id as string;
      } catch (e) {
        toast.error((e as Error).message);
        throw e;
      }
    },
    [refresh],
  );
  /** Deletes one of the user's records. */
  const remove = useCallback(
    async (id: string) => {
      try {
        await api(`/api/workspace?id=${encodeURIComponent(id)}`, undefined, "DELETE");
        await refresh();
      } catch (e) {
        toast.error((e as Error).message);
        throw e;
      }
    },
    [refresh],
  );
  const uploaded: Source[] = [...state.documents]
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .map((d) => ({
    id: d.id,
    title: d.title,
    content: d.content,
    system: "Uploads",
    owner: state.user?.displayName ?? "You",
    date: d.doc_date || d.created_at.slice(0, 10),
    kind:
      d.category || (d.mime?.startsWith("image/") ? "Image" : "Document"),
    client: d.client || "Your workspace",
    tags: [],
    status: d.content ? "Unverified" : "Text unavailable",
    url: `/api/files/${d.id}`,
    mime: d.mime,
    truncated: !!d.truncated,
  }));
  const memory: Source[] = state.records
    .filter(
      (r) => r.kind === "memory" && typeof r.data.title === "string" && typeof r.data.content === "string",
    )
    .map((r) => ({
      id: r.id,
      title: r.data.title,
      content: r.data.content,
      system: "Memory",
      owner: state.user?.displayName ?? "You",
      date: r.updated_at.slice(0, 10),
      kind: "Decision",
      client: r.data.client ?? "Your workspace",
      tags: [],
      status: "Verified",
    }));
  const stageOf = (v: unknown, fallback: ClientStage): ClientStage =>
    CLIENT_STAGES.includes(v as ClientStage) ? (v as ClientStage) : fallback;
  const clientRecords = state.records.filter((r) => r.kind === "client");
  // Records arrive newest first, so the first override per client wins.
  const overrides = new Map<string, WorkRecord>();
  for (const r of clientRecords)
    if (r.data.override && !overrides.has(String(r.data.name))) overrides.set(String(r.data.name), r);
  const sampleClients: Client[] = clients.map((c) => {
    const o = overrides.get(c.name);
    return o
      ? { ...c, stage: stageOf(o.data.stage, c.stage), stageRecordId: o.id }
      : c;
  });
  const customClients: Client[] = clientRecords
    .filter((r) => !r.data.override)
    .map((r) => ({
      id: r.id,
      stage: stageOf(r.data.stage, "Prospect"),
      name: String(r.data.name),
      initials: String(r.data.initials || initialsOf(String(r.data.name))),
      industry: String(r.data.industry || "Industry not set"),
      owner: String(r.data.owner || "Unassigned"),
      color: String(r.data.color || "neutral"),
      description: String(r.data.description || ""),
      tags: Array.isArray(r.data.tags) ? r.data.tags.map(String) : [],
      documents: [],
      opportunity: String(r.data.opportunity || ""),
      risk: String(r.data.risk || ""),
      custom: true,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    state,
    loading,
    error,
    auth,
    refresh,
    save,
    remove,
    // Your own documents and memory come before the sample library.
    allSources: [...uploaded, ...memory, ...sources],
    allClients: [...sampleClients, ...customClients],
  };
}
export type Workspace = ReturnType<typeof useWorkspace>;
export function initialsOf(name: string) {
  // First letter or digit of each word, so "(Acme) Group" → "AG" and emoji don't split.
  const words = name
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+/u, ""))
    .filter(Boolean);
  const initials = (words.length === 1 ? [words[0], words[0].slice(1)] : words)
    .slice(0, 2)
    .map((w) => Array.from(w)[0]?.toUpperCase() ?? "")
    .join("");
  return initials || "?";
}
/** Full text of an upload (the workspace list only carries a preview). */
export async function loadDocument(id: string): Promise<string> {
  const doc = await api(`/api/documents/${encodeURIComponent(id)}`);
  return String(doc.content ?? "");
}
export function downloadText(title: string, content: string) {
  const url = URL.createObjectURL(
    new Blob([content], { type: "text/markdown;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = title.replace(/[^a-zA-Z0-9 -]/g, "").slice(0, 80) + ".md";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
