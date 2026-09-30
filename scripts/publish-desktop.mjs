// Publishes the built desktop installers to the workspace's private Blob store
// and updates the release manifest the website's "Get the app" button reads.
//
//   BLOB_READ_WRITE_TOKEN=... node scripts/publish-desktop.mjs
//
// Build first with `npm run dist:mac` and `npm run dist:win` in desktop/.
import { readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { put } from "@vercel/blob";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const desktop = path.join(root, "desktop");
const { version } = JSON.parse(readFileSync(path.join(desktop, "package.json"), "utf8"));
const dist = path.join(desktop, "dist");
const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!token) throw new Error("Set BLOB_READ_WRITE_TOKEN (the production Blob store token).");

const builds = {
  "mac-arm64": `Internal AI-${version}-arm64.dmg`,
  "mac-x64": `Internal AI-${version}.dmg`,
  "win-x64": `Internal AI Setup ${version}.exe`,
};

const files = {};
for (const [platform, name] of Object.entries(builds)) {
  const local = path.join(dist, name);
  if (!existsSync(local)) {
    console.warn(`skip ${platform}: ${name} not built`);
    continue;
  }
  const size = statSync(local).size;
  const download = name.replace(/ /g, "-");
  const pathname = `internal-ai/desktop/${version}/${download}`;
  process.stdout.write(`uploading ${platform} (${Math.round(size / 1048576)} MB)… `);
  await put(pathname, readFileSync(local), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    multipart: true,
    contentType: name.endsWith(".dmg") ? "application/x-apple-diskimage" : "application/vnd.microsoft.portable-executable",
    token,
  });
  files[platform] = { path: pathname, size, name: download };
  console.log("done");
}
if (!Object.keys(files).length) throw new Error("Nothing to publish.");

const manifest = { version, releasedAt: new Date().toISOString(), files };
await put("internal-ai/desktop/latest.json", JSON.stringify(manifest, null, 2), {
  access: "private",
  addRandomSuffix: false,
  allowOverwrite: true,
  contentType: "application/json",
  token,
});
console.log(`Published Internal AI desktop ${version}:`, Object.keys(files).join(", "));
