import { describe, expect, it } from "vitest";
import {
  BUILTIN_LABEL_MAPPINGS,
  normalizeLabel,
} from "../src/accounts.js";
import { findColumnMap, parseProfitAndLoss } from "../src/import/parsers/profit-and-loss.js";
import { classifyGrid } from "../src/import/classify.js";
import type { Grid, LabelResolver, ReportType } from "../src/import/types.js";

/** Resolver backed by the built-in dialect table, as the app does before any learning. */
const builtinResolver: LabelResolver = (normalized, reportType) =>
  BUILTIN_LABEL_MAPPINGS.find(
    (m) => m.reportType === reportType && m.normalizedLabel === normalized,
  )?.accountId ?? null;

/** Resolver that also honours user-taught mappings, as it does after a correction. */
function resolverWithLearned(learned: Record<string, string>): LabelResolver {
  return (normalized, reportType) =>
    learned[normalized] ?? builtinResolver(normalized, reportType);
}

/**
 * A QuickBooks Online P&L export, reproduced with the details that defeated the v9
 * parser: preamble rows above the header, the "Total for X" label family, a trailing
 * "Total" column, a "% of Income" column, and accounting-style negatives.
 */
const QBO_PL: Grid = [
  ["Phoenix Restoration Co.", null, null, null, null],
  ["Profit and Loss", null, null, null, null],
  ["October 2023 - October 2024", null, null, null, null],
  [null, "Oct 2023", "Sep 2024", "Oct 2024", "Total"],
  ["Income", null, null, null, null],
  ["  Restoration Services", 140_000, 168_000, "$182,400.00", 490_400],
  ["  Reconstruction", 22_000, 26_000, "$21,600.00", 69_600],
  ["Total for Income", 162_000, 194_000, "$204,000.00", 560_000],
  ["Cost of Goods Sold", null, null, null, null],
  ["  Subcontractors", 61_000, 74_000, "$79,000.00", 214_000],
  ["  Materials", 38_000, 41_000, "$43,000.00", 122_000],
  ["  Equipment Rental", null, null, "-", null],
  ["Total for Cost of Goods Sold", 99_000, 115_000, "$122,000.00", 336_000],
  ["Gross Profit", 63_000, 79_000, "$82,000.00", 224_000],
  ["Expenses", null, null, null, null],
  ["  Payroll", 30_000, 33_000, "$34,000.00", 97_000],
  ["  Insurance", 4_000, 4_200, "$4,300.00", 12_500],
  ["  Depreciation & Amortization", 2_000, 2_000, "$2,000.00", 6_000],
  ["  Franchisor Fee", 0, 0, 0, 0],
  ["  Bad Debt", null, null, "(1,500.00)", null],
  ["Total for Expenses", 36_000, 39_200, "$38,800.00", 114_000],
  ["Net Operating Income", 27_000, 39_800, "$43,200.00", 110_000],
];

describe("classifyGrid", () => {
  it("identifies a QuickBooks P&L with high confidence and no user prompt", () => {
    const result = classifyGrid({ filename: "PandL_Oct2024.xlsx", grid: QBO_PL });
    expect(result.reportType).toBe<ReportType>("profit_and_loss");
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    expect(result.needsConfirmation).toBe(false);
    expect(result.evidence.join(" ")).toMatch(/profit and loss/i);
  });

  it("still identifies the report when the file has been renamed unhelpfully", () => {
    const result = classifyGrid({ filename: "export (3).xlsx", grid: QBO_PL });
    expect(result.reportType).toBe("profit_and_loss");
  });

  it("asks the user rather than guessing on an unrecognisable file", () => {
    const result = classifyGrid({
      filename: "notes.xlsx",
      grid: [["hello", "world"], ["a", 1]],
    });
    expect(result.reportType).toBeNull();
    expect(result.needsConfirmation).toBe(true);
  });
});

describe("findColumnMap", () => {
  it("finds the header row beneath the report preamble", () => {
    expect(findColumnMap(QBO_PL)?.headerRow).toBe(3);
  });

  it("maps every month column and excludes the trailing Total column", () => {
    const map = findColumnMap(QBO_PL);
    expect([...(map?.periods.values() ?? [])].sort()).toEqual([
      "2023-10",
      "2024-09",
      "2024-10",
    ]);
    expect(map?.ignored).toContain("Total");
  });
});

