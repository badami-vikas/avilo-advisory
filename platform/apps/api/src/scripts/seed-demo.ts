/**
 * Opt-in demo data.
 *
 * Never invoked by `pnpm dev`, by migrations, or by tests. The application starts empty
 * and shows honest empty states; this exists only so a reviewer can see a populated
 * dashboard without owning real QuickBooks exports. Tracked in docs/dummy.md.
 *
 *   pnpm seed:demo          populate
 *   pnpm seed:demo --reset  remove all clients and their data, leaving reference data
 */
import * as XLSX from "xlsx";
import { eq } from "drizzle-orm";

import { getDb, newId, schema } from "../db.js";
import { stageFile, commitFile } from "../services/import.js";

const RESET = process.argv.includes("--reset");

function demoWorkbook(): Uint8Array {
  const months = [
    "Nov 2023", "Dec 2023", "Jan 2024", "Feb 2024", "Mar 2024", "Apr 2024",
    "May 2024", "Jun 2024", "Jul 2024", "Aug 2024", "Sep 2024", "Oct 2024",
  ];
  const revenue = [162000, 154000, 138000, 147000, 169000, 183000, 188000, 198000, 192000, 201000, 194000, 204000];
  const cogs = [99000, 95000, 88000, 92000, 103000, 111000, 114000, 120000, 117000, 122000, 115000, 122000];
  const overhead = [36000, 35200, 34000, 35000, 37000, 38000, 39000, 40000, 38500, 39500, 39200, 38800];
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  const rows: (string | number | null)[][] = [
    ["Phoenix Restoration Co."],
    ["Profit and Loss"],
    [`${months[0]} - ${months[months.length - 1]}`],
    [null, ...months, "Total"],
    ["Income"],
    ["  Restoration Services", ...revenue.map((v) => Math.round(v * 0.89)), Math.round(sum(revenue) * 0.89)],
    ["  Reconstruction", ...revenue.map((v) => Math.round(v * 0.11)), Math.round(sum(revenue) * 0.11)],
    ["Total for Income", ...revenue, sum(revenue)],
    ["Cost of Goods Sold"],
    ["  Subcontractors", ...cogs.map((v) => Math.round(v * 0.62)), Math.round(sum(cogs) * 0.62)],
    ["  Materials", ...cogs.map((v) => Math.round(v * 0.38)), Math.round(sum(cogs) * 0.38)],
    ["Total for Cost of Goods Sold", ...cogs, sum(cogs)],
    ["Gross Profit", ...revenue.map((v, i) => v - (cogs[i] ?? 0)), sum(revenue) - sum(cogs)],
    ["Expenses"],
    ["  Payroll", ...overhead.map((v) => Math.round(v * 0.85)), Math.round(sum(overhead) * 0.85)],
    ["  Insurance", ...overhead.map((v) => Math.round(v * 0.11)), Math.round(sum(overhead) * 0.11)],
    ["  Depreciation & Amortization", ...overhead.map(() => 2000), 24000],
    ["Total for Expenses", ...overhead, sum(overhead)],
    [
      "Net Operating Income",
      ...revenue.map((v, i) => v - (cogs[i] ?? 0) - (overhead[i] ?? 0)),
      sum(revenue) - sum(cogs) - sum(overhead),
    ],
  ];

  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Profit and Loss");
  return new Uint8Array(XLSX.write(book, { type: "buffer", bookType: "xlsx" }));
}

function sheetToBytes(rows: (string | number | null)[][], name: string): Uint8Array {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, name);
  return new Uint8Array(XLSX.write(book, { type: "buffer", bookType: "xlsx" }));
}

const BALANCE_SHEET: (string | number | null)[][] = [
  ["Phoenix Restoration Co."],
  ["Balance Sheet"],
  ["As of October 31, 2024"],
  [null, "Total"],
  ["ASSETS"],
  ["  Bank Accounts"],
  ["    Operating Checking", 71500],
  ["    Payroll Savings", 13500],
  ["  Total for Bank Accounts", 85000],
  ["  Accounts Receivable"],
  ["    Accounts Receivable (A/R)", 60000],
  ["  Total for Accounts Receivable", 60000],
  ["Total for Assets", 412000],
  ["LIABILITIES AND EQUITY"],
  ["  Accounts Payable"],
  ["    Accounts Payable (A/P)", 38200],
  ["  Total for Accounts Payable", 38200],
  ["Total for Liabilities", 190000],
  ["Total for Equity", 222000],
];

const AR_AGING: (string | number | null)[][] = [
  ["Phoenix Restoration Co."],
  ["A/R Aging Summary"],
  ["As of October 31, 2024"],
  [null, "Current", "1 - 30", "31 - 60", "61 - 90", "91 and over", "Total"],
  ["Harbor Property Group", 18000, 12500, 0, 0, 0, 30500],
  ["Cedar Mill Apartments", 0, 4200, 9800, 0, 0, 14000],
  ["Northgate Facilities", 0, 0, 0, 2100, 7400, 9500],
  ["Westline Insurance", 6000, 0, 0, 0, 0, 6000],
  ["Total", 24000, 16700, 9800, 2100, 7400, 60000],
];

