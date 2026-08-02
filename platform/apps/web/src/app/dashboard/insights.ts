/**
 * The insight engine behind the interactive dashboard.
 *
 * Everything here is a pure function of the data already on screen: the period report,
 * the metric series, and the entity-level detail rows. No thresholds are invented in the
 * components — a component asks this file a question and renders the answer.
 *
 * Two rules run through all of it:
 *
 *   * **Never assert what the data cannot support.** Every derived figure carries whether
 *     it could be computed, and the reason when it could not. An advisor putting their
 *     name on a client report cannot be handed a confident number with nothing behind it,
 *     so "unknown" is a first-class result rather than a zero.
 *
 *   * **The narrative is assembled from measured facts, not chosen from a list of
 *     templates.** Which beats appear, in which tone, with which numbers, is decided by
 *     what actually moved. Two clients never get the same page.
 */

import type { DetailByKind, DetailRow, FormulaRow, PeriodReport, SeriesPoint } from "../types.js";

/* ------------------------------------------------------------------ basics */

export interface Movement {
  current: number | null;
  previous: number | null;
  /** Absolute change. Null when either end is missing. */
  change: number | null;
  /** Percentage change. Null when the previous value is missing or zero. */
  changePct: number | null;
  direction: "up" | "down" | "flat" | "unknown";
}

const FLAT_BAND_PCT = 1.5;

/** Three readings back — "last quarter", for the health dimensions. */
export const QUARTER = 3;

export function movement(series: SeriesPoint[], id: string): Movement {
  const points = series.filter((p) => p.values[id] !== null && p.values[id] !== undefined);
  const current = points.at(-1)?.values[id] ?? null;
  const previous = points.at(-2)?.values[id] ?? null;

  if (current === null || previous === null) {
    return { current, previous, change: null, changePct: null, direction: "unknown" };
  }
  const change = current - previous;
  // A percentage change off a zero base is arithmetically infinite and editorially
  // meaningless — "revenue up ∞%" from a month with no revenue. Left null.
  const changePct = previous === 0 ? null : (change / Math.abs(previous)) * 100;
  const flat = changePct !== null && Math.abs(changePct) < FLAT_BAND_PCT;
  return {
    current,
    previous,
    change,
    changePct,
    direction: flat ? "flat" : change > 0 ? "up" : change < 0 ? "down" : "flat",
  };
}

