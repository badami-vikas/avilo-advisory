import { useState } from "react";
import { AlertTriangle } from "lucide-react";

import { Block } from "./ui.js";
import { Tip } from "./Tooltip.js";
import { InlineEditor } from "./DataTable.js";
import { ChartBlock, type ChartPoint } from "./ChartBlock.js";
import {
  AgingBlock,
  ReferralBlock,
  TopCustomersBlock,
  TopExpensesBlock,
} from "./DetailSections.js";
import { byUnit, money } from "../../lib/format.js";
import type { DetailByKind, PeriodReport, SeriesPoint } from "../types.js";

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
  rangeLabel,
  onSetMetricValue,
}: {
  clientName: string;
  report: PeriodReport;
  series: SeriesPoint[];
  detail: DetailByKind;
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
    const unit = id.endsWith("_pct") ? "percent" : id === "days_cash_on_hand" ? "days" : "currency";

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

      {/* -------------------------------------------------- Phase 2 sections */}
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
        <TopCustomersBlock rows={detail["customer_sales"] ?? []} />
      </div>

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
    </div>
  );
}
