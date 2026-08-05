/**
 * The analytical sections of the dashboard.
 *
 * Each one answers a single question and says what it found. The house rule throughout:
 * a chart is never left to speak for itself — every section ends in a sentence naming
 * what the picture shows, derived from the same numbers that drew it.
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowRight, ChevronRight } from "lucide-react";

import { api } from "../../lib/trpc.js";
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
  periodEnd,
  trendPct,
  type ForecastAssumptions,
  type HealthScore,
  type Warning,
} from "./insights.js";
import {
  BubbleMatrix,
  Donut,
  Gauge,
  GroupedBars,
  Legend,
  Pareto,
  tint,
  TrendLine,
  Waterfall,
} from "./charts.js";
import { Finding, NeedsData, Panel, SeverityChip } from "./parts.js";

/* -------------------------------------------------------- series explorer */

/**
 * The two measures the section plots, and what decomposes each of them.
 *
 * `breakdown` names the kind of detail row that adds up to the measure. `components`
 * covers the measures that are arithmetic rather than a sum of ledger lines.
 *
 * Operating income needed care here. Its inputs are revenue, cost of sales and overhead,
 * but those do not *stack* into it — revenue is not a part of profit, and a bar drawn
 * from all three would total something that is not a figure at all. What does stack is
 * the month's revenue split into where it went: cost of sales, overhead, and whatever
 * survived as operating income on top. Same three numbers, an arithmetic that holds.
 */
const SERIES = [
  {
    id: "pl.revenue",
    label: "Revenue",
    color: "#1570ef",
    breakdown: "pl_income",
    components: null,
    componentNote: null,
  },
  {
    id: "net_operating_income",
    label: "Operating income",
    color: "#7a5af8",
    breakdown: null,
    components: [
      { id: "pl.cogs", label: "Cost of sales" },
      { id: "pl.overhead", label: "Overhead" },
      { id: "net_operating_income", label: "Operating income" },
    ],
    componentNote:
      "Each bar is the month's revenue, split into what it cost to deliver, what it cost to run the business, and what was left as operating income on top. Hover a bar for the amounts and each part's share.",
  },
] as const;

type SeriesId = (typeof SERIES)[number]["id"];

/** At most this many named segments; the rest are summed into one. */
const MAX_SEGMENTS = 6;

/**
 * The colour of one segment.
 *
 * Line detail is ranked largest first, so the ramp runs dark to light and the biggest
 * line is the strongest. A computed measure is stacked with the measure itself on top,
 * so the ramp runs the other way and the figure the reader picked keeps full colour.
 */
function segmentColor(base: string, index: number, count: number, subjectLast: boolean) {
  const step = index / Math.max(1, count - 1);
  return tint(base, (subjectLast ? 1 - step : step) * 0.72);
}