/** Mean of the last `n` readings of a series, ignoring gaps. */
export function trailingMean(series: SeriesPoint[], id: string, n: number): number | null {
  const values = series
    .map((p) => p.values[id])
    .filter((v): v is number => v !== null && v !== undefined)
    .slice(-n);
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Straight-line slope per period over the last `n` readings, as a share of the mean. */
export function trendPct(series: SeriesPoint[], id: string, n: number): number | null {
  const values = series
    .map((p) => p.values[id])
    .filter((v): v is number => v !== null && v !== undefined)
    .slice(-n);
  if (values.length < 3) return null;
  // Ordinary least squares on the index. Enough for "is this drifting", which is the
  // only question asked of it.
  const meanX = (values.length - 1) / 2;
  const meanY = values.reduce((sum, v) => sum + v, 0) / values.length;
  let num = 0;
  let den = 0;
  values.forEach((y, x) => {
    num += (x - meanX) * (y - meanY);
    den += (x - meanX) ** 2;
  });
  if (den === 0 || meanY === 0) return null;
  return (num / den / Math.abs(meanY)) * 100;
}

/**
 * A reading `back` periods before the latest one, skipping gaps.
 *
 * Used for quarter-on-quarter comparison. Counting back through *present* readings rather
 * than through calendar months is deliberate: a client who skipped an import should be
 * compared with the last three months they actually have, not with a hole.
 */
export function valueAt(
  series: SeriesPoint[],
  id: string,
  back: number,
): number | null {
  const values = series
    .map((p) => p.values[id])
    .filter((v): v is number => v !== null && v !== undefined);
  return values.at(-1 - back) ?? null;
}

/* ------------------------------------------------------------ health score */

export type Dimension =
  | "profitability"
  | "liquidity"
  | "collection"
  | "growth"
  | "concentration";

export interface HealthDimension {
  id: Dimension;
  label: string;
  /** 0–100, or null when the inputs are not present. */
  score: number | null;
  /** The measured value the score came from, formatted by the caller. */
  value: number | null;
  unit: string;
  /** Plain-English statement of what was measured and against what. */
  basis: string;
  /** Why it could not be scored. Set only when `score` is null. */
  missing?: string;
  /**
   * Change in the measured value against the same figure a quarter ago, in the
   * dimension's own unit. Null where there is no comparable reading — which is the
   * honest answer for the two dimensions with no month-by-month history.
   */
  quarterChange: number | null;
  /** True when a rise in `value` is a deterioration — collection days, say. */
  inverted: boolean;
}

/** Which way a dimension moved, once inversion is taken into account. */
export function dimensionDirection(
  dimension: HealthDimension,
): "better" | "worse" | "flat" | "unknown" {
  if (dimension.quarterChange === null) return "unknown";
  if (Math.abs(dimension.quarterChange) < 0.05) return "flat";
  const rose = dimension.quarterChange > 0;
  return rose === dimension.inverted ? "worse" : "better";
}

export interface HealthScore {
  dimensions: HealthDimension[];
  /** Mean of the dimensions that could be scored, or null when none could. */
  overall: number | null;
  /** How many of the five had data. An overall built on two is worth less than five. */
  scored: number;
  band: "strong" | "steady" | "strained" | "unknown";
}

/**
 * Map a measurement onto 0–100 between a floor and a ceiling.
 *
 * Linear on purpose. A curve would imply a precision about the shape of "healthy" that
 * five ratios over one month cannot carry, and would make the radar move in ways the
 * advisor could not explain to the client sitting opposite them.
 */
function band(value: number, floor: number, ceiling: number): number {
  if (ceiling === floor) return 50;
  const t = (value - floor) / (ceiling - floor);
  return Math.max(0, Math.min(100, t * 100));
}

export function healthScore(
  report: PeriodReport,
  series: SeriesPoint[],
  detail: DetailByKind,
): HealthScore {
  const metric = (id: string) => report.metrics.find((m) => m.id === id);
  const value = (id: string) => {
    const m = metric(id);
    return m && m.status === "ok" ? m.value : null;
  };

  const dimensions: HealthDimension[] = [];

  /** The same figure a quarter ago, or null when the history does not reach. */
  const quarterAgo = (id: string, current: number | null): number | null => {
    if (current === null) return null;
    const then = valueAt(series, id, QUARTER);
    return then === null ? null : current - then;
  };

  const noi = value("noi_margin_pct");
  dimensions.push({
    id: "profitability",
    label: "Profitability",
    score: noi === null ? null : band(noi, 0, 20),
    value: noi,
    unit: "percent",
    basis: "Net operating income margin, scored from 0% up to 20%.",
    quarterChange: quarterAgo("noi_margin_pct", noi),
    inverted: false,
    ...(noi === null ? { missing: "Needs revenue, cost of sales and overhead." } : {}),
  });

  const cash = value("days_cash_on_hand");
  dimensions.push({
    id: "liquidity",
    label: "Liquidity",
    score: cash === null ? null : band(cash, 0, 90),
    value: cash,
    unit: "days",
    basis: "Days of cash on hand, scored from none up to 90 days of runway.",
    quarterChange: quarterAgo("days_cash_on_hand", cash),
    inverted: false,
    ...(cash === null ? { missing: "Needs a balance sheet with a cash total." } : {}),
  });

  const dso = value("dso");
  dimensions.push({
    id: "collection",
    label: "Collection",
    // Inverted: fewer days is better, so the floor is the bad end.
    score: dso === null ? null : band(dso, 60, 15),
    value: dso,
    unit: "days",
    basis: "Days sales outstanding, scored from 60 days down to 15.",
    quarterChange: quarterAgo("dso", dso),
    inverted: true,
    ...(dso === null ? { missing: "Needs an A/R ageing report for this period." } : {}),
  });

  const recent = trailingMean(series, "pl.revenue", 3);
  const earlier = (() => {
    const values = series
      .map((p) => p.values["pl.revenue"])
      .filter((v): v is number => v !== null && v !== undefined);
    const window = values.slice(-6, -3);
    if (window.length === 0) return null;
    return window.reduce((sum, v) => sum + v, 0) / window.length;
  })();
  const growthPct =
    recent !== null && earlier !== null && earlier !== 0
      ? ((recent - earlier) / Math.abs(earlier)) * 100
      : null;
  dimensions.push({
    id: "growth",
    label: "Growth",
    score: growthPct === null ? null : band(growthPct, -20, 20),
    value: growthPct,
    unit: "percent",
    basis: "Last three months of revenue against the three before, scored from −20% to +20%.",
    // Already a quarter-on-quarter measure — comparing it with itself a quarter ago
    // would be a second derivative, which is not something anyone acts on.
    quarterChange: null,
    inverted: false,
    ...(growthPct === null
      ? { missing: "Needs at least six months of profit & loss history." }
      : {}),
  });

  const conc = concentration(detail["customer_sales"] ?? []);
  dimensions.push({
    id: "concentration",
    label: "Client spread",
    // Inverted: a smaller share for the largest customer is healthier.
    score: conc.topShare === null ? null : band(conc.topShare, 60, 10),
    value: conc.topShare,
    unit: "percent",
    basis: "Share of revenue held by the largest customer, scored from 60% down to 10%.",
    // The Sales by Customer export is a rolling twelve-month snapshot, so there is no
    // month-by-month history of it to compare against.
    quarterChange: null,
    inverted: true,
    ...(conc.topShare === null
      ? { missing: "Needs a Sales by Customer export." }
      : {}),
  });

  const scored = dimensions.filter((d) => d.score !== null);
  const overall =
    scored.length === 0
      ? null
      : scored.reduce((sum, d) => sum + (d.score ?? 0), 0) / scored.length;

  return {
    dimensions,
    overall,
    scored: scored.length,
    band:
      overall === null
        ? "unknown"
        : overall >= 66
          ? "strong"
          : overall >= 40
            ? "steady"
            : "strained",
  };
}

/* --------------------------------------------------------- concentration */

export interface ConcentrationResult {
  rows: { label: string; value: number; share: number; cumulative: number }[];
  /** Share of revenue held by the single largest customer. */
  topShare: number | null;
  /** How many customers make up 80% of revenue. */
  customersTo80: number | null;
  total: number;
}

export function concentration(rows: DetailRow[]): ConcentrationResult {
  const sorted = rows
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value);
  const total = sorted.reduce((sum, row) => sum + row.value, 0);
  if (total === 0) {
    return { rows: [], topShare: null, customersTo80: null, total: 0 };
  }

  let running = 0;
  const out = sorted.map((row) => {
    running += row.value;
    return {
      label: row.label,
      value: row.value,
      share: (row.value / total) * 100,
      cumulative: (running / total) * 100,
    };
  });

  const to80 = out.findIndex((row) => row.cumulative >= 80);
  return {
    rows: out,
    topShare: out[0]?.share ?? null,
    customersTo80: to80 === -1 ? out.length : to80 + 1,
    total,
  };
}

/* ---------------------------------------------------------------- ageing */

