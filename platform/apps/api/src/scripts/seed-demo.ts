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

function main(): void {
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

  const staged = stageFile(id, "Phoenix_ProfitAndLoss_L12M.xlsx", demoWorkbook());
  if (!staged.classification.reportType) {
    throw new Error("Demo workbook failed classification — the seed is out of date.");
  }
  const result = commitFile(id, staged.sourceFileId);

  db.insert(schema.clients)
    .values({ id: newId("cl"), name: "Sierra Contracting LLC", stage: "Onboarding" })
    .run();

  process.stdout.write(
    [
      "",
      "  Demo data seeded.",
      `  Phoenix Restoration Co. — ${result.factsWritten} values across ${result.periods.length} periods`,
      "  Sierra Contracting LLC — no data, to show the empty state",
      "",
      "  No balance sheet is included, so Days cash on hand stays flagged as missing.",
      "  That is deliberate: it demonstrates the derived checklist.",
      "",
      "  Remove it again with:  pnpm seed:demo --reset",
      "",
    ].join("\n"),
  );
}

main();
