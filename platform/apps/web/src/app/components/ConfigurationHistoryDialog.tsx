/**
 * Configuration history, and the way back to any point in it.
 *
 * Every state the app's configuration has actually been in, whoever caused it: the
 * assistant, a person importing a document, or an external agent over MCP. Restoring one
 * is deliberately not framed as "undo" — it appends a new state rather than erasing the
 * ones after it, so the list only ever grows and a restore can itself be restored away
 * from. Saying that on screen matters, because "revert" in most software means "lose what
 * came after" and here it does not.
 */
import { useCallback, useEffect, useState } from "react";
import { History, RotateCcw, X } from "lucide-react";
import { api } from "../../lib/trpc.js";
import { Button, EmptyState, Spinner } from "./ui.js";

interface VersionSummary {
  id: string;
  seq: number;
  author: string;
  summary: string;
  changeCount: number;
  restoredFrom: string | null;
  createdAt: string;
}

/** Who made a change, in words rather than the stored token. */
function authorLabel(author: string): string {
  if (author === "assistant") return "Avilo Assistant";
  if (author === "user") return "You";
  if (author === "baseline") return "Before history was kept";
  if (author === "revert") return "Undo snapshot";
  if (author.startsWith("mcp:")) return "External agent (MCP)";
  return author;
}

function when(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export function ConfigurationHistoryDialog({ onClose }: { onClose: () => void }) {
  const [versions, setVersions] = useState<VersionSummary[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const rows = await api.versions.list.query({ limit: 100 });
      setVersions(
        rows.map((v) => ({
          id: v.id,
          seq: v.seq,
          author: v.author,
          summary: v.summary,
          changeCount: v.diff.length,
          restoredFrom: v.restoredFrom,
          createdAt: v.createdAt,
        })),
      );
    } catch (cause) {
      setError((cause as Error).message);
      setVersions([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const restore = async (id: string) => {
    setBusy(id);
    setError(null);
    setNote(null);
    try {
      const outcome = await api.versions.restore.mutate({ id, author: "user" });
      if ("noChange" in outcome && outcome.noChange) {
        setNote("That is already the live configuration — nothing was changed.");
      } else {
        setNote("Restored. The change is live, and this restore is itself in the list below.");
        // Other mounted views read their configuration on this event rather than on a reload.
        window.dispatchEvent(new Event("avilo:configuration-changed"));
      }
      await load();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-6 backdrop-blur-[2px]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Configuration history"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-2xl border border-line bg-surface shadow-xl"
      >
        <header className="flex flex-shrink-0 items-start justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-ink">
              <History size={15} className="text-accent" />
              Configuration history
            </h2>
            <p className="mt-0.5 text-[12.5px] text-ink-muted">
              Every state your formulas, mappings, prompts, layout and views have been in.
              Restoring adds a new entry rather than deleting the ones after it, so nothing
              here is ever lost.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-ink-muted hover:bg-line-soft hover:text-ink"
          >
            <X size={16} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {versions === null ? (
            <Spinner label="Loading history…" />
          ) : versions.length === 0 ? (
            <EmptyState
              title="No changes recorded yet"
              body="History starts the first time a formula, mapping, prompt, layout or view changes."
            />
          ) : (
            <ul className="space-y-2">
              {versions.map((version, index) => (
                <li
                  key={version.id}
                  className="flex items-start justify-between gap-3 rounded-lg border border-line bg-canvas px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="text-[12.5px] font-medium text-ink">
                      {version.summary}
                      {index === 0 ? (
                        <span className="ml-2 rounded bg-accent-soft px-1.5 py-0.5 text-[10.5px] font-normal text-accent">
                          Live now
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-0.5 text-[11.5px] text-ink-faint">
                      {authorLabel(version.author)} · {when(version.createdAt)}
                      {version.changeCount > 0
                        ? ` · ${version.changeCount} change${version.changeCount === 1 ? "" : "s"}`
                        : null}
                      {version.restoredFrom ? " · a restore" : null}
                    </p>
                  </div>
                  {index === 0 ? null : (
                    <Button
                      size="sm"
                      onClick={() => void restore(version.id)}
                      disabled={busy !== null}
                    >
                      <RotateCcw size={12} className="mr-1" />
                      {busy === version.id ? "Restoring…" : "Restore"}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {note ? (
          <p className="flex-shrink-0 border-t border-line px-5 py-2.5 text-[11.5px] text-ink-muted">
            {note}
          </p>
        ) : null}
        {error ? (
          <p className="flex-shrink-0 border-t border-line px-5 py-2.5 text-[11.5px] text-flag">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