export const AGING_BUCKETS = [
  { id: "current", label: "Current", color: "#12b76a" },
  { id: "1_30", label: "1–30 days", color: "#84cba0" },
  { id: "31_60", label: "31–60 days", color: "#f79009" },
  { id: "61_90", label: "61–90 days", color: "#e8734a" },
  { id: "91_plus", label: "91+ days", color: "#d92d20" },
] as const;

export interface AgingSlice {
  id: string;
  label: string;
  color: string;
  value: number;
  share: number;
}

/**
 * Ageing distribution from the bucket *accounts*, not from the detail rows.
 *
 * The detail rows carry one line per customer tagged with the single bucket holding most
 * of that customer's balance, which is the honest thing to show in a table but would
 * misstate a distribution — a customer with $9k current and $10k overdue would put the
 * whole $19k in the overdue slice. The bucket totals are imported as their own facts and
 * are exact.
 */
export function agingDistribution(
  report: PeriodReport,
  prefix: "ar" | "ap",
): { slices: AgingSlice[]; total: number; overdueShare: number | null } {
  const at = (id: string) =>
    report.accounts.find((a) => a.accountId === id)?.value ?? null;

  const raw = AGING_BUCKETS.map((bucket) => ({
    ...bucket,
    value: at(`${prefix}.${bucket.id}`) ?? 0,
  }));
  const total = raw.reduce((sum, slice) => sum + slice.value, 0);
  if (total <= 0) return { slices: [], total: 0, overdueShare: null };

  const overdue = raw
    .filter((slice) => slice.id !== "current" && slice.id !== "1_30")
    .reduce((sum, slice) => sum + slice.value, 0);

  return {
    slices: raw
      .filter((slice) => slice.value !== 0)
      .map((slice) => ({ ...slice, share: (slice.value / total) * 100 })),
    total,
    overdueShare: (overdue / total) * 100,
  };
}

export interface PriorityRow {
  label: string;
  value: number;
  bucket: string | null;
  /** Amount weighted by how late it is — what to chase first. */
  weight: number;
  reason: string;
}

const BUCKET_WEIGHT: Record<string, number> = {
  current: 0.2,
  "1_30": 0.6,
  "31_60": 1.4,
  "61_90": 2.2,
  "91_plus": 3,
  total: 1,
};

const BUCKET_PHRASE: Record<string, string> = {
  current: "not yet due",
  "1_30": "up to a month late",
  "31_60": "one to two months late",
  "61_90": "two to three months late",
  "91_plus": "over three months late",
  total: "outstanding",
};

/**
 * Who to chase, in order.
 *
 * Size alone puts the largest customer first even when they always pay on time; age alone
 * puts a $180 invoice ahead of a $40,000 one. The product is what an advisor would
 * actually work down.
 */
export function collectionPriority(rows: DetailRow[], limit = 8): PriorityRow[] {
  return rows
    .filter((row) => row.value > 0)
    .map((row) => {
      const bucket = row.bucket ?? "total";
      const weight = row.value * (BUCKET_WEIGHT[bucket] ?? 1);
      return {
        label: row.label,
        value: row.value,
        bucket: row.bucket,
        weight,
        reason: `Mostly ${BUCKET_PHRASE[bucket] ?? "outstanding"}.`,
      };
    })
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit);
}

/* ------------------------------------------------------------- movements */

export interface MovementRow {
  label: string;
  from: number;
  to: number;
  change: number;
}

/**
 * Line-by-line movement between two periods' detail rows.
 *
 * Drives the revenue waterfall: what rose, what fell, what appeared, what stopped. A line
 * present in only one of the two periods is a real event — a service line that started or
 * a customer that went quiet — so it is kept with a zero on the missing side rather than
 * dropped for want of a pair.
 */
export function movements(
  current: DetailRow[],
  prior: DetailRow[],
  limit = 8,
): { rows: MovementRow[]; net: number } {
  const byLabel = new Map<string, { from: number; to: number }>();
  for (const row of prior) {
    byLabel.set(row.label, { from: row.value, to: 0 });
  }
  for (const row of current) {
    const existing = byLabel.get(row.label);
    if (existing) existing.to = row.value;
    else byLabel.set(row.label, { from: 0, to: row.value });
  }

  const all = [...byLabel.entries()]
    .map(([label, { from, to }]) => ({ label, from, to, change: to - from }))
    .filter((row) => Math.abs(row.change) > 0.005)
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change));

  const net = all.reduce((sum, row) => sum + row.change, 0);
  const head = all.slice(0, limit);
  const tailChange = net - head.reduce((sum, row) => sum + row.change, 0);

  // Everything below the cut is one bar rather than forty. A waterfall that does not
  // reconcile to the total is worse than no waterfall.
  if (all.length > limit && Math.abs(tailChange) > 0.005) {
    head.push({
      label: `${all.length - limit} smaller lines`,
      from: 0,
      to: tailChange,
      change: tailChange,
    });
  }
  return { rows: head, net };
}

/* -------------------------------------------------------------- forecast */

export interface ForecastAssumptions {
  /** Percentage change applied to the monthly revenue run rate. */
  revenueChangePct: number;
  /** Percentage change applied to monthly operating spend. */
  costChangePct: number;
  /** Days taken to collect. Longer collection delays cash without changing profit. */
  collectionDays: number;
}

export interface ForecastWeek {
  week: number;
  label: string;
  /** Projected cash at the end of the week. */
  cash: number;
  inflow: number;
  outflow: number;
}

export interface Forecast {
  weeks: ForecastWeek[];
  /** First week the balance goes negative, or null if it never does. */
  breachWeek: number | null;
  low: number;
  startingCash: number;
  /** Set when there is not enough to project at all. */
  unavailable?: string;
}

