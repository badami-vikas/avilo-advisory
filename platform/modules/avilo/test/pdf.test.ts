import { describe, expect, it } from "vitest";

import { ScannedPdfError, readPdf } from "../src/import/pdf.js";
import { classifyGrid } from "../src/import/classify.js";
import { parseProfitAndLoss } from "../src/import/parsers/profit-and-loss.js";
import { BUILTIN_LABEL_MAPPINGS } from "../src/accounts.js";
import type { LabelResolver } from "../src/import/types.js";
import { makeEmptyPdf, makePdf, type PdfRow } from "./helpers/make-pdf.js";

/** The dialect table the app uses before any correction has been taught. */
const builtinResolver: LabelResolver = (normalized, reportType) =>
  BUILTIN_LABEL_MAPPINGS.find(
    (m) => m.reportType === reportType && m.normalizedLabel === normalized,
  )?.accountId ?? null;

/** Right-hand rules for two value columns, as QuickBooks would set them. */
const COL_A = 430;
const COL_B = 540;

/** A two-column Profit & Loss, laid out the way the real export is. */
function profitAndLossPdf(): Uint8Array {
  const rows: PdfRow[] = [
    { y: 740, size: 14, cells: [{ text: "Northwind Plumbing", x: 60 }] },
    { y: 722, size: 11, cells: [{ text: "Profit and Loss", x: 60 }] },
    { y: 706, cells: [{ text: "October 2024", x: 60 }] },
    {
      y: 680,
      cells: [
        { text: "Oct 2024", x: COL_A, align: "right" },
        { text: "Sep 2024", x: COL_B, align: "right" },
      ],
    },
    { y: 660, cells: [{ text: "Income", x: 60 }] },
    {
      y: 646,
      cells: [
        { text: "Service Revenue", x: 72 },
        { text: "112,400.00", x: COL_A, align: "right" },
        { text: "98,250.00", x: COL_B, align: "right" },
      ],
    },
    {
      y: 632,
      cells: [
        { text: "Total for Income", x: 66 },
        { text: "112,400.00", x: COL_A, align: "right" },
        { text: "98,250.00", x: COL_B, align: "right" },
      ],
    },
    {
      y: 610,
      cells: [
        { text: "Cost of Goods Sold", x: 60 },
        { text: "44,900.00", x: COL_A, align: "right" },
        { text: "39,100.00", x: COL_B, align: "right" },
      ],
    },
    {
      y: 596,
      cells: [
        { text: "Gross Profit", x: 60 },
        { text: "67,500.00", x: COL_A, align: "right" },
        { text: "59,150.00", x: COL_B, align: "right" },
      ],
    },
    {
      y: 574,
      cells: [
        { text: "Total Expenses", x: 60 },
        { text: "51,200.00", x: COL_A, align: "right" },
        { text: "48,700.00", x: COL_B, align: "right" },
      ],
    },
    {
      y: 560,
      cells: [
        { text: "Net Operating Income", x: 60 },
        { text: "16,300.00", x: COL_A, align: "right" },
        { text: "10,450.00", x: COL_B, align: "right" },
      ],
    },
    {
      // A negative, set in parentheses the way accounting reports set one.
      y: 546,
      cells: [
        { text: "Total Other Expenses", x: 60 },
        { text: "(1,250.00)", x: COL_A, align: "right" },
        { text: "(980.00)", x: COL_B, align: "right" },
      ],
    },
  ];
  return makePdf(rows);
}

describe("readPdf — geometry reconstruction", () => {
  it("recovers a label column and two right-aligned value columns", async () => {
    const { grid } = await readPdf(profitAndLossPdf(), "pl.pdf");

    const row = (label: string) =>
      grid.find((cells) => String(cells[0] ?? "").trim() === label);

    expect(row("Service Revenue")).toEqual(["Service Revenue", 112400, 98250]);
    expect(row("Cost of Goods Sold")).toEqual(["Cost of Goods Sold", 44900, 39100]);
    expect(row("Net Operating Income")).toEqual(["Net Operating Income", 16300, 10450]);
  });

  it("reads a parenthesised amount as negative", async () => {
    const { grid } = await readPdf(profitAndLossPdf(), "pl.pdf");
    const row = grid.find((cells) => cells[0] === "Total Other Expenses");
    expect(row).toEqual(["Total Other Expenses", -1250, -980]);
  });

  it("keeps column headers with their columns rather than with the label", async () => {
    const { grid } = await readPdf(profitAndLossPdf(), "pl.pdf");
    const header = grid.find((cells) => cells.includes("Oct 2024"));
    expect(header).toBeDefined();
    // "Oct 2024" belongs to the first value column, "Sep 2024" to the second.
    expect(header?.indexOf("Oct 2024")).toBe(1);
    expect(header?.indexOf("Sep 2024")).toBe(2);
  });

  it("keeps the report title out of the value columns", async () => {
    const { grid } = await readPdf(profitAndLossPdf(), "pl.pdf");
    const title = grid.find((cells) => String(cells[0]).includes("Profit and Loss"));
    expect(title).toBeDefined();
    expect(title?.slice(1).every((cell) => cell === null)).toBe(true);
  });

  // Different digit counts mean different drawn widths. Clustering left edges would put
  // "112,400.00" and "98,250.00" in different columns; they share only a right rule.
  it("groups right-aligned numbers of unequal width into one column", async () => {
    const { grid } = await readPdf(profitAndLossPdf(), "pl.pdf");
    const widths = new Set(grid.filter((r) => r.length > 1).map((r) => r.length));
    expect(widths).toEqual(new Set([3]));
  });
});

describe("readPdf — the reconstructed grid feeds the existing pipeline", () => {
  it("classifies as a Profit & Loss", async () => {
    const { grid } = await readPdf(profitAndLossPdf(), "pl.pdf");
    const classification = classifyGrid({ filename: "pl.pdf", grid });
    expect(classification.reportType).toBe("profit_and_loss");
    expect(classification.needsConfirmation).toBe(false);
  });

  it("extracts the same facts the Excel path would", async () => {
    const { grid } = await readPdf(profitAndLossPdf(), "pl.pdf");
    const result = parseProfitAndLoss(grid, { resolveLabel: builtinResolver });

    expect(result.periods).toEqual(["2024-09", "2024-10"]);

    const value = (accountId: string, period: string) =>
      result.facts.find((f) => f.accountId === accountId && f.period === period)?.value;

    expect(value("pl.revenue", "2024-10")).toBe(112400);
    expect(value("pl.revenue", "2024-09")).toBe(98250);
    expect(value("pl.cogs", "2024-10")).toBe(44900);
    expect(value("pl.overhead", "2024-10")).toBe(51200);

    // Net operating income is a formula over these inputs, not a row that was read —
    // so the parenthesised figure has to survive as a negative for it to come out right.
    expect(value("pl.other_expense", "2024-10")).toBe(-1250);
  });
});

describe("readPdf — refusals", () => {
  it("refuses a PDF with no text layer instead of importing nothing", async () => {
    await expect(readPdf(makeEmptyPdf(), "scan.pdf")).rejects.toBeInstanceOf(
      ScannedPdfError,
    );
    await expect(readPdf(makeEmptyPdf(), "scan.pdf")).rejects.toThrow(/scan.pdf/);
  });

  it("leaves the caller's buffer intact, so the file can still be hashed and stored", async () => {
    const bytes = profitAndLossPdf();
    const length = bytes.byteLength;
    await readPdf(bytes, "pl.pdf");
    expect(bytes.byteLength).toBe(length);
    expect(bytes[0]).toBe("%".charCodeAt(0));
  });
});
