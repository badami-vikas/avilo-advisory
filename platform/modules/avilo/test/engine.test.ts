import { describe, expect, it } from "vitest";
import {
  buildDependencyGraph,
  evaluateFormulas,
  extractDependencies,
  requiredAccounts,
  transitiveDependencies,
  validateExpression,
  type EvaluationScope,
  type FormulaSpec,
  type ResolvedValue,
} from "../src/formulas/engine.js";
import { SEED_FORMULAS } from "../src/formulas/registry.js";

const specs: FormulaSpec[] = SEED_FORMULAS.map((f) => ({
  id: f.id,
  label: f.label,
  expression: f.expression,
}));

function scopeOf(accounts: Record<string, number>, metrics: Record<string, number> = {}): EvaluationScope {
  const a = new Map<string, ResolvedValue>();
  for (const [k, v] of Object.entries(accounts)) a.set(k, { value: v, source: "fact" });
  const m = new Map<string, ResolvedValue>();
  for (const [k, v] of Object.entries(metrics)) m.set(k, { value: v, source: "override" });
  return { accounts: a, metricOverrides: m };
}

describe("extractDependencies", () => {
  it("recovers dotted account ids as whole identifiers", () => {
    expect(extractDependencies("pl.revenue - pl.cogs")).toEqual([
      "pl.cogs",
      "pl.revenue",
    ]);
  });

  it("recovers bare formula ids", () => {
    expect(extractDependencies("gross_profit / pl.revenue * 100")).toEqual([
      "gross_profit",
      "pl.revenue",
    ]);
  });

  it("handles nested parentheses and mixed references", () => {
    expect(
      extractDependencies("bs.cash / ((pl.cogs + pl.overhead) / 365)"),
    ).toEqual(["bs.cash", "pl.cogs", "pl.overhead"]);
  });

  it("does not treat function names as dependencies", () => {
    expect(extractDependencies("abs(pl.revenue) + max(pl.cogs, 0)")).toEqual([
      "pl.cogs",
      "pl.revenue",
    ]);
  });

  it("throws on a malformed expression rather than returning junk", () => {
    expect(() => extractDependencies("pl.revenue - ")).toThrow(/Cannot parse/);
  });
});

describe("buildDependencyGraph", () => {
  it("orders dependants after their dependencies", () => {
    const { order } = buildDependencyGraph(specs);
    expect(order.indexOf("gross_profit")).toBeLessThan(
      order.indexOf("gross_margin_pct"),
    );
    expect(order.indexOf("net_operating_income")).toBeLessThan(
      order.indexOf("noi_margin_pct"),
    );
  });

  it("rejects a cycle and names its members", () => {
    const cyclic: FormulaSpec[] = [
      { id: "a", label: "A", expression: "b + 1" },
      { id: "b", label: "B", expression: "a + 1" },
    ];
    expect(() => buildDependencyGraph(cyclic)).toThrow(/Circular formula reference/);
  });

  it("rejects a self-reference", () => {
    expect(() =>
      buildDependencyGraph([{ id: "a", label: "A", expression: "a + 1" }]),
    ).toThrow(/Circular/);
  });

  it("expands transitive dependencies through intermediate formulas", () => {
    const { deps } = buildDependencyGraph(specs);
    expect(transitiveDependencies("gross_margin_pct", deps)).toContain("pl.cogs");
  });
});