const WEEKS_PER_MONTH = 52 / 12;

/**
 * A thirteen-week cash projection.
 *
 * Deliberately simple and deliberately explained: the run rate comes from the trailing
 * three months, collection shifts revenue later in time without changing its size, and
 * nothing is smoothed. An advisor has to be able to reconstruct every number in this
 * chart in front of a client, which rules out anything they would have to take on trust.
 */
export function forecast(
  report: PeriodReport,
  series: SeriesPoint[],
  assumptions: ForecastAssumptions,
): Forecast {
  const startingCash =
    report.accounts.find((a) => a.accountId === "bs.cash")?.value ?? null;
  const revenue = trailingMean(series, "pl.revenue", 3);
  const cogs = trailingMean(series, "pl.cogs", 3) ?? 0;
  const overhead = trailingMean(series, "pl.overhead", 3) ?? 0;

  if (startingCash === null || revenue === null) {
    return {
      weeks: [],
      breachWeek: null,
      low: 0,
      startingCash: startingCash ?? 0,
      unavailable:
        startingCash === null
          ? "Needs a balance sheet so the projection has an opening cash balance."
          : "Needs at least one month of profit & loss data for a run rate.",
    };
  }

  const weeklyIn = (revenue * (1 + assumptions.revenueChangePct / 100)) / WEEKS_PER_MONTH;
  const weeklyOut =
    ((cogs + overhead) * (1 + assumptions.costChangePct / 100)) / WEEKS_PER_MONTH;
  // Collection delay in whole weeks: cash for the first `lag` weeks is money already
  // invoiced, which the projection does not attempt to know, so it arrives at the run
  // rate. Beyond that the delay is a one-off shift, not a repeating loss.
  const lag = Math.max(0, Math.round(assumptions.collectionDays / 7) - 4);

  let cash = startingCash;
  let low = startingCash;
  let breachWeek: number | null = null;
  const weeks: ForecastWeek[] = [];

  for (let week = 1; week <= 13; week += 1) {
    const inflow = week <= lag ? 0 : weeklyIn;
    cash += inflow - weeklyOut;
    if (cash < low) low = cash;
    if (cash < 0 && breachWeek === null) breachWeek = week;
    weeks.push({ week, label: `W${week}`, cash, inflow, outflow: weeklyOut });
  }

  return { weeks, breachWeek, low, startingCash };
}

/* -------------------------------------------------------- early warnings */

export type Severity = "critical" | "warning" | "watch";

export interface Warning {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  /** Which dashboard section answers it. */
  section: string;
}

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, watch: 2 };

/**
 * Everything the data says is worth looking at, ranked.
 *
 * Benchmark breaches come from the bands already declared on each formula rather than
 * from thresholds written a second time here — the prototype kept two copies and they
 * drifted. The rest are patterns no single metric expresses: a margin sliding while
 * revenue climbs, receivables outgrowing sales, one customer carrying the business.
 */
