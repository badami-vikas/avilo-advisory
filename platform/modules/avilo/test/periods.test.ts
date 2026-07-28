import { describe, expect, it } from "vitest";
import {
  addMonths,
  fiscalYearOf,
  fiscalYearToDate,
  formatPeriod,
  isPeriod,
  parsePeriodHeader,
  periodRange,
  priorMonth,
  priorYearSameMonth,
  trailingMonths,
} from "../src/periods.js";

describe("period validation", () => {
  it("accepts well-formed periods and rejects malformed ones", () => {
    expect(isPeriod("2024-10")).toBe(true);
    expect(isPeriod("2024-13")).toBe(false);
    expect(isPeriod("2024-00")).toBe(false);
    expect(isPeriod("2024-1")).toBe(false);
    expect(isPeriod("Oct 2024")).toBe(false);
  });
});

describe("period arithmetic", () => {
  it("crosses year boundaries in both directions", () => {
    expect(addMonths("2024-01", -1)).toBe("2023-12");
    expect(addMonths("2024-12", 1)).toBe("2025-01");
    expect(addMonths("2024-10", -22)).toBe("2022-12");
    expect(addMonths("2024-10", 15)).toBe("2026-01");
  });

  it("gives prior month and prior-year comparatives", () => {
    expect(priorMonth("2024-01")).toBe("2023-12");
    expect(priorYearSameMonth("2024-10")).toBe("2023-10");
  });

  it("builds inclusive ranges and returns empty for inverted ranges", () => {
    expect(periodRange("2024-10", "2025-01")).toEqual([
      "2024-10",
      "2024-11",
      "2024-12",
      "2025-01",
    ]);
    expect(periodRange("2024-10", "2024-10")).toEqual(["2024-10"]);
    expect(periodRange("2025-01", "2024-10")).toEqual([]);
  });

  it("builds a trailing 12-month window ending at the given period", () => {
    const window = trailingMonths("2024-10", 12);
    expect(window).toHaveLength(12);
    expect(window[0]).toBe("2023-11");
    expect(window[11]).toBe("2024-10");
  });
});

describe("fiscal years", () => {
  it("uses the calendar year for a January start", () => {
    expect(fiscalYearOf("2024-10", 1)).toEqual({
      label: "FY 2024",
      start: "2024-01",
      end: "2024-12",
    });
  });

  it("handles a non-January start on both sides of the boundary", () => {
    expect(fiscalYearOf("2024-10", 4).start).toBe("2024-04");
    expect(fiscalYearOf("2024-10", 4).end).toBe("2025-03");
    expect(fiscalYearOf("2024-02", 4).start).toBe("2023-04");
  });

  it("truncates the year-to-date range at the requested period", () => {
    const ytd = fiscalYearToDate("2024-10", 1);
    expect(ytd.start).toBe("2024-01");
    expect(ytd.end).toBe("2024-10");
    expect(periodRange(ytd.start, ytd.end)).toHaveLength(10);
  });
});

describe("parsePeriodHeader — QuickBooks column headers", () => {
  it("parses the header shapes QuickBooks emits", () => {
    expect(parsePeriodHeader("Oct 2024")).toBe("2024-10");
    expect(parsePeriodHeader("October 2024")).toBe("2024-10");
    expect(parsePeriodHeader("OCT 2024")).toBe("2024-10");
    expect(parsePeriodHeader("Oct-24")).toBe("2024-10");
    expect(parsePeriodHeader("10/2024")).toBe("2024-10");
    expect(parsePeriodHeader("2024-10")).toBe("2024-10");
    expect(parsePeriodHeader("Sept 2024")).toBe("2024-09");
  });

  it("normalises 'Jun 2026' and 'June 2026' to the same period", () => {
    // The v9 session had to add normalisation for exactly this pair.
    expect(parsePeriodHeader("Jun 2026")).toBe(parsePeriodHeader("June 2026"));
  });

  // The regression that mattered most: the prototype read the trailing "Total" column
  // as the reporting month, so Net Operating Income showed a year's figure.
  it("refuses aggregate columns rather than treating them as a month", () => {
    expect(parsePeriodHeader("Total")).toBeNull();
    expect(parsePeriodHeader("TOTAL")).toBeNull();
    expect(parsePeriodHeader("Ytd")).toBeNull();
    expect(parsePeriodHeader("Year to date")).toBeNull();
    expect(parsePeriodHeader("% of Income")).toBeNull();
    expect(parsePeriodHeader("Variance")).toBeNull();
  });

  // A date RANGE is not a period. A loose pattern took the month from one end and the
  // year from the other, so "November 2023 - October 2024" resolved to 2024-11 and the
  // importer invented a thirteenth month holding a stray fact.
  it("refuses a date range rather than inventing a period from its two ends", () => {
    expect(parsePeriodHeader("November 2023 - October 2024")).toBeNull();
    expect(parsePeriodHeader("Nov 2023 - Oct 2024")).toBeNull();
    expect(parsePeriodHeader("January 2024 to December 2024")).toBeNull();
    expect(parsePeriodHeader("01/2024 - 12/2024")).toBeNull();
  });

  it("does not bite the leading digits off a four-digit year", () => {
    // "Nov 2023" must not be read as day 20 of year 23.
    expect(parsePeriodHeader("Nov 2023")).toBe("2023-11");
    expect(parsePeriodHeader("December 2023")).toBe("2023-12");
  });

  it("still parses a single dated header with a day component", () => {
    expect(parsePeriodHeader("October 31, 2024")).toBe("2024-10");
    expect(parsePeriodHeader("Oct 1 - 31, 2024")).toBe("2024-10");
  });

  it("refuses a period name embedded mid-sentence", () => {
    expect(parsePeriodHeader("Prepared for review in Oct 2024")).toBeNull();
  });

  it("refuses non-period text and non-strings", () => {
    expect(parsePeriodHeader("")).toBeNull();
    expect(parsePeriodHeader("Account")).toBeNull();
    expect(parsePeriodHeader(null)).toBeNull();
    expect(parsePeriodHeader(42)).toBeNull();
  });
});

describe("formatPeriod", () => {
  it("renders a period for display", () => {
    expect(formatPeriod("2024-10")).toBe("Oct 2024");
    expect(formatPeriod("2024-01")).toBe("Jan 2024");
  });
});
