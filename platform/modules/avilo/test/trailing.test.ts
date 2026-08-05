/**
 * Trailing windows, and the statement-articulation check.
 *
 * Both come from grounding the metrics against a real client's books. A liquidity ratio
 * divides a stock by a rate; one month is not a rate. And a balance sheet's Net Income is
 * its fiscal year to date, which nothing forces to match whatever range the P&L export
 * happened to cover.
 */
import { describe, expect, it } from "vitest";
import {
  buildTrailing,
  evaluateFormulas,
  requiredAccounts,
  underlyingAccount,
  type EvaluationScope,
} from "../src/formulas/engine.js";
import { SEED_FORMULAS } from "../src/formulas/registry.js";
import { checkPeriodAlignment } from "../src/integrity.js";

const specs = SEED_FORMULAS.map((f) => ({
  id: f.id,
  label: f.label,
  expression: f.expression,
  unit: f.unit,
}));

const accounts = (values: Record<string, number>): EvaluationScope["accounts"] =>
  new Map(
    Object.entries(values).map(([id, value]) => [id, { value, source: "fact" as const }]),
  );

describe("trailing windows", () => {
  it("averages an account over the window, ending at the evaluated period", () => {
    const history = [
      new Map([["pl.cogs", 10]]),
      new Map([["pl.cogs", 20]]),
      new Map([["pl.cogs", 60]]),
    ];
    expect(buildTrailing(history, ["avg3.pl.cogs"]).get("avg3.pl.cogs")).toBe(30);
    // A shorter window reads only the most recent months.
    expect(buildTrailing(history.slice(-2), ["avg2.pl.cogs"]).get("avg2.pl.cogs")).toBe(40);
  });

  it("averages what exists rather than refusing a short history", () => {
    const history = [new Map([["pl.cogs", 10]]), new Map([["pl.cogs", 30]])];
    // Two months of data, a three-month window: the mean of two, not a blank card.
    expect(buildTrailing(history, ["avg3.pl.cogs"]).get("avg3.pl.cogs")).toBe(20);
  });

  it("omits a window with no readings at all", () => {
    const history = [new Map([["pl.revenue", 10]])];
    expect(buildTrailing(history, ["avg3.pl.cogs"]).has("avg3.pl.cogs")).toBe(false);
  });

  it("names the underlying account, not the window, in the checklist", () => {
    expect(underlyingAccount("avg3.pl.cogs")).toBe("pl.cogs");
    expect(underlyingAccount("pl.cogs")).toBe("pl.cogs");

    const required = requiredAccounts(specs);
    expect(required).toContain("pl.cogs");
    expect(required.some((id) => id.startsWith("avg"))).toBe(false);
  });

  it("reports the underlying account as the missing input", () => {
    const result = evaluateFormulas(specs, { accounts: accounts({ "bs.cash": 40_411.54 }) });
    const daysCash = result.metrics.get("days_cash_on_hand")!;
    expect(daysCash.status).toBe("missing_inputs");
    expect(daysCash.missing).toContain("pl.cogs");
    expect(daysCash.missing.some((id) => id.startsWith("avg"))).toBe(false);
  });

  /*
    The case that prompted all of this, with the client's real figures.

    Cash $40,411.54 at 30 June 2026. Operating spend that month was $22,470.99 — the
    lowest of thirteen — against a trailing three-month mean of $31,540.36. The headline
    moves from 54 days of runway to 38, and the point-in-time twin still shows the 54 so
    the difference is visible rather than buried.
  */
  it("puts the headline on the trailing base and keeps the single month beside it", () => {
    const result = evaluateFormulas(specs, {
      accounts: accounts({
        "bs.cash": 40_411.54,
        "pl.cogs": 0,
        "pl.overhead": 22_470.99,
      }),
      trailing: new Map([
        ["avg3.pl.cogs", 0],
        ["avg3.pl.overhead", (47_944.26 + 24_205.83 + 22_470.99) / 3],
      ]),
    });

    const headline = result.metrics.get("days_cash_on_hand")!;
    const point = result.metrics.get("days_cash_on_hand_point")!;

    expect(headline.status).toBe("ok");
    expect(point.status).toBe("ok");
    expect(point.value).toBeCloseTo(54.0, 1);
    expect(headline.value).toBeCloseTo(38.4, 1);
    // The whole reason for the change: the month on screen flattered the runway.
    expect(headline.value!).toBeLessThan(point.value!);
  });
});

describe("statement articulation", () => {
  const months = (values: number[]) =>
    values.map((value, index) => ({ period: `2026-${String(index + 1).padStart(2, "0")}`, value }));

  it("passes when the P&L covers exactly the balance sheet's fiscal year", () => {
    const result = checkPeriodAlignment(-100, months([-40, -30, -30]));
    expect(result.matchedMonths).toBe(3);
    expect(result.finding).toBeNull();
  });

  /*
    The real case: a 13-month P&L against a 6-month fiscal year. Both correct, both on the
    same page, one reading +$275,000 and the other −$63,953.
  */
  it("names the shorter window when the P&L reaches further back", () => {
    const series = [
      { period: "2025-08", value: 300_000 },
      { period: "2025-09", value: 40_000 },
      { period: "2025-10", value: 20_000 },
      { period: "2025-11", value: -10_000 },
      { period: "2026-01", value: -20_000 },
      { period: "2026-02", value: -30_000 },
    ];
    const result = checkPeriodAlignment(-60_000, series);
    expect(result.matchedMonths).toBe(3);
    expect(result.importedMonths).toBe(6);
    expect(result.finding?.code).toBe("period_window_mismatch");
    expect(result.finding?.message).toMatch(/fiscal year to date is 3 months/);
    expect(result.finding?.message).toMatch(/6 months of P&L are imported/);
  });

  it("says so plainly when no window reconciles at all", () => {
    const result = checkPeriodAlignment(999_999, months([10, 20, 30]));
    expect(result.matchedMonths).toBeNull();
    expect(result.finding?.code).toBe("period_window_mismatch");
    expect(result.finding?.message).toMatch(/no run of imported P&L months adds up/);
  });

  it("stays silent when there is nothing to compare", () => {
    expect(checkPeriodAlignment(null, months([10])).finding).toBeNull();
    expect(checkPeriodAlignment(100, []).finding).toBeNull();
  });
});
