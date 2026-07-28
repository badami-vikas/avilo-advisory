// Profit & Loss parser.
//
// Three defects from the v7→v9 build are structurally excluded here:
//
//  1. "Total" column selected instead of the reporting month. The prototype found the
//     current month with `row.length - 1`, which lands on QuickBooks' trailing Total
//     column. Here columns are identified by parsing their header into a period;
//     anything that is not a period is recorded in `ignoredColumns` and never read.
//
//  2. Prior-year / prior-month read by hard-coded index (col 1, col 12, col 13). Here
//     EVERY period column in the file is extracted, so comparatives are queries against
//     the fact store rather than assumptions about column order. A 13-column L13M export
//     yields 13 months in one import.
//
//  3. "Total for Income" not matching a regex expecting "Total Income", silently
//     yielding an empty report. Here resolution goes through an injected LabelResolver
//     backed by a database table; an unmatched row is reported in `unmatched` for the
//     user to map, and the mapping is remembered.

import { normalizeLabel } from "../../accounts.js";
import { parsePeriodHeader, type Period } from "../../periods.js";
import { cellText, isBlank, parseNumber, rowLabel } from "../cells.js";
import type {
  ExtractedFact,
  Grid,
  LabelResolver,
  ParseResult,
  UnmatchedRow,
} from "../types.js";

interface ColumnMap {
  headerRow: number;
  /** column index -> period */
  periods: Map<number, Period>;
  /** header text of columns deliberately skipped */
  ignored: string[];
}

/**
 * Locate the header row by finding the row that parses the most period headers.
 *
 * Scanning rather than assuming a fixed row number: QuickBooks puts a company name, a
 * report title and a date range above the header, and how many of those rows exist
 * varies with export settings.
 */
export function findColumnMap(grid: Grid, scanRows = 30): ColumnMap | null {
  let best: ColumnMap | null = null;

  for (let r = 0; r < Math.min(grid.length, scanRows); r += 1) {
    const row = grid[r];
    if (!row) continue;

    const periods = new Map<number, Period>();
    const ignored: string[] = [];

    for (let c = 0; c < row.length; c += 1) {
      const text = cellText(row[c] ?? null);
      if (text === "") continue;
      const period = parsePeriodHeader(text);
      if (period) periods.set(c, period);
      else ignored.push(text);
    }

    if (periods.size === 0) continue;
    if (!best || periods.size > best.periods.size) {
      best = { headerRow: r, periods, ignored };
    }
  }

  return best;
}

/**
 * Rows that are structure, not data. Excluded from the unmatched list so the review
 * screen shows only rows a human could plausibly want to map.
 */
const STRUCTURAL_ROW = /^(income|revenue|expenses?|operating expenses?|cost of goods sold|cost of sales|other income|other expenses?|gross profit|net income|net operating income|net other income)$/i;

/** Section headers that switch the parser's context as it walks down the sheet. */
const SECTION_HEADERS: { pattern: RegExp; section: PLSection }[] = [
  { pattern: /^(income|revenue|operating income)$/i, section: "income" },
  { pattern: /^(cost of goods sold|cost of sales|cogs)$/i, section: "cogs" },
  { pattern: /^(expenses|operating expenses|overhead)$/i, section: "expense" },
  { pattern: /^other income$/i, section: "other" },
  { pattern: /^other expenses?$/i, section: "other" },
];

export type PLSection = "income" | "cogs" | "expense" | "other" | null;

/** A detail line under a section, e.g. one expense account. */
export interface PLDetailLine {
  label: string;
  section: Exclude<PLSection, null>;
  /** Amount per period. */
  amounts: { period: Period; value: number }[];
}

export interface ParsePLOptions {
  resolveLabel: LabelResolver;
  /** Restrict extraction to these periods. Omit to take every period in the file. */
  onlyPeriods?: Period[];
}

export interface PLParseResult extends ParseResult {
  /** Detail lines by section — what the Top Expenses panel renders. */
  detailLines: PLDetailLine[];
}

