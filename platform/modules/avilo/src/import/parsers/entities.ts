// Sales-by-customer and referral parsers.
//
// Both reduce to the same shape: a label column plus one or more numeric columns, with
// a Total row to discard. They are handled by one routine parameterised by what the
// label and the numbers mean.
//
// The v9 build inferred a job count from PDF text and got it wrong often enough that the
// "# of jobs" card was removed and restored twice. Here the count is taken from an
// explicit column when the export has one, and otherwise reported as absent rather than
// guessed — a missing number the user can supply beats a confident wrong one.

import type { Period } from "../../periods.js";
import { cellText, isBlank, parseNumber, rowLabel } from "../cells.js";
import { collapseTotalGroups, isGrandTotalRow } from "../grouping.js";
import type { ExtractedFact, Grid, ParseResult, ReportType } from "../types.js";

export interface EntityRow {
  label: string;
  value: number;
  /** Present only when the export carries an explicit count column. */
  count: number | null;
}

export interface EntityParseResult extends ParseResult {
  entities: EntityRow[];
  /** True when a transaction/job count column was actually present. */
  hasExplicitCount: boolean;
}

const AMOUNT_HEADER = /^(total|amount|sales|income|revenue|balance)$/i;
const COUNT_HEADER = /^(count|transactions|# of jobs|jobs|no\.? of jobs|invoices)$/i;

interface Layout {
  headerRow: number;
  labelColumn: number;
  amountColumn: number;
  countColumn: number | null;
  ignored: string[];
}

function findLayout(grid: Grid, scanRows = 25): Layout | null {
  for (let r = 0; r < Math.min(grid.length, scanRows); r += 1) {
    const row = grid[r];
    if (!row) continue;

    let amountColumn: number | null = null;
    let countColumn: number | null = null;
    let labelColumn: number | null = null;
    const ignored: string[] = [];

    /*
      The label column is the leftmost column that is not an amount or a count — and it
      is almost always the one with a BLANK header, because QuickBooks does not name it.

      Skipping blank headers before choosing the label column is what broke the customer
      ranking: on a Sales by Customer Summary the header is ["", "Jul 2025", …, "Total"],
      so the label column became "Jul 2025" and every customer was labelled with their
      July figure. The grand total row read as a customer called "20200" worth $1.3m.
    */
    for (let c = 0; c < row.length; c += 1) {
      const text = cellText(row[c] ?? null);
      if (text !== "" && COUNT_HEADER.test(text)) {
        countColumn = c;
        continue;
      }
      if (text !== "" && AMOUNT_HEADER.test(text)) {
        // Prefer the leftmost amount column: QuickBooks puts "Total" last and a
        // percentage column after it.
        if (amountColumn === null) amountColumn = c;
        continue;
      }
      if (labelColumn === null) labelColumn = c;
      else if (text !== "") ignored.push(text);
    }

    if (amountColumn !== null) {
      return {
        headerRow: r,
        labelColumn: labelColumn ?? 0,
        amountColumn,
        countColumn,
        ignored,
      };
    }
  }

  // No recognisable header: fall back to "first text column, last numeric column".
  for (let r = 0; r < Math.min(grid.length, scanRows); r += 1) {
    const row = grid[r];
    if (!row) continue;
    let numeric: number | null = null;
    for (let c = row.length - 1; c >= 0; c -= 1) {
      if (parseNumber(row[c] ?? null) !== null) {
        numeric = c;
        break;
      }
    }
    if (numeric !== null && rowLabel(row) !== "") {
      return {
        headerRow: r - 1,
        labelColumn: 0,
        amountColumn: numeric,
        countColumn: null,
        ignored: [],
      };
    }
  }

  return null;
}

export interface ParseEntityOptions {
  period: Period;
  reportType: Extract<ReportType, "sales_by_customer_l12m" | "referral_l90d">;
  /** Account the grand total is written to. */
  totalAccountId?: string;
}

export function parseEntityReport(
  grid: Grid,
  options: ParseEntityOptions,
): EntityParseResult {
  const warnings: string[] = [];
  const layout = findLayout(grid);

  if (!layout) {
    return {
      reportType: options.reportType,
      periods: [],
      facts: [],
      unmatched: [],
      entities: [],
      hasExplicitCount: false,
      ignoredColumns: [],
      warnings: [
        "No amount column was found. Expected a column headed Total, Amount, Sales or Income.",
      ],
    };
  }

  const headerCells = grid[Math.max(layout.headerRow, 0)] ?? [];
  const buffered: { label: string; row: EntityRow | null }[] = [];
  let statedTotal: number | null = null;

  for (let r = Math.max(layout.headerRow, 0) + 1; r < grid.length; r += 1) {
    const row = grid[r];
    if (!row) continue;

    const label = cellText(row[layout.labelColumn] ?? null) || rowLabel(row);
    if (label === "") continue;

    // A bare label with no figures is a parent heading; keep it as a group marker so the
    // job lines beneath it have something to collapse into.
    const cell = row[layout.amountColumn] ?? null;
    const value = isBlank(cell) ? null : parseNumber(cell);
    if (value === null) {
      buffered.push({ label, row: null });
      continue;
    }

    if (isGrandTotalRow(label)) {
      statedTotal = value;
      continue;
    }

    const count =
      layout.countColumn === null
        ? null
        : parseNumber(row[layout.countColumn] ?? null);

    buffered.push({ label, row: { label, value, count } });
  }

  // One row per customer or partner: a job line belongs to the customer above it, and
  // "Total for <customer>" is that customer's real figure. See `../grouping.ts`.
  const entities = collapseTotalGroups(buffered).map(({ label, row }) => ({
    ...row,
    label,
  }));

  entities.sort((a, b) => b.value - a.value);

  const total = statedTotal ?? entities.reduce((sum, e) => sum + e.value, 0);
  const facts: ExtractedFact[] = [];
  const columnLabel =
    cellText(headerCells[layout.amountColumn] ?? null) || "Amount";

  if (options.totalAccountId) {
    facts.push({
      period: options.period,
      accountId: options.totalAccountId,
      value: total,
      sourceRowLabel: statedTotal === null ? "Total (summed from rows)" : "Total",
      sourceColumnLabel: columnLabel,
    });
  }

  if (options.reportType === "sales_by_customer_l12m") {
    facts.push({
      period: options.period,
      accountId: "ops.customer_count",
      value: entities.length,
      sourceRowLabel: "Distinct customers billed",
      sourceColumnLabel: columnLabel,
    });

    const explicitJobs = entities.reduce(
      (sum, e) => sum + (e.count ?? 0),
      0,
    );
    if (layout.countColumn !== null && explicitJobs > 0) {
      facts.push({
        period: options.period,
        accountId: "ops.job_count",
        value: explicitJobs,
        sourceRowLabel: "Summed from the export's job count column",
        sourceColumnLabel: cellText(headerCells[layout.countColumn] ?? null) || "Count",
      });
    } else {
      // The v9 build guessed here and was wrong repeatedly. Say so instead.
      warnings.push(
        "This export has no job or transaction count column, so jobs completed was not inferred. Enter it in Raw data if you need it.",
      );
    }
  }

  if (entities.length === 0) {
    warnings.push("An amount column was found but no data rows were read.");
  }

  return {
    reportType: options.reportType,
    periods: [options.period],
    facts,
    unmatched: [],
    entities,
    hasExplicitCount: layout.countColumn !== null,
    ignoredColumns: layout.ignored,
    warnings,
  };
}
