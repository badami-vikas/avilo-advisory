import { describe, expect, it } from "vitest";
import { BUILTIN_LABEL_MAPPINGS, matchAgingBucket } from "../src/accounts.js";
import { findAsOfPeriod, parseBalanceSheet } from "../src/import/parsers/balance-sheet.js";
import { parseAging } from "../src/import/parsers/aging.js";
import { parseEntityReport } from "../src/import/parsers/entities.js";
import { parseProfitAndLoss } from "../src/import/parsers/profit-and-loss.js";
import { classifyGrid } from "../src/import/classify.js";
import type { Grid, LabelResolver } from "../src/import/types.js";

const builtinResolver: LabelResolver = (normalized, reportType) =>
  BUILTIN_LABEL_MAPPINGS.find(
    (m) => m.reportType === reportType && m.normalizedLabel === normalized,
  )?.accountId ?? null;

/* ---------------------------------------------------------- balance sheet */

const QBO_BALANCE_SHEET: Grid = [
  ["Phoenix Restoration Co."],
  ["Balance Sheet"],
  ["As of October 31, 2024"],
  [null, "Total"],
  ["ASSETS"],
  ["  Current Assets"],
  ["    Bank Accounts"],
  ["      Operating Checking", 71_500],
  ["      Payroll Savings", 13_500],
  ["    Total for Bank Accounts", 85_000],
  ["    Accounts Receivable"],
  ["      Accounts Receivable (A/R)", 142_300],
  ["    Total for Accounts Receivable", 142_300],
  ["  Total for Assets", 412_000],
  ["LIABILITIES AND EQUITY"],
  ["    Accounts Payable"],
  ["      Accounts Payable (A/P)", 68_400],
  ["    Total for Accounts Payable", 68_400],
  ["  Total for Liabilities", 190_000],
  ["  Total for Equity", 222_000],
];

