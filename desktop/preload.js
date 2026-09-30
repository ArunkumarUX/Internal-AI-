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
});
