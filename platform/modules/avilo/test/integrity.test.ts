import { describe, expect, it } from "vitest";

import { CENT, checkIntegrity, toCents } from "../src/integrity.js";

const BALANCED = {
  "bs.total_assets": 250_000,
  "bs.total_liabilities": 90_000,
  "bs.equity": 160_000,
};

describe("the accounting equation", () => {
  it("passes a balance sheet that balances", () => {
    expect(checkIntegrity(BALANCED)).toEqual([]);
  });

  // Nothing in the importer would otherwise notice this: both sides parse perfectly,
  // and the dashboard renders a confident, internally contradictory balance sheet.
  it("reports a balance sheet that does not balance, with the gap", () => {
    const findings = checkIntegrity({ ...BALANCED, "bs.equity": 150_000 });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.code).toBe("balance_sheet_unbalanced");
    expect(findings[0]?.delta).toBeCloseTo(10_000, 6);
    expect(findings[0]?.message).toContain("$10,000.00");
  });

  it("tolerates a sub-cent difference from rounded line items", () => {
    expect(checkIntegrity({ ...BALANCED, "bs.equity": 160_000.004 })).toEqual([]);
  });

  it("stays silent when the balance sheet was never uploaded", () => {
    // "Out by the whole of your assets" is noise, not a finding.
    expect(checkIntegrity({ "pl.revenue": 100 })).toEqual([]);
    expect(checkIntegrity({ "bs.total_assets": 250_000 })).toEqual([]);
  });
});

describe("balance sheet against the ageing reports", () => {
  it("reports receivables that disagree with the A/R ageing total", () => {
    const findings = checkIntegrity({ "bs.ar": 60_000, "ar.total": 58_500 });
    expect(findings.map((f) => f.code)).toEqual(["ar_disagrees_with_ageing"]);
    expect(findings[0]?.message).toContain("$1,500.00");
  });

  it("reports payables that disagree with the A/P ageing total", () => {
    const findings = checkIntegrity({ "bs.ap": 38_200, "ap.total": 40_000 });
    expect(findings.map((f) => f.code)).toEqual(["ap_disagrees_with_ageing"]);
  });

  it("passes when they agree", () => {
    expect(checkIntegrity({ "bs.ar": 60_000, "ar.total": 60_000 })).toEqual([]);
  });
});

describe("ageing buckets against their own total", () => {
  const buckets = {
    "ar.current": 20_000,
    "ar.1_30": 15_000,
    "ar.31_60": 12_000,
    "ar.61_90": 8_000,
    "ar.91_plus": 5_000,
  };

  it("passes when the buckets add up", () => {
    expect(checkIntegrity({ ...buckets, "ar.total": 60_000 })).toEqual([]);
  });

  it("reports buckets that do not add up to the stated total", () => {
    const findings = checkIntegrity({ ...buckets, "ar.total": 64_000 });
    expect(findings.map((f) => f.code)).toEqual(["ageing_buckets_disagree_with_total"]);
    expect(findings[0]?.message).toContain("$4,000.00");
  });

  // A partial set summed against the total reports a shortfall that is really a column
  // the export did not carry.
  it("stays silent when a bucket column is absent", () => {
    const { "ar.61_90": _omitted, ...partial } = buckets;
    expect(checkIntegrity({ ...partial, "ar.total": 60_000 })).toEqual([]);
  });
});

describe("the P&L against its own subtotal", () => {
  it("reports a gross profit that is not revenue less COGS", () => {
    const findings = checkIntegrity({
      "pl.revenue": 204_000,
      "pl.cogs": 122_000,
      "pl.gross_profit": 90_000,
    });
    expect(findings.map((f) => f.code)).toEqual(["gross_profit_disagrees"]);
    expect(findings[0]?.delta).toBeCloseTo(8_000, 6);
  });

  it("passes when it reconciles", () => {
    expect(
      checkIntegrity({
        "pl.revenue": 204_000,
        "pl.cogs": 122_000,
        "pl.gross_profit": 82_000,
      }),
    ).toEqual([]);
  });
});

describe("toCents", () => {
  it("rounds to whole cents", () => {
    expect(toCents(1.006)).toBe(1.01);
    expect(toCents(1.004)).toBe(1.0);
    expect(toCents(204000.12345)).toBe(204000.12);
    expect(toCents(0)).toBe(0);
  });

  /**
   * `Math.round` rounds half toward +Infinity, so -0.005 becomes -0.00 while +0.005
   * becomes +0.01. Several of the exports this reads carry expenses as negatives, so
   * that asymmetry is a systematic upward bias across a whole column.
   */
  it("treats equal magnitudes identically regardless of sign", () => {
    for (const value of [1.005, 2.675, 1250.005, 0.125, 99.999]) {
      expect(toCents(-value)).toBe(-toCents(value));
    }
  });

  it("does not depend on float representation error at the half-cent", () => {
    // 1.005 * 100 is 100.49999999999999 and -1250.005 * 100 is -125000.50000000001.
    // A naive round would send the same fractional part in opposite directions.
    expect(toCents(1.005)).toBe(1.01);
    expect(toCents(1250.005)).toBe(1250.01);
  });

  it("stops a running sum drifting off cents", () => {
    // Ten tenths is the case that genuinely drifts: 0.9999999999999999.
    let naive = 0;
    for (let i = 0; i < 10; i += 1) naive += 0.1;
    expect(naive).not.toBe(1);

    let running = 0;
    for (let i = 0; i < 10; i += 1) running = toCents(running + 0.1);
    expect(running).toBe(1);
  });

  it("is idempotent, so re-saving a stored figure never moves it", () => {
    for (const value of [204000.12, -1250.01, 0.01, 82000]) {
      expect(toCents(toCents(value))).toBe(toCents(value));
    }
  });

  it("leaves the tolerance wide enough for rounded inputs, tight enough for a cent", () => {
    expect(CENT).toBeLessThan(0.01);
    expect(CENT).toBeGreaterThan(0);
  });
});