describe("balance sheet", () => {
  it("reads the 'as of' date from the report preamble", () => {
    expect(findAsOfPeriod(QBO_BALANCE_SHEET)).toBe("2024-10");
  });

  it("parses several 'as of' date formats", () => {
    expect(findAsOfPeriod([["As of 10/31/2024"]])).toBe("2024-10");
    expect(findAsOfPeriod([["As of Oct 2024"]])).toBe("2024-10");
    expect(findAsOfPeriod([["Balance Sheet"], ["As of December 31, 2023"]])).toBe(
      "2023-12",
    );
  });

  it("resolves the 'Total for X' family to canonical accounts", () => {
    const result = parseBalanceSheet(QBO_BALANCE_SHEET, {
      resolveLabel: builtinResolver,
    });
    const value = (id: string) => result.facts.find((f) => f.accountId === id)?.value;
    expect(value("bs.cash")).toBe(85_000);
    expect(value("bs.ar")).toBe(142_300);
    expect(value("bs.ap")).toBe(68_400);
    expect(value("bs.total_assets")).toBe(412_000);
    expect(value("bs.equity")).toBe(222_000);
  });

  it("attributes every value to the report's period", () => {
    const result = parseBalanceSheet(QBO_BALANCE_SHEET, {
      resolveLabel: builtinResolver,
    });
    expect(result.periods).toEqual(["2024-10"]);
    expect(result.facts.every((f) => f.period === "2024-10")).toBe(true);
  });

  // The v9 defect: a later matching row silently overwrote a correct earlier value.
  it("keeps the first match at equal rank and warns instead of overwriting", () => {
    const withDuplicate: Grid = [
      ...QBO_BALANCE_SHEET,
      ["  Total for Bank Accounts", 999],
    ];
    const result = parseBalanceSheet(withDuplicate, { resolveLabel: builtinResolver });
    expect(result.facts.find((f) => f.accountId === "bs.cash")?.value).toBe(85_000);
    expect(result.warnings.join(" ")).toMatch(/first value was kept/i);
  });

  it("lets a section total supersede a detail line that maps to the same account", () => {
    // QuickBooks prints "Accounts Receivable (A/R)" then "Total for Accounts
    // Receivable". Taking whichever came first would mean a multi-line section is
    // represented by one of its lines.
    const grid: Grid = [
      ["Balance Sheet"],
      ["As of October 31, 2024"],
      [null, "Total"],
      ["  Accounts Receivable"],
      ["    Accounts Receivable (A/R)", 100_000],
      ["    Retainage Receivable", 42_300],
      ["  Total for Accounts Receivable", 142_300],
    ];
    const result = parseBalanceSheet(grid, { resolveLabel: builtinResolver });
    expect(result.facts.find((f) => f.accountId === "bs.ar")?.value).toBe(142_300);
    expect(result.facts.find((f) => f.accountId === "bs.ar")?.sourceRowLabel).toBe(
      "Total for Accounts Receivable",
    );
    // Not an anomaly — this is the normal shape, so it must not raise a warning.
    expect(result.warnings).toHaveLength(0);
  });

  it("produces exactly one fact per account", () => {
    const result = parseBalanceSheet(QBO_BALANCE_SHEET, {
      resolveLabel: builtinResolver,
    });
    const ids = result.facts.map((f) => f.accountId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("refuses to guess a period when the file carries no date", () => {
    const undated: Grid = [["Balance Sheet"], [null, "Total"], ["Total for Bank Accounts", 5]];
    const result = parseBalanceSheet(undated, { resolveLabel: builtinResolver });
    expect(result.facts).toHaveLength(0);
    expect(result.warnings[0]).toMatch(/no 'as of' date/i);
  });

  it("uses an explicit fallback period and says that it did", () => {
    const undated: Grid = [["Balance Sheet"], [null, "Total"], ["Total for Bank Accounts", 5]];
    const result = parseBalanceSheet(undated, {
      resolveLabel: builtinResolver,
      fallbackPeriod: "2024-10",
    });
    expect(result.facts[0]?.value).toBe(5);
    expect(result.warnings.join(" ")).toMatch(/recorded against 2024-10/);
  });

  it("is classified correctly from its own content", () => {
    expect(classifyGrid({ filename: "x.xlsx", grid: QBO_BALANCE_SHEET }).reportType).toBe(
      "balance_sheet",
    );
  });
});

/* ------------------------------------------------------------------ ageing */

const QBO_AR_AGING: Grid = [
  ["Phoenix Restoration Co."],
  ["A/R Aging Summary"],
  ["As of October 31, 2024"],
  [null, "Current", "1 - 30", "31 - 60", "61 - 90", "91 and over", "Total"],
  ["Harbor Property Group", 18_000, 12_500, 0, 0, 0, 30_500],
  ["Cedar Mill Apartments", 0, 4_200, 9_800, 0, 0, 14_000],
  ["Northgate Facilities", 0, 0, 0, 2_100, 7_400, 9_500],
  ["Westline Insurance", 6_000, 0, 0, 0, 0, 6_000],
  ["Total", 24_000, 16_700, 9_800, 2_100, 7_400, 60_000],
];

describe("ageing", () => {
  it("matches every QuickBooks bucket header", () => {
    expect(matchAgingBucket("Current")).toBe("current");
    expect(matchAgingBucket("1 - 30")).toBe("1_30");
    expect(matchAgingBucket("31 - 60")).toBe("31_60");
    expect(matchAgingBucket("61 - 90")).toBe("61_90");
    expect(matchAgingBucket("91 and over")).toBe("91_plus");
    expect(matchAgingBucket("Total")).toBeNull();
  });

  // The v9 defect: the 31–60 bucket came back empty because a model misread column
  // positions. Buckets are matched from header text here, so position is irrelevant.
  it("populates every bucket including 31-60", () => {
    const result = parseAging(QBO_AR_AGING, {
      period: "2024-10",
      reportType: "ar_aging",
    });
    const value = (id: string) => result.facts.find((f) => f.accountId === id)?.value;
    expect(value("ar.current")).toBe(24_000);
    expect(value("ar.1_30")).toBe(16_700);
    expect(value("ar.31_60")).toBe(9_800);
    expect(value("ar.61_90")).toBe(2_100);
    expect(value("ar.91_plus")).toBe(7_400);
    expect(value("ar.total")).toBe(60_000);
  });

  it("returns one entity per customer with its worst bucket", () => {
    const result = parseAging(QBO_AR_AGING, {
      period: "2024-10",
      reportType: "ar_aging",
    });
    expect(result.entities).toHaveLength(4);
    const northgate = result.entities.find((e) => e.label === "Northgate Facilities");
    // Its largest outstanding amount sits in 91+, which is what the UI shows.
    expect(northgate?.bucket).toBe("91_plus");
    expect(northgate?.total).toBe(9_500);
    const harbor = result.entities.find((e) => e.label === "Harbor Property Group");
    expect(harbor?.bucket).toBe("current");
  });

  it("excludes the Total row from the entity list", () => {
    const result = parseAging(QBO_AR_AGING, {
      period: "2024-10",
      reportType: "ar_aging",
    });
    expect(result.entities.map((e) => e.label)).not.toContain("Total");
  });

  it("derives totals by summing when the report has no Total row", () => {
    const noTotal = QBO_AR_AGING.slice(0, -1);
    const result = parseAging(noTotal, { period: "2024-10", reportType: "ar_aging" });
    expect(result.facts.find((f) => f.accountId === "ar.total")?.value).toBe(60_000);
    expect(result.facts.find((f) => f.accountId === "ar.31_60")?.value).toBe(9_800);
  });

  it("writes to the ap.* namespace for a payables report", () => {
    const result = parseAging(QBO_AR_AGING, {
      period: "2024-10",
      reportType: "ap_aging",
    });
    expect(result.facts.every((f) => f.accountId.startsWith("ap."))).toBe(true);
  });

  /*
    Customers with sub-jobs, which is how every real restoration ageing report is shaped
    and how none of the fixtures above were. Two variants appear in the wild and both are
    here: a parent that bills nothing directly (Andrea) and one that carries a credit of
    its own alongside a job (Michael).

    Read without grouping this is five customers owing 461,000 between them.
  */
  const QBO_AR_AGING_WITH_JOBS: Grid = [
    ["Phoenix Restoration Co."],
    ["A/R Aging Summary"],
    ["As of October 31, 2024"],
    [null, "Current", "1 - 30", "31 - 60", "61 - 90", "91 and over", "Total"],
    ["Andrea Anthony"],
    ["02MO0226-027WTR [Water]", null, null, null, null, 18_000, 18_000],
    ["Total for Andrea Anthony", 0, 0, 0, 0, 18_000, 18_000],
    ["Dan Casey", null, null, 10_000, null, null, 10_000],
    ["Michael Hutchinson", null, null, null, null, -184_000, -184_000],
    ["STL0925-070WTR [Water]", null, null, null, null, 375_000, 375_000],
    ["Total for Michael Hutchinson", 0, 0, 0, 0, 191_000, 191_000],
    ["Total", 0, 0, 10_000, 0, 209_000, 219_000],
  ];

  it("folds job lines into the customer they belong to", () => {
    const result = parseAging(QBO_AR_AGING_WITH_JOBS, {
      period: "2024-10",
      reportType: "ar_aging",
    });

    expect(result.entities.map((e) => e.label)).toEqual([
      "Andrea Anthony",
      "Dan Casey",
      "Michael Hutchinson",
    ]);
    // The group total, not the job line and not the parent's own credit.
    expect(result.entities.find((e) => e.label === "Michael Hutchinson")?.total).toBe(
      191_000,
    );
    // Nothing is counted twice: the entity list reconciles to the report's own total.
    expect(result.entities.reduce((sum, e) => sum + e.total, 0)).toBe(219_000);
  });

  it("never presents a job code as a customer", () => {
    const result = parseAging(QBO_AR_AGING_WITH_JOBS, {
      period: "2024-10",
      reportType: "ar_aging",
    });
    expect(result.entities.map((e) => e.label).join(" ")).not.toMatch(/\[Water\]/);
    expect(result.entities.map((e) => e.label).join(" ")).not.toMatch(/^Total for/);
  });

  it("reports a clear failure when no bucket columns exist", () => {
    const result = parseAging([["Customer", "Amount"], ["A", 1]], {
      period: "2024-10",
      reportType: "ar_aging",
    });
    expect(result.facts).toHaveLength(0);
    expect(result.warnings[0]).toMatch(/No ageing buckets found/);
  });
});

/* ------------------------------------------------------ entity reports */

const QBO_SALES_BY_CUSTOMER: Grid = [
  ["Phoenix Restoration Co."],
  ["Sales by Customer Summary"],
  ["November 2023 - October 2024"],
  [null, "Total"],
  ["Harbor Property Group", 420_000],
  ["Cedar Mill Apartments", 318_500],
  ["Northgate Facilities", 210_000],
  ["Westline Insurance", 96_400],
  ["Total", 1_044_900],
];

describe("sales by customer", () => {
  it("ranks customers by revenue, excluding the Total row", () => {
    const result = parseEntityReport(QBO_SALES_BY_CUSTOMER, {
      period: "2024-10",
      reportType: "sales_by_customer_l12m",
    });
    expect(result.entities.map((e) => e.label)).toEqual([
      "Harbor Property Group",
      "Cedar Mill Apartments",
      "Northgate Facilities",
      "Westline Insurance",
    ]);
    expect(result.entities[0]?.value).toBe(420_000);
  });

  it("records the number of customers billed", () => {
    const result = parseEntityReport(QBO_SALES_BY_CUSTOMER, {
      period: "2024-10",
      reportType: "sales_by_customer_l12m",
    });
    expect(
      result.facts.find((f) => f.accountId === "ops.customer_count")?.value,
    ).toBe(4);
  });

  // The v9 build guessed a job count from PDF text and got it wrong repeatedly.
  it("does not invent a job count when the export has no count column", () => {
    const result = parseEntityReport(QBO_SALES_BY_CUSTOMER, {
      period: "2024-10",
      reportType: "sales_by_customer_l12m",
    });
    expect(result.facts.find((f) => f.accountId === "ops.job_count")).toBeUndefined();
    expect(result.hasExplicitCount).toBe(false);
    expect(result.warnings.join(" ")).toMatch(/was not inferred/);
  });

  it("uses a real job count when the export provides one", () => {
    const withCount: Grid = [
      [null, "Total", "Transactions"],
      ["Harbor Property Group", 420_000, 12],
      ["Cedar Mill Apartments", 318_500, 9],
      ["Total", 738_500, 21],
    ];
    const result = parseEntityReport(withCount, {
      period: "2024-10",
      reportType: "sales_by_customer_l12m",
    });
    expect(result.hasExplicitCount).toBe(true);
    expect(result.facts.find((f) => f.accountId === "ops.job_count")?.value).toBe(21);
  });

  /*
    The export an advisor actually downloads: a month column per month, a trailing Total,
    and customers with sub-jobs.

    This shape defeated the parser completely. The label column was chosen by skipping
    blank headers, so it landed on "Jul 2025" and every customer was labelled with their
    July figure — the grand total row became a customer called "20200" worth $1.3m, and
    the ranking a beta user saw was job codes and stray numbers.
  */
  const QBO_SALES_BY_MONTH: Grid = [
    ["Phoenix Restoration Co."],
    ["Sales by Customer Summary"],
    ["November 2023 - October 2024"],
    ["", "Jul 2025", "Aug 2025", "Sep 2025", "Total"],
    ["Andrea Anthony"],
    ["02MO0226-027WTR [Water]", null, 18_000, null, 18_000],
    ["Total for Andrea Anthony", 0, 18_000, 0, 18_000],
    ["Harbor Property Group", 20_200, null, null, 20_200],
    ["Total", 20_200, 18_000, 0, 38_200],
  ];

  it("reads the label column when the amount columns are months", () => {
    const result = parseEntityReport(QBO_SALES_BY_MONTH, {
      period: "2024-10",
      reportType: "sales_by_customer_l12m",
    });

    expect(result.entities.map((e) => e.label)).toEqual([
      "Harbor Property Group",
      "Andrea Anthony",
    ]);
    expect(result.entities[0]?.value).toBe(20_200);
    // The last column is the 12-month total, not the first month.
    expect(result.entities[1]?.value).toBe(18_000);
    // The grand total row is not a customer.
    expect(result.entities.reduce((sum, e) => sum + e.value, 0)).toBe(38_200);
    expect(
      result.facts.find((f) => f.accountId === "ops.customer_count")?.value,
    ).toBe(2);
  });

  it("writes a total account for a referral report", () => {
    const referrals: Grid = [
      ["Referral Report"],
      ["Source", "Amount"],
      ["Restoration Referral Network", 180_000],
      ["Insurance Adjusters", 92_000],
      ["Total", 272_000],
    ];
    const result = parseEntityReport(referrals, {
      period: "2024-10",
      reportType: "referral_l90d",
      totalAccountId: "ops.referral_total",
    });
    expect(
      result.facts.find((f) => f.accountId === "ops.referral_total")?.value,
    ).toBe(272_000);
    expect(result.entities).toHaveLength(2);
  });
});

/* ---------------------------------------------------- P&L detail lines */

describe("P&L detail lines for the Top Expenses panel", () => {
  const PL: Grid = [
    ["Phoenix Restoration Co."],
    ["Profit and Loss"],
    [null, "Oct 2024", "Total"],
    ["Income"],
    ["  Restoration Services", 182_400, 182_400],
    ["Total for Income", 204_000, 204_000],
    ["Expenses"],
    ["  Payroll", 34_000, 34_000],
    ["  Insurance", 4_300, 4_300],
    ["  Depreciation & Amortization", 2_000, 2_000],
    ["  Franchisor Fee", 0, 0],
    ["Total for Expenses", 38_800, 38_800],
  ];

  it("attributes detail lines to their section", () => {
    const result = parseProfitAndLoss(PL, { resolveLabel: builtinResolver });
    const expenses = result.detailLines.filter((l) => l.section === "expense");
    expect(expenses.map((l) => l.label.trim())).toEqual([
      "Payroll",
      "Insurance",
      "Depreciation & Amortization",
      "Franchisor Fee",
    ]);
    const income = result.detailLines.filter((l) => l.section === "income");
    expect(income.map((l) => l.label.trim())).toEqual(["Restoration Services"]);
  });

  it("does not treat a Total row as a detail line", () => {
    const result = parseProfitAndLoss(PL, { resolveLabel: builtinResolver });
    expect(
      result.detailLines.some((l) => /^total/i.test(l.label.trim())),
    ).toBe(false);
  });

  it("carries a value per period for each detail line", () => {
    const result = parseProfitAndLoss(PL, { resolveLabel: builtinResolver });
    const payroll = result.detailLines.find((l) => l.label.trim() === "Payroll");
    expect(payroll?.amounts).toEqual([{ period: "2024-10", value: 34_000 }]);
  });

  /*
    A real expense list is not flat: QuickBooks nests sub-groups and prints a total for
    each one. Any total row used to close the section, so the section closed at the FIRST
    sub-group and every line below it was discarded. Top Expenses showed two rows, one of
    them a negative credit-card rebate — reported by a beta user, and invisible to the
    flat fixture above.
  */
  const NESTED_PL: Grid = [
    ["Phoenix Restoration Co."],
    ["Profit and Loss"],
    [null, "Oct 2024", "Total"],
    ["Expenses"],
    ["  Advertising & Marketing", 120, 120],
    ["  Bank Charges & Fees", 44, 44],
    ["    Credit Card rewards", -29.25, -29.25],
    ["  Total for Bank Charges & Fees", 14.75, 14.75],
    ["  Wages", 23_641.32, 23_641.32],
    ["  Workers Comp", 211, 211],
    ["  Total for Payroll Expenses", 23_852.32, 23_852.32],
    ["  Insurance", 1_172, 1_172],
    ["Total for Expenses", 25_159.07, 25_159.07],
  ];

  it("keeps reading expenses after a sub-group total", () => {
    const result = parseProfitAndLoss(NESTED_PL, { resolveLabel: () => null });
    const expenses = result.detailLines.filter((l) => l.section === "expense");

    expect(expenses.map((l) => l.label.trim())).toEqual([
      "Advertising & Marketing",
      "Bank Charges & Fees",
      "Credit Card rewards",
      "Wages",
      "Workers Comp",
      "Insurance",
    ]);
    // The largest expense is Wages, not whatever survived the truncation.
    const largest = [...expenses].sort(
      (a, b) => Math.abs(b.amounts[0]!.value) - Math.abs(a.amounts[0]!.value),
    )[0];
    expect(largest?.label.trim()).toBe("Wages");
  });

  it("excludes sub-group totals so children are not double-counted", () => {
    const result = parseProfitAndLoss(NESTED_PL, { resolveLabel: () => null });
    expect(
      result.detailLines.some((l) => /^total/i.test(l.label.trim())),
    ).toBe(false);
  });
});