export function warnings(
  report: PeriodReport,
  series: SeriesPoint[],
  detail: DetailByKind,
  formulas: FormulaRow[],
  cash: Forecast,
): Warning[] {
  const out: Warning[] = [];
  const value = (id: string) => {
    const m = report.metrics.find((x) => x.id === id);
    return m && m.status === "ok" ? m.value : null;
  };

  for (const metric of report.metrics) {
    if (metric.status !== "ok" || metric.value === null) continue;
    const formula = formulas.find((f) => f.id === metric.id);
    if (!formula?.benchmark) continue;
    let benchmark: { min?: number; max?: number; note?: string };
    try {
      benchmark = JSON.parse(formula.benchmark);
    } catch {
      continue;
    }
    if (benchmark.min !== undefined && metric.value < benchmark.min) {
      out.push({
        id: `bench-${metric.id}`,
        severity: metric.value < benchmark.min * 0.5 ? "critical" : "warning",
        title: `${metric.label} below its benchmark`,
        detail: `${format(metric.value, formula.unit)} against a floor of ${format(benchmark.min, formula.unit)}. ${benchmark.note ?? ""}`.trim(),
        section: "health",
      });
    }
    if (benchmark.max !== undefined && metric.value > benchmark.max) {
      out.push({
        id: `bench-${metric.id}`,
        severity: metric.value > benchmark.max * 1.5 ? "critical" : "warning",
        title: `${metric.label} above its benchmark`,
        detail: `${format(metric.value, formula.unit)} against a ceiling of ${format(benchmark.max, formula.unit)}. ${benchmark.note ?? ""}`.trim(),
        section: "receivables",
      });
    }
  }

  // Margin eroding while revenue grows: the pattern that a revenue chart alone hides.
  const revenue = movement(series, "pl.revenue");
  const marginTrend = trendPct(series, "noi_margin_pct", 6);
  if (revenue.direction === "up" && marginTrend !== null && marginTrend < -2) {
    out.push({
      id: "margin-erosion",
      severity: "warning",
      title: "Growing, but keeping less of it",
      detail: `Revenue rose ${fmtPct(revenue.changePct)} while operating margin has drifted down over the last six months. Volume is covering a widening cost base.`,
      section: "profitability",
    });
  }

  // Receivables growing faster than sales.
  const ar = movement(series, "ar.total");
  if (
    ar.changePct !== null &&
    revenue.changePct !== null &&
    ar.changePct > revenue.changePct + 10
  ) {
    out.push({
      id: "ar-outpacing",
      severity: "warning",
      title: "Receivables growing faster than sales",
      detail: `Money owed rose ${fmtPct(ar.changePct)} against revenue at ${fmtPct(revenue.changePct)}. The extra sales have not turned into cash yet.`,
      section: "receivables",
    });
  }

  const conc = concentration(detail["customer_sales"] ?? []);
  if (conc.topShare !== null && conc.topShare > 30) {
    out.push({
      id: "concentration",
      severity: conc.topShare > 50 ? "critical" : "watch",
      title: "Revenue concentrated in one customer",
      detail: `${conc.rows[0]?.label} accounts for ${conc.topShare.toFixed(0)}% of the last twelve months. ${conc.customersTo80} customers make up 80%.`,
      section: "customers",
    });
  }

  if (cash.breachWeek !== null) {
    out.push({
      id: "cash-breach",
      severity: "critical",
      title: `Cash runs out in week ${cash.breachWeek}`,
      detail:
        "On the current run rate and collection speed the projected balance goes negative inside the thirteen-week window.",
      section: "forecast",
    });
  }

  const dso = value("dso");
  const dpo = value("dpo");
  if (dso !== null && dpo !== null && dso > dpo + 20) {
    out.push({
      id: "cash-gap",
      severity: "warning",
      title: "Paying faster than being paid",
      detail: `Collecting in ${Math.round(dso)} days while paying in ${Math.round(dpo)} — a ${Math.round(dso - dpo)}-day gap the business funds itself.`,
      section: "cash",
    });
  }

  if (report.missingRequired.length > 0) {
    out.push({
      id: "missing-inputs",
      severity: "watch",
      title: `${report.missingRequired.length} input${report.missingRequired.length === 1 ? "" : "s"} missing`,
      detail: `${report.accounts
        .filter((a) => a.requiredButMissing)
        .map((a) => a.label)
        .join(", ")} — metrics that depend on them are shown as unavailable rather than estimated.`,
      section: "summary",
    });
  }

  return out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

/* --------------------------------------------------------------- actions */

export interface Action {
  id: string;
  title: string;
  why: string;
  /** What it is worth, when that can be quantified. */
  impact: string | null;
  effort: "low" | "medium" | "high";
  /** How soon it stops being cheap to fix. Drives the default due date. */
  urgency: "high" | "medium" | "low";
  /** Days from the period end, used until someone sets a real date. */
  dueInDays: number;
  section: string;
}

/**
 * What to do about it.
 *
 * Each action is generated from a specific measured condition and carries the arithmetic
 * behind its own impact figure, because "collect faster" is advice and "collecting 12 days
 * sooner frees $38,400" is a decision.
 */
export function actions(
  report: PeriodReport,
  series: SeriesPoint[],
  detail: DetailByKind,
  warningList: Warning[],
): Action[] {
  const out: Action[] = [];
  const value = (id: string) => {
    const m = report.metrics.find((x) => x.id === id);
    return m && m.status === "ok" ? m.value : null;
  };
  const account = (id: string) =>
    report.accounts.find((a) => a.accountId === id)?.value ?? null;

  const dso = value("dso");
  const revenue = account("pl.revenue");
  if (dso !== null && revenue !== null && dso > 30) {
    const target = 30;
    const freed = ((dso - target) / 30) * revenue;
    out.push({
      id: "collect",
      title: `Bring collection down to ${target} days`,
      why: `Invoices are settling in ${Math.round(dso)} days. Every day above 30 is a day's revenue sitting in a customer's account rather than yours.`,
      impact: `Frees about ${money(freed)} of cash, once.`,
      effort: "medium",
      urgency: "high",
      dueInDays: 30,
      section: "receivables",
    });
  }

  const priority = collectionPriority(detail["ar_customer"] ?? [], 3).filter(
    (row) => row.bucket === "61_90" || row.bucket === "91_plus",
  );
  if (priority.length > 0) {
    const sum = priority.reduce((total, row) => total + row.value, 0);
    out.push({
      id: "chase",
      title: `Chase ${priority.length} overdue account${priority.length === 1 ? "" : "s"}`,
      why: `${priority.map((row) => row.label).join(", ")} are more than sixty days late. Balances past sixty days are materially less likely to be collected in full.`,
      impact: `${money(sum)} outstanding.`,
      effort: "low",
      urgency: "high",
      dueInDays: 14,
      section: "receivables",
    });
  }

  const conc = concentration(detail["customer_sales"] ?? []);
  if (conc.topShare !== null && conc.topShare > 30) {
    out.push({
      id: "diversify",
      title: "Reduce reliance on the largest customer",
      why: `${conc.rows[0]?.label} is ${conc.topShare.toFixed(0)}% of revenue. Losing them would take out roughly ${money((conc.total * conc.topShare) / 100)} of annual billing.`,
      impact: null,
      effort: "high",
      urgency: "medium",
      dueInDays: 90,
      section: "customers",
    });
  }

  const marginTrend = trendPct(series, "gross_margin_pct", 6);
  const expenses = detail["pl_expense"] ?? [];
  if (marginTrend !== null && marginTrend < -2 && expenses.length > 0) {
    const largest = [...expenses].sort((a, b) => Math.abs(b.value) - Math.abs(a.value))[0];
    out.push({
      id: "margin",
      title: "Find where the margin is going",
      why: `Gross margin has drifted down over six months. The largest single cost line this period is ${largest?.label.trim()} at ${money(Math.abs(largest?.value ?? 0))}.`,
      impact:
        revenue !== null ? `One point of gross margin is ${money(revenue * 0.01)} a month.` : null,
      effort: "medium",
      urgency: "medium",
      dueInDays: 45,
      section: "profitability",
    });
  }

  if (warningList.some((w) => w.id === "cash-breach")) {
    out.push({
      id: "runway",
      title: "Close the projected cash gap",
      why: "The thirteen-week projection goes negative on current assumptions. The levers are collection speed, payment timing and discretionary spend, in that order.",
      impact: null,
      effort: "high",
      urgency: "high",
      dueInDays: 7,
      section: "forecast",
    });
  }

  const referrals = detail["referral_partner"] ?? [];
  if (referrals.length > 0) {
    const top = [...referrals].sort((a, b) => b.value - a.value)[0];
    out.push({
      id: "referrals",
      title: `Keep ${top?.label} close`,
      why: `Referral partners produced ${money(referrals.reduce((sum, row) => sum + row.value, 0))} over the last ninety days, and ${top?.label} led it.`,
      impact: null,
      effort: "low",
      urgency: "low",
      dueInDays: 60,
      section: "referrals",
    });
  }

  return out;
}

/* ------------------------------------------------- per-dimension briefing */

export interface DimensionStory {
  happened: string;
  weakened: string;
  attention: string;
}

/**
 * One dimension of the health score, in three sentences.
 *
 * Shown when the advisor hovers a point on the radar. The three questions are fixed —
 * what happened, what weakened, what needs attention — but each answer is measured, and a
 * dimension with nothing wrong says so rather than manufacturing a concern.
 */
export function dimensionStory(
  dimension: HealthDimension,
  report: PeriodReport,
  series: SeriesPoint[],
  detail: DetailByKind,
): DimensionStory {
  const account = (id: string) =>
    report.accounts.find((a) => a.accountId === id)?.value ?? null;
  const direction = dimensionDirection(dimension);
  const moved =
    dimension.quarterChange === null
      ? "There is no reading from a quarter ago to compare against."
      : direction === "flat"
        ? "It has barely moved since last quarter."
        : `${direction === "better" ? "Improved" : "Deteriorated"} by ${Math.abs(dimension.quarterChange).toFixed(1)}${dimension.unit === "percent" ? " points" : dimension.unit === "days" ? " days" : ""} since last quarter.`;

  if (dimension.missing) {
    return {
      happened: dimension.missing,
      weakened: "Nothing can be assessed until that import arrives.",
      attention: `Import the missing report, then this dimension scores automatically.`,
    };
  }

  switch (dimension.id) {
    case "profitability": {
      const gross = movement(series, "gross_margin_pct");
      const expenses = [...(detail["pl_expense"] ?? [])].sort(
        (a, b) => Math.abs(b.value) - Math.abs(a.value),
      );
      const revenue = account("pl.revenue");
      return {
        happened: `Operating margin is ${dimension.value?.toFixed(1)}%. ${moved}`,
        weakened:
          gross.change !== null && gross.change < -0.3
            ? `Gross margin fell ${Math.abs(gross.change).toFixed(1)} points on the month, so the pressure is in delivery cost rather than overhead.`
            : expenses[0]
              ? `Nothing is eroding sharply. The largest single cost line is ${expenses[0].label.trim()} at ${money(Math.abs(expenses[0].value))}.`
              : "Nothing is eroding sharply.",
        attention:
          revenue === null
            ? "Watch the trend rather than the month."
            : `One point of margin is ${money(revenue * 0.01)} a month — that is the size of the prize on any pricing or cost decision.`,
      };
    }

    case "liquidity": {
      const cashMove = movement(series, "bs.cash");
      return {
        happened: `${Math.round(dimension.value ?? 0)} days of cash at the current rate of spend. ${moved}`,
        weakened:
          cashMove.change !== null && cashMove.change < 0
            ? `The balance fell ${money(Math.abs(cashMove.change))} on the month.`
            : "The balance is not falling.",
        attention:
          (dimension.value ?? 0) < 30
            ? "Under thirty days of runway leaves no room for a slow-paying month."
            : "Runway is comfortable; the thirteen-week projection is the thing to watch, not the balance.",
      };
    }

    case "collection": {
      const overdue = agingDistribution(report, "ar");
      const worst = collectionPriority(detail["ar_customer"] ?? [], 1)[0];
      return {
        happened: `Invoices are settling in ${Math.round(dimension.value ?? 0)} days. ${moved}`,
        weakened:
          overdue.overdueShare === null
            ? "No ageing detail was imported for this period."
            : `${overdue.overdueShare.toFixed(0)}% of ${money(overdue.total)} is more than thirty days past due.`,
        attention: worst
          ? `${worst.label} is the first call — ${money(worst.value)}, ${worst.reason.toLowerCase()}`
          : "Nothing is materially overdue.",
      };
    }

    case "growth": {
      const revenue = movement(series, "pl.revenue");
      const slope = trendPct(series, "pl.revenue", 6);
      return {
        happened: `The last quarter ran ${dimension.value === null ? "—" : `${dimension.value >= 0 ? "+" : ""}${dimension.value.toFixed(1)}%`} against the quarter before.`,
        weakened:
          slope === null
            ? "Six months of history are needed before a trend can be called."
            : Math.abs(slope) < 1
              ? "Over six months the line is flat — this is a steady business, not a growing one."
              : `Over six months revenue is ${slope > 0 ? "rising" : "falling"} about ${Math.abs(slope).toFixed(1)}% a month.`,
        attention:
          revenue.direction === "down"
            ? "This month was down on last. One month is not a trend, but two would be."
            : "Growth without margin is volume. Check the profitability axis alongside this one.",
      };
    }

    case "concentration": {
      const conc = concentration(detail["customer_sales"] ?? []);
      const top = conc.rows[0];
      return {
        happened: top
          ? `${top.label} is ${top.share.toFixed(1)}% of the last twelve months' billings.`
          : "No customer revenue has been imported.",
        weakened:
          conc.customersTo80 === null
            ? "Nothing to assess."
            : `${conc.customersTo80} customer${conc.customersTo80 === 1 ? "" : "s"} make up 80% of revenue.`,
        attention:
          (conc.topShare ?? 0) > 30 && top
            ? `Losing ${top.label} would take out roughly ${money((conc.total * top.share) / 100)} of annual billing.`
            : "The book is spread widely enough that no single loss would be structural.",
      };
    }
  }
}

/* -------------------------------------------------------- growth quality */

export interface GrowthQualityPoint {
  label: string;
  /** Change in trailing-twelve-month billings against the prior snapshot, %. */
  growthPct: number | null;
  /** Share of total billings. */
  share: number;
  revenue: number;
  /** Outstanding balance as a share of what they bill — the exposure axis. */
  exposurePct: number;
  risk: "low" | "medium" | "high";
}

/**
 * Every customer positioned by how they are moving and how much they are owed.
 *
 * The reference for this chart plots growth against *gross margin per customer*, which
 * the source exports do not carry — a Sales by Customer report has revenue and nothing
 * about the cost of serving it. Rather than invent a margin, the vertical axis is the
 * share of revenue the customer represents, which answers the question the quadrant
 * labels actually ask: does this movement matter?
 *
 * Payment risk is real and comes from the ageing report.
 */
export function growthQuality(
  detail: DetailByKind,
  priorDetail: DetailByKind,
): { points: GrowthQualityPoint[]; comparable: boolean } {
  const current = detail["customer_sales"] ?? [];
  const prior = priorDetail["customer_sales"] ?? [];
  const owed = new Map((detail["ar_customer"] ?? []).map((row) => [row.label, row]));
  const before = new Map(prior.map((row) => [row.label, row.value]));

  const total = current.reduce((sum, row) => sum + Math.max(0, row.value), 0);
  if (total === 0) return { points: [], comparable: false };

  const points = current
    .filter((row) => row.value > 0)
    .map((row) => {
      const was = before.get(row.label);
      const balance = owed.get(row.label);
      const exposurePct = balance ? (balance.value / row.value) * 100 : 0;
      const bucket = balance?.bucket ?? null;
      return {
        label: row.label,
        growthPct:
          was === undefined || was === 0 ? null : ((row.value - was) / Math.abs(was)) * 100,
        share: (row.value / total) * 100,
        revenue: row.value,
        exposurePct,
        risk:
          bucket === "91_plus" || bucket === "61_90"
            ? ("high" as const)
            : bucket === "31_60"
              ? ("medium" as const)
              : ("low" as const),
      };
    })
    .sort((a, b) => b.revenue - a.revenue);

  return { points, comparable: points.some((p) => p.growthPct !== null) };
}

/* ------------------------------------------------------------- narrative */

export interface Beat {
  id: "what" | "why" | "risk" | "next" | "act";
  kicker: string;
  headline: string;
  /** Sentences. Rendered as separate paragraphs. */
  body: string[];
  /** Phrases in the body that link to a section. */
  links: { phrase: string; section: string }[];
  tone: "positive" | "neutral" | "negative";
}

/**
 * The five-beat story: what happened, why, where the risk is, what happens next, what to
 * do about it.
 *
 * Assembled from measurements. Where a beat has nothing measured behind it, it says so
 * rather than reaching for a generality — an advisor's credibility does not survive a
 * paragraph the client can tell was written by a template.
 */
export function narrative(
  report: PeriodReport,
  series: SeriesPoint[],
  detail: DetailByKind,
  health: HealthScore,
  cash: Forecast,
  warningList: Warning[],
  actionList: Action[],
): Beat[] {
  const revenue = movement(series, "pl.revenue");
  const noi = movement(series, "net_operating_income");
  const margin = movement(series, "noi_margin_pct");
  const beats: Beat[] = [];

  /* --- what happened */
  const whatBody: string[] = [];
  if (revenue.current !== null) {
    whatBody.push(
      revenue.direction === "unknown"
        ? `Revenue for ${report.periodLabel} was ${money(revenue.current)}. There is no earlier month to compare it against yet.`
        : `Revenue for ${report.periodLabel} was ${money(revenue.current)}, ${describeChange(revenue)} on the month before.`,
    );
  }
  if (noi.current !== null) {
    whatBody.push(
      `Operating income came to ${money(noi.current)}${
        margin.current !== null ? `, a margin of ${margin.current.toFixed(1)}%` : ""
      }${margin.direction !== "unknown" && margin.change !== null ? ` — ${margin.change >= 0 ? "up" : "down"} ${Math.abs(margin.change).toFixed(1)} points` : ""}.`,
    );
  }
  if (whatBody.length === 0) {
    whatBody.push(
      "Nothing has been imported for this period yet, so there is no month to describe.",
    );
  }
  beats.push({
    id: "what",
    kicker: "What happened",
    headline:
      revenue.direction === "up"
        ? "A bigger month"
        : revenue.direction === "down"
          ? "A smaller month"
          : revenue.direction === "flat"
            ? "Held steady"
            : "This month",
    body: whatBody,
    links: [{ phrase: "Revenue", section: "growth" }],
    tone: revenue.direction === "up" ? "positive" : revenue.direction === "down" ? "negative" : "neutral",
  });

  /* --- why it happened */
  const whyBody: string[] = [];
  const lineMoves = movements(detail["pl_income"] ?? [], [], 3);
  const topLines = lineMoves.rows.filter((row) => row.to > 0).slice(0, 2);
  if (topLines.length > 0) {
    whyBody.push(
      `The month was carried by ${topLines.map((row) => `${row.label.trim()} at ${money(row.to)}`).join(" and ")}.`,
    );
  }
  const expenses = detail["pl_expense"] ?? [];
  if (expenses.length > 0) {
    const largest = [...expenses].sort((a, b) => Math.abs(b.value) - Math.abs(a.value))[0];
    if (largest) {
      whyBody.push(
        `On the cost side the largest single line was ${largest.label.trim()} at ${money(Math.abs(largest.value))}.`,
      );
    }
  }
  const gross = movement(series, "gross_margin_pct");
  if (gross.change !== null && Math.abs(gross.change) >= 0.5) {
    whyBody.push(
      `Gross margin moved ${gross.change >= 0 ? "up" : "down"} ${Math.abs(gross.change).toFixed(1)} points, so the change was ${gross.change >= 0 ? "not only" : "not just"} volume.`,
    );
  }
  if (whyBody.length === 0) {
    whyBody.push(
      "The profit & loss detail needed to attribute the change — service lines and expense lines — has not been imported for this period.",
    );
  }
  beats.push({
    id: "why",
    kicker: "Why it happened",
    headline: "What moved underneath",
    body: whyBody,
    links: [
      { phrase: "service lines", section: "growth" },
      { phrase: "cost side", section: "profitability" },
    ],
    tone: "neutral",
  });

  /* --- where the risk is */
  const top = warningList[0];
  beats.push({
    id: "risk",
    kicker: "Where the risk is",
    headline: top ? top.title : "Nothing outside its band",
    body: top
      ? [
          top.detail,
          warningList.length > 1
            ? `${warningList.length - 1} further item${warningList.length === 2 ? "" : "s"} ${warningList.length === 2 ? "is" : "are"} flagged below.`
            : "Nothing else is outside its benchmark this period.",
        ]
      : [
          "Every metric with a benchmark is inside its band this period, and no structural pattern — margin erosion, receivables outpacing sales, customer concentration — is present in the data.",
        ],
    links: [{ phrase: "flagged", section: "warnings" }],
    tone: top ? (top.severity === "critical" ? "negative" : "neutral") : "positive",
  });

  /* --- what happens next */
  const nextBody: string[] = [];
  if (cash.unavailable) {
    nextBody.push(cash.unavailable);
  } else {
    nextBody.push(
      cash.breachWeek === null
        ? `On the current run rate cash ends the thirteen weeks at ${money(cash.weeks.at(-1)?.cash ?? 0)}, with a low point of ${money(cash.low)}.`
        : `On the current run rate cash turns negative in week ${cash.breachWeek}, bottoming at ${money(cash.low)}.`,
    );
  }
  if (health.overall !== null) {
    nextBody.push(
      `The health score sits at ${Math.round(health.overall)} out of 100 across ${health.scored} of five dimensions — ${
        health.band === "strong"
          ? "a business with room to move."
          : health.band === "steady"
            ? "sound, with specific weak points rather than general trouble."
            : "thin enough that a single bad month would be felt."
      }`,
    );
  }
  beats.push({
    id: "next",
    kicker: "What happens next",
    headline:
      cash.breachWeek !== null
        ? "The runway is the constraint"
        : health.band === "strained"
          ? "Manageable, but not comfortable"
          : "Steady from here",
    body: nextBody,
    links: [{ phrase: "thirteen weeks", section: "forecast" }],
    tone: cash.breachWeek !== null ? "negative" : "neutral",
  });

  /* --- what to do */
  const first = actionList[0];
  beats.push({
    id: "act",
    kicker: "What to do",
    headline: first ? first.title : "Nothing urgent",
    body: first
      ? [
          first.why,
          ...(first.impact ? [first.impact] : []),
          actionList.length > 1
            ? `${actionList.length - 1} further action${actionList.length === 2 ? "" : "s"} ${actionList.length === 2 ? "is" : "are"} listed below, ranked by what they are worth.`
            : "",
        ].filter(Boolean)
      : [
          "No condition in this month's data calls for an intervention. The useful work is keeping the imports current so a change is visible the month it happens.",
        ],
    links: [{ phrase: "actions", section: "actions" }],
    tone: first ? "neutral" : "positive",
  });

  return beats;
}

/**
 * The last day of a reporting month, spelled out.
 *
 * Every window on the dashboard ends here. A profit & loss covers the month up to this
 * date, a balance is a photograph taken on it, a customer ranking looks back a year from
 * it, and the projection starts from it. Stating the same date in every section's basis
 * is what makes the one month picker in the toolbar mean something: it does not put every
 * panel on the same window — it puts them all on the same *end*.
 */
export function periodEnd(period: string): string {
  const [year, month] = period.split("-").map(Number);
  if (!year || !month) return period;
  // Day zero of the next month is the last day of this one.
  return new Date(Date.UTC(year, month, 0)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/* -------------------------------------------------------------- helpers */

function describeChange(m: Movement): string {
  if (m.changePct === null || m.change === null) return "with no comparable prior month";
  const word = m.direction === "up" ? "up" : m.direction === "down" ? "down" : "level";
  if (m.direction === "flat") return "effectively level";
  return `${word} ${Math.abs(m.changePct).toFixed(1)}% (${money(Math.abs(m.change))})`;
}

function fmtPct(value: number | null): string {
  return value === null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

/**
 * Compact money for prose.
 *
 * Deliberately separate from `lib/format.ts`'s `money`: this file is imported by tests
 * that must not depend on the browser's Intl data being present, and a sentence wants
 * "$1.2M" where a table cell wants "$1,234,567.00".
 */
export function money(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${sign}$${Math.round(abs / 1_000)}K`;
  // Grouped below the K threshold: "$9,500" reads as money, "$9500" reads as a part number.
  return `${sign}$${Math.round(abs)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

function format(value: number, unit: string): string {
  if (unit === "percent") return `${value.toFixed(1)}%`;
  if (unit === "days") return `${Math.round(value)} days`;
  return money(value);
}
