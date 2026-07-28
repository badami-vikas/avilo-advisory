/**
 * Column-level aggregates for table footers.
 *
 * Numeric columns default to average, text columns to a count of distinct values.
 * Which aggregates are even offered depends on the column's data, so a text column
 * never advertises "sum".
 */

export type AggregateKind =
  | "average"
  | "sum"
  | "min"
  | "max"
  | "median"
  | "range"
  | "count"
  | "filled"
  | "empty"
  | "unique";

export const AGGREGATE_LABELS: Record<AggregateKind, string> = {
  average: "Average",
  sum: "Sum",
  min: "Min",
  max: "Max",
  median: "Median",
  range: "Range",
  count: "Count",
  filled: "Filled",
  empty: "Empty",
  unique: "Unique",
};

const NUMERIC_AGGREGATES: AggregateKind[] = [
  "average",
  "sum",
  "min",
  "max",
  "median",
  "range",
  "count",
  "filled",
  "empty",
  "unique",
];

const TEXT_AGGREGATES: AggregateKind[] = ["unique", "count", "filled", "empty"];

export function availableAggregates(numeric: boolean): AggregateKind[] {
  return numeric ? NUMERIC_AGGREGATES : TEXT_AGGREGATES;
}

export function defaultAggregate(numeric: boolean): AggregateKind {
  return numeric ? "average" : "unique";
}

function isEmpty(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "")
  );
}

export interface AggregateResult {
  kind: AggregateKind;
  /** null when the aggregate cannot be computed, e.g. average of nothing. */
  value: number | null;
  /** True when the result is a plain count rather than a value in the column's unit. */
  isCount: boolean;
}

/**
 * Compute an aggregate over a column's raw values.
 *
 * Empty cells are excluded from every statistic except `count`, `empty` and `filled` —
 * averaging a column where two of five clients have no data should average the three
 * that do, not treat the gaps as zero.
 */
export function computeAggregate(
  values: unknown[],
  kind: AggregateKind,
): AggregateResult {
  const countResult = (value: number): AggregateResult => ({
    kind,
    value,
    isCount: true,
  });

  switch (kind) {
    case "count":
      return countResult(values.length);
    case "empty":
      return countResult(values.filter(isEmpty).length);
    case "filled":
      return countResult(values.filter((v) => !isEmpty(v)).length);
    case "unique":
      return countResult(
        new Set(values.filter((v) => !isEmpty(v)).map((v) => String(v))).size,
      );
    default:
      break;
  }

  const numbers = values
    .filter((v) => !isEmpty(v))
    .map((v) => (typeof v === "number" ? v : Number(v)))
    .filter((n) => Number.isFinite(n));

  if (numbers.length === 0) return { kind, value: null, isCount: false };

  const sorted = [...numbers].sort((a, b) => a - b);
  const sum = numbers.reduce((total, n) => total + n, 0);

  switch (kind) {
    case "sum":
      return { kind, value: sum, isCount: false };
    case "average":
      return { kind, value: sum / numbers.length, isCount: false };
    case "min":
      return { kind, value: sorted[0]!, isCount: false };
    case "max":
      return { kind, value: sorted[sorted.length - 1]!, isCount: false };
    case "range":
      return { kind, value: sorted[sorted.length - 1]! - sorted[0]!, isCount: false };
    case "median": {
      const mid = Math.floor(sorted.length / 2);
      const median =
        sorted.length % 2 === 0
          ? ((sorted[mid - 1]! + sorted[mid]!) / 2)
          : sorted[mid]!;
      return { kind, value: median, isCount: false };
    }
    default:
      return { kind, value: null, isCount: false };
  }
}