export function parseProfitAndLoss(
  grid: Grid,
  options: ParsePLOptions,
): PLParseResult {
  const warnings: string[] = [];
  const columnMap = findColumnMap(grid);

  if (!columnMap) {
    return {
      reportType: "profit_and_loss",
      periods: [],
      facts: [],
      unmatched: [],
      detailLines: [],
      ignoredColumns: [],
      warnings: [
        "No period columns found. The header row could not be identified — check that the export includes month columns.",
      ],
    };
  }

  const wanted = options.onlyPeriods ? new Set(options.onlyPeriods) : null;
  const columns = [...columnMap.periods.entries()]
    .filter(([, period]) => !wanted || wanted.has(period))
    .sort((a, b) => a[0] - b[0]);

  if (columns.length === 0) {
    warnings.push(
      "The requested periods are not present in this file. Available: " +
        [...new Set(columnMap.periods.values())].sort().join(", "),
    );
  }

  const headerRowCells = grid[columnMap.headerRow] ?? [];
  const facts: ExtractedFact[] = [];
  const unmatchedByLabel = new Map<string, UnmatchedRow>();
  const detailLines: PLDetailLine[] = [];
  const seen = new Set<string>();

  // Tracks which section of the statement the walker is currently inside, so a detail
  // line can be attributed to Income, COGS or Expenses without matching its own label.
  let section: PLSection = null;

  for (let r = columnMap.headerRow + 1; r < grid.length; r += 1) {
    const row = grid[r];
    if (!row) continue;

    const label = rowLabel(row);
    if (label === "") continue;

    const normalized = normalizeLabel(label);
    if (normalized === "") continue;

    const sectionHeader = SECTION_HEADERS.find((s) => s.pattern.test(normalized));
    if (sectionHeader) section = sectionHeader.section;
    // A "Total for X" row closes its section.
    else if (/^total for /.test(normalized) || /^total /.test(normalized)) section = null;

    const accountId = options.resolveLabel(normalized, "profit_and_loss");

    const values: { period: Period; value: number; columnLabel: string }[] = [];
    for (const [columnIndex, period] of columns) {
      const cell = row[columnIndex] ?? null;
      if (isBlank(cell)) continue;
      const value = parseNumber(cell);
      if (value === null) continue;
      values.push({
        period,
        value,
        columnLabel: cellText(headerRowCells[columnIndex] ?? null) || period,
      });
    }

    if (values.length === 0) continue;

    // Detail lines are captured regardless of whether the row also maps to a canonical
    // account: "Depreciation & Amortization" is both a mapped account and an expense
    // line the Top Expenses panel needs to know about in order to exclude it.
    if (section !== null && !sectionHeader) {
      detailLines.push({
        label,
        section,
        amounts: values.map(({ period, value }) => ({ period, value })),
      });
    }

    if (accountId) {
      for (const entry of values) {
        const key = `${entry.period}|${accountId}`;
        if (seen.has(key)) {
          // Two rows mapped to the same account in the same period. Keep the first and
          // say so, rather than letting a later row silently overwrite a correct value —
          // exactly the failure the balance-sheet parser hit in v9.
          warnings.push(
            `Ignored duplicate value for ${accountId} in ${entry.period} from row "${label}"; the first matching row was kept.`,
          );
          continue;
        }
        seen.add(key);
        facts.push({
          period: entry.period,
          accountId,
          value: entry.value,
          sourceRowLabel: label,
          sourceColumnLabel: entry.columnLabel,
        });
      }
      continue;
    }

    if (STRUCTURAL_ROW.test(normalized)) continue;

    const existing = unmatchedByLabel.get(normalized);
    if (existing) continue;
    unmatchedByLabel.set(normalized, {
      rawLabel: label,
      normalizedLabel: normalized,
      sampleValues: values.slice(0, 3).map(({ period, value }) => ({ period, value })),
    });
  }

  const periods = [...new Set(columns.map(([, p]) => p))].sort();

  return {
    reportType: "profit_and_loss",
    periods,
    facts,
    unmatched: [...unmatchedByLabel.values()],
    detailLines,
    ignoredColumns: columnMap.ignored,
    warnings,
  };
}
