// Local files: add files or connect folders on this computer. Their text goes
// into your private Internal AI knowledge (through the same /api/upload the
// website uses), and connected folders stay in sync as files change.
//
// The page can only ask for things by folder id; paths only ever come from the
// native file picker, so a web page can't read arbitrary files.
const { dialog, ipcMain, session, app } = require("electron");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const SUPPORTED = new Set(["txt", "md", "csv", "pdf", "docx", "pptx", "xlsx", "png", "jpg", "jpeg", "webp"]);
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_FILES_PER_FOLDER = 500;
const MAX_DEPTH = 6;
const SKIP_DIRS = new Set(["node_modules", ".git", "Library", "$RECYCLE.BIN", "System Volume Information"]);
const SYNC_EVERY_MS = 10 * 60 * 1000;
const CATEGORY = "Local files";

function create({ origin, getWindow }) {
  const storeFile = path.join(app.getPath("userData"), "local-sources.json");
  let store = load();
  const running = new Set();

  function load() {
    try {
      const data = JSON.parse(fs.readFileSync(storeFile, "utf8"));
      return { folders: Array.isArray(data.folders) ? data.folders : [] };
    } catch {
      return { folders: [] };
    }
  }
  function save() {
    try {
      fs.writeFileSync(storeFile, JSON.stringify(store, null, 1));
    } catch {}
  }
  const notify = (event, payload) => getWindow()?.webContents.send(event, payload);

  /** What the page sees: never the manifest, just a summary per folder. */
  const summary = () =>
    store.folders.map((f) => ({
      id: f.id,
      name: path.basename(f.path),
      path: f.path,
      files: Object.keys(f.files ?? {}).length,
      lastSync: f.lastSync ?? null,
      status: running.has(f.id) ? "syncing" : (f.status ?? "idle"),
      message: f.message ?? "",
    }));

  /* -------------------------------------------------------------- */
  /* Talking to the workspace with the signed-in session             */
  /* -------------------------------------------------------------- */

  async function upload(filePath, bytes) {
    const boundary = `----InternalAI${crypto.randomBytes(12).toString("hex")}`;
    const name = path.basename(filePath).replace(/["\r\n]/g, "_");
    const part = (field, value) =>
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"\r\n\r\n${value}\r\n`);
    const body = Buffer.concat([
      part("title", name),
      part("category", CATEGORY),
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      ),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const response = await session.defaultSession.fetch(`${origin}/api/upload`, {
      method: "POST",
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}`, Origin: origin },
      body,
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) throw Object.assign(new Error("Sign in to Internal AI to sync files."), { auth: true });
    if (!response.ok) throw new Error(data.error || `Upload failed (${response.status}).`);
    return String(data.id);
  }

  async function remove(docId) {
    const response = await session.defaultSession.fetch(`${origin}/api/files/${encodeURIComponent(docId)}`, {
      method: "DELETE",
      headers: { Origin: origin },
    });
    if (response.status === 401) throw Object.assign(new Error("Sign in to Internal AI to sync files."), { auth: true });
    // Already gone is fine.
  }

  /* -------------------------------------------------------------- */
  /* Scanning                                                        */
  /* -------------------------------------------------------------- */

  const supported = (file) => SUPPORTED.has(path.extname(file).slice(1).toLowerCase());

  function scan(root) {
    const found = [];
    const walk = (dir, depth) => {
      if (depth > MAX_DEPTH || found.length >= MAX_FILES_PER_FOLDER) return;
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (found.length >= MAX_FILES_PER_FOLDER) return;
        if (entry.name.startsWith(".") || entry.name.startsWith("~$")) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name)) walk(full, depth + 1);
        } else if (entry.isFile() && supported(entry.name)) {
          try {
            const stat = fs.statSync(full);
            if (stat.size > 0 && stat.size <= MAX_BYTES)
              found.push({ rel: path.relative(root, full), full, size: stat.size, mtimeMs: Math.round(stat.mtimeMs) });
          } catch {}
        }
      }
    };
    walk(root, 0);
    return found;
  }

  /** Uploads new and changed files, and removes deleted ones. */
  async function sync(folder) {
    if (running.has(folder.id)) return;
    if (!fs.existsSync(folder.path)) {
      folder.status = "error";
      folder.message = "This folder was moved or deleted.";
      save();
      notify("local:changed", summary());
      return;
    }
    running.add(folder.id);
    notify("local:changed", summary());
    const files = folder.files ?? (folder.files = {});
    const seen = new Set();
    let done = 0;
    let failed = 0;
    let lastError = "";
    try {
      const found = scan(folder.path);
      const changed = found.filter((f) => {
        seen.add(f.rel);
        const known = files[f.rel];
        return !known || known.size !== f.size || known.mtimeMs !== f.mtimeMs;
      });
      for (const f of changed) {
        notify("local:progress", { id: folder.id, done, total: changed.length, current: f.rel });
        try {
          const docId = await upload(f.full, fs.readFileSync(f.full));
          const previous = files[f.rel]?.docId;
          files[f.rel] = { size: f.size, mtimeMs: f.mtimeMs, docId };
          if (previous) await remove(previous).catch(() => {});
          save();
        } catch (error) {
          if (error.auth) throw error;
          failed++;
          lastError = `${f.rel}: ${error.message}`;
        }
        done++;
      }
      // Files deleted from the folder are removed from your knowledge too.
      for (const rel of Object.keys(files)) {
        if (seen.has(rel)) continue;
        await remove(files[rel].docId).catch(() => {});
        delete files[rel];
      }
      folder.status = failed ? "warning" : "idle";
      folder.message = failed ? `${failed} file${failed === 1 ? "" : "s"} couldn’t be added. ${lastError}` : "";
      if (found.length >= MAX_FILES_PER_FOLDER)
        folder.message = `Only the first ${MAX_FILES_PER_FOLDER} supported files are synced.`;
      folder.lastSync = new Date().toISOString();
    } catch (error) {
      folder.status = "error";
      folder.message = error.message;
    } finally {
      running.delete(folder.id);
      save();
      notify("local:progress", { id: folder.id, done, total: done, current: "" });
      notify("local:changed", summary());
    }
  }

  const syncAll = () => Promise.all(store.folders.map((f) => sync(f)));

  /* -------------------------------------------------------------- */
  /* Page requests                                                   */
  /* -------------------------------------------------------------- */

  const fromWorkspace = (event) => {
    try {
      return new URL(event.senderFrame?.url || "").origin === origin;
    } catch {
      return false;
    }
  };
  const handle = (channel, fn) =>
    ipcMain.handle(channel, (event, ...args) => {
      if (!fromWorkspace(event)) throw new Error("Not allowed.");
      return fn(...args);
    });

  handle("local:list", () => summary());

  handle("local:add-files", async () => {
    const result = await dialog.showOpenDialog(getWindow(), {
      title: "Add files to Internal AI",
      buttonLabel: "Add to Internal AI",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Documents and images", extensions: [...SUPPORTED] }],
    });
    if (result.canceled) return { added: 0, failed: [] };
    let added = 0;
    const failed = [];
    for (const file of result.filePaths) {
      try {
        const stat = fs.statSync(file);
        if (stat.size > MAX_BYTES) throw new Error("larger than 10 MB");
        await upload(file, fs.readFileSync(file));
        added++;
      } catch (error) {
        if (error.auth) throw error;
        failed.push(`${path.basename(file)}: ${error.message}`);
      }
    }
    return { added, failed };
  });

  handle("local:add-folder", async () => {
    const result = await dialog.showOpenDialog(getWindow(), {
      title: "Connect a folder to Internal AI",
      buttonLabel: "Connect folder",
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return summary();
    const chosen = result.filePaths[0];
    if (chosen === path.parse(chosen).root || chosen === app.getPath("home"))
      throw new Error("Choose a specific folder rather than your whole disk or home folder.");
    if (!store.folders.some((f) => f.path === chosen)) {
      const folder = { id: crypto.randomUUID(), path: chosen, files: {}, addedAt: new Date().toISOString() };
      store.folders.push(folder);
      save();
      void sync(folder);
    }
    return summary();
  });

  handle("local:sync", async (id) => {
    const folder = store.folders.find((f) => f.id === id);
    if (folder) await sync(folder);
    else await syncAll();
    return summary();
  });

  handle("local:remove", async (id, removeFiles) => {
    const folder = store.folders.find((f) => f.id === id);
    if (!folder) return summary();
    store.folders = store.folders.filter((f) => f.id !== id);
    save();
    if (removeFiles)
      for (const entry of Object.values(folder.files ?? {})) await remove(entry.docId).catch(() => {});
    return summary();
  });

  // Keep connected folders current in the background.
  setInterval(() => void syncAll(), SYNC_EVERY_MS).unref?.();
  let lastFocusSync = 0;
  return {
    onFocus() {
      if (Date.now() - lastFocusSync < 60_000) return;
      lastFocusSync = Date.now();
      void syncAll();
    },
  };
}

module.exports = { create };
