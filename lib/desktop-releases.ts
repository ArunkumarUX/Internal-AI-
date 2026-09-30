/*
 * Desktop app releases live in the workspace's private Blob store:
 *   internal-ai/desktop/latest.json  -> { version, releasedAt, files: { [platform]: { path, size, name } } }
 * written by desktop/scripts/publish.mjs. Downloads are handed out as
 * short-lived signed links to signed-in people only.
 */

export const RELEASE_MANIFEST = "internal-ai/desktop/latest.json";
export const PLATFORMS = {
  "mac-arm64": "macOS · Apple silicon (M1–M4)",
  "mac-x64": "macOS · Intel",
  "win-x64": "Windows 10 and 11",
} as const;
export type Platform = keyof typeof PLATFORMS;
export type Release = {
  version: string;
  releasedAt: string;
  files: Partial<Record<Platform, { path: string; size: number; name: string }>>;
};

let cached: { release: Release | null; at: number } | null = null;

export async function latestRelease(): Promise<Release | null> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  if (cached && Date.now() - cached.at < 60_000) return cached.release;
  const { get } = await import("@vercel/blob");
  let release: Release | null = null;
  try {
    const result = await get(RELEASE_MANIFEST, { access: "private", useCache: false });
    if (result?.statusCode === 200) release = JSON.parse(await new Response(result.stream).text()) as Release;
  } catch {
    release = null;
  }
  cached = { release, at: Date.now() };
  return release;
}

/** A signed download link that expires after `minutes`. */
export async function signedDownload(pathname: string, minutes = 10) {
  const { issueSignedToken, presignUrl } = await import("@vercel/blob");
  const validUntil = Date.now() + minutes * 60 * 1000;
  const token = await issueSignedToken({ pathname, operations: ["get"], validUntil });
  const { presignedUrl } = await presignUrl(token, { operation: "get", pathname, access: "private", validUntil });
  return presignedUrl;
}
