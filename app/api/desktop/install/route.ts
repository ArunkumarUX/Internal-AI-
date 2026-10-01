import { failure, identity, log, ApiError } from "@/lib/server";
import { latestRelease, signedDownload } from "@/lib/desktop-releases";

export const dynamic = "force-dynamic";

/**
 * A one-line Terminal command that installs the Mac app for a signed-in
 * person. Files downloaded by curl aren't quarantined, so macOS doesn't ask
 * to verify the (not yet notarised) app. The link inside expires in 10 minutes.
 */
export async function GET(request: Request) {
  try {
    const user = await identity();
    const platform = new URL(request.url).searchParams.get("platform");
    if (platform !== "mac-arm64" && platform !== "mac-x64") throw new ApiError("The install command is for macOS.", 400);
    const file = (await latestRelease())?.files[platform];
    if (!file) throw new ApiError("That download isn’t available yet.", 404);
    const url = await signedDownload(file.path, 10);
    if (/'/.test(url)) throw new ApiError("Couldn’t prepare the command. Please try again.", 503);
    const app = "/Applications/Internal AI.app";
    const command = [
      `T=$(mktemp -d)`,
      `curl -fL --progress-bar '${url}' -o "$T/InternalAI.dmg"`,
      `M=$(hdiutil attach -nobrowse -readonly "$T/InternalAI.dmg" | tail -1 | awk -F'\\t' '{print $NF}')`,
      `rm -rf "${app}"`,
      `cp -R "$M/Internal AI.app" /Applications/`,
      `hdiutil detach "$M" -quiet`,
      `xattr -cr "${app}"`,
      `open "${app}"`,
      `echo "Internal AI is installed."`,
    ].join(" && ");
    await log(user.userId, "Desktop install command", platform).catch(() => {});
    return Response.json({ command, expiresInMinutes: 10 }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    return failure(e);
  }
}
