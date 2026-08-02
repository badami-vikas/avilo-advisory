/**
 * The analytical sections of the dashboard.
 *
 * Each one answers a single question and says what it found. The house rule throughout:
 * a chart is never left to speak for itself — every section ends in a sentence naming
 * what the picture shows, derived from the same numbers that drew it.
 */

import { useMemo, useState } from "react";
import { ArrowRight, ChevronRight } from "lucide-react";

import { moneyFull, percent } from "../../lib/format.js";
import { Tip } from "../components/Tooltip.js";
import type { DetailByKind, DetailRow, PeriodReport, SeriesPoint } from "../types.js";
import {
  AGING_BUCKETS,
  agingDistribution,
  collectionPriority,
  concentration,
  forecast,
  money,
  movement,
  movements,
  trailingMean,
  trendPct,
  type Action,
  type ForecastAssumptions,
  type HealthScore,
  type Warning,
} from "./insights.js";
import {
  BubbleMatrix,
  Donut,
  Gauge,
  GroupedBars,
  Pareto,
  TrendLine,
  Waterfall,
} from "./charts.js";
import { Finding, NeedsData, Panel, SeverityChip } from "./parts.js";

/* -------------------------------------------------------- series explorer */

/**
 * Every series the trend chart can draw, and what a breakdown of it looks like.
 *
 * `breakdown` names the detail rows that decompose the series for the selected month.
 * Not every series has one — operating income is an arithmetic result rather than a sum
 * of lines — and the section says so rather than showing an empty strip.
 */
const SERIES = [
  { id: "pl.revenue", label: "Revenue", color: "#1570ef", breakdown: "pl_income" },
  { id: "pl.cogs", label: "Cost of sales", color: "#f79009", breakdown: null },
  { id: "pl.overhead", label: "Overhead", color: "#e8734a", breakdown: "pl_expense" },
  { id: "gross_profit", label: "Gross profit", color: "#12b76a", breakdown: null },
  { id: "net_operating_income", label: "Operating income", color: "#7a5af8", breakdown: null },
] as const;

type SeriesId = (typeof SERIES)[number]["id"];