export function GrowthSection({
  clientId,
  series,
  asAt,
}: {
  clientId: string;
  series: SeriesPoint[];
  /** The date every window on the page ends on. */
  asAt: string;
}) {
  /**
   * Which measures are picked out. Empty is the resting state, not a filter that has
   * removed everything — the chart shows both, as a trend.
   */
  const [selected, setSelected] = useState<SeriesId[]>([]);
  /** Line detail for every month, fetched only when a measure that has some is picked. */
  const [lines, setLines] = useState<Record<string, DetailRow[]> | null>(null);
  const [loadingLines, setLoadingLines] = useState(false);

  const labels = series.map((point) => point.periodLabel);
  const revenue = movement(series, "pl.revenue");
  const slope = trendPct(series, "pl.revenue", 6);

  const chosen = SERIES.filter((entry) => selected.includes(entry.id));
  const isolated = chosen.length === 1 ? chosen[0]! : null;
  const kind = isolated?.breakdown ?? null;

  /*
    The month-by-month line detail behind the isolated measure. Fetched here rather than
    handed down from the page: nothing else on the dashboard needs it, and a page that
    loaded every line of every month up front would pay for a chart most sessions never
    open.
  */
  useEffect(() => {
    if (!kind) {
      setLines(null);
      return;
    }
    let live = true;
    setLoadingLines(true);
    void api.report.detailSeries
      .query({ clientId, kind })
      .then((result) => {
        if (live) setLines(result);
      })
      .finally(() => {
        if (live) setLoadingLines(false);
      });
    return () => {
      live = false;
    };
  }, [clientId, kind]);

  const toggle = (id: SeriesId) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );

  /**
   * The isolated measure as its parts, one stacked dataset per part.
   *
   * Two sources, one shape. A measure with imported line detail is stacked from those
   * lines; a computed one is stacked from the totals it is computed from. Either way the
   * segments are drawn inside the bars themselves, so the composition is read off the
   * same shape as the level rather than off a second picture below it.
   */
  const segments = useMemo(() => {
    if (!isolated) return null;

    if (isolated.components) {
      const parts = isolated.components.map((component) => ({
        label: component.label,
        values: series.map((point) => {
          const value = point.values[component.id];
          if (value === null || value === undefined) return null;
          // The costs are magnitudes; the measure itself keeps its sign, so a month that
          // lost money stacks below the axis instead of being drawn as profit.
          return component.id === isolated.id ? value : Math.abs(value);
        }),
      }));
      return parts.some((part) => part.values.some((v) => v !== null))
        ? { parts, months: series.length, note: null }
        : { parts: [], months: 0, note: `The totals behind ${isolated.label.toLowerCase()} have not been imported.` };
    }

    if (!lines) return null;

    // Rank the lines by what they add up to across every month, so the same line keeps
    // the same colour from month to month and the small ones collapse together.
    const totals = new Map<string, number>();
    for (const rows of Object.values(lines)) {
      for (const row of rows) {
        const label = row.label.trim();
        totals.set(label, (totals.get(label) ?? 0) + Math.abs(row.value));
      }
    }
    const ranked = [...totals.entries()]
      .filter(([, total]) => total > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([label]) => label);

    const monthsWithDetail = series.filter(
      (point) => (lines[point.period] ?? []).length > 0,
    ).length;

    if (ranked.length === 0 || monthsWithDetail === 0) {
      return {
        parts: [],
        months: 0,
        note: `No line detail has been imported for ${isolated.label.toLowerCase()} in any month.`,
      };
    }

    const named = ranked.slice(0, MAX_SEGMENTS);
    const rest = ranked.slice(MAX_SEGMENTS);

    const sumFor = (period: string, want: string[]) => {
      const rows = lines[period] ?? [];
      // Null, not zero, where the month carries no detail: an unimported month is not a
      // month in which nothing was billed.
      if (rows.length === 0) return null;
      return rows
        .filter((row) => want.includes(row.label.trim()))
        .reduce((sum, row) => sum + Math.abs(row.value), 0);
    };

    const parts = named.map((label) => ({
      label,
      values: series.map((point) => sumFor(point.period, [label])),
    }));
    if (rest.length > 0) {
      parts.push({
        label: `${rest.length} smaller line${rest.length === 1 ? "" : "s"}`,
        values: series.map((point) => sumFor(point.period, rest)),
      });
    }

    return {
      parts,
      months: monthsWithDetail,
      note:
        monthsWithDetail < series.length
          ? `${monthsWithDetail} of ${series.length} months carry line detail; the rest were imported as a total only.`
          : null,
    };
  }, [isolated, lines, series]);

  const showSegments = Boolean(isolated && segments && segments.parts.length > 0);

  return (
    <Panel
      id="growth"
      title="Growth and its quality"
      subtitle="Revenue and operating income, month by month"
      basis={`12 months to ${asAt}`}
      summary={
        revenue.direction === "unknown"
          ? "Only one month imported — no movement to describe yet."
          : `Revenue ${revenue.direction === "flat" ? "held level" : `moved ${money(revenue.change)}`} on the month${slope === null ? "" : `, ${Math.abs(slope) < 1 ? "flat" : slope > 0 ? "rising" : "falling"} over six`}.`
      }
    >
      {/*
        One chart, three states. Nothing picked draws both measures as a trend; one picked
        draws that measure alone, stacked into the lines it is made of; both picked draws
        them side by side to compare. The legend below is the control for all three, and
        it is HTML rather than the canvas's own legend — Chart.js's legend click hides a
        dataset and strikes it through, which reads as "you turned that off" when the
        intent is "show me this one".
      */}
      {chosen.length === 0 ? (
        <TrendLine
          labels={labels}
          showLegend={false}
          datasets={SERIES.map((entry) => ({
            label: entry.label,
            values: series.map((p) => p.values[entry.id] ?? null),
            color: entry.color,
            fill: entry.id === "pl.revenue",
          }))}
        />
      ) : showSegments ? (
        <GroupedBars
          labels={labels}
          stacked
          showLegend={false}
          datasets={segments!.parts.map((part, index) => ({
            label: part.label,
            values: part.values,
            // Steps of the measure's own colour: these are parts of one total, not
            // competing categories.
            color: segmentColor(
              isolated!.color,
              index,
              segments!.parts.length,
              Boolean(isolated!.components),
            ),
          }))}
        />
      ) : (
        <GroupedBars
          labels={labels}
          showLegend={false}
          datasets={chosen.map((entry) => ({
            label: entry.label,
            values: series.map((p) => p.values[entry.id] ?? null),
            color: entry.color,
          }))}
        />
      )}

      {/* --- the same legend every chart on the page has, driving this one's selection */}
      <Legend
        items={SERIES.map((entry) => ({
          label: entry.label,
          color: entry.color,
          present: series.some((p) => p.values[entry.id] !== null),
          tip: `Show ${entry.label.toLowerCase()} on its own, broken into what it is made of.`,
        }))}
        selected={chosen.map((entry) => entry.label)}
        onToggle={(label) => {
          const entry = SERIES.find((candidate) => candidate.label === label);
          if (entry) toggle(entry.id);
        }}
        onClear={() => setSelected([])}
      />

      {/* --- what the segments are, when the bars carry them */}
      {isolated ? (
        <div className="mt-2">
          {loadingLines ? (
            <p className="text-[11.5px] text-ink-faint">Reading the line detail…</p>
          ) : showSegments ? (
            <>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {segments!.parts.map((part, index) => (
                  <span
                    key={part.label}
                    className="inline-flex items-center gap-1.5 text-[11px] text-ink-muted"
                  >
                    <span
                      className="h-2 w-2 rounded-[3px]"
                      style={{
                        background: segmentColor(
                          isolated.color,
                          index,
                          segments!.parts.length,
                          Boolean(isolated.components),
                        ),
                      }}
                    />
                    {part.label}
                  </span>
                ))}
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">
                {isolated.componentNote ??
                  `Each bar is ${isolated.label.toLowerCase()} for that month, stacked into the lines it is made of. Hover a bar for the amounts and each line's share.`}
                {segments!.note ? ` ${segments!.note}` : ""}
              </p>
            </>
          ) : (
            <p className="text-[11.5px] text-ink-faint">
              {segments?.note ??
                `No line detail is available for ${isolated.label.toLowerCase()}, so the bars show the total only.`}
            </p>
          )}
        </div>
      ) : (
        <p className="mt-2 text-[11.5px] text-ink-faint">
          {selected.length === 0
            ? "Click a measure to show it on its own, broken into what it is made of. Pick both to compare them month by month."
            : "Both measures, side by side. Drop one to see the other broken into its parts."}
        </p>
      )}

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
      basis={`Month to ${periodEnd(report.period)}`}
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
      basis={`Month to ${periodEnd(report.period)}`}
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
  asAt,
}: {
  detail: DetailByKind;
  onOpenCustomer: (label: string) => void;
  asAt: string;
}) {
  const sales = detail["customer_sales"] ?? [];
  const receivable = detail["ar_customer"] ?? [];
  const conc = useMemo(() => concentration(sales), [sales]);

  if (conc.rows.length === 0) {
    return (
      <Panel id="customers" title="Customer economics" subtitle="Who the business runs on" basis={`12 months to ${asAt}`}>
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
      basis={`12 months to ${asAt}`}
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
  compact = false,
}: {
  id: string;
  title: string;
  subtitle: string;
  report: PeriodReport;
  prefix: "ar" | "ap";
  rows: DetailRow[];
  entityNoun: string;
  reportName: string;
  /** Half-width, beside its opposite number — the ring goes above the list, not beside it. */
  compact?: boolean;
}) {
  const distribution = agingDistribution(report, prefix);
  const priority = collectionPriority(rows);
  const asAtLabel = `As at ${periodEnd(report.period)}`;

  if (distribution.slices.length === 0 && priority.length === 0) {
    return (
      <Panel id={id} title={title} subtitle={subtitle} basis={asAtLabel}>
        <NeedsData what={`No ${entityNoun.toLowerCase()} balances imported`} upload={`an ${reportName}`} />
      </Panel>
    );
  }

  return (
    <Panel
      id={id}
      title={title}
      subtitle={subtitle}
      basis={asAtLabel}
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
      <div
        className={`grid grid-cols-1 gap-5 ${
          compact ? "" : "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]"
        }`}
      >
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

export function ReferralsSection({
  detail,
  asAt,
}: {
  detail: DetailByKind;
  asAt: string;
}) {
  const rows = (detail["referral_partner"] ?? []).filter((row) => row.value > 0);
  const [open, setOpen] = useState<string | null>(null);

  if (rows.length === 0) {
    return (
      <Panel id="referrals" title="Referral to cash" subtitle="Where the work comes from" basis={`90 days to ${asAt}`}>
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
      subtitle="Where the work comes from"
      basis={`90 days to ${asAt}`}
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
  planner,
}: {
  report: PeriodReport;
  series: SeriesPoint[];
  detail: DetailByKind;
  /**
   * The collections planner, rendered inside this panel.
   *
   * Chasing an invoice is not a separate subject from the thirteen-week projection — it
   * is the fastest lever on it. The parent passes the planner in and is told what the
   * ticked accounts release, so the projection can draw the same money arriving.
   */
  planner?: (onCollected: (amount: number) => void) => ReactNode;
}) {
  const [collected, setCollected] = useState(0);
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
      <Panel
        id="forecast"
        title="Thirteen weeks ahead"
        subtitle="Cash, projected"
        basis={`13 weeks from ${periodEnd(report.period)}`}
      >
        <NeedsData what={base.unavailable} upload="a Balance Sheet and Profit & Loss" />
      </Panel>
    );
  }

  return (
    <Panel
      id="forecast"
      title="Thirteen weeks ahead"
      subtitle="Cash on the current run rate, and what would break it"
      basis={`13 weeks from ${periodEnd(report.period)}`}
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
          /*
            The second line only exists once something has been ticked below. It is the
            same projection with the collected money arriving in week two — soon, but not
            instantly, because a call made today is not cash in the account tomorrow.
          */
          ...(collected > 0
            ? [
                {
                  label: "With the collections below",
                  values: base.weeks.map((week, index) =>
                    week.cash === null ? null : index >= 1 ? week.cash + collected : week.cash,
                  ),
                  color: "#12b76a",
                  dashed: true,
                },
              ]
            : []),
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

      {planner ? (
        <div className="mt-6 border-t border-line-soft pt-4">
          <p className="text-[12.5px] font-semibold text-ink">
            What would collecting change?
          </p>
          <p className="mb-3 mt-0.5 text-[11.5px] text-ink-muted">
            Tick the accounts you expect to collect. The projection above gains a second
            line with that money arriving in week two.
          </p>
          {planner(setCollected)}
        </div>
      ) : null}

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
  asAt,
}: {
  warnings: Warning[];
  onGo: (section: string) => void;
  asAt: string;
}) {
  return (
    <Panel
      id="warnings"
      title="Early warning centre"
      subtitle="Everything the data says is worth looking at, ranked"
      basis={`Month to ${asAt}`}
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

