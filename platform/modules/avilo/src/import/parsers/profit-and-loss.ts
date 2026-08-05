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
import { totalRowSubject } from "../grouping.js";
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

  /*
    Candidates per (period, account), resolved after the walk rather than during it.

    First-match-wins was wrong, and wrong in a way that quietly produced a plausible
    number. A chart of accounts has many rows feeding one canonical account — several
    income lines, dozens of expense lines — and QuickBooks prints a section total
    alongside them. Keeping whichever row happened to appear first meant revenue could
    come out as the "Discounts given" line (-1,000) while the real total sat ten rows
    below, and overhead could read a few hundred pounds when every expense row had been
    mapped to it.

    The rule, matching the balance-sheet parser: a section total is authoritative and
    wins outright; failing that, the detail rows are SUMMED, because that is what a set
    of sibling accounts under one heading means.
  */
  const candidates = new Map<
    string,
    { period: Period; accountId: string; rank: number; label: string; columnLabel: string; value: number }[]
  >();

  /*
    Tracks which section of the statement the walker is currently inside, so a detail line
    can be attributed to Income, COGS or Expenses without matching its own label.

    `sectionLabel` is what closes it, and it has to be: ANY total row used to close the
    section, but an expense list is full of sub-group totals —

        Bank Charges & Fees / Credit Card rewards / Total for Bank Charges & Fees
        Car & Truck / Repair & Maintenance        / Total for Car & Truck

    — so the section closed at the first sub-group and the thirty expense lines below it
    were never captured. Top Expenses showed two rows, one of them a negative credit-card
    rebate ranked as the smallest expense. Only "Total for Expenses" closes Expenses.
  */
  let section: PLSection = null;
  let sectionLabel = "";

  for (let r = columnMap.headerRow + 1; r < grid.length; r += 1) {
    const row = grid[r];
    if (!row) continue;

    const label = rowLabel(row);
    if (label === "") continue;

    const normalized = normalizeLabel(label);
    if (normalized === "") continue;

    const sectionHeader = SECTION_HEADERS.find((s) => s.pattern.test(normalized));
    const totalSubject = totalRowSubject(normalized);

    if (sectionHeader) {
      section = sectionHeader.section;
      sectionLabel = normalized;
    } else if (
      totalSubject !== null &&
      (totalSubject === "" || totalSubject === sectionLabel)
    ) {
      // Only the section's own total closes it; a sub-group total does not.
      section = null;
      sectionLabel = "";
    }

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
    // A sub-group total (`Total for Payroll Expenses`) would double-count against the
    // children it covers, and a structural row (`Gross Profit`) is not an expense at all.
    if (
      section !== null &&
      !sectionHeader &&
      totalSubject === null &&
      !STRUCTURAL_ROW.test(normalized)
    ) {
      detailLines.push({
        label,
        section,
        amounts: values.map(({ period, value }) => ({ period, value })),
      });
    }

    if (accountId) {
      /** A "Total …" row is a section total (rank 2); anything else is a detail line. */
      const rank = totalSubject === null ? 1 : 2;
      for (const entry of values) {
        const key = `${entry.period}|${accountId}`;
        const list = candidates.get(key) ?? [];
        list.push({
          period: entry.period,
          accountId,
          rank,
          label,
          columnLabel: entry.columnLabel,
          value: entry.value,
        });
        candidates.set(key, list);
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

  /*
    Resolve each account's value from the rows that claimed it.

    A section total wins outright — it already includes its children, so adding them
    would double-count. With no total present, the details are summed, which is what a
    group of sibling accounts under one heading adds up to. Two competing totals is a
    genuine ambiguity and is reported rather than guessed at.
  */
  for (const list of candidates.values()) {
    const totals = list.filter((c) => c.rank === 2);
    const chosen = totals.length > 0 ? totals : list;
    const first = chosen[0]!;

    if (totals.length > 1) {
      warnings.push(
        `Two section totals both map to ${first.accountId} in ${first.period} ` +
          `("${totals.map((t) => t.label).join('", "')}"). The first was used.`,
      );
    }

    const value =
      totals.length > 0
        ? first.value
        : chosen.reduce((sum, candidate) => sum + candidate.value, 0);

    facts.push({
      period: first.period,
      accountId: first.accountId,
      value,
      sourceRowLabel:
        chosen.length > 1 && totals.length === 0
          ? `${chosen.length} rows summed (${chosen.map((c) => c.label).slice(0, 3).join(", ")}${chosen.length > 3 ? ", …" : ""})`
          : first.label,
      sourceColumnLabel: first.columnLabel,
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
