import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Globe, MapPin, X } from "lucide-react";

import { api } from "../../lib/trpc.js";
import { Button } from "./ui.js";

export interface EditTarget {
  kind: "account" | "metric";
  id: string;
  label: string;
  unit: string;
  currentValue: number | null;
  /** Present for metrics: the expression that would otherwise compute the value. */
  expression?: string;
  formulaVersion?: number;
}

/**
 * The edit affordance for any value on the element page.
 *
 * When the field is formula-backed, the user is made to choose explicitly, because the
 * two options have very different blast radii and the product's rules differ for each:
 *
 *   Edit the formula  — global, versioned, retroactive across every client and period.
 *   Override the value — this client and period only, permanent across sessions,
 *                        leaves the formula untouched, cleared only by a re-import.
 *
 * The dialog states the consequence in words rather than relying on the user to know it.
 */
export function EditValueDialog({
  clientId,
  period,
  target,
  onClose,
  onSaved,
}: {
  clientId: string;
  period: string;
  target: EditTarget;
  onClose: () => void;
  onSaved: () => void;
}) {
  const canEditFormula = target.kind === "metric" && Boolean(target.expression);
  const [mode, setMode] = useState<"override" | "formula">("override");
  // A computed metric arrives as a raw float (40.72164948453608). Seed the editor with
  // a figure a human would actually type, without silently changing a stored value:
  // this only affects the starting text, and the number is re-read from the input.
  const [value, setValue] = useState(
    target.currentValue === null
      ? ""
      : String(Number(target.currentValue.toFixed(target.unit === "currency" ? 2 : 4))),
  );
  const [expression, setExpression] = useState(target.expression ?? "");
  const [reason, setReason] = useState("");
  const [validation, setValidation] = useState<{
    ok: boolean;
    error?: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Validate a candidate expression as it is typed: a bad global edit would otherwise
  // break every client's dashboard at once.
  useEffect(() => {
    if (mode !== "formula" || !expression.trim()) {
      setValidation(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const result = await api.formulas.validate.query({
          id: target.id,
          expression,
        });
        if (!cancelled) setValidation({ ok: result.ok, error: result.error });
      } catch {
        /* transient */
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [expression, mode, target.id]);

  const save = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === "formula") {
        await api.formulas.update.mutate({
          id: target.id,
          expression: expression.trim(),
          note: reason.trim() || undefined,
        });
      } else {
        const numeric = Number(value.replace(/[$,\s]/g, ""));
        if (!Number.isFinite(numeric)) throw new Error("Enter a number.");
        await api.overrides.set.mutate({
          clientId,
          period,
          targetKind: target.kind,
          targetId: target.id,
          value: numeric,
          previousValue: target.currentValue,
          reason: reason.trim() || undefined,
        });
      }
      onSaved();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }, [clientId, expression, mode, onSaved, period, reason, target, value]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-6 backdrop-blur-[2px]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-line bg-surface shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight text-ink">
              {target.label}
            </h2>
            <p className="mt-0.5 text-[12px] text-ink-muted">
              {period} · {target.kind === "metric" ? "calculated metric" : "imported value"}
            </p>
          </div>
          <Button variant="ghost" onClick={onClose} aria-label="Close">
            <X size={17} />
          </Button>
        </header>

        <div className="space-y-4 p-5">
          {canEditFormula ? (
            <div className="grid grid-cols-2 gap-2">
              <ModeCard
                active={mode === "override"}
                onClick={() => setMode("override")}
                icon={<MapPin size={14} />}
                title="Override the value"
                body="This client and this period only. Permanent, and the formula is unchanged."
              />
              <ModeCard
                active={mode === "formula"}
                onClick={() => setMode("formula")}
                icon={<Globe size={14} />}
                title="Edit the formula"
                body="Every client, every period, applied retroactively. Versioned and reversible."
              />
            </div>
          ) : null}

          {mode === "override" ? (
            <label className="block">
              <span className="mb-1.5 block text-[12px] font-medium text-ink">
                Value
              </span>
              <input
                autoFocus
                value={value}
                onChange={(event) => setValue(event.target.value)}
                className="num h-10 w-full rounded-lg border border-line px-3 text-[14px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
              />
              <span className="mt-1.5 block text-[11.5px] text-ink-muted">
                Stored permanently. It will be replaced only if a future import supplies
                a new value for this field — and the entry you make now is kept in
                history either way.
              </span>
            </label>
          ) : (
            <label className="block">
              <span className="mb-1.5 block text-[12px] font-medium text-ink">
                Expression
                {target.formulaVersion ? (
                  <span className="ml-1.5 font-normal text-ink-faint">
                    currently v{target.formulaVersion}
                  </span>
                ) : null}
              </span>
              <textarea
                autoFocus
                value={expression}
                onChange={(event) => setExpression(event.target.value)}
                rows={3}
                spellCheck={false}
                className="w-full rounded-lg border border-line px-3 py-2 font-mono text-[13px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
              />
              {validation && !validation.ok ? (
                <span className="mt-1.5 flex items-start gap-1.5 text-[11.5px] text-flag">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                  {validation.error}
                </span>
              ) : (
                <span className="mt-1.5 block text-[11.5px] text-ink-muted">
                  Reference accounts by id (pl.revenue) or other metrics by name
                  (gross_profit).
                </span>
              )}
            </label>
          )}

          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-ink">
              Reason <span className="font-normal text-ink-faint">(optional)</span>
            </span>
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={
                mode === "formula"
                  ? "Why this definition changed"
                  : "e.g. client confirmed a credit note"
              }
              className="h-9 w-full rounded-lg border border-line px-3 text-[13px] outline-none placeholder:text-ink-faint focus:border-accent focus:ring-2 focus:ring-accent/15"
            />
          </label>

          {error ? (
            <p className="rounded-lg border border-flag/25 bg-flag-soft px-3 py-2 text-[12.5px] text-flag">
              {error}
            </p>
          ) : null}
        </div>

        <footer className="flex justify-end gap-2 border-t border-line px-5 py-3.5">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={save}
            disabled={busy || (mode === "formula" && validation?.ok === false)}
          >
            {busy
              ? "Saving…"
              : mode === "formula"
                ? "Update formula everywhere"
                : "Save override"}
          </Button>
        </footer>
      </div>
    </div>
  );
}

function ModeCard({
  active,
  onClick,
  icon,
  title,
  body,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-xl border p-3 text-left transition-colors ${
        active
          ? "border-accent bg-accent-soft"
          : "border-line bg-surface hover:bg-line-soft"
      }`}
    >
      <span
        className={`flex items-center gap-1.5 text-[12.5px] font-medium ${
          active ? "text-accent" : "text-ink"
        }`}
      >
        {icon}
        {title}
      </span>
      <span className="mt-1 block text-[11.5px] leading-relaxed text-ink-muted">
        {body}
      </span>
    </button>
  );
}
