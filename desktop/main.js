// Internal AI desktop app: a native window around the Internal AI workspace,
// with a system-wide shortcut, a menu bar icon, a Dock badge for unread
// messages and native permission prompts for the microphone and screen.
const {
  app,
  BrowserWindow,
  Menu,
  MenuItem,
  screen,
  Tray,
  desktopCapturer,
  globalShortcut,
  ipcMain,
  nativeImage,
  Notification,
  session,
  shell,
  systemPreferences,
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const localFiles = require("./local-files");

const APP_URL = new URL(process.env.INTERNAL_AI_URL || "https://internal-ai.vercel.app");
const ORIGIN = APP_URL.origin;
const QUICK_SHORTCUT = "Alt+Space";
const isMac = process.platform === "darwin";

let win = null;
let tray = null;
let quitting = false;
let local = null;

/* ---------------------------------------------------------------- */
/* Window state                                                       */
/* ---------------------------------------------------------------- */

const stateFile = () => path.join(app.getPath("userData"), "window-state.json");

function readState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), "utf8"));
  } catch {
    return { width: 1320, height: 860 };
  }
}

function saveState() {
  if (!win || win.isDestroyed()) return;
  try {
    const bounds = win.getNormalBounds();
    fs.writeFileSync(stateFile(), JSON.stringify({ ...bounds, maximized: win.isMaximized() }));
  } catch {}
}

/* ---------------------------------------------------------------- */
/* Main window                                                        */
/* ---------------------------------------------------------------- */

const sameOrigin = (url) => {
  try {
    return new URL(url).origin === ORIGIN;
  } catch {
    return false;
  }
};

function openExternal(url) {
  try {
    const { protocol } = new URL(url);
    if (protocol === "https:" || protocol === "http:" || protocol === "mailto:") shell.openExternal(url);
  } catch {}
}

function createWindow() {
  const state = readState();
  win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: "Internal AI",
    backgroundColor: "#f7f9fc",
    titleBarStyle: isMac ? "hiddenInset" : "default",
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });
  if (state.maximized) win.maximize();

  win.loadURL(APP_URL.toString());
  win.once("ready-to-show", () => win.show());

  // Stay on the workspace; everything else opens in the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!sameOrigin(url)) openExternal(url);
    else win.loadURL(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (sameOrigin(url)) return;
    event.preventDefault();
    openExternal(url);
  });

  // Offline or unreachable: show a small retry page instead of a blank window.
  win.webContents.on("did-fail-load", (_event, code, description, _url, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3: navigation aborted
    const html = `<!doctype html><meta charset="utf-8"><title>Internal AI</title>
<body style="margin:0;display:grid;place-items:center;height:100vh;font-family:-apple-system,Segoe UI,sans-serif;background:#f7f9fc;color:#1f2a44">
<div style="text-align:center;max-width:360px"><h2 style="margin:0 0 8px">Can’t reach Internal AI</h2>
<p style="color:#5b6a85;line-height:1.5">Check your internet connection. (${description})</p>
<button onclick="location.href='${APP_URL.toString()}'" style="margin-top:8px;padding:10px 18px;border:0;border-radius:10px;background:#5146e5;color:#fff;font-size:14px;cursor:pointer">Try again</button></div></body>`;
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  });

  win.on("focus", () => local?.onFocus());
  win.on("resize", saveState);
  win.on("move", saveState);
  // Closing the window keeps the app (and the shortcut) running, like Claude's app.
  win.on("close", (event) => {
    saveState();
    if (!quitting && isMac) {
      event.preventDefault();
      win.hide();
    }
  });
  win.on("closed", () => {
    win = null;
  });
}

function showWindow() {
  if (!win) createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/** ⌥Space from anywhere: bring Internal AI forward and open the quick assistant. */
function quickAsk() {
  showWindow();
  const send = () => win.webContents.send("desktop:quick-ask");
  if (win.webContents.isLoading()) win.webContents.once("did-finish-load", send);
  else send();
}

/* ---------------------------------------------------------------- */
/* Permissions: microphone, notifications and screen capture          */
/* ---------------------------------------------------------------- */

/** Save cookies to disk soon after they change, so sign-in survives restarts and crashes. */
function persistCookies() {
  let timer = null;
  session.defaultSession.cookies.on("changed", () => {
    clearTimeout(timer);
    timer = setTimeout(() => session.defaultSession.cookies.flushStore().catch(() => {}), 1000);
  });
}

function setUpPermissions() {
  const allowed = new Set(["media", "notifications", "clipboard-sanitized-write", "fullscreen", "display-capture"]);
  // Only the workspace itself may use the microphone, notifications and screen.
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    callback(sameOrigin(details.requestingUrl || "") && allowed.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    return sameOrigin(requestingOrigin || "") && allowed.has(permission);
  });
  // "Capture your screen" in the quick assistant: share the screen the window is on.
  session.defaultSession.setDisplayMediaRequestHandler(
    async (request, callback) => {
      if (!sameOrigin(request.securityOrigin || request.frame?.url || "")) return callback({});
      try {
        const sources = await desktopCapturer.getSources({ types: ["screen"] });
        const display = win ? screen.getDisplayMatching(win.getBounds()) : null;
        const source = sources.find((s) => display && s.display_id === String(display.id)) ?? sources[0];
        callback(source ? { video: source } : {});
      } catch {
        callback({});
      }
    },
    { useSystemPicker: true },
  );
}

