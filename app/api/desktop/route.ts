import { failure, identity } from "@/lib/server";
import { latestRelease, PLATFORMS, type Platform } from "@/lib/desktop-releases";

export const dynamic = "force-dynamic";

/** The latest desktop app version and which installers exist (signed-in only). */
export async function GET() {
  try {
    await identity();
    const release = await latestRelease();
    return Response.json(
      {
        version: release?.version ?? null,
        releasedAt: release?.releasedAt ?? null,
        platforms: release
          ? (Object.keys(release.files) as Platform[])
              .filter((p) => p in PLATFORMS)
              .map((p) => ({ id: p, label: PLATFORMS[p], size: release.files[p]!.size, name: release.files[p]!.name }))
          : [],
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return failure(e);
  }
}
