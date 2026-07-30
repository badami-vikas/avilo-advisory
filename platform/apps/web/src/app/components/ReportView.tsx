import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";

import { Block } from "./ui.js";
import { Tip } from "./Tooltip.js";
import { InlineEditor } from "./DataTable.js";
import { ChartBlock, type ChartPoint } from "./ChartBlock.js";
import {
  AgingBlock,
  ReferralBlock,
  ServiceLinesBlock,
  TopCustomersBlock,
  TopExpensesBlock,
} from "./DetailSections.js";
import { byUnit, money } from "../../lib/format.js";
import type {
  DetailByKind,
  FormulaRow,
  PeriodReport,
  SeriesPoint,
} from "../types.js";

/**
 * Key Insights — the advisor's own commentary.
 *
 * In the v9 prototype this was `d.note || 'Add your key insights here.'`: a plain text
 * field a person typed. It is kept that way deliberately. The numbers are already on the
 * page; what a client is paying for is someone's reading of them, and a generated
 * paragraph would be confident prose with nothing behind it.
 *
 * Click to edit, blur or Cmd-Enter to save, Escape to abandon.
 */
function KeyInsightsBlock({
  note,
  onSave,
}: {
  note: string;
  onSave: (body: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note);

  // The note belongs to the selected period, so changing period must replace the draft
  // rather than carry last month's commentary into this month's field.
  useEffect(() => {
    setDraft(note);
    setEditing(false);
  }, [note]);

  const commit = async () => {
    setEditing(false);
    if (draft !== note) await onSave(draft);
  };

  return (
    <div className="rounded-xl border border-line bg-accent-soft/40 px-5 py-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-faint">
        Key Insights
      </p>
      {editing ? (
        <textarea
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setDraft(note);
              setEditing(false);
            }
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              void commit();
            }
          }}
          rows={4}
          placeholder="Add your key insights here."
          className="mt-2 w-full resize-y rounded-lg border border-accent bg-surface px-3 py-2 text-[13px] leading-relaxed text-ink outline-none"
        />
      ) : (
        <p
          onClick={() => setEditing(true)}
          className={`mt-1.5 cursor-text whitespace-pre-wrap text-[13px] leading-relaxed ${
            note.trim() === "" ? "text-ink-faint italic" : "text-ink"
          }`}
        >
          {note.trim() === "" ? "Add your key insights here." : note}
        </p>
      )}
    </div>
  );
}

/**
 * Top 5 jobs this month.
 *
 * The reference computes this as `customers.sort(by revenue).slice(0, 5)` over the Sales
 * by Customer export — so a "job" here is really the highest-billing customers, and the
 * subtitle says so rather than implying a job-level source the export does not contain.
 */
function TopJobsBlock({ rows }: { rows: { id: string; label: string; value: number }[] }) {
  const top = [...rows].sort((a, b) => b.value - a.value).slice(0, 5);

  return (
    <Block
      title="Top 5 jobs this month"
      subtitle="Highest-billing customers in the Sales by Customer export"
    >
      {top.length === 0 ? (
        <p className="px-5 py-6 text-[12.5px] italic text-ink-faint">
          Import a Sales by Customer report to populate this table.
        </p>
      ) : (
        <div className="divide-y divide-line-soft">
          {top.map((row, index) => (
            <div key={row.id} className="flex items-center gap-3 px-5 py-2.5">
              <span className="num w-5 shrink-0 text-[11.5px] text-ink-faint">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
                {row.label}
              </span>
              <span className="num w-28 shrink-0 text-right text-[12.5px] font-medium text-ink">
                {money(row.value)}
              </span>
            </div>
          ))}
        </div>
      )}
    </Block>
  );
}

/**
 * The Report view: the rendered dashboard, composed of separated visual blocks.
 *
 * Explanations are tooltips rather than lines of text under each figure — the earlier
 * layout doubled the vertical space and pushed the numbers apart.
 */