const AP_AGING: (string | number | null)[][] = [
  ["Phoenix Restoration Co."],
  ["A/P Aging Summary"],
  ["As of October 31, 2024"],
  [null, "Current", "1 - 30", "31 - 60", "61 - 90", "91 and over", "Total"],
  ["Sunbelt Equipment Rental", 9200, 3100, 0, 0, 0, 12300],
  ["Valley Building Supply", 6400, 5200, 1800, 0, 0, 13400],
  ["Desert Waste Services", 2100, 0, 0, 900, 0, 3000],
  ["Copper State Insurance", 9500, 0, 0, 0, 0, 9500],
  ["Total", 27200, 8300, 1800, 900, 0, 38200],
];

const SALES_BY_CUSTOMER: (string | number | null)[][] = [
  ["Phoenix Restoration Co."],
  ["Sales by Customer Summary"],
  ["November 2023 - October 2024"],
  [null, "Total", "Transactions"],
  ["Harbor Property Group", 420000, 38],
  ["Cedar Mill Apartments", 318500, 26],
  ["Northgate Facilities", 210000, 19],
  ["Westline Insurance", 96400, 11],
  ["Total", 1044900, 94],
];

const REFERRALS: (string | number | null)[][] = [
  ["Phoenix Restoration Co."],
  ["Referral Report"],
  ["As of October 31, 2024"],
  ["Source", "Amount"],
  ["Restoration Referral Network", 180000],
  ["Copper State Insurance Adjusters", 92000],
  ["Harbor Property Management", 61000],
  ["Direct / Repeat", 44000],
  ["Total", 377000],
];

async function main(): Promise<void> {
  const db = getDb();

  const existing = db.select().from(schema.clients).all();
  for (const client of existing) {
    db.delete(schema.clients).where(eq(schema.clients.id, client.id)).run();
  }

  if (RESET) {
    process.stdout.write(
      `Removed ${existing.length} client${existing.length === 1 ? "" : "s"}. Reference data (accounts, formulas, label mappings) kept.\n`,
    );
    return;
  }

  const id = newId("cl");
  db.insert(schema.clients)
    .values({
      id,
      name: "Phoenix Restoration Co.",
      stage: "Active",
      industry: "Restoration & reconstruction",
      fiscalYearStartMonth: 1,
    })
    .run();

  // The P&L goes first: the snapshot reports are dated from it when their own header
  // cannot be read, so ordering here mirrors the order an advisor would upload in.
  const uploads: { filename: string; bytes: Uint8Array }[] = [
    { filename: "Phoenix_ProfitAndLoss_L12M.xlsx", bytes: demoWorkbook() },
    { filename: "Phoenix_BalanceSheet_Oct2024.xlsx", bytes: sheetToBytes(BALANCE_SHEET, "Balance Sheet") },
    { filename: "Phoenix_AR_Aging_Oct2024.xlsx", bytes: sheetToBytes(AR_AGING, "AR Aging") },
    { filename: "Phoenix_AP_Aging_Oct2024.xlsx", bytes: sheetToBytes(AP_AGING, "AP Aging") },
    { filename: "Phoenix_SalesByCustomer_L12M.xlsx", bytes: sheetToBytes(SALES_BY_CUSTOMER, "Sales") },
    { filename: "Phoenix_Referrals_L90D.xlsx", bytes: sheetToBytes(REFERRALS, "Referrals") },
  ];

  let facts = 0;
  let details = 0;
  const lines: string[] = [];

  for (const upload of uploads) {
    const staged = await stageFile(id, upload.filename, upload.bytes);
    if (!staged.classification.reportType) {
      lines.push(`  ${upload.filename} — NOT CLASSIFIED (seed is out of date)`);
      continue;
    }
    const outcome = await commitFile(id, staged.sourceFileId);
    facts += outcome.factsWritten;
    details += outcome.detailsWritten;
    lines.push(
      `  ${staged.classification.reportType} — ${outcome.factsWritten} values, ${outcome.detailsWritten} detail rows` +
        (outcome.warnings.length > 0 ? `\n      ${outcome.warnings.join("\n      ")}` : ""),
    );
  }

  const result = { factsWritten: facts, detailsWritten: details, lines };

  db.insert(schema.clients)
    .values({ id: newId("cl"), name: "Sierra Contracting LLC", stage: "Onboarding" })
    .run();

  process.stdout.write(
    [
      "",
      "  Demo data seeded — Phoenix Restoration Co.",
      ...result.lines,
      "",
      `  ${result.factsWritten} values and ${result.detailsWritten} detail rows in total.`,
      "  Sierra Contracting LLC — no data, to show the empty state.",
      "",
      "  Remove it again with:  pnpm seed:demo --reset",
      "",
    ].join("\n"),
  );
}

main().catch((error) => {
  process.stderr.write(`Seed failed: ${(error as Error).stack}\n`);
  process.exit(1);
});
