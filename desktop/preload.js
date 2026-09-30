// Bridge between the Internal AI page and the desktop app. The page only gets
// these few functions; it never has access to Node.js or Electron itself.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("internalAIDesktop", {
  isDesktop: true,
  platform: process.platform,
  /** Called when ⌥Space is pressed anywhere on the computer. */
  onQuickAsk(callback) {
    const listener = () => callback();
    ipcRenderer.on("desktop:quick-ask", listener);
    return () => ipcRenderer.removeListener("desktop:quick-ask", listener);
  },
  /** Shows the unread count on the Dock icon and menu bar. */
  setUnread(count) {
    ipcRenderer.send("desktop:unread", count);
  },
  /** Brings the window to the front, e.g. when a notification is clicked. */
  focus() {
    ipcRenderer.send("desktop:focus");
  },
  /** Files and folders on this computer. Paths only come from the native picker. */
  local: {
    list: () => ipcRenderer.invoke("local:list"),
    addFiles: () => ipcRenderer.invoke("local:add-files"),
    addFolder: () => ipcRenderer.invoke("local:add-folder"),
    sync: (id) => ipcRenderer.invoke("local:sync", id),
    remove: (id, removeFiles) => ipcRenderer.invoke("local:remove", id, !!removeFiles),
    onChange(callback) {
      const listener = (_event, folders) => callback(folders);
      ipcRenderer.on("local:changed", listener);
      return () => ipcRenderer.removeListener("local:changed", listener);
    },
    onProgress(callback) {
      const listener = (_event, progress) => callback(progress);
      ipcRenderer.on("local:progress", listener);
      return () => ipcRenderer.removeListener("local:progress", listener);
    },
  },
});