export function ReportView({
  clientName,
  report,
  series,
  detail,
  formulas,
  note,
  onSetNote,
  rangeLabel,
  onSetMetricValue,
}: {
  clientName: string;
  report: PeriodReport;
  series: SeriesPoint[];
  detail: DetailByKind;
  /** Carries the benchmark bands, which is what "Flags to review" is derived from. */
  formulas: FormulaRow[];
  /** The advisor's own commentary for this client-month. */
  note: string;
  onSetNote: (body: string) => Promise<void>;
  /** Set only while exporting: the period range the PDF covers. */
  rangeLabel?: string | null;
  onSetMetricValue: (metricId: string, raw: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const metric = (id: string) => report.metrics.find((m) => m.id === id);
  const account = (id: string) => report.accounts.find((a) => a.accountId === id);

  const points: ChartPoint[] = series.map((point) => ({
    label: point.periodLabel,
    values: point.values,
  }));

  const unitFor = (id: string): string =>
    formulas.find((f) => f.id === id)?.unit ?? (id.endsWith("_pct") ? "percent" : "currency");

  const metricTip = (id: string): string => {
    const m = metric(id);
    if (!m) return "";
    if (m.status === "missing_inputs")
      return `Needs ${m.missing.join(", ")} — not present for this period.`;
    if (m.status === "error") return m.error ?? "Could not be computed.";
    return "Double-click to override this value for this period. The formula is unchanged.";
  };

  const MetricCard = ({ id }: { id: string }) => {
    const m = metric(id);
    if (!m) return null;
    const ok = m.status === "ok";
    // The unit is declared on the formula, so read it from there. Inferring it from the
    // id — "_pct" means percent, this one id means days, everything else is currency —
    // meant every new formula rendered as dollars until someone remembered to add a
    // branch here, which is how DSO first shipped as "$8.82".
    const unit = unitFor(id);

    return (
      <div
        className="bg-surface px-5 py-4"
        onDoubleClick={() => setEditing(id)}
      >
        <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-faint">
          {m.label}
        </p>
        {editing === id ? (
          <div className="mt-1">
            <InlineEditor
              initial={m.value === null ? "" : String(Number(m.value.toFixed(4)))}
              onCancel={() => setEditing(null)}
              onCommit={async (next) => {
                setEditing(null);
                await onSetMetricValue(id, next);
              }}
            />
          </div>
        ) : (
          <Tip content={metricTip(id)}>
            <p
              className={`num mt-1 cursor-pointer text-[21px] font-semibold tracking-tight ${
                ok ? "text-ink" : "text-flag"
              }`}
            >
              {ok ? byUnit(m.value, unit) : "Unavailable"}
              {!ok ? <AlertTriangle size={13} className="ml-1.5 inline align-[-2px]" /> : null}
            </p>
          </Tip>
        )}
      </div>
    );
  };

  /**
   * Flags to review.
   *
   * Derived from the benchmark bands already declared in the formula registry, not from
   * thresholds written again here — the v9 prototype kept its rules in a second place
   * and they drifted from the formulas they judged. Editing a benchmark changes this
   * panel, because there is only one definition.
   */
  const flags = (() => {
    const out: { label: string; detail: string; tone: "flag" | "warn" }[] = [];

    for (const metric of report.metrics) {
      if (metric.status === "missing_inputs") continue;
      if (metric.status === "error") {
        out.push({
          label: metric.label,
          detail: metric.error ?? "Could not be computed.",
          tone: "flag",
        });
        continue;
      }
      if (metric.value === null) continue;

      const formula = formulas.find((f) => f.id === metric.id);
      if (!formula?.benchmark) continue;

      let band: { min?: number; max?: number; note?: string };
      try {
        band = JSON.parse(formula.benchmark) as typeof band;
      } catch {
        continue;
      }

      const unit = formula.unit;
      if (band.min !== undefined && metric.value < band.min) {
        out.push({
          label: metric.label,
          detail: `${byUnit(metric.value, unit)} — below ${byUnit(band.min, unit)}. ${band.note ?? ""}`.trim(),
          tone: "flag",
        });
      } else if (band.max !== undefined && metric.value > band.max) {
        out.push({
          label: metric.label,
          detail: `${byUnit(metric.value, unit)} — above ${byUnit(band.max, unit)}. ${band.note ?? ""}`.trim(),
          tone: "warn",
        });
      }
    }

    return out;
  })();

  return (
    <div className="space-y-4">
      {/* Print-only header: the exported PDF must identify itself. */}
      <div className="print-only mb-4">
        <h1 className="text-[18px] font-semibold tracking-tight text-ink">{clientName}</h1>
        <p className="text-[12px] text-ink-muted">
          Monthly business snapshot · {report.periodLabel} · Avilo Advisory
        </p>
        {rangeLabel ? (
          <p className="text-[11.5px] text-ink-faint">
            Trend data covers {rangeLabel}
          </p>
        ) : null}
      </div>

      {report.missingRequired.length > 0 ? (
        <Tip
          content={report.accounts
            .filter((a) => a.requiredButMissing)
            .map((a) => a.label)
            .join(", ")}
        >
          <div className="flex items-center gap-2 rounded-xl border border-flag/25 bg-flag-soft px-4 py-2.5">
            <AlertTriangle size={14} className="shrink-0 text-flag" />
            <p className="text-[12.5px] font-medium text-flag">
              {report.missingRequired.length} required input
              {report.missingRequired.length === 1 ? "" : "s"} missing for{" "}
              {report.periodLabel} — metrics that depend on{" "}
              {report.missingRequired.length === 1 ? "it" : "them"} are shown as
              unavailable rather than estimated.
            </p>
          </div>
        </Tip>
      ) : null}

      {/* ------------------------------------------------------ Key Insights */}
      <KeyInsightsBlock note={note} onSave={onSetNote} />

      {/* ------------------------------------------------------- At a Glance */}
      <Block title="At a Glance" subtitle={`${clientName} · ${report.periodLabel}`}>
        <div className="grid grid-cols-1 gap-px bg-line-soft sm:grid-cols-3">
          {[
            { id: "pl.revenue", label: "Revenue" },
            { id: "net_operating_income", label: "Net Operating Income", isMetric: true },
            { id: "bs.cash", label: "Total cash in bank accounts" },
          ].map((item) => {
            const value = item.isMetric
              ? (metric(item.id)?.value ?? null)
              : (account(item.id)?.value ?? null);
            const missing = value === null;
            return (
              <div key={item.id} className="bg-surface px-5 py-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-faint">
                  {item.label}
                </p>
                <Tip
                  content={
                    missing
                      ? "No value for this period. Upload the report that supplies it, or enter it in Raw data."
                      : account(item.id)?.sourceFilename
                        ? `From ${account(item.id)?.sourceFilename}`
                        : "Computed from imported data"
                  }
                >
                  <p
                    className={`num mt-1 text-[24px] font-semibold tracking-tight ${
                      missing ? "text-flag" : "text-ink"
                    }`}
                  >
                    {missing ? "Missing" : byUnit(value, "currency")}
                  </p>
                </Tip>
              </div>
            );
          })}
        </div>
      </Block>

      {/* -------------------------------------------- Did you make money? */}
      <Block
        title="Did you make money this month?"
        subtitle="Double-click any figure to override it for this period"
      >
        <div className="grid grid-cols-1 gap-px bg-line-soft sm:grid-cols-2 lg:grid-cols-4">
          {["gross_profit", "gross_margin_pct", "net_operating_income", "noi_margin_pct"].map(
            (id) => (
              <MetricCard key={id} id={id} />
            ),
          )}
        </div>
      </Block>

      {/* -------------------------------------------------------- trend */}
      <ChartBlock
        title="Revenue & Net Operating Income margin"
        subtitle="Every period imported for this client"
        points={points}
        series={[
          { id: "pl.revenue", label: "Revenue", unit: "currency", type: "bar", color: "#b2ddff" },
          {
            id: "net_operating_income",
            label: "Net Operating Income",
            unit: "currency",
            type: "bar",
            color: "#1570ef",
          },
          {
            id: "noi_margin_pct",
            label: "Net Operating Income margin",
            unit: "percent",
            type: "line",
            secondaryAxis: true,
            color: "#12b76a",
          },
        ]}
      />

      {/* -------------------------------------------------------- liquidity */}
      <Block title="Cash position">
        <div className="grid grid-cols-1 gap-px bg-line-soft sm:grid-cols-2">
          <div className="bg-surface px-5 py-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-faint">
              Total cash in bank accounts
            </p>
            <Tip
              content={
                account("bs.cash")?.value === null
                  ? "Upload a Balance Sheet to populate this."
                  : `From ${account("bs.cash")?.sourceFilename ?? "an imported file"}`
              }
            >
              <p
                className={`num mt-1 text-[21px] font-semibold tracking-tight ${
                  account("bs.cash")?.value === null ? "text-flag" : "text-ink"
                }`}
              >
                {account("bs.cash")?.value === null
                  ? "Missing"
                  : money(account("bs.cash")?.value ?? null)}
              </p>
            </Tip>
          </div>
          <MetricCard id="days_cash_on_hand" />
        </div>
      </Block>

      {/* Gross profit against overhead: the second trend the prototype carried, and the
          one the twelve months of P&L data actually supports. */}
      <ChartBlock
        title="Gross profit and overhead"
        subtitle="What is earned against what it costs to run"
        points={points}
        series={[
          {
            id: "gross_profit",
            label: "Gross profit",
            unit: "currency",
            type: "bar",
            color: "#12b76a",
          },
          {
            id: "pl.overhead",
            label: "Overhead",
            unit: "currency",
            type: "bar",
            color: "#f79009",
          },
          {
            id: "gross_margin_pct",
            label: "Gross margin",
            unit: "percent",
            type: "line",
            secondaryAxis: true,
            color: "#1570ef",
          },
        ]}
      />

      {/* ------------------------------------------------ A/R & A/P timing */}
      <Block
        title="A/R & A/P timing"
        subtitle="How long money takes to arrive, and how long you take to pay"
      >
        <div className="grid grid-cols-1 gap-px bg-line-soft sm:grid-cols-2">
          <MetricCard id="dso" />
          <MetricCard id="dpo" />
        </div>
      </Block>

      {/* -------------------------------------------------- Phase 2 sections */}
      <ServiceLinesBlock rows={detail["pl_income"] ?? []} />

      <TopExpensesBlock rows={detail["pl_expense"] ?? []} />

      <AgingBlock
        title="Who owes you money"
        subtitle="Outstanding customer balances by ageing bucket"
        rows={detail["ar_customer"] ?? []}
        reportName="A/R Ageing Summary"
        entityNoun="Customer"
      />

      <AgingBlock
        title="What you owe"
        subtitle="Outstanding vendor balances by ageing bucket"
        rows={detail["ap_vendor"] ?? []}
        reportName="A/P Ageing Summary"
        entityNoun="Vendor"
      />

      <div className="print-break-before">
        <TopJobsBlock rows={detail["customer_sales"] ?? []} />
      </div>

      <TopCustomersBlock rows={detail["customer_sales"] ?? []} />

      {/*
        Job performance is derived from the Sales by Customer export, which covers the
        last twelve months — not the reporting month. Labelling these "this month" would
        put a twelve-month job count next to a one-month revenue figure and invite the
        reader to divide one by the other.
      */}
      <Block
        title="Job performance"
        subtitle="From the Sales by Customer export — last 12 months"
      >
        <div className="grid grid-cols-1 gap-px bg-line-soft sm:grid-cols-4">
          {(() => {
            const jobs = account("ops.job_count")?.value ?? null;
            const customers = account("ops.customer_count")?.value ?? null;
            const salesRows = detail["customer_sales"] ?? [];
            const salesTotal =
              salesRows.length > 0
                ? salesRows.reduce((sum, row) => sum + row.value, 0)
                : null;

            const cards: {
              label: string;
              value: string;
              tip: string;
              missing: boolean;
            }[] = [
              {
                label: "Jobs (12 mo)",
                value: jobs === null ? "—" : byUnit(jobs, "count"),
                tip:
                  jobs === null
                    ? "The Sales by Customer export carried no job or transaction count column, so this was not inferred. Enter it in Raw data if you track it elsewhere."
                    : "Summed from the export's own transaction count column",
                missing: jobs === null,
              },
              {
                label: "Customers billed (12 mo)",
                value: customers === null ? "—" : byUnit(customers, "count"),
                tip: "Distinct customers appearing in the Sales by Customer export",
                missing: customers === null,
              },
              {
                label: "Avg revenue / customer",
                value:
                  salesTotal !== null && customers !== null && customers > 0
                    ? money(salesTotal / customers)
                    : "—",
                tip: "Twelve-month revenue divided by customers billed over the same twelve months",
                missing: salesTotal === null || customers === null,
              },
              {
                label: "Avg revenue / job",
                value:
                  salesTotal !== null && jobs !== null && jobs > 0
                    ? money(salesTotal / jobs)
                    : "—",
                tip:
                  jobs === null
                    ? "Needs a job count, which this export did not provide"
                    : "Twelve-month revenue divided by jobs over the same twelve months",
                missing: salesTotal === null || jobs === null,
              },
            ];

            return cards.map((card) => (
              <div key={card.label} className="bg-surface px-5 py-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-faint">
                  {card.label}
                </p>
                <Tip content={card.tip}>
                  <p
                    className={`num mt-1 text-[21px] font-semibold tracking-tight ${
                      card.missing ? "text-ink-faint" : "text-ink"
                    }`}
                  >
                    {card.value}
                  </p>
                </Tip>
              </div>
            ));
          })()}
        </div>
      </Block>

      <ReferralBlock rows={detail["referral_partner"] ?? []} />

      {/* ------------------------------------------------- Flags to review */}
      <Block
        title="Flags to review"
        subtitle="Measured against the benchmark bands set on each formula"
      >
        {flags.length === 0 && report.missingRequired.length === 0 ? (
          <p className="px-5 py-6 text-[12.5px] text-ink-muted">
            Nothing outside its benchmark this period.
          </p>
        ) : (
          <div className="divide-y divide-line-soft">
            {report.missingRequired.length > 0 ? (
              <div className="flex items-start gap-3 px-5 py-3">
                <AlertTriangle size={14} className="mt-0.5 shrink-0 text-flag" />
                <div className="min-w-0">
                  <p className="text-[12.5px] font-medium text-ink">Missing inputs</p>
                  <p className="mt-0.5 text-[11.5px] text-ink-muted">
                    {report.accounts
                      .filter((a) => a.requiredButMissing)
                      .map((a) => a.label)
                      .join(", ")}{" "}
                    — metrics depending on these are shown as unavailable rather than
                    estimated.
                  </p>
                </div>
              </div>
            ) : null}
            {flags.map((flag) => (
              <div key={flag.label} className="flex items-start gap-3 px-5 py-3">
                <AlertTriangle
                  size={14}
                  className={`mt-0.5 shrink-0 ${
                    flag.tone === "flag" ? "text-flag" : "text-warn"
                  }`}
                />
                <div className="min-w-0">
                  <p className="text-[12.5px] font-medium text-ink">{flag.label}</p>
                  <p className="mt-0.5 text-[11.5px] text-ink-muted">{flag.detail}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Block>
    </div>
  );
}