describe("parseProfitAndLoss", () => {
  const parse = (resolver: LabelResolver = builtinResolver, onlyPeriods?: string[]) =>
    parseProfitAndLoss(QBO_PL, { resolveLabel: resolver, onlyPeriods });

  // The headline v9 regression: "Total for Income" did not match a regex expecting
  // "Total Income", so revenue, COGS and overhead all came back empty.
  it("resolves the 'Total for X' label family that broke the prototype", () => {
    const result = parse();
    const oct = result.facts.filter((f) => f.period === "2024-10");
    expect(oct.find((f) => f.accountId === "pl.revenue")?.value).toBe(204_000);
    expect(oct.find((f) => f.accountId === "pl.cogs")?.value).toBe(122_000);
    expect(oct.find((f) => f.accountId === "pl.overhead")?.value).toBe(38_800);
  });

  // The second v9 regression: reading `row.length - 1` selected the Total column.
  it("never reads the Total column as a reporting month", () => {
    const result = parse();
    expect(result.facts.every((f) => f.sourceColumnLabel !== "Total")).toBe(true);
    expect(result.facts.some((f) => f.value === 560_000)).toBe(false);
    expect(result.ignoredColumns).toContain("Total");
  });

  // The third: prior-year and prior-month were read by hard-coded column index.
  it("extracts every period in the file so comparatives need no index arithmetic", () => {
    const result = parse();
    expect(result.periods).toEqual(["2023-10", "2024-09", "2024-10"]);
    const priorYear = result.facts.find(
      (f) => f.period === "2023-10" && f.accountId === "pl.revenue",
    );
    expect(priorYear?.value).toBe(162_000);
  });

  it("parses currency strings, accounting negatives and dash-as-zero", () => {
    const result = parse();
    const oct = result.facts.filter((f) => f.period === "2024-10");
    // "$204,000.00" → 204000
    expect(oct.find((f) => f.accountId === "pl.revenue")?.value).toBe(204_000);
    // "(1,500.00)" is an unmapped line, so it surfaces for mapping with a negative value.
    const badDebt = result.unmatched.find((u) => u.rawLabel === "Bad Debt");
    expect(badDebt?.sampleValues[0]?.value).toBe(-1_500);
  });

  it("records provenance for every fact", () => {
    const fact = parse().facts.find(
      (f) => f.period === "2024-10" && f.accountId === "pl.revenue",
    );
    expect(fact?.sourceRowLabel).toBe("Total for Income");
    expect(fact?.sourceColumnLabel).toBe("Oct 2024");
  });

  it("reports unmapped detail rows for the review screen without failing the import", () => {
    const result = parse();
    const labels = result.unmatched.map((u) => u.rawLabel);
    expect(labels).toContain("Restoration Services");
    expect(labels).toContain("Subcontractors");
    // Structural rows are not offered for mapping — they are not user data.
    expect(labels).not.toContain("Income");
    expect(labels).not.toContain("Gross Profit");
  });

  it("applies a learned mapping so a correction is made once and never again", () => {
    const learned = { [normalizeLabel("Restoration Services")]: "pl.revenue" };
    const before = parse().unmatched.map((u) => u.rawLabel);
    expect(before).toContain("Restoration Services");

    const after = parse(resolverWithLearned(learned));
    expect(after.unmatched.map((u) => u.rawLabel)).not.toContain(
      "Restoration Services",
    );
  });

  it("keeps the first match and warns when two rows map to the same account", () => {
    const learned = {
      [normalizeLabel("Restoration Services")]: "pl.revenue",
      [normalizeLabel("Reconstruction")]: "pl.revenue",
    };
    const result = parse(resolverWithLearned(learned));
    const octRevenue = result.facts.filter(
      (f) => f.period === "2024-10" && f.accountId === "pl.revenue",
    );
    expect(octRevenue).toHaveLength(1);
    expect(result.warnings.join(" ")).toMatch(/duplicate value for pl\.revenue/);
  });

  it("honours a period restriction", () => {
    const result = parse(builtinResolver, ["2024-10"]);
    expect(result.periods).toEqual(["2024-10"]);
    expect(result.facts.every((f) => f.period === "2024-10")).toBe(true);
  });

  it("warns instead of throwing when the requested period is absent", () => {
    const result = parse(builtinResolver, ["2025-06"]);
    expect(result.facts).toHaveLength(0);
    expect(result.warnings.join(" ")).toMatch(/not present in this file/);
  });

  it("reports a clear failure when no period columns exist at all", () => {
    const result = parseProfitAndLoss(
      [["Account", "Amount"], ["Total for Income", 100]],
      { resolveLabel: builtinResolver },
    );
    expect(result.facts).toHaveLength(0);
    expect(result.warnings[0]).toMatch(/No period columns found/);
  });
});
