// A/R and A/P ageing parser.
//
// Both reports share a shape: one row per customer or vendor, one column per ageing
// bucket, plus a Total column and a Total row.
//
// The v9 build had two defects here, both structural rather than incidental:
//   * The 31–60 bucket came back empty because a cloud model misread the column
//     positions from a PDF. Here buckets are matched from their header text.
//   * "Who owes you" printed a computed day count the model could not actually know.
//     Here each customer carries the bucket the report itself placed them in.

import { matchAgingBucket, type AgingBucketId } from "../../accounts.js";
import type { Period } from "../../periods.js";
import { cellText, isBlank, parseNumber, rowLabel } from "../cells.js";
import type { ExtractedFact, Grid, ParseResult, ReportType } from "../types.js";

export interface AgingEntity {
  label: string;
  /** The bucket holding the largest outstanding amount — how the row is presented. */
  bucket: AgingBucketId | "total";
  bucketAmounts: Partial<Record<AgingBucketId, number>>;
  total: number;
}

export interface AgingParseResult extends ParseResult {
  entities: AgingEntity[];
}

interface BucketColumns {
  headerRow: number;
  buckets: Map<number, AgingBucketId>;
  totalColumn: number | null;
  ignored: string[];
}

export function findBucketColumns(grid: Grid, scanRows = 25): BucketColumns | null {
  let best: BucketColumns | null = null;

  for (let r = 0; r < Math.min(grid.length, scanRows); r += 1) {
    const row = grid[r];
    if (!row) continue;

    const buckets = new Map<number, AgingBucketId>();
    const ignored: string[] = [];
    let totalColumn: number | null = null;

    for (let c = 0; c < row.length; c += 1) {
      const text = cellText(row[c] ?? null);
      if (text === "") continue;
      const bucket = matchAgingBucket(text);
      if (bucket) {
        buckets.set(c, bucket);
        continue;
      }
      if (/^total$/i.test(text)) {
        totalColumn = c;
        continue;
      }
      ignored.push(text);
    }

    if (buckets.size === 0) continue;
    if (!best || buckets.size > best.buckets.size) {
      best = { headerRow: r, buckets, totalColumn, ignored };
    }
  }

  return best;
}

const TOTAL_ROW = /^total$/i;

export interface ParseAgingOptions {
  /** The period this ageing snapshot belongs to. */
  period: Period;
  reportType: Extract<ReportType, "ar_aging" | "ap_aging">;
}

export function parseAging(grid: Grid, options: ParseAgingOptions): AgingParseResult {
  const warnings: string[] = [];
  const prefix = options.reportType === "ar_aging" ? "ar" : "ap";
  const columns = findBucketColumns(grid);

  if (!columns) {
    return {
      reportType: options.reportType,
      periods: [],
      facts: [],
      unmatched: [],
      entities: [],
      ignoredColumns: [],
      warnings: [
        "No ageing buckets found. Expected columns such as Current, 1–30, 31–60, 61–90, 91 and over.",
      ],
    };
  }

  const headerCells = grid[columns.headerRow] ?? [];
  const entities: AgingEntity[] = [];
  const bucketTotals = new Map<AgingBucketId, number>();
  let grandTotal: number | null = null;
  let totalRowLabel = "";

  for (let r = columns.headerRow + 1; r < grid.length; r += 1) {
    const row = grid[r];
    if (!row) continue;
    const label = rowLabel(row);
    if (label === "") continue;

    const bucketAmounts: Partial<Record<AgingBucketId, number>> = {};
    let rowTotal = 0;
    let sawValue = false;

    for (const [columnIndex, bucket] of columns.buckets) {
      const cell = row[columnIndex] ?? null;
      if (isBlank(cell)) continue;
      const value = parseNumber(cell);
      if (value === null) continue;
      sawValue = true;
      bucketAmounts[bucket] = value;
      rowTotal += value;
    }

    if (columns.totalColumn !== null) {
      const stated = parseNumber(row[columns.totalColumn] ?? null);
      if (stated !== null) {
        sawValue = true;
        // Trust the report's own total over the sum of buckets; a rounding difference
        // is the report's, not ours to invent.
        rowTotal = stated;
      }
    }

    if (!sawValue) continue;

    if (TOTAL_ROW.test(label.trim())) {
      grandTotal = rowTotal;
      totalRowLabel = label;
      for (const [bucket, amount] of Object.entries(bucketAmounts)) {
        bucketTotals.set(bucket as AgingBucketId, amount as number);
      }
      continue;
    }

    // Present the bucket carrying the most money — the honest answer to "how late is
    // this customer", and one the report actually supports.
    let worst: AgingBucketId | "total" = "total";
    let worstAmount = -Infinity;
    for (const [bucket, amount] of Object.entries(bucketAmounts)) {
      if ((amount as number) > worstAmount) {
        worstAmount = amount as number;
        worst = bucket as AgingBucketId;
      }
    }

    entities.push({ label, bucket: worst, bucketAmounts, total: rowTotal });
  }

  // No Total row: derive bucket totals by summing the entities.
  if (bucketTotals.size === 0) {
    for (const entity of entities) {
      for (const [bucket, amount] of Object.entries(entity.bucketAmounts)) {
        bucketTotals.set(
          bucket as AgingBucketId,
          (bucketTotals.get(bucket as AgingBucketId) ?? 0) + (amount as number),
        );
      }
    }
  }
  if (grandTotal === null) {
    grandTotal = entities.reduce((sum, entity) => sum + entity.total, 0);
  }

  const columnLabelFor = (bucket: AgingBucketId): string => {
    for (const [index, id] of columns.buckets) {
      if (id === bucket) return cellText(headerCells[index] ?? null) || bucket;
    }
    return bucket;
  };

  const facts: ExtractedFact[] = [];
  for (const [bucket, amount] of bucketTotals) {
    facts.push({
      period: options.period,
      accountId: `${prefix}.${bucket}`,
      value: amount,
      sourceRowLabel: totalRowLabel || "Total (summed from rows)",
      sourceColumnLabel: columnLabelFor(bucket),
    });
  }
  facts.push({
    period: options.period,
    accountId: `${prefix}.total`,
    value: grandTotal,
    sourceRowLabel: totalRowLabel || "Total (summed from rows)",
    sourceColumnLabel: "Total",
  });

  if (entities.length === 0) {
    warnings.push(
      "Bucket columns were found but no customer or vendor rows were read. Check the export is a summary rather than a detail report.",
    );
  }

  return {
    reportType: options.reportType,
    periods: [options.period],
    facts,
    unmatched: [],
    entities,
    ignoredColumns: columns.ignored,
    warnings,
  };
}
