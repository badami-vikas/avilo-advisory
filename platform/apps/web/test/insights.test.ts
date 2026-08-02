/**
 * Tests for the insight engine.
 *
 * This is the one part of the dashboard where a bug is invisible: a chart that fails to
 * draw is obvious, but a number that is confidently wrong looks exactly like a number
 * that is right. Every assertion here is about a judgement the engine makes on the
 * advisor's behalf — what "up" means, what counts as concentrated, when a projection runs
 * out of money — because those are what end up in front of a client.
 */

import { describe, expect, it } from "vitest";

import {
  agingDistribution,
  dimensionDirection,
  dimensionStory,
  growthQuality,
  collectionPriority,
  concentration,
  forecast,
  healthScore,
  movement,
  movements,
  narrative,
  periodEnd,
  trendPct,
  warnings,
} from "../src/app/dashboard/insights.js";
import type {
  DetailByKind,
  DetailRow,
  PeriodReport,
  SeriesPoint,
} from "../src/app/types.js";

/* ---------------------------------------------------------------- fixtures */

function point(period: string, values: Record<string, number | null>): SeriesPoint {
  return { period, periodLabel: period, values } as SeriesPoint;
}

function detailRow(over: Partial<DetailRow> & { label: string; value: number }): DetailRow {
  return {
    id: `${over.label}-${over.bucket ?? "x"}`,
    clientId: "c",
    period: "2024-10",
    kind: "customer_sales",
    bucket: null,
    count: null,
    sourceFileId: null,
    createdAt: "",
    ...over,
  } as DetailRow;
}

function makeReport(over: {
  accounts?: Record<string, number | null>;
  metrics?: Record<string, number | null>;
}): PeriodReport {
  return {
    period: "2024-10",
    periodLabel: "Oct 2024",
    accounts: Object.entries(over.accounts ?? {}).map(([accountId, value]) => ({
      accountId,
      label: accountId,
      unit: "currency",
      description: null,
      value,
      source: value === null ? "missing" : "fact",
      requiredButMissing: false,
    })),
    metrics: Object.entries(over.metrics ?? {}).map(([id, value]) => ({
      id,
      label: id,
      value,
      status: value === null ? "missing_inputs" : "ok",
      missing: [],
    })),
    missingRequired: [],
    complete: true,
  } as unknown as PeriodReport;
}

/* --------------------------------------------------------------- movement */

describe("movement", () => {
  const series = [
    point("2024-08", { rev: 100 }),
    point("2024-09", { rev: 200 }),
    point("2024-10", { rev: 210 }),
  ];

  it("compares the last two readings that exist", () => {
    const result = movement(series, "rev");
    expect(result.current).toBe(210);
    expect(result.previous).toBe(200);
    expect(result.changePct).toBeCloseTo(5);
    expect(result.direction).toBe("up");
  });

  /**
   * A gap in the middle of a series is a month that was never imported, not a month with
   * no revenue. Comparing against the nearest month that *does* have a reading is the
   * only honest option; treating the gap as zero would report a collapse and a recovery
   * that never happened.
   */
  it("skips missing readings rather than treating them as zero", () => {
    const gapped = [
      point("2024-08", { rev: 100 }),
      point("2024-09", { rev: null }),
      point("2024-10", { rev: 110 }),
    ];
    expect(movement(gapped, "rev").previous).toBe(100);
  });

  /** A percentage change off a zero base is infinite and meaningless in prose. */
  it("refuses a percentage against a zero base", () => {
    const fromZero = [point("2024-09", { rev: 0 }), point("2024-10", { rev: 500 })];
    const result = movement(fromZero, "rev");
    expect(result.change).toBe(500);
    expect(result.changePct).toBeNull();
  });

  it("calls a sub-2% move flat rather than a direction", () => {
    const nearly = [point("2024-09", { rev: 1000 }), point("2024-10", { rev: 1008 })];
    expect(movement(nearly, "rev").direction).toBe("flat");
  });

  it("reports unknown when there is only one month", () => {
    expect(movement([point("2024-10", { rev: 5 })], "rev").direction).toBe("unknown");
  });
});

describe("trendPct", () => {
  it("needs at least three readings before calling a direction", () => {
    expect(trendPct([point("a", { m: 1 }), point("b", { m: 2 })], "m", 6)).toBeNull();
  });

  it("reads a rising line as positive and a falling one as negative", () => {
    const rising = [10, 12, 14, 16].map((v, i) => point(`p${i}`, { m: v }));
    const falling = [16, 14, 12, 10].map((v, i) => point(`p${i}`, { m: v }));
    expect(trendPct(rising, "m", 6)!).toBeGreaterThan(0);
    expect(trendPct(falling, "m", 6)!).toBeLessThan(0);
  });
});

