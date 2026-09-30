import { NextResponse } from "next/server";
import { failure, identity, log, ApiError } from "@/lib/server";
import { latestRelease, PLATFORMS, signedDownload, type Platform } from "@/lib/desktop-releases";

export const dynamic = "force-dynamic";

/** Redirects a signed-in person to a short-lived link for their installer. */
export async function GET(request: Request) {
  try {
    const user = await identity();
    const platform = new URL(request.url).searchParams.get("platform") as Platform | null;
    if (!platform || !(platform in PLATFORMS)) throw new ApiError("Choose macOS or Windows.", 400);
    const file = (await latestRelease())?.files[platform];
    if (!file) throw new ApiError("That download isn’t available yet.", 404);
    await log(user.userId, "Desktop app downloaded", platform).catch(() => {});
    return NextResponse.redirect(await signedDownload(file.path), 302);
  } catch (e) {
    return failure(e);
  }
}
