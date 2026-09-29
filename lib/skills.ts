/** Agent skill catalogue shared by the server (enforcement) and the UI. */

export type SkillId =
  | "memory"
  | "documents"
  | "claims"
  | "web"
  | "scrape"
  | "data"
  | "create-docs"
  | "charts"
  | "images"
  | "jobs"
  | "notion"
  | "mcp"
  | "gmail"
  | "calendar"
  | "outlook";

export const SKILL_DEFAULTS: Record<SkillId, boolean> = {
  memory: true,
  documents: true,
  claims: true,
  web: true,
  scrape: true,
  data: true,
  "create-docs": true,
  charts: true,
  images: false,
  jobs: true,
  notion: true,
  mcp: true,
  gmail: true,
  calendar: true,
  outlook: true,
};

/** MCP servers whose name or URL matches these words belong to an integration. */
export const INTEGRATION_MATCH: Partial<Record<SkillId, RegExp>> = {
  gmail: /gmail|google\s*mail/i,
  calendar: /calendar|gcal/i,
  outlook: /outlook|microsoft|m365|office\s*365|graph\.microsoft/i,
};

export function resolveSkills(stored: unknown): Record<SkillId, boolean> {
  const data = stored && typeof stored === "object" ? (stored as Record<string, unknown>) : {};
  return Object.fromEntries(
    (Object.keys(SKILL_DEFAULTS) as SkillId[]).map((id) => [
      id,
      typeof data[id] === "boolean" ? (data[id] as boolean) : SKILL_DEFAULTS[id],
    ]),
  ) as Record<SkillId, boolean>;
}
