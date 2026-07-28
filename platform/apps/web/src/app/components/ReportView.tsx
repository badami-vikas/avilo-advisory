import { AlertTriangle } from "lucide-react";
import { formatPeriod } from "@avilo/module";

import { Block } from "./ui.js";
import { ChartBlock, type ChartPoint } from "./ChartBlock.js";
import { byUnit, money, percent } from "../../lib/format.js";
import type { PeriodReport, SeriesPoint } from "../types.js";

/**
 * The Report view: the rendered dashboard, composed of separated visual blocks.
 *
 * Ports the v9 prototype's sections. Phase 1 covers what the P&L supports; the
 * remaining sections (A/R ageing, Who owes you, referral partners, job performance)
 * arrive with their importers in Phase 2 and are listed honestly below rather than
 * shown with invented figures.
 */
export function ReportView({
  clientName,
  report,
  series,
  onEditMetric,
}: {
  clientName: string;
  report: PeriodReport;
  series: SeriesPoint[];
  onEditMetric: (metricId: string) => void;
}) {
  const metric = (id: string) => report.metrics.find((m) => m.id === id);

  const points: ChartPoint[] = series.map((point) => ({
    label: point.periodLabel,
    values: point.values,
  }));

  return (
    <div className="space-y-4">
      {/* Print-only header: the exported PDF must identify itself. */}
      <div className="print-only mb-4">
        <h1 className="text-[18px] font-semibold tracking-tight text-ink">
          {clientName}
        </h1>
        <p className="text-[12px] text-ink-muted">
          Monthly business snapshot · {report.periodLabel} · Avilo Advisory
        </p>
      </div>

      {report.missingRequired.length > 0 ? (
        <div className="flex items-start gap-2 rounded-xl border border-flag/25 bg-flag-soft px-4 py-3">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-flag" />
          <div>
            <p className="text-[13px] font-medium text-flag">
              {report.missingRequired.length} required input
              {report.missingRequired.length === 1 ? "" : "s"} missing for{" "}
              {report.periodLabel}
            </p>
            <p className="mt-0.5 text-[12px] leading-relaxed text-flag/85">
              {report.accounts
                .filter((a) => a.requiredButMissing)
                .map((a) => a.label)
                .join(", ")}
              . Metrics that depend on {report.missingRequired.length === 1 ? "it" : "them"}{" "}
              are shown as unavailable rather than estimated.
            </p>
          </div>
        </div>
      ) : null}

      {/* ------------------------------------------------------- At a Glance */}
      <Block title="At a Glance" subtitle={`${clientName} · ${report.periodLabel}`}>
        <div className="grid grid-cols-1 gap-px bg-line-soft sm:grid-cols-3">
          {[
            {
              id: "pl.revenue",
              label: "Revenue",
              value: report.accounts.find((a) => a.accountId === "pl.revenue")?.value,
              unit: "currency",
            },
            {
              id: "net_operating_income",
              label: "Net Operating Income",
              value: metric("net_operating_income")?.value,
              unit: "currency",
            },
            {
              id: "bs.cash",
              label: "Total cash in bank accounts",
              value: report.accounts.find((a) => a.accountId === "bs.cash")?.value,
              unit: "currency",
            },
          ].map((item) => (
            <div key={item.id} className="bg-surface px-5 py-4">
              <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-faint">
                {item.label}
              </p>
              <p
                className={`num mt-1 text-[24px] font-semibold tracking-tight ${
                  item.value === null || item.value === undefined
                    ? "text-flag"
                    : "text-ink"
                }`}
              >
                {item.value === null || item.value === undefined
                  ? "Missing"
                  : byUnit(item.value, item.unit)}
              </p>
            </div>
          ))}
        </div>
      </Block>

      {/* -------------------------------------------- Did you make money? */}
      <Block
        title="Did you make money this month?"
        subtitle="Double-click any figure to override it or edit its formula"
      >
        <div className="grid grid-cols-1 gap-px bg-line-soft sm:grid-cols-2 lg:grid-cols-4">
          {["gross_profit", "gross_margin_pct", "net_operating_income", "noi_margin_pct"].map(
            (id) => {
              const m = metric(id);
              if (!m) return null;
              const unavailable = m.status !== "ok";
              return (
                <button
                  key={id}
                  onDoubleClick={() => onEditMetric(id)}
                  title="Double-click to edit"
                  className="bg-surface px-5 py-4 text-left transition-colors hover:bg-canvas"
                >
                  <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-faint">
                    {m.label}
                  </p>
                  <p
                    className={`num mt-1 text-[21px] font-semibold tracking-tight ${
                      unavailable ? "text-flag" : "text-ink"
                    }`}
                  >
                    {unavailable ? "Unavailable" : byUnit(m.value, formulaUnit(id))}
                  </p>
                  {unavailable ? (
                    <p className="mt-1 flex items-start gap-1 text-[11px] leading-snug text-flag">
                      <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                      {m.status === "missing_inputs"
                        ? `Needs ${m.missing.join(", ")}`
                        : m.error}
                    </p>
                  ) : null}
                </button>
              );
            },
          )}
        </div>
      </Block>

      {/* -------------------------------------------------------- trend */}
      <ChartBlock
        title="Revenue & Net Operating Income margin"
        subtitle="Every period imported for this client"
        points={points}
        series={[
          {
            id: "pl.revenue",
            label: "Revenue",
            unit: "currency",
            type: "bar",
            color: "#b2ddff",
          },
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
          {["bs.cash"].map((accountId) => {
            const account = report.accounts.find((a) => a.accountId === accountId);
            if (!account) return null;
            return (
              <div key={accountId} className="bg-surface px-5 py-4">
                <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-faint">
                  {account.label}
                </p>
                <p
                  className={`num mt-1 text-[21px] font-semibold tracking-tight ${
                    account.value === null ? "text-flag" : "text-ink"
                  }`}
                >
                  {account.value === null ? "Missing" : money(account.value)}
                </p>
                {account.value === null ? (
                  <p className="mt-1 text-[11px] leading-snug text-flag">
                    Upload a Balance Sheet to populate this.
                  </p>
                ) : null}
              </div>
            );
          })}
          {(() => {
            const m = metric("days_cash_on_hand");
            if (!m) return null;
            return (
              <button
                onDoubleClick={() => onEditMetric(m.id)}
                title="Double-click to edit"
                className="bg-surface px-5 py-4 text-left transition-colors hover:bg-canvas"
              >
                <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-ink-faint">
                  {m.label}
                </p>
                <p
                  className={`num mt-1 text-[21px] font-semibold tracking-tight ${
                    m.status !== "ok" ? "text-flag" : "text-ink"
                  }`}
                >
                  {m.status === "ok" ? `${Math.round(m.value ?? 0)}` : "Unavailable"}
                </p>
                {m.status !== "ok" ? (
                  <p className="mt-1 flex items-start gap-1 text-[11px] leading-snug text-flag">
                    <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                    {m.status === "missing_inputs"
                      ? `Needs ${m.missing.join(", ")}`
                      : m.error}
                  </p>
                ) : null}
              </button>
            );
          })()}
        </div>
      </Block>

      {/* ------------------------------------------------- honest scope note */}
      <Block title="Not in this build yet">
        <div className="px-5 py-4">
          <p className="text-[12.5px] leading-relaxed text-ink-muted">
            Top expenses, A/R ageing and "who owes you", "what you owe", service lines,
            job performance and referral partners are Phase 2 sections. They arrive with
            their importers. They are listed here rather than shown with placeholder
            figures.
          </p>
        </div>
      </Block>
    </div>
  );
}

function formulaUnit(id: string): string {
  return id.endsWith("_pct") ? "percent" : "currency";
}

export { percent };
