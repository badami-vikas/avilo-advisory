import { useState } from "react";
import { AlertTriangle, FileSpreadsheet, Globe, RotateCcw } from "lucide-react";

import { Block } from "./ui.js";
import { Tip } from "./Tooltip.js";
import { InlineEditor } from "./DataTable.js";
import { byUnit, moneyFull } from "../../lib/format.js";
import type { FormulaRow, PeriodReport } from "../types.js";

/**
 * The Raw Data view: Edit data on top, Check formulas below.
 *
 * Everything is edited in place. The two-column split in the formulas table is what
 * makes the modal unnecessary: the FORMULA cell is the global, versioned definition,
 * and the VALUE cell is the local override for this client and period. The blast radius
 * is expressed by which cell you double-click, not by a dialog asking you to choose.
 */
export function RawDataView({
  report,
  formulas,
  onSetAccountValue,
  onSetMetricValue,
  onSetFormula,
  onClearOverride,
}: {
  report: PeriodReport;
  formulas: FormulaRow[];
  onSetAccountValue: (accountId: string, raw: string) => Promise<void>;
  onSetMetricValue: (metricId: string, raw: string) => Promise<void>;
  onSetFormula: (formulaId: string, expression: string) => Promise<void>;
  onClearOverride: (accountId: string) => void;
  /*
    No report-layout editing here.

    It used to live at the bottom of this view, which put an editorial decision about the
    document among tables of figures — two different jobs on one screen. The report is
    now arranged on the report itself, by dragging.
  */
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const required = new Set(report.missingRequired);

  const commit = async (key: string, run: () => Promise<void>) => {
    setEditing(null);
    setError(null);
    try {
      await run();
    } catch (cause) {
      setError(`${key}: ${(cause as Error).message}`);
    }
  };

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-xl border border-flag/25 bg-flag-soft px-4 py-3 text-[12.5px] text-flag">
          {error}
        </div>
      ) : null}

      {/* ------------------------------------------------------- Edit data */}
      <Block
        title="Edit data"
        subtitle={`${report.periodLabel} · double-click a value to override it`}
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
                const key = `account:${account.accountId}`;
                const isEditing = editing === key;

                return (
                  <tr
                    key={account.accountId}
                    className={`border-b border-line-soft last:border-b-0 ${
                      isRequired ? "bg-flag-soft/50" : "hover:bg-canvas"
                    }`}
                  >
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <Tip
                        content={
                          isRequired
                            ? "An active formula needs this account and it has no value for this period. Upload the report that supplies it, or double-click the value to enter it manually."
                            : account.description ||
                              `Canonical account ${account.accountId}`
                        }
                      >
                        <span
                          className={`font-medium ${isRequired ? "text-flag" : "text-ink"}`}
                        >
                          {account.label}
                          {isRequired ? (
                            <AlertTriangle size={11} className="ml-1.5 inline align-[-1px]" />
                          ) : null}
                        </span>
                      </Tip>
                    </td>

                    <td
                      className="cursor-pointer px-4 py-2.5 text-right"
                      onDoubleClick={() => setEditing(key)}
                    >
                      {isEditing ? (
                        <InlineEditor
                          initial={
                            account.value === null
                              ? ""
                              : String(Number(account.value.toFixed(2)))
                          }
                          align="right"
                          onCancel={() => setEditing(null)}
                          onCommit={(next) =>
                            void commit(account.label, () =>
                              onSetAccountValue(account.accountId, next),
                            )
                          }
                        />
                      ) : (
                        <Tip
                          content={
                            account.divergesFrom !== undefined
                              ? `Your manual value. The imported file says ${moneyFull(account.divergesFrom)}.`
                              : "Double-click to override this value. Overrides are permanent and never change a formula."
                          }
                        >
                          {/*
                            Red is reserved for a real problem: an absent value only
                            matters when an active formula needs it.
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
                        </Tip>
                      )}
                    </td>

                    <td className="whitespace-nowrap px-4 py-2.5">
                      {account.source === "override" ? (
                        <Tip content="Entered by hand. It survives restarts and is replaced only by a re-import supplying a new value for this field.">
                          <span className="inline-flex items-center rounded-md border border-accent/25 bg-accent-soft px-2 py-[3px] text-[11px] font-medium text-accent">
                            Manual override
                          </span>
                        </Tip>
                      ) : account.source === "fact" ? (
                        <span className="text-[12px] text-ink-muted">Imported</span>
                      ) : (
                        <span className="text-[12px] text-ink-faint">—</span>
                      )}
                    </td>

                    <td className="whitespace-nowrap px-4 py-2.5">
                      {account.sourceFilename ? (
                        <Tip
                          content={`Row "${account.sourceRowLabel}", column "${account.sourceColumnLabel}"`}
                        >
                          <span className="inline-flex items-center gap-1.5 text-[11.5px] text-ink-muted">
                            <FileSpreadsheet size={12} className="text-ink-faint" />
                            {account.sourceFilename}
                          </span>
                        </Tip>
                      ) : (
                        <span className="text-[12px] text-ink-faint">—</span>
                      )}
                    </td>

                    <td className="px-4 py-2.5 text-right">
                      {account.source === "override" ? (
                        <Tip content="Remove the override and fall back to the imported value">
                          <button
                            onClick={() => onClearOverride(account.accountId)}
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] text-ink-muted hover:bg-line-soft hover:text-ink"
                          >
                            <RotateCcw size={11} />
                            Clear
                          </button>
                        </Tip>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Block>

      {/* --------------------------------------------------- Check formulas */}
      <Block
        title="Check formulas"
        subtitle="Double-click a formula to change it everywhere, or a value to override it here"
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-line bg-line-soft/60">
                <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-faint">
                  Element
                </th>
                <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-faint">
                  Formula
                </th>
                <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-faint">
                  Value
                </th>
              </tr>
            </thead>
            <tbody>
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
                const ok = metric?.status === "ok";
                const breached =
                  benchmark && value !== null && ok
                    ? (benchmark.min !== undefined && value < benchmark.min) ||
                      (benchmark.max !== undefined && value > benchmark.max)
                    : false;

                const formulaKey = `formula:${formula.id}`;
                const valueKey = `metric:${formula.id}`;

                return (
                  <tr
                    key={formula.id}
                    className="border-b border-line-soft last:border-b-0 hover:bg-canvas"
                  >
                    {/* --- element name */}
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <Tip content={formula.description}>
                        <span className="font-medium text-ink">
                          {formula.label}
                          <span className="ml-1.5 text-[11px] font-normal text-ink-faint">
                            v{formula.version}
                          </span>
                        </span>
                      </Tip>
                    </td>

                    {/* --- formula (global, versioned) */}
                    <td
                      className="cursor-pointer px-4 py-2.5"
                      onDoubleClick={() => setEditing(formulaKey)}
                    >
                      {editing === formulaKey ? (
                        <InlineEditor
                          initial={formula.expression}
                          onCancel={() => setEditing(null)}
                          onCommit={(next) =>
                            void commit(formula.label, () =>
                              onSetFormula(formula.id, next),
                            )
                          }
                        />
                      ) : (
                        <Tip
                          content={
                            <span>
                              <Globe size={11} className="mr-1 inline align-[-1px]" />
                              Double-click to edit. A formula change applies to every
                              client and every period, is versioned, and is refused if it
                              would create a cycle.
                              {metric && metric.dependsOn.length > 0 ? (
                                <> Depends on {metric.dependsOn.join(", ")}.</>
                              ) : null}
                            </span>
                          }
                        >
                          <span className="font-mono text-[12px] text-ink-muted">
                            {formula.expression}
                          </span>
                        </Tip>
                      )}
                    </td>

                    {/* --- value (local override) */}
                    <td
                      className="cursor-pointer whitespace-nowrap px-4 py-2.5 text-right"
                      onDoubleClick={() => setEditing(valueKey)}
                    >
                      {editing === valueKey ? (
                        <InlineEditor
                          initial={value === null ? "" : String(Number(value.toFixed(4)))}
                          align="right"
                          onCancel={() => setEditing(null)}
                          onCommit={(next) =>
                            void commit(formula.label, () =>
                              onSetMetricValue(formula.id, next),
                            )
                          }
                        />
                      ) : (
                        <Tip
                          content={
                            metric?.status === "missing_inputs" ? (
                              <>Needs {metric.missing.join(", ")} — not present for this period</>
                            ) : metric?.status === "error" ? (
                              metric.error
                            ) : breached && benchmark?.note ? (
                              benchmark.note
                            ) : (
                              "Double-click to override this value for this client and period only. The formula is unchanged."
                            )
                          }
                        >
                          <span
                            className={`num text-[14px] font-semibold ${
                              !ok || breached ? "text-flag" : "text-ink"
                            }`}
                          >
                            {ok ? byUnit(value, formula.unit) : "Unavailable"}
                            {(!ok || breached) ? (
                              <AlertTriangle
                                size={11}
                                className="ml-1.5 inline align-[-1px]"
                              />
                            ) : null}
                          </span>
                        </Tip>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Block>
    </div>
  );
}
