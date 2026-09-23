"use client";
import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { sources, type Source } from "./knowledge";
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
};
export async function api(path: string, body?: unknown) {
  const r = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json: any = await r.json();
  if (!r.ok) throw new Error(json.error ?? "Could not complete the request.");
  return json;
}
export function useWorkspace() {
  const [state, setState] = useState<WorkspaceState>({
    records: [],
    documents: [],
    audit: [],
    user: null,
    aiConfigured: false,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      setState(await api("/api/workspace"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const save = async (kind: string, data: Record<string, any>, id?: string) => {
    try {
      const r = await api("/api/workspace", { kind, data, id });
      await refresh();
      return r.id as string;
    } catch (e) {
      toast.error((e as Error).message);
      throw e;
    }
  };
  const uploaded: Source[] = state.documents.map((d) => ({
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
  }));
  const memory: Source[] = state.records
    .filter((r) => r.kind === "memory")
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
  return {
    state,
    loading,
    error,
    refresh,
    save,
    allSources: [...sources, ...uploaded, ...memory],
  };
}
export type Workspace = ReturnType<typeof useWorkspace>;
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
