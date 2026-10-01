/** Which video service a calendar event uses, recognised from its links. */
export type Provider = "teams" | "meet" | "zoom" | "";

const PATTERNS: [Provider, RegExp][] = [
  ["teams", /https:\/\/teams\.(?:microsoft|live)\.com\/[^\s<>"')]+/i],
  ["meet", /https:\/\/meet\.google\.com\/[a-z0-9-]+(?:\?[^\s<>"')]*)?/i],
  ["zoom", /https:\/\/(?:[\w-]+\.)?zoom\.(?:us|com)\/(?:j|my|w|wc)\/[^\s<>"')]+/i],
];

/** The first meeting link found in the given texts (join URL, location, description). */
export function detectProvider(...texts: (string | undefined | null)[]): { provider: Provider; joinUrl: string } {
  for (const text of texts) {
    if (!text) continue;
    for (const [provider, pattern] of PATTERNS) {
      const match = text.match(pattern);
      if (match) return { provider, joinUrl: match[0] };
    }
  }
  return { provider: "", joinUrl: "" };
}
