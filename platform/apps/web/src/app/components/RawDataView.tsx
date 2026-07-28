import { AlertTriangle, FileSpreadsheet, RotateCcw } from "lucide-react";

import { Block } from "./ui.js";
import { byUnit, moneyFull } from "../../lib/format.js";
import type { FormulaRow, PeriodReport } from "../types.js";

/**
 * The Raw Data view: two stacked blocks, Edit Data on top and Check Formulas below.
 *
 * In the prototype these were two separate panels whose contents could disagree — the
 * formula panel described metrics in prose while the arithmetic lived elsewhere. Here
 * both read the same registry, so the description and the computation cannot diverge.
 */
export function RawDataView({
  report,
  formulas,
  onEditAccount,
  onEditMetric,
  onClearOverride,
}: {
  report: PeriodReport;
  formulas: FormulaRow[];
  onEditAccount: (accountId: string) => void;
  onEditMetric: (metricId: string) => void;
  onClearOverride: (accountId: string) => void;
}) {
  const required = new Set(report.missingRequired);

  return (
    <div className="space-y-4">
      {/* ------------------------------------------------------- Edit Data */}
      <Block
        title="Edit data"
        subtitle={`${report.periodLabel} · double-click any value to override it. Overrides are permanent and never change a formula.`}
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line bg-line-soft/60">
                {["Account", "Value", "Source", "From file", ""].map((label, index) => (
                  <th
                    key={label + index}
                    className={`px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-faint ${
                      index === 1 ? "text-right" : "text-left"
                    }`}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.accounts.map((account) => {
                const missing = account.value === null;
                const isRequired = required.has(account.accountId);
                return (
                  <tr
                    key={account.accountId}
                    className={`border-b border-line-soft last:border-b-0 ${
                      isRequired ? "bg-flag-soft/50" : "hover:bg-canvas"
                    }`}
                  >
                    <td className="px-4 py-2.5">
                      <span
                        className={`font-medium ${isRequired ? "text-flag" : "text-ink"}`}
                      >
                        {account.label}
                      </span>
                      <span className="ml-2 font-mono text-[11px] text-ink-faint">
                        {account.accountId}
                      </span>
                      {isRequired ? (
                        <span className="mt-0.5 flex items-center gap-1 text-[11px] text-flag">
                          <AlertTriangle size={11} />
                          Required by an active formula — no value for this period
                        </span>
                      ) : null}
                    </td>

                    <td
                      className="cursor-pointer px-4 py-2.5 text-right"
                      onDoubleClick={() => onEditAccount(account.accountId)}
                      title="Double-click to override"
                    >
                      {/*
                        Red is reserved for a real problem. An account with no value is
                        only a problem when an active formula needs it; otherwise it is
                        simply a report this client has not uploaded, and shows neutral.
                      */}
                      <span
                        className={`num font-medium ${
                          !missing
                            ? "text-ink"
                            : isRequired
                              ? "text-flag"
                              : "text-ink-faint"
                        }`}
                      >
                        {missing
                          ? isRequired
                            ? "Missing"
                            : "—"
                          : byUnit(account.value, account.unit)}
                      </span>
                      {account.divergesFrom !== undefined ? (
                        <span className="mt-0.5 block text-[11px] text-warn">
                          source says {moneyFull(account.divergesFrom)}
                        </span>
                      ) : null}
                    </td>

                    <td className="px-4 py-2.5">
                      {account.source === "override" ? (
                        <span className="inline-flex items-center rounded-md border border-accent/25 bg-accent-soft px-2 py-[3px] text-[11px] font-medium text-accent">
                          Manual override
                        </span>
                      ) : account.source === "fact" ? (
                        <span className="text-[12px] text-ink-muted">Imported</span>
                      ) : (
                        <span className="text-[12px] text-ink-faint">—</span>
                      )}
                    </td>

                    <td className="px-4 py-2.5">
                      {account.sourceFilename ? (
                        <span
                          className="inline-flex items-center gap-1.5 text-[11.5px] text-ink-muted"
                          title={`Row "${account.sourceRowLabel}", column "${account.sourceColumnLabel}"`}
                        >
                          <FileSpreadsheet size={12} className="text-ink-faint" />
                          {account.sourceFilename}
                        </span>
                      ) : (
                        <span className="text-[12px] text-ink-faint">—</span>
                      )}
                    </td>

                    <td className="px-4 py-2.5 text-right">
                      {account.source === "override" ? (
                        <button
                          onClick={() => onClearOverride(account.accountId)}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] text-ink-muted hover:bg-line-soft hover:text-ink"
                          title="Remove this override and fall back to the imported value"
                        >
                          <RotateCcw size={11} />
                          Clear
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Block>

      {/* --------------------------------------------------- Check Formulas */}
      <Block
        title="Check formulas"
        subtitle="Every metric's definition, its inputs, and how it evaluated for this period. Editing a formula here changes it for every client."
      >
        <div className="divide-y divide-line-soft">
          {formulas.map((formula) => {
            const metric = report.metrics.find((m) => m.id === formula.id);
            const benchmark = formula.benchmark
              ? (JSON.parse(formula.benchmark) as {
                  min?: number;
                  max?: number;
                  note?: string;
                })
              : null;
            const value = metric?.value ?? null;
            const breached =
              benchmark && value !== null && metric?.status === "ok"
                ? (benchmark.min !== undefined && value < benchmark.min) ||
                  (benchmark.max !== undefined && value > benchmark.max)
                : false;

            return (
              <div
                key={formula.id}
                className="cursor-pointer px-5 py-3.5 transition-colors hover:bg-canvas"
                onDoubleClick={() => onEditMetric(formula.id)}
                title="Double-click to edit the formula or override the value"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-ink">
                      {formula.label}
                      <span className="ml-2 text-[11px] font-normal text-ink-faint">
                        v{formula.version}
                      </span>
                    </p>
                    <p className="mt-1 font-mono text-[12px] text-ink-muted">
                      {formula.expression}
                    </p>
                  </div>
                  <p
                    className={`num text-[17px] font-semibold tracking-tight ${
                      metric?.status !== "ok" ? "text-flag" : breached ? "text-flag" : "text-ink"
                    }`}
                  >
                    {metric?.status === "ok"
                      ? byUnit(value, formula.unit)
                      : "Unavailable"}
                  </p>
                </div>

                <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-muted">
                  {formula.description}
                </p>

                {metric?.status === "missing_inputs" ? (
                  <p className="mt-1.5 flex items-center gap-1.5 text-[11.5px] font-medium text-flag">
                    <AlertTriangle size={12} />
                    Needs {metric.missing.join(", ")} — not present for this period
                  </p>
                ) : metric?.status === "error" ? (
                  <p className="mt-1.5 flex items-center gap-1.5 text-[11.5px] font-medium text-flag">
                    <AlertTriangle size={12} />
                    {metric.error}
                  </p>
                ) : breached && benchmark?.note ? (
                  <p className="mt-1.5 flex items-center gap-1.5 text-[11.5px] font-medium text-flag">
                    <AlertTriangle size={12} />
                    {benchmark.note}
                  </p>
                ) : null}

                {metric && metric.dependsOn.length > 0 ? (
                  <p className="mt-1.5 text-[11px] text-ink-faint">
                    Depends on {metric.dependsOn.join(", ")}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      </Block>
    </div>
  );
}
