/**
 * One way to reach the import dialog, from anywhere in the page.
 *
 * A dozen sections can be empty, and each of them knows exactly which file would fill it
 * in. Telling the reader that and then making them find the toolbar is a instruction with
 * no button attached, so the "needs data" block opens the importer itself.
 *
 * A context rather than a prop threaded through Dashboard → section → panel: the handler
 * is the same one for every section, and the sections that need it are three levels down
 * from the page that owns the dialog.
 */

import { createContext, useContext, type ReactNode } from "react";

const UploadContext = createContext<(() => void) | null>(null);

export function UploadProvider({
  onUpload,
  children,
}: {
  onUpload: () => void;
  children: ReactNode;
}) {
  return <UploadContext.Provider value={onUpload}>{children}</UploadContext.Provider>;
}

/** Null outside a provider — the block then renders as plain text, not a dead button. */
export function useUpload(): (() => void) | null {
  return useContext(UploadContext);
}
