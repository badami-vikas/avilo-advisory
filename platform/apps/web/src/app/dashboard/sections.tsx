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
  Pareto,
  Radar,
  TrendLine,
  Waterfall,
} from "./charts.js";
import { Finding, NeedsData, Panel, SeverityChip } from "./parts.js";

/* ----------------------------------------------------------------- health */

export function HealthSection({ health }: { health: HealthScore }) {
  const scored = health.dimensions.filter((d) => d.score !== null);

  return (
    <Panel
      id="health"
      title="Financial health"
      subtitle="Five dimensions, each scored against a stated band"
      badge={
        health.overall !== null ? (
          <span className="num text-[12.5px] font-semibold text-ink">
            {Math.round(health.overall)}/100
          </span>
        ) : null
      }
    >
      {scored.length === 0 ? (
        <NeedsData
          what="Nothing can be scored yet"
          upload="a Profit & Loss and a Balance Sheet"
        />
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div>
            <Radarish health={health} />
          </div>
          <div className="divide-y divide-line-soft">
            {health.dimensions.map((dimension) => (
              <div key={dimension.id} className="flex items-start gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] font-medium text-ink">{dimension.label}</p>
                  <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-muted">
                    {dimension.missing ?? dimension.basis}
                  </p>
                </div>
                <div className="w-24 shrink-0 text-right">
                  {dimension.score === null ? (
                    <span className="text-[12px] text-ink-faint">Not scored</span>
                  ) : (
                    <>
                      <span className="num text-[14px] font-semibold text-ink">
                        {Math.round(dimension.score)}
                      </span>
                      <span className="num block text-[11px] text-ink-faint">
                        {dimension.unit === "percent"
                          ? percent(dimension.value)
                          : dimension.unit === "days"
                            ? `${Math.round(dimension.value ?? 0)} days`
                            : moneyFull(dimension.value)}
                      </span>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {health.overall !== null ? (
        <Finding>
          Scored {Math.round(health.overall)} out of 100 across {health.scored} of five
          dimensions
          {health.scored < 5
            ? " — the unscored ones are waiting on imports rather than failing"
            : ""}
          . The weakest is{" "}
          <strong>
            {
              [...scored].sort((a, b) => (a.score ?? 0) - (b.score ?? 0))[0]
                ?.label
            }
          </strong>
          , the strongest{" "}
          <strong>
            {[...scored].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0]?.label}
          </strong>
          .
        </Finding>
      ) : null}
    </Panel>
  );
}

/** The radar plus its own gauge, kept together so the section body stays readable. */
function Radarish({ health }: { health: HealthScore }) {
  return (
    <div>
      <Radar
        labels={health.dimensions.map((d) => d.label)}
        values={health.dimensions.map((d) => d.score)}
      />
      {health.overall !== null ? (
        <Gauge
          value={health.overall}
          label="Overall"
          display={`${Math.round(health.overall)}`}
          tone={
            health.band === "strong"
              ? "#12b76a"
              : health.band === "steady"
                ? "#1570ef"
                : "#d92d20"
          }
          height={120}
        />
      ) : null}
    </div>
  );
}

/* ----------------------------------------------------------------- growth */

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
  const labels = series.map((point) => point.periodLabel);
  const revenue = movement(series, "pl.revenue");
  const slope = trendPct(series, "pl.revenue", 6);

  const bridge = useMemo(
    () => movements(detail["pl_income"] ?? [], priorDetail["pl_income"] ?? [], 6),
    [detail, priorDetail],
  );

  return (
    <Panel
      id="growth"
      title="Growth and its quality"
      subtitle="Where the top line went, and which lines moved it"
    >
      <TrendLine
        labels={labels}
        datasets={[
          {
            label: "Revenue",
            values: series.map((p) => p.values["pl.revenue"] ?? null),
            color: "#1570ef",
            fill: true,
          },
          {
            label: "Net operating income",
            values: series.map((p) => p.values["net_operating_income"] ?? null),
            color: "#12b76a",
          },
        ]}
      />

      {bridge.rows.length > 0 && revenue.previous !== null ? (
        <div className="mt-5">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-faint">
            What moved revenue, line by line
          </p>
          <Waterfall
            opening={revenue.previous}
            openingLabel="Last month"
            steps={bridge.rows.map((row) => ({ label: row.label.trim(), change: row.change }))}
            closingLabel={periodLabel}
          />
        </div>
      ) : null}

      <Finding>
        {revenue.direction === "unknown" ? (
          <>Only one month of revenue has been imported, so there is no movement to explain yet.</>
        ) : (
          <>
            Revenue {revenue.direction === "flat" ? "was effectively level" : `moved ${money(revenue.change)}`}
            {revenue.changePct !== null ? ` (${revenue.changePct.toFixed(1)}%)` : ""} on the
            month
            {bridge.rows[0]
              ? `, and ${bridge.rows[0].label.trim()} accounts for the largest single part of it at ${money(bridge.rows[0].change)}`
              : ""}
            .{" "}
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
    <Panel id="cash" title="Profit into cash" subtitle="What the month earned against what it banked">
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
