import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Sparkles,
  UploadCloud,
  X,
} from "lucide-react";
import { REPORT_TYPE_LABELS, type ReportType } from "@avilo/module";

import { api } from "../../lib/trpc.js";
import { moneyFull } from "../../lib/format.js";
import { Button } from "./ui.js";

type Staged = Awaited<ReturnType<typeof api.import.stage.mutate>>[number];
type Account = Awaited<ReturnType<typeof api.accounts.list.query>>[number];

async function toBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * One dialog for every upload.
 *
 * Deliberately not six typed drop zones: the classifier decides what each file is, and
 * the user corrects it if it is wrong. The v9 build's per-slot design is what made a
 * combined export awkward and made a misdrop fall back to placeholder logic silently.
 *
 * Nothing is written to the fact store until "Import" is pressed, so a wrong detection
 * costs a click rather than a wrong dashboard.
 */
export function UploadDialog({
  clientId,
  clientName,
  onClose,
  onImported,
}: {
  clientId: string;
  clientName: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const [staged, setStaged] = useState<Staged[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void api.accounts.list.query().then(setAccounts);
  }, []);

  const stage = useCallback(
    async (files: FileList | File[]) => {
      const list = [...files];
      if (list.length === 0) return;
      setBusy(true);
      setError(null);
      try {
        const payload = await Promise.all(
          list.map(async (file) => ({
            filename: file.name,
            content: await toBase64(file),
          })),
        );
        const next = await api.import.stage.mutate({ clientId, files: payload });
        setStaged((current) => [
          ...current.filter(
            (existing) => !next.some((n) => n.sourceFileId === existing.sourceFileId),
          ),
          ...next,
        ]);
      } catch (cause) {
        setError((cause as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [clientId],
  );

  const mapLabel = useCallback(
    async (file: Staged, rawLabel: string, accountId: string) => {
      if (!accountId) return;
      await api.import.mapLabel.mutate({
        clientId,
        reportType: file.classification.reportType as string,
        rawLabel,
        accountId,
        scope: "client",
      });
      // Re-stage from the stored copy so the preview reflects the new mapping.
      const refreshed = await api.import.stage.mutate({
        clientId,
        files: [],
      });
      void refreshed;
      setStaged((current) =>
        current.map((entry) =>
          entry.sourceFileId === file.sourceFileId
            ? {
                ...entry,
                preview: entry.preview
                  ? {
                      ...entry.preview,
                      unmatched: entry.preview.unmatched.filter(
                        (u) => u.rawLabel !== rawLabel,
                      ),
                    }
                  : null,
              }
            : entry,
        ),
      );
    },
    [clientId],
  );

  const importAll = useCallback(async () => {
    setBusy(true);
    setError(null);
    const notices: string[] = [];
    try {
      for (const file of staged) {
        if (!file.classification.reportType) continue;
        const outcome = await api.import.commit.mutate({
          clientId,
          sourceFileId: file.sourceFileId,
          reportType: file.classification.reportType,
        });
        notices.push(
          `${file.filename}: ${outcome.factsWritten} values across ${outcome.periods.length} period${outcome.periods.length === 1 ? "" : "s"}.`,
          ...outcome.notices,
          ...outcome.warnings,
        );
      }
      setResult(notices);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }, [clientId, staged]);

  const importable = staged.filter((f) => f.classification.reportType && f.preview);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/25 p-6 backdrop-blur-[2px]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Upload files for ${clientName}`}
    >
      <div
        className="mt-8 w-full max-w-3xl rounded-2xl border border-line bg-surface shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight text-ink">
              Upload source files
            </h2>
            <p className="mt-0.5 text-[12.5px] text-ink-muted">
              {clientName} · files are classified automatically and nothing is saved
              until you import
            </p>
          </div>
          <Button variant="ghost" onClick={onClose} aria-label="Close">
            <X size={17} />
          </Button>
        </header>

        <div className="max-h-[65vh] space-y-4 overflow-y-auto p-5">
          {/* ------------------------------------------------------ drop zone */}
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              void stage(event.dataTransfer.files);
            }}
            onClick={() => inputRef.current?.click()}
            className={`cursor-pointer rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors ${
              dragging
                ? "border-accent bg-accent-soft"
                : "border-line bg-canvas hover:border-ink-faint"
            }`}
          >
            <UploadCloud size={26} className="mx-auto text-ink-faint" />
            <p className="mt-2 text-[13px] font-medium text-ink">
              Drop one or more files here
            </p>
            <p className="mt-1 text-[12px] text-ink-muted">
              Excel, CSV or PDF exports from QuickBooks. Any report type, any order —
              they are identified for you. Excel is the most reliable: it states its
              structure, where a PDF only draws one.
            </p>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept=".xlsx,.xlsm,.xls,.csv,.pdf"
              className="hidden"
              onChange={(event) => {
                if (event.target.files) void stage(event.target.files);
                event.target.value = "";
              }}
            />
          </div>

          {error ? (
            <p className="rounded-lg border border-flag/25 bg-flag-soft px-3 py-2 text-[12.5px] text-flag">
              {error}
            </p>
          ) : null}

          {/* -------------------------------------------------- staged files */}
          {staged.map((file) => (
            <StagedFileCard
              key={file.sourceFileId}
              file={file}
              accounts={accounts}
              onMapLabel={(raw, account) => void mapLabel(file, raw, account)}
              onChangeType={(type) =>
                setStaged((current) =>
                  current.map((entry) =>
                    entry.sourceFileId === file.sourceFileId
                      ? {
                          ...entry,
                          classification: {
                            ...entry.classification,
                            reportType: type,
                            needsConfirmation: false,
                            method: "user",
                          },
                        }
                      : entry,
                  ),
                )
              }
            />
          ))}

          {result ? (
            <div className="space-y-1.5 rounded-xl border border-line bg-canvas p-4">
              <p className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
                <CheckCircle2 size={15} className="text-positive" />
                Import complete
              </p>
              {result.map((line, index) => (
                <p key={index} className="text-[12.5px] leading-relaxed text-ink-muted">
                  {line}
                </p>
              ))}
            </div>
          ) : null}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-line px-5 py-3.5">
          <p className="text-[12px] text-ink-muted">
            {staged.length === 0
              ? "No files staged"
              : `${importable.length} of ${staged.length} file${staged.length === 1 ? "" : "s"} ready to import`}
          </p>
          <div className="flex gap-2">
            <Button onClick={onClose}>{result ? "Close" : "Cancel"}</Button>
            {result ? (
              <Button variant="primary" onClick={onImported}>
                Done
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={importAll}
                disabled={busy || importable.length === 0}
              >
                {busy ? "Working…" : `Import ${importable.length || ""}`.trim()}
              </Button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}

function StagedFileCard({
  file,
  accounts,
  onMapLabel,
  onChangeType,
}: {
  file: Staged;
  accounts: Account[];
  onMapLabel: (rawLabel: string, accountId: string) => void;
  onChangeType: (type: ReportType) => void;
}) {
  const { classification, preview } = file;
  const confident = classification.reportType && !classification.needsConfirmation;

  /*
    AI suggestions for the rows the deterministic resolver could not place.

    Held in local state and rendered as a pre-selected value with a reason, never applied
    silently: the model is a fast first draft of a decision that remains the user's. A
    suggestion becomes real only when "Apply" is pressed, which routes through exactly the
    same mapLabel call as a manual choice — so an accepted suggestion is learned, and the
    same label is never asked about again on any future import.
  */
  const [suggestions, setSuggestions] = useState<Record<string, { accountId: string | null; reason: string }>>({});
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  const suggested = Object.entries(suggestions).filter(([, s]) => s.accountId);

  const askModel = async () => {
    if (!preview || !classification.reportType) return;
    setSuggesting(true);
    setSuggestError(null);
    try {
      const result = await api.import.suggestMappings.mutate({
        reportType: classification.reportType,
        labels: preview.unmatched.map((u) => u.rawLabel),
      });
      const next: Record<string, { accountId: string | null; reason: string }> = {};
      for (const s of result) next[s.rawLabel] = { accountId: s.accountId, reason: s.reason };
      setSuggestions(next);
    } catch (cause) {
      setSuggestError((cause as Error).message);
    } finally {
      setSuggesting(false);
    }
  };

  const applyAll = () => {
    for (const [rawLabel, s] of suggested) {
      if (s.accountId) onMapLabel(rawLabel, s.accountId);
    }
    setSuggestions({});
  };

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-start gap-3">
        <FileSpreadsheet size={17} className="mt-0.5 shrink-0 text-ink-faint" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-ink">{file.filename}</p>

          {file.error ? (
            <p className="mt-1.5 flex items-start gap-1.5 text-[12.5px] leading-relaxed text-flag">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              {file.error}
            </p>
          ) : (
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <select
                value={classification.reportType ?? ""}
                onChange={(event) => onChangeType(event.target.value as ReportType)}
                className="h-7 rounded-md border border-line bg-surface px-2 text-[12px] text-ink outline-none focus:border-accent"
              >
                <option value="">Choose report type…</option>
                {Object.entries(REPORT_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>

              {confident ? (
                <span className="text-[11.5px] text-ink-muted">
                  detected automatically · {Math.round(classification.confidence * 100)}%
                  confidence
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-md bg-flag-soft px-2 py-[3px] text-[11.5px] font-medium text-flag">
                  <AlertTriangle size={11} />
                  Please confirm the type
                </span>
              )}
            </div>
          )}

          {classification.evidence.length > 0 ? (
            <p className="mt-1.5 text-[11.5px] text-ink-faint">
              Matched on {classification.evidence.slice(0, 3).join(", ")}
            </p>
          ) : null}

          {preview ? (
            <div className="mt-3 space-y-2 border-t border-line-soft pt-3">
              <p className="text-[12px] text-ink-muted">
                <span className="font-medium text-ink">
                  {preview.periods.length} period
                  {preview.periods.length === 1 ? "" : "s"}
                </span>{" "}
                found: {preview.periods.join(", ")}
                {preview.ignoredColumns.length > 0 ? (
                  <>
                    {" · ignored "}
                    {preview.ignoredColumns.slice(0, 4).join(", ")}
                  </>
                ) : null}
              </p>
              <p className="text-[12px] text-ink-muted">
                <span className="font-medium text-ink">{preview.facts.length}</span>{" "}
                values recognised
              </p>

              {preview.unmatched.length > 0 ? (
                <div className="rounded-lg border border-line bg-canvas p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      {/*
                        "No matching account", not "not recognised".

                        Most of these rows are sub-accounts and subtotals that the
                        canonical chart has no slot for — mapping a subtotal alongside its
                        children would double-count it. Calling that "not recognised"
                        described a healthy import as a failure and sent people hunting for
                        a bug that was not there.
                      */}
                      <p className="text-[12px] font-medium text-ink">
                        {preview.unmatched.length} row
                        {preview.unmatched.length === 1 ? " has" : "s have"} no matching
                        account
                      </p>
                      <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-muted">
                        Usually fine — subtotals and sub-accounts have nowhere to map, and
                        skipping them is correct. Map the ones that matter; each choice is
                        remembered.
                      </p>
                    </div>
                    <Button onClick={askModel} disabled={suggesting}>
                      <Sparkles size={12} />
                      {suggesting ? "Thinking…" : "Suggest"}
                    </Button>
                  </div>

                  {suggestError ? (
                    <p className="mt-2 flex items-start gap-1.5 text-[11.5px] leading-relaxed text-flag">
                      <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                      {suggestError}
                    </p>
                  ) : null}

                  {suggested.length > 0 ? (
                    <div className="mt-2 flex items-center justify-between gap-3 rounded-md border border-accent/30 bg-accent-soft/40 px-2.5 py-1.5">
                      <span className="text-[11.5px] text-ink">
                        {suggested.length} mapping{suggested.length === 1 ? "" : "s"}{" "}
                        suggested below. Review, then apply.
                      </span>
                      <Button variant="primary" onClick={applyAll}>
                        Apply {suggested.length}
                      </Button>
                    </div>
                  ) : null}
                  <div className="mt-2 max-h-44 space-y-1.5 overflow-y-auto">
                    {preview.unmatched.map((row) => {
                      const hint = suggestions[row.rawLabel];
                      return (
                        <div
                          key={row.normalizedLabel}
                          className="flex items-center gap-2"
                        >
                          <span className="min-w-0 flex-1 truncate text-[12px] text-ink">
                            {row.rawLabel}
                            {row.sampleValues[0] ? (
                              <span className="num ml-2 text-ink-faint">
                                {moneyFull(row.sampleValues[0].value)}
                              </span>
                            ) : null}
                            {hint?.reason ? (
                              <span
                                className={`ml-2 text-[11px] ${hint.accountId ? "text-accent" : "text-ink-faint"}`}
                              >
                                {hint.accountId ? "AI: " : "AI: skip — "}
                                {hint.reason}
                              </span>
                            ) : null}
                          </span>
                          <select
                            value={hint?.accountId ?? ""}
                            onChange={(event) => {
                              const value = event.target.value;
                              setSuggestions((current) => ({
                                ...current,
                                [row.rawLabel]: {
                                  accountId: value || null,
                                  reason: current[row.rawLabel]?.reason ?? "",
                                },
                              }));
                              if (value) onMapLabel(row.rawLabel, value);
                            }}
                            className={`h-7 w-52 shrink-0 rounded-md border bg-surface px-2 text-[11.5px] outline-none focus:border-accent ${
                              hint?.accountId ? "border-accent text-accent" : "border-line"
                            }`}
                          >
                            <option value="">Skip</option>
                            {accounts.map((account) => (
                              <option key={account.id} value={account.id}>
                                {account.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {preview.warnings.map((warning, index) => (
                <p
                  key={index}
                  className="flex items-start gap-1.5 text-[11.5px] leading-relaxed text-warn"
                >
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                  {warning}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
