/**
 * The desktop shell, as seen from the renderer.
 *
 * `window.desktop` is injected by the Electron preload and is undefined everywhere else,
 * so every capability here is optional and every caller has a working fallback. That is
 * what keeps this a normal web application that a shell can improve, rather than one
 * that only runs inside it — and it is what makes the front end reusable when the module
 * is merged into a larger app with a different shell.
 */

export interface DesktopBridge {
  isDesktop: true;
  platform: string;
  exportPdf(): Promise<void>;
}

declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}

export function desktop(): DesktopBridge | null {
  return typeof window !== "undefined" && window.desktop ? window.desktop : null;
}

export const isDesktop = (): boolean => desktop() !== null;

/**
 * Produce a PDF of the current view.
 *
 * In the shell this opens a native save dialog and writes the file directly — the same
 * print stylesheets, but the user picks a location once instead of walking through a
 * browser print sheet to reach "Save as PDF". Outside it, `window.print()` is still the
 * only thing a page can do.
 */
export async function exportReportPdf(): Promise<void> {
  const bridge = desktop();
  if (!bridge) {
    window.print();
    return;
  }
  try {
    await bridge.exportPdf();
  } catch {
    // A failed native export should still leave the user a way to get their PDF rather
    // than a button that silently does nothing.
    window.print();
  }
}
