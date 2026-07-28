import { describe, expect, it } from "vitest";
import {
  displayValue,
  resolveImport,
  type OverrideRecord,
} from "../src/overrides.js";

const override = (patch: Partial<OverrideRecord> = {}): OverrideRecord => ({
  id: "ov1",
  clientId: "c1",
  period: "2024-10",
  targetKind: "account",
  targetId: "pl.revenue",
  value: 195_000,
  status: "active",
  ...patch,
});

describe("displayValue precedence", () => {
  it("shows an active override in preference to the imported fact", () => {
    expect(displayValue(200_000, override())).toEqual({
      value: 195_000,
      source: "override",
      divergesFrom: 200_000,
    });
  });

  it("does not report divergence when the override agrees with the fact", () => {
    const result = displayValue(195_000, override());
    expect(result.source).toBe("override");
    expect(result.divergesFrom).toBeUndefined();
  });

  it("shows an override that has no underlying fact", () => {
    expect(displayValue(undefined, override())).toEqual({
      value: 195_000,
      source: "override",
    });
  });

  it("ignores a superseded override and falls back to the fact", () => {
    expect(displayValue(200_000, override({ status: "superseded" }))).toEqual({
      value: 200_000,
      source: "fact",
    });
  });

  it("reports missing when there is neither a fact nor an override", () => {
    expect(displayValue(undefined, undefined)).toEqual({
      value: null,
      source: "missing",
    });
  });
});

describe("resolveImport — fresh import supersedes an override", () => {
  it("writes the fact and supersedes a conflicting override", () => {
    const result = resolveImport(
      [{ period: "2024-10", accountId: "pl.revenue", value: 200_000 }],
      [override()],
    );

    expect(result.actions).toContainEqual({
      kind: "write_fact",
      period: "2024-10",
      accountId: "pl.revenue",
      value: 200_000,
    });
    expect(result.actions).toContainEqual({
      kind: "supersede_override",
      overrideId: "ov1",
      supersededValue: 200_000,
      reason: "Replaced by a newer imported value",
    });
    expect(result.notices[0]).toMatch(/can be restored/);
  });

  it("never emits a delete — the override is retained for restore", () => {
    const result = resolveImport(
      [{ period: "2024-10", accountId: "pl.revenue", value: 200_000 }],
      [override()],
    );
    expect(result.actions.some((a) => a.kind.includes("delete"))).toBe(false);
  });

  it("leaves the override alone when the import agrees with it", () => {
    const result = resolveImport(
      [{ period: "2024-10", accountId: "pl.revenue", value: 195_000 }],
      [override()],
    );
    expect(result.actions.filter((a) => a.kind === "supersede_override")).toHaveLength(0);
    expect(result.notices).toHaveLength(0);
  });

  it("does not touch an override for a different period", () => {
    const result = resolveImport(
      [{ period: "2024-11", accountId: "pl.revenue", value: 210_000 }],
      [override({ period: "2024-10" })],
    );
    expect(result.actions.filter((a) => a.kind === "supersede_override")).toHaveLength(0);
  });

  it("does not touch an override for a different account", () => {
    const result = resolveImport(
      [{ period: "2024-10", accountId: "pl.cogs", value: 120_000 }],
      [override({ targetId: "pl.revenue" })],
    );
    expect(result.actions.filter((a) => a.kind === "supersede_override")).toHaveLength(0);
  });

  it("does not supersede a metric override from an account import", () => {
    const result = resolveImport(
      [{ period: "2024-10", accountId: "pl.revenue", value: 200_000 }],
      [override({ targetKind: "metric", targetId: "net_operating_income" })],
    );
    expect(result.actions.filter((a) => a.kind === "supersede_override")).toHaveLength(0);
  });

  it("ignores overrides that were already superseded", () => {
    const result = resolveImport(
      [{ period: "2024-10", accountId: "pl.revenue", value: 200_000 }],
      [override({ status: "superseded" })],
    );
    expect(result.actions.filter((a) => a.kind === "supersede_override")).toHaveLength(0);
  });
});
