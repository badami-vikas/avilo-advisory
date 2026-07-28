// Balance Sheet parser.
//
// A balance sheet is a point-in-time statement, so unlike the P&L it usually carries a
// single "As of" date rather than month columns. Two shapes are handled: a dated column
// header, and a single unlabelled value column with the date in the report preamble.
//
// The v9 build's balance-sheet bug is designed out here: it let a later matching row
// silently overwrite an earlier correct value, so a detail line further down the sheet
// could clobber the section total. Here the first match for an account wins and a
// conflict is reported.

import { normalizeLabel } from "../../accounts.js";
import { parsePeriodHeader, type Period } from "../../periods.js";
import { cellText, isBlank, parseNumber, rowLabel } from "../cells.js";
import type { ExtractedFact, Grid, LabelResolver, ParseResult, UnmatchedRow } from "../types.js";

/**
 * Find the "as of" period from the report preamble.
 *
 * QuickBooks writes "As of October 31, 2024" or "As of 10/31/2024" above the table.
 */
export function findAsOfPeriod(grid: Grid, scanRows = 10): Period | null {
  for (const row of grid.slice(0, scanRows)) {
    for (const cell of row) {
      const text = cellText(cell);
      if (text === "") continue;

      const asOf = text.match(/as of\s+(.*)$/i);
      const candidate = asOf?.[1] ?? text;

      // "October 31, 2024" → strip the day so the month/year parser can read it.
      const monthYear = candidate.match(/([a-z]{3,9})\s+\d{1,2},?\s*(\d{4})/i);
      if (monthYear) {
        const parsed = parsePeriodHeader(`${monthYear[1]} ${monthYear[2]}`);
        if (parsed) return parsed;
      }

      // "10/31/2024"
      const numeric = candidate.match(/^(\d{1,2})\/\d{1,2}\/(\d{4})$/);
      if (numeric) {
        const parsed = parsePeriodHeader(`${numeric[1]}/${numeric[2]}`);
        if (parsed) return parsed;
      }

      const direct = parsePeriodHeader(candidate);
      if (direct) return direct;
    }
  }
  return null;
}

/** The rightmost column that holds numbers, for a sheet with no dated header. */
function findValueColumn(grid: Grid, startRow: number): number | null {
  const counts = new Map<number, number>();
  for (const row of grid.slice(startRow)) {
    for (let c = 0; c < row.length; c += 1) {
      if (parseNumber(row[c] ?? null) !== null) {
        counts.set(c, (counts.get(c) ?? 0) + 1);
      }
    }
  }
  let best: number | null = null;
  let bestCount = 0;
  for (const [column, count] of counts) {
    if (count > bestCount || (count === bestCount && best !== null && column > best)) {
      best = column;
      bestCount = count;
    }
  }
  return best;
}

const STRUCTURAL_ROW =
  /^(assets|liabilities|equity|current assets|bank accounts|other current assets|fixed assets|current liabilities|liabilities and equity|total liabilities and equity)$/i;

export interface ParseBalanceSheetOptions {
  resolveLabel: LabelResolver;
  /** Used when the file carries no date at all. */
  fallbackPeriod?: Period;
}