export function GrowthSection({
  series,
  detail,
  priorDetail,
  periodLabel,
}: {
  series: SeriesPoint[];
  detail: DetailByKind;
  priorDetail: DetailByKind;
  periodLabel: string;
}) {
  /**
   * Which series are picked out. Empty is the resting state, not a filter that has
   * removed everything — the chart shows all of them, as a trend.
   */
  const [selected, setSelected] = useState<SeriesId[]>([]);
  const labels = series.map((point) => point.periodLabel);
  const revenue = movement(series, "pl.revenue");
  const slope = trendPct(series, "pl.revenue", 6);

  const toggle = (id: SeriesId) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );

  const chosen = SERIES.filter((entry) => selected.includes(entry.id));

  /*
    The composition of a single selected series for the month on screen, with each line's
    movement against last month. This is what replaced the standalone revenue waterfall:
    the same decomposition, reached by selecting the series it decomposes rather than
    printed unconditionally further down the page.
  */
  const composition = (() => {
    if (chosen.length !== 1) return null;
    const entry = chosen[0]!;
    if (!entry.breakdown) {
      return { entry, rows: [], unavailable: `${entry.label} is a computed result, not a sum of lines — there is nothing to break down.` };
    }
    const rows = (detail[entry.breakdown] ?? []).filter((row) => Math.abs(row.value) > 0);
    if (rows.length === 0) {
      return { entry, rows: [], unavailable: `No line detail was imported for ${entry.label.toLowerCase()} this period.` };
    }
    const priorRows = new Map(
      (priorDetail[entry.breakdown] ?? []).map((row) => [row.label, row.value]),
    );
    const total = rows.reduce((sum, row) => sum + Math.abs(row.value), 0);
    return {
      entry,
      unavailable: null,
      rows: rows
        .map((row) => ({
          label: row.label.trim(),
          value: Math.abs(row.value),
          share: (Math.abs(row.value) / total) * 100,
          change: Math.abs(row.value) - Math.abs(priorRows.get(row.label) ?? 0),
          isNew: !priorRows.has(row.label),
        }))
        .sort((a, b) => b.value - a.value),
    };
  })();

  return (
    <Panel
      id="growth"
      title="Growth and its quality"
      subtitle="Click a measure to isolate it. Pick more than one to compare them month by month."
      summary={
        revenue.direction === "unknown"
          ? "Only one month imported — no movement to describe yet."
          : `Revenue ${revenue.direction === "flat" ? "held level" : `moved ${money(revenue.change)}`} on the month${slope === null ? "" : `, ${Math.abs(slope) < 1 ? "flat" : slope > 0 ? "rising" : "falling"} over six`}.`
      }
    >
      {chosen.length === 0 ? (
        <TrendLine
          labels={labels}
          datasets={SERIES.filter((entry) =>
            ["pl.revenue", "net_operating_income"].includes(entry.id),
          ).map((entry) => ({
            label: entry.label,
            values: series.map((p) => p.values[entry.id] ?? null),
            color: entry.color,
            fill: entry.id === "pl.revenue",
          }))}
        />
      ) : (
        <GroupedBars
          labels={labels}
          datasets={chosen.map((entry) => ({
            label: entry.label,
            values: series.map((p) => p.values[entry.id] ?? null),
            color: entry.color,
          }))}
        />
      )}

      {/*
        The selector, below the chart where a legend would be — because it *is* the
        legend, with the click doing something. Selecting is highlighting rather than
        filtering: an unselected measure is dimmed, never hidden from the list.
      */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {SERIES.map((entry) => {
          const on = selected.includes(entry.id);
          const present = series.some((p) => p.values[entry.id] !== null);
          return (
            <Tip
              key={entry.id}
              content={
                present
                  ? on
                    ? `Showing ${entry.label} as bars. Click to put it back in the trend.`
                    : `Isolate ${entry.label}${entry.breakdown ? " and see what it is made of" : ""}.`
                  : `${entry.label} has not been imported for any month yet.`
              }
            >
              <button
                onClick={() => present && toggle(entry.id)}
                disabled={!present}
                aria-pressed={on}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[12px] font-medium transition-all disabled:opacity-40 ${
                  on
                    ? "border-transparent text-white shadow-[0_1px_2px_rgba(16,24,40,0.12)]"
                    : "border-line bg-surface text-ink-muted hover:border-ink-faint hover:text-ink"
                }`}
                style={on ? { background: entry.color } : undefined}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: on ? "#fff" : entry.color }}
                />
                {entry.label}
              </button>
            </Tip>
          );
        })}
        {selected.length > 0 ? (
          <button
            onClick={() => setSelected([])}
            className="ml-1 text-[11.5px] text-ink-faint underline-offset-2 hover:text-ink hover:underline"
          >
            Back to the trend
          </button>
        ) : null}
      </div>

      {composition ? (
        <div className="mt-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-faint">
            {composition.entry.label} — what it is made of, {periodLabel}
          </p>
          {composition.unavailable ? (
            <p className="text-[12px] text-ink-faint">{composition.unavailable}</p>
          ) : (
            <Composition rows={composition.rows} color={composition.entry.color} />
          )}
        </div>
      ) : null}

      <Finding>
        {revenue.direction === "unknown" ? (
          <>Only one month of revenue has been imported, so there is no movement to explain yet.</>
        ) : (
          <>
            Revenue {revenue.direction === "flat" ? "was effectively level" : `moved ${money(revenue.change)}`}
            {revenue.changePct !== null ? ` (${revenue.changePct.toFixed(1)}%)` : ""} on the
            month.{" "}
            {slope === null
              ? "Six months of history are needed before a trend can be called."
              : `Over six months the line is ${
                  Math.abs(slope) < 1
                    ? "flat"
                    : `${slope > 0 ? "rising" : "falling"} about ${Math.abs(slope).toFixed(1)}% a month`
                }.`}
          </>
        )}
      </Finding>
    </Panel>
  );
}

/**
 * A single stacked bar of the lines that make up a measure, with the detail on hover.
 *
 * One bar rather than a table because the question is proportion — which line *is* this
 * month — and a table of five numbers makes the reader do the division. The hover carries
 * the arithmetic the bar cannot: the amount, the share, and what it did since last month.
 */
function Composition({
  rows,
  color,
}: {
  rows: { label: string; value: number; share: number; change: number; isNew: boolean }[];
  color: string;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const active = rows.find((row) => row.label === hover) ?? null;

  return (
    <div>
      <div className="flex h-7 w-full overflow-hidden rounded-lg border border-line">
        {rows.map((row, index) => (
          <button
            key={row.label}
            onMouseEnter={() => setHover(row.label)}
            onMouseLeave={() => setHover(null)}
            aria-label={`${row.label}: ${moneyFull(row.value)}`}
            className="h-full border-r border-white/70 transition-opacity last:border-r-0"
            style={{
              width: `${row.share}%`,
              background: color,
              // Successive segments step down in weight so adjacent lines stay
              // distinguishable without five arbitrary colours.
              opacity: hover === null ? 1 - index * 0.13 : hover === row.label ? 1 : 0.25,
            }}
          />
        ))}
      </div>

      <div className="mt-2 min-h-[34px]">
        {active ? (
          <p className="text-[12.5px] text-ink">
            <span className="font-medium">{active.label}</span> — {moneyFull(active.value)},{" "}
            {active.share.toFixed(1)}% of the total.{" "}
            {active.isNew ? (
              <span className="text-positive">New this month.</span>
            ) : Math.abs(active.change) < 1 ? (
              <span className="text-ink-muted">Unchanged on last month.</span>
            ) : (
              <span className={active.change > 0 ? "text-positive" : "text-flag"}>
                {active.change > 0 ? "Up" : "Down"} {moneyFull(Math.abs(active.change))} on
                last month.
              </span>
            )}
          </p>
        ) : (
          <p className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-ink-faint">
            {rows.slice(0, 6).map((row) => (
              <span key={row.label}>
                {row.label} {row.share.toFixed(0)}%
              </span>
            ))}
            <span className="italic">Hover a segment for the detail.</span>
          </p>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- profitability */

export function ProfitabilitySection({
  report,
  series,
  detail,
}: {
  report: PeriodReport;
  series: SeriesPoint[];
  detail: DetailByKind;
}) {
  const labels = series.map((point) => point.periodLabel);
  const account = (id: string) =>
    report.accounts.find((a) => a.accountId === id)?.value ?? null;

  const revenue = account("pl.revenue");
  const cogs = account("pl.cogs");
  const overhead = account("pl.overhead");

  const expenses = (detail["pl_expense"] ?? [])
    .filter((row) => Math.abs(row.value) > 0)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, 8);
  const expenseTotal = expenses.reduce((sum, row) => sum + Math.abs(row.value), 0);

  const grossTrend = trendPct(series, "gross_margin_pct", 6);

  return (
    <Panel
      id="profitability"
      title="Profitability"
      subtitle="What is kept from what is billed"
      summary={
        grossTrend === null
          ? "Six months of history are needed before a direction can be called."
          : Math.abs(grossTrend) < 1
            ? "Gross margin has held steady over six months."
            : `Gross margin is ${grossTrend > 0 ? "improving" : "eroding"} about ${Math.abs(grossTrend).toFixed(1)}% a month.`
      }
    >
      <TrendLine
        labels={labels}
        currency={false}
        datasets={[
          {
            label: "Gross margin",
            values: series.map((p) => p.values["gross_margin_pct"] ?? null),
            color: "#12b76a",
          },
          {
            label: "Operating margin",
            values: series.map((p) => p.values["noi_margin_pct"] ?? null),
            color: "#1570ef",
          },
        ]}
      />

      {revenue !== null ? (
        <div className="mt-5">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-faint">
            From revenue to operating income
          </p>
          <Waterfall
            opening={revenue}
            openingLabel="Revenue"
            steps={[
              ...(cogs !== null ? [{ label: "Cost of sales", change: -cogs }] : []),
              ...(overhead !== null ? [{ label: "Overhead", change: -overhead }] : []),
            ]}
            closingLabel="Operating income"
          />
        </div>
      ) : null}

      {expenses.length > 0 ? (
        <div className="mt-5">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-faint">
            Where the cost sits this month
          </p>
          <div className="divide-y divide-line-soft">
            {expenses.map((row) => {
              const share = expenseTotal === 0 ? 0 : (Math.abs(row.value) / expenseTotal) * 100;
              const ofRevenue =
                revenue && revenue !== 0 ? (Math.abs(row.value) / revenue) * 100 : null;
              return (
                <div key={row.id} className="flex items-center gap-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
                    {row.label.trim()}
                  </span>
                  <Tip
                    content={
                      ofRevenue === null
                        ? `${share.toFixed(1)}% of this month's listed costs`
                        : `${share.toFixed(1)}% of listed costs, ${ofRevenue.toFixed(1)}% of revenue`
                    }
                  >
                    <span className="h-1.5 w-28 shrink-0 overflow-hidden rounded-full bg-line-soft">
                      <span
                        className="block h-full rounded-full bg-accent"
                        style={{ width: `${share}%` }}
                      />
                    </span>
                  </Tip>
                  <span className="num w-14 shrink-0 text-right text-[11.5px] text-ink-faint">
                    {ofRevenue === null ? "—" : `${ofRevenue.toFixed(1)}%`}
                  </span>
                  <span className="num w-28 shrink-0 text-right text-[12.5px] font-medium text-ink">
                    {moneyFull(Math.abs(row.value))}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="mt-1.5 text-[11px] text-ink-faint">
            The right-hand column is each line as a share of this month's revenue.
          </p>
        </div>
      ) : null}

      <Finding>
        {grossTrend === null ? (
          <>Six months of margin history are needed before a direction can be called.</>
        ) : Math.abs(grossTrend) < 1 ? (
          <>Gross margin has held steady over the last six months.</>
        ) : (
          <>
            Gross margin has been {grossTrend > 0 ? "improving" : "eroding"} at roughly{" "}
            {Math.abs(grossTrend).toFixed(1)}% a month over six months.
            {grossTrend < 0 && expenses[0]
              ? ` The largest cost line this period is ${expenses[0].label.trim()}.`
              : ""}
          </>
        )}
      </Finding>
    </Panel>
  );
}

/* ------------------------------------------------------------------ cash */

export function CashSection({
  report,
  series,
}: {
  report: PeriodReport;
  series: SeriesPoint[];
}) {
  const labels = series.map((point) => point.periodLabel);
  const metric = (id: string) => {
    const m = report.metrics.find((x) => x.id === id);
    return m && m.status === "ok" ? m.value : null;
  };

  const noi = metric("net_operating_income");
  const ar = movement(series, "ar.total");
  const ap = movement(series, "ap.total");

  /*
    Profit is not cash, and the gap between them is where a profitable business runs out
    of money. Receivables rising consumes cash; payables rising supplies it. Both changes
    are needed for the bridge to reconcile, so it is only drawn when both are known.
  */
  const canBridge = noi !== null && ar.change !== null && ap.change !== null;
  const conversion =
    canBridge && noi !== 0
      ? ((noi - (ar.change ?? 0) + (ap.change ?? 0)) / noi) * 100
      : null;

  const dso = metric("dso");
  const dpo = metric("dpo");

  return (
    <Panel
      id="cash"
      title="Profit into cash"
      subtitle="What the month earned against what it banked"
      summary={
        conversion === null
          ? "Needs a second month of ageing data before profit can be traced into cash."
          : `${Math.round(conversion)}% of operating income became cash this month.`
      }
    >
      {canBridge ? (
        <Waterfall
          opening={noi}
          openingLabel="Operating income"
          steps={[
            { label: "Change in receivables", change: -(ar.change ?? 0) },
            { label: "Change in payables", change: ap.change ?? 0 },
          ]}
          closingLabel="Cash generated"
        />
      ) : (
        <NeedsData
          what="The profit-to-cash bridge needs two months of ageing data"
          upload="A/R and A/P Ageing Summaries for this month and last"
        />
      )}

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-faint">
            Working capital
          </p>
          <TrendLine
            labels={labels}
            height={200}
            datasets={[
              {
                label: "Owed to you",
                values: series.map((p) => p.values["ar.total"] ?? null),
                color: "#1570ef",
              },
              {
                label: "Owed by you",
                values: series.map((p) => p.values["ap.total"] ?? null),
                color: "#f79009",
              },
              {
                label: "Cash",
                values: series.map((p) => p.values["bs.cash"] ?? null),
                color: "#12b76a",
                dashed: true,
              },
            ]}
          />
        </div>
        <div>
          {conversion === null ? (
            <p className="px-2 py-8 text-center text-[12px] text-ink-faint">
              Cash conversion needs a prior month of ageing data.
            </p>
          ) : (
            <Gauge
              value={Math.max(0, Math.min(150, conversion))}
              max={150}
              label="Cash conversion"
              display={`${Math.round(conversion)}%`}
              tone={conversion >= 80 ? "#12b76a" : conversion >= 50 ? "#f79009" : "#d92d20"}
              height={170}
            />
          )}
          <p className="mt-1 px-2 text-center text-[11px] leading-relaxed text-ink-faint">
            Share of this month's operating income that actually became cash, after the
            movement in what is owed both ways.
          </p>
        </div>
      </div>

      <Finding>
        {dso !== null && dpo !== null ? (
          <>
            Collecting in {Math.round(dso)} days and paying in {Math.round(dpo)} — a{" "}
            {Math.abs(Math.round(dso - dpo))}-day{" "}
            {dso > dpo ? "gap the business funds itself" : "cushion in the business's favour"}.
            {conversion !== null
              ? ` ${Math.round(conversion)}% of operating income converted to cash this month.`
              : ""}
          </>
        ) : (
          <>
            Collection and payment timing need both ageing reports before the cash cycle can
            be measured.
          </>
        )}
      </Finding>
    </Panel>
  );
}

/* ------------------------------------------------------------- customers */

export function CustomersSection({
  detail,
  onOpenCustomer,
}: {
  detail: DetailByKind;
  onOpenCustomer: (label: string) => void;
}) {
  const sales = detail["customer_sales"] ?? [];
  const receivable = detail["ar_customer"] ?? [];
  const conc = useMemo(() => concentration(sales), [sales]);

  if (conc.rows.length === 0) {
    return (
      <Panel id="customers" title="Customer economics" subtitle="Who the business runs on">
        <NeedsData what="No customer revenue imported" upload="a Sales by Customer export" />
      </Panel>
    );
  }

  const top = conc.rows.slice(0, 10);
  const owedBy = new Map(receivable.map((row) => [row.label, row]));

  /*
    Revenue against exposure. A customer far to the right is a large part of the business;
    a customer high up is slow to pay. The one in the top-right corner is the risk nobody
    names out loud, and it is exactly the point this chart puts on the page.
  */
  const points = top.slice(0, 8).map((row) => {
    const owed = owedBy.get(row.label);
    const exposure = owed ? (owed.value / row.value) * 100 : 0;
    return {
      label: row.label,
      x: row.share,
      y: Math.min(120, exposure),
      r: Math.max(6, Math.min(24, Math.sqrt(row.value) / 12)),
      color: exposure > 25 && row.share > 15 ? "#d92d20" : exposure > 25 ? "#f79009" : "#1570ef",
    };
  });

  return (
    <Panel
      id="customers"
      title="Customer economics"
      subtitle="Who the business runs on, and how exposed that makes it"
      summary={`${conc.rows[0]?.label} is ${conc.topShare?.toFixed(0)}% of revenue; ${conc.customersTo80} customer${conc.customersTo80 === 1 ? "" : "s"} make up 80%.`}
      badge={
        conc.topShare !== null && conc.topShare > 30 ? (
          <SeverityChip severity={conc.topShare > 50 ? "critical" : "watch"} />
        ) : null
      }
    >
      <Pareto
        labels={top.map((row) => row.label)}
        values={top.map((row) => row.value)}
        cumulative={top.map((row) => row.cumulative)}
      />

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-faint">
            Share of revenue against outstanding balance
          </p>
          <BubbleMatrix
            points={points}
            xLabel="Share of revenue"
            yLabel="Owed as % of billings"
            xIsPercent
          />
        </div>

        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-faint">
            Portfolio
          </p>
          <div className="divide-y divide-line-soft">
            {top.slice(0, 8).map((row) => {
              const owed = owedBy.get(row.label);
              return (
                <button
                  key={row.label}
                  onClick={() => onOpenCustomer(row.label)}
                  className="flex w-full items-center gap-3 py-2 text-left transition-colors hover:bg-line-soft/60"
                >
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
                    {row.label}
                  </span>
                  <span className="num w-12 shrink-0 text-right text-[11.5px] text-ink-faint">
                    {row.share.toFixed(1)}%
                  </span>
                  <span className="num w-24 shrink-0 text-right text-[12.5px] font-medium text-ink">
                    {moneyFull(row.value)}
                  </span>
                  <span
                    className={`num w-24 shrink-0 text-right text-[12px] ${
                      owed ? "text-warn" : "text-ink-faint"
                    }`}
                  >
                    {owed ? `${moneyFull(owed.value)} owed` : "nothing owed"}
                  </span>
                  <ChevronRight size={13} className="shrink-0 text-ink-faint" />
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <Finding>
        {conc.rows[0]?.label} is {conc.topShare?.toFixed(1)}% of the last twelve months, and{" "}
        {conc.customersTo80} customer{conc.customersTo80 === 1 ? "" : "s"} make up 80% of
        revenue.{" "}
        {conc.topShare !== null && conc.topShare > 30
          ? "That is concentrated enough that losing the largest account would be a structural event rather than a bad quarter."
          : "The book is spread widely enough that no single loss would be structural."}
      </Finding>
    </Panel>
  );
}

/* ------------------------------------------------------------- ageing */

export function AgingSection({
  id,
  title,
  subtitle,
  report,
  prefix,
  rows,
  entityNoun,
  reportName,
}: {
  id: string;
  title: string;
  subtitle: string;
  report: PeriodReport;
  prefix: "ar" | "ap";
  rows: DetailRow[];
  entityNoun: string;
  reportName: string;
}) {
  const distribution = agingDistribution(report, prefix);
  const priority = collectionPriority(rows);

  if (distribution.slices.length === 0 && priority.length === 0) {
    return (
      <Panel id={id} title={title} subtitle={subtitle}>
        <NeedsData what={`No ${entityNoun.toLowerCase()} balances imported`} upload={`an ${reportName}`} />
      </Panel>
    );
  }

  return (
    <Panel
      id={id}
      title={title}
      subtitle={subtitle}
      summary={
        distribution.overdueShare === null
          ? `${money(distribution.total)} outstanding.`
          : `${money(distribution.total)} outstanding, ${distribution.overdueShare.toFixed(0)}% of it more than thirty days ${prefix === "ar" ? "overdue" : "past due"}.`
      }
      badge={
        distribution.overdueShare !== null && distribution.overdueShare > 20 ? (
          <SeverityChip severity={distribution.overdueShare > 40 ? "critical" : "warning"} />
        ) : null
      }
    >
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div>
          {distribution.slices.length > 0 ? (
            <Donut
              slices={distribution.slices}
              centerLabel="Total"
              centerValue={money(distribution.total)}
            />
          ) : (
            <p className="px-2 py-10 text-center text-[12px] text-ink-faint">
              The ageing buckets were not imported for this period.
            </p>
          )}
        </div>

        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-faint">
            {prefix === "ar" ? "Chase in this order" : "Pay in this order"}
          </p>
          <div className="divide-y divide-line-soft">
            {priority.map((row) => {
              const bucket = AGING_BUCKETS.find((b) => b.id === row.bucket);
              return (
                <div key={row.label} className="flex items-center gap-3 py-2">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: bucket?.color ?? "#98a2b3" }}
                  />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
                    {row.label}
                  </span>
                  <Tip content={row.reason}>
                    <span className="shrink-0 text-[11px] text-ink-faint">
                      {bucket?.label ?? "outstanding"}
                    </span>
                  </Tip>
                  <span className="num w-28 shrink-0 text-right text-[12.5px] font-medium text-ink">
                    {moneyFull(row.value)}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="mt-1.5 text-[11px] text-ink-faint">
            Ordered by amount weighted by how late it is, not by size alone.
          </p>
        </div>
      </div>

      {distribution.overdueShare !== null ? (
        <Finding>
          {distribution.overdueShare.toFixed(0)}% of {money(distribution.total)} is more than
          thirty days {prefix === "ar" ? "overdue" : "past due"}.{" "}
          {distribution.overdueShare > 20
            ? prefix === "ar"
              ? "That is the part least likely to arrive without being asked for."
              : "Supplier goodwill is a credit line; this is how much of it is being drawn."
            : "The book is current enough not to need intervention."}
        </Finding>
      ) : null}
    </Panel>
  );
}

/* ------------------------------------------------------------ referrals */

export function ReferralsSection({ detail }: { detail: DetailByKind }) {
  const rows = (detail["referral_partner"] ?? []).filter((row) => row.value > 0);
  const [open, setOpen] = useState<string | null>(null);

  if (rows.length === 0) {
    return (
      <Panel id="referrals" title="Referral to cash" subtitle="Where the work comes from">
        <NeedsData what="No referral data imported" upload="a Referral report" />
      </Panel>
    );
  }

  const sorted = [...rows].sort((a, b) => b.value - a.value);
  const total = sorted.reduce((sum, row) => sum + row.value, 0);

  return (
    <Panel
      id="referrals"
      title="Referral to cash"
      subtitle="Where the work comes from — last ninety days"
      summary={`${sorted[0]?.label} is ${(((sorted[0]?.value ?? 0) / total) * 100).toFixed(0)}% of ${money(total)} referred across ${sorted.length} source${sorted.length === 1 ? "" : "s"}.`}
    >
      <div className="space-y-1.5">
        {sorted.map((row) => {
          const share = (row.value / total) * 100;
          const expanded = open === row.label;
          return (
            <div key={row.id} className="rounded-lg border border-line">
              <button
                onClick={() => setOpen(expanded ? null : row.label)}
                className="flex w-full items-center gap-3 px-3 py-2 text-left"
              >
                <ChevronRight
                  size={13}
                  className="shrink-0 text-ink-faint transition-transform"
                  style={{ transform: expanded ? "rotate(90deg)" : "none" }}
                />
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
                  {row.label}
                </span>
                {/*
                  A bar rather than a funnel. The data is one number per source — there is
                  no stage-by-stage drop-off to draw, and a funnel shape drawn from a single
                  measure would imply a pipeline the export does not describe.
                */}
                <span className="h-1.5 w-32 shrink-0 overflow-hidden rounded-full bg-line-soft">
                  <span
                    className="block h-full rounded-full bg-accent"
                    style={{ width: `${share}%` }}
                  />
                </span>
                <span className="num w-12 shrink-0 text-right text-[11.5px] text-ink-faint">
                  {share.toFixed(0)}%
                </span>
                <span className="num w-28 shrink-0 text-right text-[12.5px] font-medium text-ink">
                  {moneyFull(row.value)}
                </span>
              </button>
              {expanded ? (
                <div className="border-t border-line-soft bg-canvas px-3 py-2.5 text-[12px] text-ink-muted">
                  <p>
                    {row.label} produced {moneyFull(row.value)} of referred revenue over the
                    last ninety days — {share.toFixed(1)}% of everything referred, and{" "}
                    {sorted.indexOf(row) === 0
                      ? "the largest single source."
                      : `ranked ${sorted.indexOf(row) + 1} of ${sorted.length}.`}
                  </p>
                  {row.count !== null ? (
                    <p className="mt-1">
                      {row.count} referral{row.count === 1 ? "" : "s"}, averaging{" "}
                      {moneyFull(row.value / row.count)} each.
                    </p>
                  ) : (
                    <p className="mt-1 text-ink-faint">
                      The export carried no referral count, so an average per referral cannot
                      be shown.
                    </p>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <Finding>
        {sorted[0]?.label} is {(((sorted[0]?.value ?? 0) / total) * 100).toFixed(0)}% of{" "}
        {money(total)} referred in the last ninety days
        {sorted.length > 1 ? `, across ${sorted.length} sources` : " — the only source"}.
      </Finding>
    </Panel>
  );
}

/* ------------------------------------------------------------- forecast */

const STRESS_TESTS = [
  {
    id: "largest-customer",
    title: "Largest customer leaves",
    apply: (a: ForecastAssumptions, context: { topShare: number | null }) => ({
      ...a,
      revenueChangePct: a.revenueChangePct - (context.topShare ?? 20),
    }),
    describe: (context: { topShare: number | null }) =>
      `Revenue drops by their ${context.topShare === null ? "share" : `${context.topShare.toFixed(0)}%`} of the book.`,
  },
  {
    id: "collection-slips",
    title: "Collection slips a month",
    apply: (a: ForecastAssumptions) => ({ ...a, collectionDays: a.collectionDays + 30 }),
    describe: () => "Everything is paid thirty days later than it is now.",
  },
  {
    id: "costs-rise",
    title: "Costs rise 10%",
    apply: (a: ForecastAssumptions) => ({ ...a, costChangePct: a.costChangePct + 10 }),
    describe: () => "Operating spend rises a tenth with no change in revenue.",
  },
] as const;

export function ForecastSection({
  report,
  series,
  detail,
}: {
  report: PeriodReport;
  series: SeriesPoint[];
  detail: DetailByKind;
}) {
  const [assumptions, setAssumptions] = useState<ForecastAssumptions>({
    revenueChangePct: 0,
    costChangePct: 0,
    collectionDays: Math.round(
      report.metrics.find((m) => m.id === "dso" && m.status === "ok")?.value ?? 30,
    ),
  });

  const base = useMemo(() => forecast(report, series, assumptions), [report, series, assumptions]);
  const conc = useMemo(() => concentration(detail["customer_sales"] ?? []), [detail]);

  if (base.unavailable) {
    return (
      <Panel id="forecast" title="Thirteen weeks ahead" subtitle="Cash, projected">
        <NeedsData what={base.unavailable} upload="a Balance Sheet and Profit & Loss" />
      </Panel>
    );
  }

  return (
    <Panel
      id="forecast"
      title="Thirteen weeks ahead"
      subtitle="Cash on the current run rate, and what would break it"
      summary={
        base.breachWeek === null
          ? `Stays positive, with a low point of ${money(base.low)}.`
          : `Turns negative in week ${base.breachWeek}, bottoming at ${money(base.low)}.`
      }
      badge={base.breachWeek !== null ? <SeverityChip severity="critical" /> : null}
    >
      <TrendLine
        labels={base.weeks.map((week) => week.label)}
        datasets={[
          {
            label: "Projected cash",
            values: base.weeks.map((week) => week.cash),
            color: base.breachWeek === null ? "#1570ef" : "#d92d20",
            fill: true,
          },
        ]}
        height={220}
      />

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Slider
          label="Revenue"
          value={assumptions.revenueChangePct}
          min={-50}
          max={50}
          suffix="%"
          onChange={(revenueChangePct) =>
            setAssumptions((current) => ({ ...current, revenueChangePct }))
          }
        />
        <Slider
          label="Operating cost"
          value={assumptions.costChangePct}
          min={-30}
          max={50}
          suffix="%"
          onChange={(costChangePct) =>
            setAssumptions((current) => ({ ...current, costChangePct }))
          }
        />
        <Slider
          label="Collection"
          value={assumptions.collectionDays}
          min={7}
          max={120}
          suffix=" days"
          onChange={(collectionDays) =>
            setAssumptions((current) => ({ ...current, collectionDays }))
          }
        />
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
        The run rate is the mean of the last three months. Collection shifts revenue later
        in time without changing its size — every number in this chart can be rebuilt by
        hand, which is the point.
      </p>

      <div className="mt-5">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-faint">
          What would break it
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {STRESS_TESTS.map((test) => {
            const stressed = forecast(
              report,
              series,
              test.apply(assumptions, { topShare: conc.topShare }),
            );
            const survives = stressed.breachWeek === null;
            return (
              <div
                key={test.id}
                className={`rounded-xl border px-3.5 py-3 ${
                  survives ? "border-line bg-surface" : "border-flag/25 bg-flag-soft"
                }`}
              >
                <p className="text-[12.5px] font-medium text-ink">{test.title}</p>
                <p className="mt-1 text-[11.5px] leading-relaxed text-ink-muted">
                  {test.describe({ topShare: conc.topShare })}
                </p>
                <p
                  className={`num mt-2 text-[13px] font-semibold ${
                    survives ? "text-positive" : "text-flag"
                  }`}
                >
                  {survives
                    ? `Holds — low of ${money(stressed.low)}`
                    : `Runs out in week ${stressed.breachWeek}`}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      <Finding>
        {base.breachWeek === null ? (
          <>
            Cash ends the thirteen weeks at {money(base.weeks.at(-1)?.cash ?? 0)} with a low
            point of {money(base.low)}, starting from {money(base.startingCash)}.
          </>
        ) : (
          <>
            On these assumptions the balance turns negative in week {base.breachWeek} and
            bottoms at {money(base.low)}. The levers are above — collection is usually the
            fastest of the three to move.
          </>
        )}
      </Finding>
    </Panel>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between">
        <span className="text-[11.5px] font-medium text-ink-muted">{label}</span>
        <span className="num text-[12px] font-semibold text-ink">
          {value > 0 && suffix === "%" ? "+" : ""}
          {value}
          {suffix}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1.5 w-full accent-[#1570ef]"
      />
    </label>
  );
}

/* ------------------------------------------------------- warnings/actions */

export function WarningsSection({
  warnings,
  onGo,
}: {
  warnings: Warning[];
  onGo: (section: string) => void;
}) {
  return (
    <Panel
      id="warnings"
      title="Early warning centre"
      subtitle="Everything the data says is worth looking at, ranked"
      summary={
        warnings.length === 0
          ? "Nothing outside its benchmark, and no structural pattern present."
          : `${warnings.length} flagged — the most serious is ${warnings[0]!.title.toLowerCase()}.`
      }
      badge={
        warnings[0] ? <SeverityChip severity={warnings[0].severity} /> : null
      }
    >
      {warnings.length === 0 ? (
        <p className="py-4 text-[12.5px] text-ink-muted">
          Nothing is outside its benchmark, and no structural pattern — margin erosion,
          receivables outpacing sales, customer concentration — is present this period.
        </p>
      ) : (
        <div className="divide-y divide-line-soft">
          {warnings.map((warning) => (
            <button
              key={warning.id}
              onClick={() => onGo(warning.section)}
              className="flex w-full items-start gap-3 py-3 text-left transition-colors hover:bg-line-soft/50"
            >
              <span className="mt-0.5 shrink-0">
                <SeverityChip severity={warning.severity} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] font-medium text-ink">
                  {warning.title}
                </span>
                <span className="mt-0.5 block text-[11.5px] leading-relaxed text-ink-muted">
                  {warning.detail}
                </span>
              </span>
              <ArrowRight size={13} className="mt-1 shrink-0 text-ink-faint" />
            </button>
          ))}
        </div>
      )}
    </Panel>
  );
}

const EFFORT_LABEL: Record<Action["effort"], string> = {
  low: "Quick",
  medium: "Some work",
  high: "Structural",
};

export function ActionsSection({
  actions,
  onGo,
}: {
  actions: Action[];
  onGo: (section: string) => void;
}) {
  return (
    <Panel
      id="actions"
      title="Recommended actions"
      subtitle="Generated from this month's conditions, with the arithmetic behind each"
    >
      {actions.length === 0 ? (
        <p className="py-4 text-[12.5px] text-ink-muted">
          No condition in this month's data calls for an intervention.
        </p>
      ) : (
        <ol className="space-y-2.5">
          {actions.map((action, index) => (
            <li key={action.id}>
              <button
                onClick={() => onGo(action.section)}
                className="flex w-full items-start gap-3 rounded-xl border border-line px-4 py-3 text-left transition-all hover:border-ink-faint hover:shadow-[0_2px_8px_rgba(16,24,40,0.06)]"
              >
                <span className="num mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-ink text-[11px] font-semibold text-white">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-medium text-ink">{action.title}</span>
                    <span className="rounded-md border border-line bg-line-soft px-1.5 py-[2px] text-[10px] font-medium uppercase tracking-[0.05em] text-ink-muted">
                      {EFFORT_LABEL[action.effort]}
                    </span>
                  </span>
                  <span className="mt-1 block text-[12px] leading-relaxed text-ink-muted">
                    {action.why}
                  </span>
                  {action.impact ? (
                    <span className="mt-1 block text-[12px] font-medium text-positive">
                      {action.impact}
                    </span>
                  ) : null}
                </span>
                <ArrowRight size={13} className="mt-1 shrink-0 text-ink-faint" />
              </button>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

/** Trailing-mean helper re-exported for the shell's summary strip. */
export { trailingMean };