/* ---------------------------------------------------------------- */
/* Menu bar icon and app menu                                         */
/* ---------------------------------------------------------------- */

function createTray() {
  const image = nativeImage.createFromPath(path.join(__dirname, "assets", "trayTemplate.png"));
  if (isMac) image.setTemplateImage(true);
  tray = new Tray(image);
  tray.setToolTip("Internal AI");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open Internal AI", click: showWindow },
      { label: "Quick ask", accelerator: QUICK_SHORTCUT, click: quickAsk },
      { type: "separator" },
      { label: "Quit Internal AI", role: "quit" },
    ]),
  );
  tray.on("click", () => (isMac ? undefined : showWindow()));
}

function createMenu() {
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [
        { label: "Quick ask", accelerator: QUICK_SHORTCUT, click: quickAsk },
        { label: "New chat", accelerator: "CmdOrCtrl+N", click: () => win?.loadURL(new URL("/#ask", APP_URL).toString()) },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        ...(app.isPackaged ? [] : [{ role: "toggleDevTools" }]),
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [{ label: "Open in browser", click: () => openExternal(win?.webContents.getURL() || APP_URL.toString()) }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ---------------------------------------------------------------- */
/* Messages from the page                                             */
/* ---------------------------------------------------------------- */

ipcMain.on("desktop:unread", (event, count) => {
  if (!sameOrigin(event.senderFrame?.url || "")) return;
  const n = Math.max(0, Math.min(9999, Number(count) || 0));
  app.setBadgeCount(n);
  tray?.setTitle(isMac && n ? String(n) : "");
});

ipcMain.on("desktop:focus", (event) => {
  if (sameOrigin(event.senderFrame?.url || "")) showWindow();
});

/* ---------------------------------------------------------------- */
/* Updates                                                            */
/* ---------------------------------------------------------------- */

const newer = (a, b) => {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
};
let announced = "";

/** Asks the workspace for the latest desktop version and offers the download. */
async function checkForUpdate() {
  try {
    const response = await session.defaultSession.fetch(`${ORIGIN}/api/desktop`, { headers: { Origin: ORIGIN } });
    if (!response.ok) return;
    const latest = await response.json();
    if (!latest.version || !newer(latest.version, app.getVersion()) || announced === latest.version) return;
    announced = latest.version;
    const open = () => openExternal(`${ORIGIN}/#download`);
    if (Notification.isSupported()) {
      const n = new Notification({
        title: "Internal AI update available",
        body: `Version ${latest.version} is ready. Click to download it.`,
      });
      n.on("click", open);
      n.show();
    }
    updateMenu(latest.version, open);
  } catch {}
}

function updateMenu(version, open) {
  const menu = Menu.getApplicationMenu();
  const help = menu?.items.find((item) => item.role === "help");
  if (!help || help.submenu.items.some((item) => item.id === "update")) return;
  help.submenu.append(new MenuItem({ id: "update", label: `Download version ${version}…`, click: open }));
}

/* ---------------------------------------------------------------- */
/* Lifecycle                                                          */
/* ---------------------------------------------------------------- */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showWindow);

  app.whenReady().then(() => {
    app.setAppUserModelId("io.naar.internal-ai");
    setUpPermissions();
    persistCookies();
    createMenu();
    createWindow();
    createTray();
    local = localFiles.create({ origin: ORIGIN, getWindow: () => win });
    setTimeout(checkForUpdate, 15_000);
    setInterval(checkForUpdate, 6 * 60 * 60 * 1000);
    if (!globalShortcut.register(QUICK_SHORTCUT, quickAsk))
      console.warn(`The ${QUICK_SHORTCUT} shortcut is taken by another app.`);
    // Ask for the microphone up front on macOS so Echo works on first use.
    if (isMac) systemPreferences.askForMediaAccess?.("microphone").catch(() => {});
  });

  app.on("activate", showWindow);
  app.on("before-quit", () => {
    quitting = true;
    session.defaultSession.cookies.flushStore().catch(() => {});
  });
  app.on("will-quit", () => globalShortcut.unregisterAll());
  app.on("window-all-closed", () => {
    if (!isMac) app.quit();
  });
}