export function parseBalanceSheet(
  grid: Grid,
  options: ParseBalanceSheetOptions,
): ParseResult {
  const warnings: string[] = [];

  // A dated column header wins; otherwise fall back to the preamble date.
  let headerRow = -1;
  let valueColumn: number | null = null;
  let period: Period | null = null;

  /** A column only counts as a value column if numbers actually appear beneath it. */
  const columnHasNumbers = (column: number, below: number): boolean => {
    let seen = 0;
    for (const row of grid.slice(below + 1)) {
      if (parseNumber(row[column] ?? null) !== null) {
        seen += 1;
        if (seen >= 2) return true;
      }
    }
    return false;
  };

  outer: for (let r = 0; r < Math.min(grid.length, 25); r += 1) {
    const row = grid[r];
    if (!row) continue;
    for (let c = 0; c < row.length; c += 1) {
      const text = cellText(row[c] ?? null);

      // "As of October 31, 2024" is the report preamble, not a column header. It
      // parses as a period, so without this guard the label column itself was
      // selected as the value column and every figure came back empty.
      if (/\bas of\b/i.test(text)) continue;

      const parsed = parsePeriodHeader(text);
      if (parsed && columnHasNumbers(c, r)) {
        headerRow = r;
        valueColumn = c;
        period = parsed;
        break outer;
      }
    }
  }

  if (period === null) {
    period = findAsOfPeriod(grid);
    headerRow = 0;
  }
  if (period === null && options.fallbackPeriod) {
    period = options.fallbackPeriod;
    warnings.push(
      `No date found in the file; values were recorded against ${options.fallbackPeriod}.`,
    );
  }

  if (period === null) {
    return {
      reportType: "balance_sheet",
      periods: [],
      facts: [],
      unmatched: [],
      ignoredColumns: [],
      warnings: [
        "No 'as of' date could be read from this balance sheet, so its values cannot be attributed to a period. Check that the export includes its report header.",
      ],
    };
  }

  if (valueColumn === null) {
    valueColumn = findValueColumn(grid, Math.max(headerRow, 0) + 1);
  }
  if (valueColumn === null) {
    return {
      reportType: "balance_sheet",
      periods: [],
      facts: [],
      unmatched: [],
      ignoredColumns: [],
      warnings: ["No numeric column was found in this balance sheet."],
    };
  }

  const columnLabel =
    cellText(grid[Math.max(headerRow, 0)]?.[valueColumn] ?? null) || `As of ${period}`;

  const facts: ExtractedFact[] = [];
  const unmatchedByLabel = new Map<string, UnmatchedRow>();

  /**
   * Two rows can legitimately map to the same account: QuickBooks prints a detail line
   * ("Accounts Receivable (A/R)") and then a section total ("Total for Accounts
   * Receivable"). The total is authoritative — a section with several detail lines
   * would otherwise be represented by whichever line happened to appear first.
   *
   * So matches are ranked rather than taken first-come, and only an equal-or-lower rank
   * collision is reported as a genuine ambiguity.
   */
  const claimed = new Map<string, { label: string; rank: number; index: number }>();
  const rankOf = (normalized: string): number =>
    /^total\b/.test(normalized) ? 2 : 1;

  for (let r = Math.max(headerRow, 0) + 1; r < grid.length; r += 1) {
    const row = grid[r];
    if (!row) continue;

    const label = rowLabel(row);
    if (label === "") continue;
    const normalized = normalizeLabel(label);
    if (normalized === "") continue;

    const cell = row[valueColumn] ?? null;
    if (isBlank(cell)) continue;
    const value = parseNumber(cell);
    if (value === null) continue;

    const accountId = options.resolveLabel(normalized, "balance_sheet");

    if (accountId) {
      const rank = rankOf(normalized);
      const existing = claimed.get(accountId);

      if (existing) {
        if (rank > existing.rank) {
          // A section total supersedes a detail line, quietly: this is the expected
          // shape of a QuickBooks balance sheet, not an anomaly worth warning about.
          facts[existing.index] = {
            period,
            accountId,
            value,
            sourceRowLabel: label,
            sourceColumnLabel: columnLabel,
          };
          claimed.set(accountId, { label, rank, index: existing.index });
          continue;
        }

        // Same rank, different row: a genuine ambiguity. The v9 defect was letting the
        // later row silently overwrite the earlier one, so keep the first and say so.
        if (rank === existing.rank) {
          warnings.push(
            `"${label}" also maps to ${accountId}, which was already set from "${existing.label}". The first value was kept.`,
          );
        }
        continue;
      }

      claimed.set(accountId, { label, rank, index: facts.length });
      facts.push({
        period,
        accountId,
        value,
        sourceRowLabel: label,
        sourceColumnLabel: columnLabel,
      });
      continue;
    }

    if (STRUCTURAL_ROW.test(normalized)) continue;
    if (unmatchedByLabel.has(normalized)) continue;
    unmatchedByLabel.set(normalized, {
      rawLabel: label,
      normalizedLabel: normalized,
      sampleValues: [{ period, value }],
    });
  }

  return {
    reportType: "balance_sheet",
    periods: [period],
    facts,
    unmatched: [...unmatchedByLabel.values()],
    ignoredColumns: [],
    warnings,
  };
}
