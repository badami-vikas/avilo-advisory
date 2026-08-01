/**
 * The bridge between the shell and the renderer.
 *
 * CommonJS on purpose: a sandboxed preload is not an ES module, and sandboxing is worth
 * more than the consistency.
 *
 * What crosses this boundary is the whole of what the web app can ask the operating
 * system to do. Everything exposed here is a verb the user could already trigger from
 * the menu bar — nothing reads a path, opens a file, or returns anything from the host
 * process. Adding to this list is adding attack surface, so the test for a new entry is
 * whether a compromised renderer could do harm with it.
 */

import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("desktop", {
  /** True only inside the packaged shell. The web build leaves `window.desktop` undefined. */
  isDesktop: true,
  platform: process.platform,
  /** Opens the native save dialog and writes the current view as a PDF. */
  exportPdf: (): Promise<void> => ipcRenderer.invoke("desktop:export-pdf"),
});
