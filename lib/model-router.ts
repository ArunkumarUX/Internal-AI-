import { env } from "@/lib/env";

/*
 * Automatic model choice. Every AI feature asks for a kind of model, not a
 * specific one; the router tries the best fit first and moves down a list of
 * suitable models when the key refuses one or the gateway doesn't have it.
 * Refusals are remembered for a while, so later requests go straight to a
 * model that works. Nobody has to change models by hand.
 */

export type ModelKind = "chat" | "fast" | "vision" | "embedding" | "asr";

const list = (...ids: (string | undefined)[]) => ids.map((id) => id?.trim()).filter((id): id is string => !!id);

const CHAINS: Record<ModelKind, () => string[]> = {
  // Long answers, proposals, enhancing meeting notes.
  chat: () => list(env.AI_MODEL, "qwen3.8-max", "qwen3.7-max", "qwen3-max", "qwen3.7-plus", "qwen3.6-plus", "qwen-max", "qwen-plus"),
  // Short replies, titles, follow-up suggestions.
  fast: () => list(env.AI_FAST_MODEL, "qwen3.8-flash", "qwen3.7-flash", "qwen3.6-flash", "qwen-flash", "qwen-turbo", "qwen-plus"),
  // Reading images and scanned pages.
  vision: () => list(process.env.AI_VISION_MODEL, "qwen3-vl-plus", "qwen-vl-max", "qwen3-vl-flash", "qwen-vl-plus", env.AI_MODEL),
  // Search by meaning (1024-dimension vectors).
  embedding: () => list(process.env.AI_EMBEDDING_MODEL, "text-embedding-v4", "qwen3.7-text-embedding", "text-embedding-v3"),
  // Speech to text: dedicated recognisers first, then audio-capable chat models.
  asr: () =>
    list(
      process.env.AI_ASR_MODEL,
      "qwen3-asr-flash",
      "qwen3-asr-flash-2026-02-10",
      "qwen-audio-3.0-asr-flash",
      "qwen3.8-omni-flash",
      "qwen3.5-omni-flash",
      "qwen3-omni-flash",
    ),
};

const REFUSED_FOR = 15 * 60_000;
const refused = new Map<string, number>();
const working = new Map<ModelKind, string>();

/** Models to try for a kind, best first; `preferred` (the user's choice) leads. */
export function candidates(kind: ModelKind, preferred?: string) {
  const all = [...new Set(list(preferred, working.get(kind), ...CHAINS[kind]()))];
  const now = Date.now();
  const usable = all.filter((m) => (refused.get(m) ?? 0) < now);
  // Everything refused recently: try them all again rather than give up.
  return usable.length ? usable : all;
}

/** Whether a gateway reply means "this key can't use this model". */
export function isRefusal(status: number, code?: string) {
  return status === 401 || status === 403 || status === 404 || code === "access_denied" || code === "model_not_found";
}

export function markRefused(model: string) {
  refused.set(model, Date.now() + REFUSED_FOR);
  for (const [kind, m] of working) if (m === model) working.delete(kind);
}

export function markWorking(kind: ModelKind, model: string) {
  refused.delete(model);
  working.set(kind, model);
}

/** The model a kind is currently using, when one has worked. */
export const workingModel = (kind: ModelKind) => working.get(kind);

/** Which kind a requested model belongs to, for falling back to the right family. */
export function kindOf(model: string, fallback: ModelKind): ModelKind {
  for (const kind of Object.keys(CHAINS) as ModelKind[]) if (CHAINS[kind]().includes(model)) return kind;
  return fallback;
}

export class AllRefused extends Error {
  constructor(public kind: ModelKind) {
    super(`No ${kind} model is allowed on this AI key.`);
  }
}

/**
 * Runs `attempt` with each candidate until one isn't refused. `attempt`
 * returns `{ refused: true }` to move on, or anything else to finish.
 */
export async function withModel<T>(
  kind: ModelKind,
  attempt: (model: string) => Promise<T | { refused: true }>,
  preferred?: string,
): Promise<T> {
  for (const model of candidates(kind, preferred)) {
    const result = await attempt(model);
    if (result && typeof result === "object" && "refused" in result && (result as { refused: unknown }).refused === true) {
      markRefused(model);
      continue;
    }
    markWorking(kind, model);
    return result as T;
  }
  throw new AllRefused(kind);
}