describe("evaluateFormulas", () => {
  it("computes the seed metrics from complete P&L and balance sheet inputs", () => {
    const result = evaluateFormulas(
      specs,
      scopeOf({
        "pl.revenue": 200_000,
        "pl.cogs": 120_000,
        "pl.overhead": 50_000,
        "bs.cash": 85_000,
      }),
    );

    expect(result.metrics.get("gross_profit")?.value).toBe(80_000);
    expect(result.metrics.get("gross_margin_pct")?.value).toBe(40);
    expect(result.metrics.get("net_operating_income")?.value).toBe(30_000);
    expect(result.metrics.get("noi_margin_pct")?.value).toBe(15);
    expect(result.metrics.get("days_cash_on_hand")?.value).toBeCloseTo(
      85_000 / ((120_000 + 50_000) / 365),
      6,
    );
  });

  it("reports missing leaf inputs instead of yielding NaN", () => {
    const result = evaluateFormulas(
      specs,
      scopeOf({ "pl.revenue": 100, "pl.cogs": 40, "pl.overhead": 30 }),
    );
    const days = result.metrics.get("days_cash_on_hand");
    expect(days?.status).toBe("missing_inputs");
    expect(days?.value).toBeNull();
    expect(days?.missing).toEqual(["bs.cash"]);
  });

  it("propagates a missing leaf through an intermediate formula", () => {
    const result = evaluateFormulas(specs, scopeOf({ "pl.revenue": 100 }));
    const margin = result.metrics.get("gross_margin_pct");
    expect(margin?.status).toBe("missing_inputs");
    // The user must supply pl.cogs — not "gross_profit", which is computed.
    expect(margin?.missing).toEqual(["pl.cogs"]);
  });

  it("flags division by zero as an error rather than Infinity", () => {
    const result = evaluateFormulas(
      specs,
      scopeOf({ "pl.revenue": 0, "pl.cogs": 0, "pl.overhead": 0, "bs.cash": 10 }),
    );
    expect(result.metrics.get("gross_margin_pct")?.status).toBe("error");
    expect(result.metrics.get("gross_margin_pct")?.error).toMatch(/zero/i);
  });

  it("lets a metric override short-circuit computation without hiding dependencies", () => {
    const result = evaluateFormulas(
      specs,
      scopeOf(
        { "pl.revenue": 200_000, "pl.cogs": 120_000, "pl.overhead": 50_000 },
        { net_operating_income: 33_333 },
      ),
    );
    const noi = result.metrics.get("net_operating_income");
    expect(noi?.value).toBe(33_333);
    expect(noi?.source).toBe("override");
    expect(noi?.dependsOn).toContain("pl.overhead");
    // Downstream metrics consume the overridden value.
    expect(result.metrics.get("noi_margin_pct")?.value).toBeCloseTo(16.6665, 3);
  });
});

describe("requiredAccounts — the derived checklist", () => {
  it("derives every account the active formulas need, with no hand-maintained list", () => {
    expect(requiredAccounts(specs)).toEqual([
      "bs.cash",
      "pl.cogs",
      "pl.overhead",
      "pl.revenue",
    ]);
  });

  it("shrinks when a formula is deactivated", () => {
    const withoutCash = specs.map((f) =>
      f.id === "days_cash_on_hand" ? { ...f, active: false } : f,
    );
    expect(requiredAccounts(withoutCash)).not.toContain("bs.cash");
  });

  it("grows automatically when a formula gains a new reference", () => {
    const extended = [
      ...specs,
      { id: "current_ratio", label: "Current ratio", expression: "bs.total_assets / bs.total_liabilities" },
    ];
    expect(requiredAccounts(extended)).toContain("bs.total_assets");
  });

  it("reports which required accounts are absent from a given scope", () => {
    const result = evaluateFormulas(specs, scopeOf({ "pl.revenue": 1 }));
    expect(result.missingAccounts).toEqual(["bs.cash", "pl.cogs", "pl.overhead"]);
  });
});

describe("validateExpression — guards a global formula edit", () => {
  const accountIds = ["pl.revenue", "pl.cogs", "pl.overhead", "bs.cash"];

  it("accepts a valid edit", () => {
    const result = validateExpression(
      "(pl.revenue - pl.cogs) / pl.revenue * 100",
      "gross_margin_pct",
      specs,
      accountIds,
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a reference to an account that does not exist", () => {
    const result = validateExpression(
      "pl.revenue - pl.nonsense",
      "gross_profit",
      specs,
      accountIds,
    );
    expect(result.ok).toBe(false);
    expect(result.unknownReferences).toEqual(["pl.nonsense"]);
  });

  it("rejects an edit that would introduce a cycle", () => {
    const result = validateExpression(
      "noi_margin_pct * 2",
      "net_operating_income",
      specs,
      accountIds,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Circular/);
  });

  it("rejects syntactically invalid input", () => {
    const result = validateExpression("pl.revenue +", "gross_profit", specs, accountIds);
    expect(result.ok).toBe(false);
  });
});
