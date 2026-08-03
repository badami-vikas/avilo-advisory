import { describe, expect, it } from "vitest";

import { buildSuggestPrompt, parseSuggestions } from "../src/import/suggest.js";
import { normalizeLabel } from "../src/accounts.js";

const input = {
  reportType: "balance_sheet",
  labels: [
    "1000 Cash in Bank",
    "Total Current Assets",
    "1200 Work in Process",
    "1100 Accounts Receivable",
  ],
  candidates: [
    { id: "bs.cash", label: "Total cash in bank accounts", statement: "balance_sheet" },
    { id: "bs.ar", label: "Accounts receivable", statement: "balance_sheet" },
    { id: "pl.revenue", label: "Total revenue", statement: "pl" },
  ],
};

describe("parseSuggestions", () => {
  it("maps a well-formed reply onto the labels in order", () => {
    const out = parseSuggestions(
      ["1|bs.cash|bank line", "2|skip|subtotal", "3|skip|no account", "4|bs.ar|receivables"].join("\n"),
      input,
    );
    expect(out.map((s) => s.accountId)).toEqual(["bs.cash", null, null, "bs.ar"]);
    expect(out[0]!.rawLabel).toBe("1000 Cash in Bank");
    expect(out[1]!.reason).toBe("subtotal");
  });

  /**
   * The safety property that makes it acceptable to let a model near an import at all:
   * an account id the app does not have must degrade to "skip", never be passed through
   * to become a fact against a nonexistent account.
   */
  it("degrades a hallucinated account id to skip", () => {
    const out = parseSuggestions("1|bs.does_not_exist|invented", input);
    expect(out[0]!.accountId).toBeNull();
  });

  it("never throws on malformed, empty or out-of-range output", () => {
    for (const reply of ["", "complete nonsense", "9|bs.cash|out of range", "|||", "1"]) {
      const out = parseSuggestions(reply, input);
      expect(out).toHaveLength(input.labels.length);
      expect(out.every((s) => s.accountId === null || typeof s.accountId === "string")).toBe(true);
    }
  });

  it("returns one entry per label even when the model answers for none", () => {
    const out = parseSuggestions("2|bs.cash|only one line", input);
    expect(out).toHaveLength(4);
    expect(out.filter((s) => s.accountId !== null)).toHaveLength(1);
  });

  it("returns nothing for an empty label list", () => {
    expect(parseSuggestions("1|bs.cash|x", { ...input, labels: [] })).toEqual([]);
  });
});

describe("buildSuggestPrompt", () => {
  it("offers only accounts belonging to the report's statement", () => {
    const prompt = buildSuggestPrompt(input);
    expect(prompt).toContain("bs.cash");
    expect(prompt).toContain("bs.ar");
    // A P&L account must not be offered as a balance-sheet mapping.
    expect(prompt).not.toContain("pl.revenue");
  });

  it("instructs the model to skip subtotals rather than double-count", () => {
    expect(buildSuggestPrompt(input)).toMatch(/SUBTOTAL/);
  });

  it("lists every label to be mapped", () => {
    const prompt = buildSuggestPrompt(input);
    for (const label of input.labels) expect(prompt).toContain(label);
  });
});

describe("normalizeLabel account-code handling", () => {
  it("strips a leading chart-of-accounts code", () => {
    expect(normalizeLabel("1100 Accounts Receivable")).toBe("accounts receivable");
    expect(normalizeLabel("2000 Accounts Payable")).toBe("accounts payable");
  });

  it("leaves a label without a code untouched", () => {
    expect(normalizeLabel("Accounts Receivable")).toBe("accounts receivable");
  });

  /** A year or a quantity at the start of a label is not an account code. */
  it("does not strip digit groups outside the 3-6 digit code range", () => {
    expect(normalizeLabel("12 Month Revenue")).toBe("12 month revenue");
  });
});
