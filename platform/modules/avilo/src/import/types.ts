import type { Period } from "../periods.js";

/** A worksheet flattened to cells. Row 0 is the first row of the file. */
export type Cell = string | number | null;
export type Grid = Cell[][];

export const REPORT_TYPES = [
  "profit_and_loss",
  "balance_sheet",
  "ar_aging",
  "ap_aging",
  "referral_l90d",
  "sales_by_customer_l12m",
  "combined_group_report",
] as const;

export type ReportType = (typeof REPORT_TYPES)[number];

export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  profit_and_loss: "Profit & Loss",
  balance_sheet: "Balance Sheet",
  ar_aging: "A/R Ageing Summary",
  ap_aging: "A/P Ageing Summary",
  referral_l90d: "Referral Report (last 90 days)",
  sales_by_customer_l12m: "Sales by Customer (last 12 months)",
  combined_group_report: "Combined group report",
};

export interface ClassificationCandidate {
  reportType: ReportType;
  score: number;
  evidence: string[];
}

export interface Classification {
  reportType: ReportType | null;
  confidence: number;
  /** rules | local_llm | user */
  method: "rules" | "local_llm" | "user";
  evidence: string[];
  /** Ranked alternatives, so the review screen can offer a sensible dropdown. */
  candidates: ClassificationCandidate[];
  /** True when confidence is too low to import without the user confirming. */
  needsConfirmation: boolean;
}

/** A single number recovered from a source file, with full provenance. */
export interface ExtractedFact {
  period: Period;
  accountId: string;
  value: number;
  sourceRowLabel: string;
  sourceColumnLabel: string;
}

/** A row whose label matched no known account — the review screen's work list. */
export interface UnmatchedRow {
  rawLabel: string;
  normalizedLabel: string;
  /** Values by period, so the user can see what they would be mapping. */
  sampleValues: { period: Period; value: number }[];
}

export interface ParseResult {
  reportType: ReportType;
  periods: Period[];
  facts: ExtractedFact[];
  unmatched: UnmatchedRow[];
  /** Columns deliberately ignored, e.g. "Total". Surfaced so the user can see why. */
  ignoredColumns: string[];
  warnings: string[];
}

/** Resolves a normalised label to a canonical account id. Backed by `label_mappings`. */
export type LabelResolver = (
  normalizedLabel: string,
  reportType: ReportType,
) => string | null;
