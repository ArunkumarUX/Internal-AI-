import { env } from "cloudflare:workers";
import { database } from "@/lib/server";

export type ModelChoice = {
  model: string;
  fast: string;
};

export type ModelOption = {
  id: string;
  label: string;
  name: string;
  note: string;
  size: string;
  /** Model ids this preset selects; empty when the gateway isn't configured. */
  model: string;
  fast: string;
};

const MODEL_ID = /^[\w./:-]{2,80}$/;

export function defaultModels(): ModelChoice {
  const model = env.AI_MODEL || "";
  return { model, fast: env.AI_FAST_MODEL || model };
}

export function presets(): ModelOption[] {
  const { model, fast } = defaultModels();
  return [
    {
      id: "recommended",
      label: "Recommended",
      name: model || "Not configured",
      note: "Best quality for Ask, briefs and proposals.",
      size: "Chat",
      model,
      fast: model,
    },
    {
      id: "balanced",
      label: "Balanced",
      name: model && fast && model !== fast ? `${model} · ${fast}` : model || "Not configured",
      note: "Quality answers, faster related questions.",
      size: "Chat + fast",
      model,
      fast,
    },
    {
      id: "fastest",
      label: "Fastest",
      name: fast || model || "Not configured",
      note: "Snappier replies and follow-up suggestions.",
      size: "Fast",
      model: fast || model,
      fast: fast || model,
    },
  ];
}

export async function readModelChoice(userId: string): Promise<ModelChoice> {
  const fallback = defaultModels();
  const row = await database()
    .prepare(
      "SELECT data FROM records WHERE user_id=? AND kind='settings' ORDER BY updated_at DESC LIMIT 1",
    )
    .bind(userId)
    .first();
  if (!row) return fallback;
  try {
    const data = JSON.parse(String(row.data)) as {
      model?: string;
      fastModel?: string;
    };
    const model =
      typeof data.model === "string" && MODEL_ID.test(data.model)
        ? data.model
        : fallback.model;
    const fast =
      typeof data.fastModel === "string" && MODEL_ID.test(data.fastModel)
        ? data.fastModel
        : fallback.fast;
    return { model, fast: fast || model };
  } catch {
    return fallback;
  }
}

export async function listGatewayModels(): Promise<string[]> {
  if (!env.AI_GATEWAY_URL || !env.AI_GATEWAY_KEY) return [];
  const base = new URL(env.AI_GATEWAY_URL);
  if (base.protocol !== "https:") return [];
  const url = `${base.toString().replace(/\/$/, "")}/models`;
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${env.AI_GATEWAY_KEY}` },
      signal: AbortSignal.timeout(12000),
      redirect: "manual",
    });
    if (!response.ok) return [];
    const json = (await response.json()) as {
      data?: { id?: string }[];
    };
    return (json.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => typeof id === "string" && MODEL_ID.test(id));
  } catch {
    return [];
  }
}

export function isModelId(value: string) {
  return MODEL_ID.test(value);
}
