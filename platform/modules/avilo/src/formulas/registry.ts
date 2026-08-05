// Seed formula registry.
//
// In the prototype these were JavaScript expressions inline in render functions, with a
// separate hand-written "Formula Checker" panel that *described* them in prose. The two
// could drift, and did. Here the expression IS the definition: the panel renders it, the
// engine evaluates it, and the required-data checklist is derived from its dependencies.
// One source of truth, three consumers.
//
// Identifiers resolve in this order: account ids (dotted, e.g. `pl.revenue`), then other
// formula ids (e.g. `gross_profit`). Cycles are rejected at registration time.

export interface Benchmark {
  /** Healthy band. Values outside it raise a red flag in Check Formulas. */
  min?: number;
  max?: number;
  note?: string;
}

export interface FormulaDef {
  id: string;
  label: string;
  expression: string;
  unit: "currency" | "percent" | "days" | "ratio" | "count";
  description: string;
  benchmark?: Benchmark;
  sortOrder: number;
}

export const SEED_FORMULAS: FormulaDef[] = [
  {
    id: "gross_profit",
    label: "Gross profit",
    expression: "pl.revenue - pl.cogs",
    unit: "currency",
    description: "Revenue less cost of goods sold.",
    sortOrder: 10,
  },
  {
    id: "gross_margin_pct",
    label: "Gross margin %",
    expression: "gross_profit / pl.revenue * 100",
    unit: "percent",
    description: "Gross profit as a percentage of revenue.",
    benchmark: { min: 30, note: "Below 30% is thin for a service business." },
    sortOrder: 20,
  },
  {
    id: "net_operating_income",
    label: "Net Operating Income",
    expression: "pl.revenue - pl.cogs - pl.overhead",
    unit: "currency",
    description: "Revenue less cost of goods sold and operating overhead.",
    sortOrder: 30,
  },
  {
    id: "noi_margin_pct",
    label: "Net Operating Income margin %",
    expression: "net_operating_income / pl.revenue * 100",
    unit: "percent",
    description: "Net Operating Income as a percentage of revenue.",
    benchmark: { min: 10, note: "Below 10% leaves little room for reinvestment." },
    sortOrder: 40,
  },
  /*
    Liquidity: a stock over a rate.
    ------------------------------------------------------------------------------
    Each of these divides a point-in-time balance by a daily rate of activity, and the
    rate is where two separate mistakes were made.

    The first was the divisor. These used 365 while every P&L column is a single month,
    so daily spend came out twelve times too small — a beta user reported 10,304 days of
    runway. A 30-day month puts numerator and denominator on the same footing.

    The second was the base, and it survived the first fix. One month is not a rate; it
    is one observation. This client bills $380,881 in one month and $12,527 in another,
    and their most recent month happened to carry the lowest operating spend of thirteen
    — so days cash on hand read 54 days where a trailing three-month base reads 19.
    Neither figure is wrong arithmetic. One of them is a coincidence.

    Three months rather than twelve: long enough to survive one lumpy month, short enough
    that a business genuinely running out of money is not reassured by last summer.

    Each headline keeps a `_point` twin computing the same thing on the selected month
    alone. It is not decoration — it is what makes the trailing figure auditable, and it
    stays in the registry rather than being recomputed in a chart, so there is still one
    definition of every number on the page (ADR-003).
  */
  {
    id: "days_cash_on_hand",
    label: "Days cash on hand",
    expression: "bs.cash / ((avg3.pl.cogs + avg3.pl.overhead) / 30)",
    unit: "days",
    description:
      "Total cash in bank accounts divided by average daily operating spend, taken from the trailing three months of cost of sales and overhead over a 30-day month.",
    benchmark: { min: 30, note: "Under 30 days of runway is a liquidity risk." },
    sortOrder: 50,
  },
  {
    id: "days_cash_on_hand_point",
    label: "Days cash on hand (this month)",
    expression: "bs.cash / ((pl.cogs + pl.overhead) / 30)",
    unit: "days",
    description:
      "The same calculation on the selected month's spend alone. Shown beside the headline so the effect of an unusual month is visible rather than hidden.",
    sortOrder: 51,
  },
  {
    id: "dso",
    label: "Days sales outstanding (DSO)",
    expression: "ar.total / avg3.pl.revenue * 30",
    unit: "days",
    description:
      "Average days to collect. Outstanding receivables divided by trailing three-month average revenue.",
    benchmark: { max: 45, note: "Over 45 days means cash is sitting in customers' hands." },
    sortOrder: 60,
  },
  {
    id: "dso_point",
    label: "Days sales outstanding (this month)",
    expression: "ar.total / pl.revenue * 30",
    unit: "days",
    description:
      "The same calculation on the selected month's revenue alone. A wide gap against the headline means the month was not typical.",
    sortOrder: 61,
  },
  {
    id: "dpo",
    label: "Days payable outstanding (DPO)",
    expression: "ap.total / ((avg3.pl.cogs + avg3.pl.overhead)) * 30",
    unit: "days",
    description:
      "Average days taken to pay suppliers. Outstanding payables divided by trailing three-month average operating spend.",
    sortOrder: 70,
  },
  {
    id: "dpo_point",
    label: "Days payable outstanding (this month)",
    expression: "ap.total / ((pl.cogs + pl.overhead)) * 30",
    unit: "days",
    description:
      "The same calculation on the selected month's operating spend alone.",
    sortOrder: 71,
  },
];