/* ----------------------------------------------------------- concentration */

describe("concentration", () => {
  it("ranks by size and counts how many customers reach 80%", () => {
    const result = concentration([
      detailRow({ label: "Big", value: 700 }),
      detailRow({ label: "Middle", value: 200 }),
      detailRow({ label: "Small", value: 100 }),
    ]);
    expect(result.rows[0]?.label).toBe("Big");
    expect(result.topShare).toBeCloseTo(70);
    // 70% then 90% — two customers to clear the 80% line.
    expect(result.customersTo80).toBe(2);
  });

  it("returns nothing rather than dividing by zero on an empty book", () => {
    const result = concentration([]);
    expect(result.topShare).toBeNull();
    expect(result.rows).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ ageing */

describe("agingDistribution", () => {
  /**
   * The distribution comes from the bucket accounts, never from the per-customer detail
   * rows: a detail row carries only the single bucket holding most of that customer's
   * balance, so summing them would put a customer's entire balance in their worst bucket.
   */
  it("builds slices from the bucket accounts and reports the overdue share", () => {
    const report = makeReport({
      accounts: {
        "ar.current": 5000,
        "ar.1_30": 3000,
        "ar.31_60": 1000,
        "ar.61_90": 500,
        "ar.91_plus": 500,
      },
    });
    const result = agingDistribution(report, "ar");
    expect(result.total).toBe(10000);
    // Overdue means past 30 days: 1000 + 500 + 500 of 10000.
    expect(result.overdueShare).toBeCloseTo(20);
    expect(result.slices).toHaveLength(5);
  });

  it("says nothing when the buckets were never imported", () => {
    expect(agingDistribution(makeReport({}), "ar").overdueShare).toBeNull();
  });
});

describe("collectionPriority", () => {
  /**
   * The whole point of the weighting: a small very-late balance can outrank a larger
   * current one, because that is the order a person would actually work down.
   */
  it("puts an older balance ahead of a larger newer one", () => {
    const ordered = collectionPriority([
      detailRow({ label: "Recent", value: 10_000, bucket: "current" }),
      detailRow({ label: "Ancient", value: 4_000, bucket: "91_plus" }),
    ]);
    expect(ordered[0]?.label).toBe("Ancient");
  });
});

/* --------------------------------------------------------------- movements */

describe("movements", () => {
  it("keeps a line that exists in only one of the two periods", () => {
    const result = movements(
      [detailRow({ label: "New line", value: 500 })],
      [detailRow({ label: "Stopped line", value: 300 })],
      10,
    );
    expect(result.rows.map((row) => row.label).sort()).toEqual([
      "New line",
      "Stopped line",
    ]);
    expect(result.net).toBe(200);
  });

  /** A waterfall that does not reconcile to the total is worse than no waterfall. */
  it("rolls everything past the limit into one bar so the steps still sum to the net", () => {
    const current = Array.from({ length: 10 }, (_, i) =>
      detailRow({ label: `L${i}`, value: (i + 1) * 100 }),
    );
    const result = movements(current, [], 3);
    const summed = result.rows.reduce((sum, row) => sum + row.change, 0);
    expect(summed).toBeCloseTo(result.net);
    expect(result.rows.at(-1)?.label).toBe("7 smaller lines");
  });
});

/* ---------------------------------------------------------------- forecast */

describe("forecast", () => {
  const series = [
    point("2024-08", { "pl.revenue": 30_000, "pl.cogs": 12_000, "pl.overhead": 12_000 }),
    point("2024-09", { "pl.revenue": 30_000, "pl.cogs": 12_000, "pl.overhead": 12_000 }),
    point("2024-10", { "pl.revenue": 30_000, "pl.cogs": 12_000, "pl.overhead": 12_000 }),
  ];
  const report = makeReport({ accounts: { "bs.cash": 50_000 } });
  const flat = { revenueChangePct: 0, costChangePct: 0, collectionDays: 30 };

  it("projects thirteen weeks from the opening balance", () => {
    const result = forecast(report, series, flat);
    expect(result.weeks).toHaveLength(13);
    expect(result.startingCash).toBe(50_000);
    // Profitable and collecting on time: the balance should never go under.
    expect(result.breachWeek).toBeNull();
  });

  it("finds the week the balance turns negative once costs outrun revenue", () => {
    const result = forecast(report, series, { ...flat, revenueChangePct: -90 });
    expect(result.breachWeek).not.toBeNull();
    expect(result.low).toBeLessThan(0);
  });

  /**
   * Collection delay moves cash in time without changing profit — so a longer delay must
   * lower the trough even when the business is comfortably profitable.
   */
  it("makes slower collection dig a deeper hole without changing profitability", () => {
    const fast = forecast(report, series, { ...flat, collectionDays: 30 });
    const slow = forecast(report, series, { ...flat, collectionDays: 90 });
    expect(slow.low).toBeLessThan(fast.low);
  });

  it("refuses to project rather than assuming an opening balance", () => {
    const result = forecast(makeReport({}), series, flat);
    expect(result.unavailable).toMatch(/opening cash/i);
    expect(result.weeks).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ health */

describe("healthScore", () => {
  it("scores only the dimensions it has inputs for, and says why for the rest", () => {
    const report = makeReport({
      metrics: { noi_margin_pct: 10, days_cash_on_hand: 45 },
    });
    const health = healthScore(report, [], {});
    expect(health.scored).toBe(2);

    const profitability = health.dimensions.find((d) => d.id === "profitability");
    // 10% against a 0–20 band is the midpoint.
    expect(profitability?.score).toBeCloseTo(50);

    const collection = health.dimensions.find((d) => d.id === "collection");
    expect(collection?.score).toBeNull();
    expect(collection?.missing).toBeTruthy();
  });

  /** Fewer days is better, so the scale has to run backwards for collection. */
  it("inverts the dimensions where a smaller number is healthier", () => {
    const quick = healthScore(makeReport({ metrics: { dso: 15 } }), [], {});
    const slow = healthScore(makeReport({ metrics: { dso: 60 } }), [], {});
    expect(quick.dimensions.find((d) => d.id === "collection")?.score).toBe(100);
    expect(slow.dimensions.find((d) => d.id === "collection")?.score).toBe(0);
  });

  it("returns unknown rather than zero when nothing can be scored", () => {
    const health = healthScore(makeReport({}), [], {});
    expect(health.overall).toBeNull();
    expect(health.band).toBe("unknown");
  });
});

/* ---------------------------------------------------------------- warnings */

describe("warnings", () => {
  const detail: DetailByKind = {
    customer_sales: [
      detailRow({ label: "One Big Client", value: 800 }),
      detailRow({ label: "Everyone else", value: 200 }),
    ],
  } as DetailByKind;

  it("raises concentration from the customer book, ranked by severity", () => {
    const report = makeReport({ metrics: { noi_margin_pct: 15 } });
    const result = warnings(report, [], detail, [], {
      weeks: [],
      breachWeek: null,
      low: 0,
      startingCash: 0,
    });
    const concentrationWarning = result.find((w) => w.id === "concentration");
    expect(concentrationWarning?.severity).toBe("critical");
    // Critical sorts to the front.
    expect(result[0]?.id).toBe("concentration");
  });

  it("reports a projected cash breach as critical", () => {
    const result = warnings(makeReport({}), [], {} as DetailByKind, [], {
      weeks: [],
      breachWeek: 7,
      low: -1000,
      startingCash: 500,
    });
    expect(result.find((w) => w.id === "cash-breach")?.severity).toBe("critical");
  });
});

/* --------------------------------------------------------------- narrative */

describe("narrative", () => {
  const empty = { weeks: [], breachWeek: null, low: 0, startingCash: 0 };

  it("always produces the five beats in order", () => {
    const beats = narrative(
      makeReport({}),
      [],
      {} as DetailByKind,
      healthScore(makeReport({}), [], {}),
      empty,
      [],
      [],
    );
    expect(beats.map((beat) => beat.id)).toEqual(["what", "why", "risk", "next", "act"]);
  });

  /**
   * The story has to change with the data — that is the entire claim being made for it.
   * A month that grew and a month that shrank must not read the same.
   */
  it("changes headline and tone with the direction of the month", () => {
    const health = healthScore(makeReport({}), [], {});
    const grew = narrative(
      makeReport({}),
      [point("2024-09", { "pl.revenue": 100 }), point("2024-10", { "pl.revenue": 150 })],
      {} as DetailByKind,
      health,
      empty,
      [],
      [],
    );
    const shrank = narrative(
      makeReport({}),
      [point("2024-09", { "pl.revenue": 150 }), point("2024-10", { "pl.revenue": 100 })],
      {} as DetailByKind,
      health,
      empty,
      [],
      [],
    );

    expect(grew[0]?.tone).toBe("positive");
    expect(shrank[0]?.tone).toBe("negative");
    expect(grew[0]?.headline).not.toBe(shrank[0]?.headline);
  });

  it("says the risk beat is clear when nothing is flagged", () => {
    const beats = narrative(
      makeReport({}),
      [],
      {} as DetailByKind,
      healthScore(makeReport({}), [], {}),
      empty,
      [],
      [],
    );
    expect(beats.find((beat) => beat.id === "risk")?.tone).toBe("positive");
  });
});

/* --------------------------------------------------------- growth quality */

describe("growthQuality", () => {
  const current = {
    customer_sales: [
      detailRow({ label: "Rising", value: 600 }),
      detailRow({ label: "Falling", value: 400 }),
    ],
    ar_customer: [detailRow({ label: "Falling", value: 300, bucket: "91_plus" })],
  } as DetailByKind;

  it("measures growth against the prior snapshot and flags payment risk", () => {
    const prior = {
      customer_sales: [
        detailRow({ label: "Rising", value: 400 }),
        detailRow({ label: "Falling", value: 500 }),
      ],
    } as DetailByKind;

    const { points, comparable } = growthQuality(current, prior);
    expect(comparable).toBe(true);

    const rising = points.find((p) => p.label === "Rising")!;
    expect(rising.growthPct).toBeCloseTo(50);
    expect(rising.share).toBeCloseTo(60);
    expect(rising.risk).toBe("low");

    // Most of their balance is over ninety days old, so their revenue is not yet cash.
    expect(points.find((p) => p.label === "Falling")?.risk).toBe("high");
  });

  /**
   * A Sales by Customer export is a rolling twelve-month snapshot. With only one of them
   * there is nothing to compare, and reporting every customer as flat would be a lie
   * dressed as a measurement.
   */
  it("reports that nothing is comparable when there is only one snapshot", () => {
    const { comparable } = growthQuality(current, {} as DetailByKind);
    expect(comparable).toBe(false);
  });
});

/* ----------------------------------------------------- dimension briefing */

describe("dimensionStory", () => {
  const series = [
    point("2024-07", { noi_margin_pct: 12, "pl.revenue": 100 }),
    point("2024-08", { noi_margin_pct: 14, "pl.revenue": 110 }),
    point("2024-09", { noi_margin_pct: 16, "pl.revenue": 120 }),
    point("2024-10", { noi_margin_pct: 18, "pl.revenue": 130 }),
  ];

  it("answers all three questions for a scored dimension", () => {
    const report = makeReport({
      accounts: { "pl.revenue": 130 },
      metrics: { noi_margin_pct: 18 },
    });
    const health = healthScore(report, series, {});
    const profitability = health.dimensions.find((d) => d.id === "profitability")!;
    const story = dimensionStory(profitability, report, series, {} as DetailByKind);

    expect(story.happened).toContain("18.0%");
    expect(story.weakened).toBeTruthy();
    expect(story.attention).toBeTruthy();
  });

  /** A dimension with no inputs must say what is missing, not invent a concern. */
  it("says what is missing rather than manufacturing a finding", () => {
    const report = makeReport({});
    const health = healthScore(report, [], {});
    const collection = health.dimensions.find((d) => d.id === "collection")!;
    const story = dimensionStory(collection, report, [], {} as DetailByKind);

    expect(story.happened).toMatch(/ageing/i);
    expect(story.attention).toMatch(/import/i);
  });
});

describe("dimensionDirection", () => {
  /**
   * Collection days is inverted: fewer is better. A dimension that read a fall as a
   * deterioration would colour the radar backwards on the one axis where it matters most.
   */
  it("reads a fall in an inverted dimension as an improvement", () => {
    const base = {
      id: "collection" as const,
      label: "Collection",
      score: 60,
      value: 30,
      unit: "days",
      basis: "",
      inverted: true,
    };
    expect(dimensionDirection({ ...base, quarterChange: -8 })).toBe("better");
    expect(dimensionDirection({ ...base, quarterChange: 8 })).toBe("worse");
    expect(dimensionDirection({ ...base, quarterChange: null })).toBe("unknown");
    expect(dimensionDirection({ ...base, inverted: false, quarterChange: 8 })).toBe(
      "better",
    );
  });
});

describe("periodEnd", () => {
  /**
   * Every basis chip on the dashboard ends on this date, so a wrong one would put five
   * panels on five different anchors — the exact confusion the chips exist to remove.
   */
  it("gives the last day of the month, not the first of the next", () => {
    expect(periodEnd("2024-10")).toBe("31 Oct 2024");
    expect(periodEnd("2024-02")).toBe("29 Feb 2024");
    expect(periodEnd("2023-02")).toBe("28 Feb 2023");
    expect(periodEnd("2024-12")).toBe("31 Dec 2024");
  });

  it("hands back anything it cannot parse rather than inventing a date", () => {
    expect(periodEnd("not-a-period")).toBe("not-a-period");
  });
});
