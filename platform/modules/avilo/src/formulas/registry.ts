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

/**
 * Days Cash on Hand uses the corrected denominator agreed in the v9 review:
 * cash / ((COGS + overhead) / 365). The prototype originally shipped a different
 * denominator and it was explicitly corrected during the session.
 */
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
  {
    id: "days_cash_on_hand",
    label: "Days cash on hand",
    expression: "bs.cash / ((pl.cogs + pl.overhead) / 365)",
    unit: "days",
    description:
      "Total cash in bank accounts divided by average daily operating spend.",
    benchmark: { min: 30, note: "Under 30 days of runway is a liquidity risk." },
    sortOrder: 50,
  },
  /**
   * Collection and payment timing.
   *
   * Both use a 30-day month rather than 365/12, because the numerator is a
   * point-in-time balance from an ageing report and the denominator is a single
   * month's activity from the P&L. Mixing a monthly figure with an annual divisor is
   * the kind of unit mismatch that produces a plausible-looking number that is wrong
   * by a factor of twelve.
   */
  {
    id: "dso",
    label: "Days sales outstanding (DSO)",
    expression: "ar.total / pl.revenue * 30",
    unit: "days",
    description:
      "Average days to collect. Outstanding receivables divided by one month's revenue.",
    benchmark: { max: 45, note: "Over 45 days means cash is sitting in customers' hands." },
    sortOrder: 60,
  },
  {
    id: "dpo",
    label: "Days payable outstanding (DPO)",
    expression: "ap.total / ((pl.cogs + pl.overhead)) * 30",
    unit: "days",
    description:
      "Average days taken to pay suppliers. Outstanding payables divided by one month's operating spend.",
    sortOrder: 70,
  },
];
