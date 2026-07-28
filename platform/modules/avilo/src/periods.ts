// Period algebra.
//
// A period is an ISO year-month string, "2024-10". Chosen deliberately: it sorts
// lexicographically, so every range query is a BETWEEN and never index arithmetic over
// spreadsheet columns. The prototype's `row.length - 1` bug — which silently selected
// QuickBooks' trailing "Total" column instead of the reporting month — is not
// expressible in this model.

export type Period = string;

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isPeriod(value: unknown): value is Period {
  return typeof value === "string" && PERIOD_RE.test(value);
}

export function assertPeriod(value: unknown): Period {
  if (!isPeriod(value)) throw new Error(`Invalid period: ${String(value)}`);
  return value;
}

export function makePeriod(year: number, month1to12: number): Period {
  if (month1to12 < 1 || month1to12 > 12) {
    throw new Error(`Month out of range: ${month1to12}`);
  }
  return `${String(year).padStart(4, "0")}-${String(month1to12).padStart(2, "0")}`;
}

export function periodYear(p: Period): number {
  return Number(assertPeriod(p).slice(0, 4));
}

export function periodMonth(p: Period): number {
  return Number(assertPeriod(p).slice(5, 7));
}

/** Shift a period by N months, forward or backward. */
export function addMonths(p: Period, delta: number): Period {
  const total = periodYear(p) * 12 + (periodMonth(p) - 1) + delta;
  return makePeriod(Math.floor(total / 12), (total % 12) + 1);
}

export function priorMonth(p: Period): Period {
  return addMonths(p, -1);
}

export function priorYearSameMonth(p: Period): Period {
  return addMonths(p, -12);
}

/** Inclusive list of periods from `start` to `end`. */
export function periodRange(start: Period, end: Period): Period[] {
  assertPeriod(start);
  assertPeriod(end);
  if (start > end) return [];
  const out: Period[] = [];
  let cursor = start;
  while (cursor <= end) {
    out.push(cursor);
    cursor = addMonths(cursor, 1);
  }
  return out;
}

/** Trailing N months ending at (and including) `end`. */
export function trailingMonths(end: Period, count: number): Period[] {
  if (count <= 0) return [];
  return periodRange(addMonths(end, -(count - 1)), end);
}

export interface FiscalYear {
  label: string;
  start: Period;
  end: Period;
}

/**
 * The fiscal year containing `p`, for a client whose FY begins in `fyStartMonth`
 * (1 = January, the product default for US calendar-year filers).
 */
export function fiscalYearOf(p: Period, fyStartMonth = 1): FiscalYear {
  if (fyStartMonth < 1 || fyStartMonth > 12) {
    throw new Error(`Invalid fiscal year start month: ${fyStartMonth}`);
  }
  const year = periodYear(p);
  const month = periodMonth(p);
  const startYear = month >= fyStartMonth ? year : year - 1;
  const start = makePeriod(startYear, fyStartMonth);
  const end = addMonths(start, 11);
  const label =
    fyStartMonth === 1
      ? `FY ${startYear}`
      : `FY ${startYear}–${String(startYear + 1).slice(2)}`;
  return { label, start, end };
}

/**
 * Current fiscal year *to date*: FY start through `p` inclusive. This is the default
 * range offered by the PDF export dialog.
 */
export function fiscalYearToDate(p: Period, fyStartMonth = 1): FiscalYear {
  const fy = fiscalYearOf(p, fyStartMonth);
  return { ...fy, end: p };
}

/**
 * Display formatter. Tolerant by design: a formatter that throws takes a whole page
 * down over one empty cell. Logic paths that genuinely require a valid period use
 * `assertPeriod`, which still throws.
 */
export function formatPeriod(p: Period | null | undefined): string {
  if (!isPeriod(p)) return "—";
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${months[periodMonth(p) - 1]} ${periodYear(p)}`;
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

/**
 * Parse a QuickBooks column header into a period.
 *
 * QuickBooks exports headers in several shapes across report types and locales:
 * "Oct 2024", "October 2024", "Oct-24", "10/2024", "2024-10", "Oct 1 - 31, 2024".
 * Returns null for anything that is not a period — importantly including "Total",
 * which is what the prototype mistook for the reporting month.
 */
export function parsePeriodHeader(header: unknown): Period | null {
  if (typeof header !== "string") return null;
  const text = header.trim().toLowerCase();
  if (text === "") return null;

  // Explicit non-period columns seen in QuickBooks exports.
  if (/^(total|ytd|year to date|% of income|variance|change|budget|average|avg)\b/.test(text)) {
    return null;
  }

  if (PERIOD_RE.test(text)) return text;

  // "oct 2024" | "october 2024" | "oct 1 - 31, 2024" | "oct-24" | "oct '24"
  const named = text.match(/\b([a-z]{3,9})\b[^0-9a-z]*(?:\d{1,2}[^0-9]*(?:-|–|to)?[^0-9]*\d{0,2}[^0-9]*)?'?(\d{2,4})\b/);
  if (named) {
    const month = MONTH_NAMES[named[1] as string];
    const rawYear = named[2] as string;
    if (month) {
      const year = rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear);
      if (year >= 1900 && year <= 2200) return makePeriod(year, month);
    }
  }

  // "10/2024" | "10-2024"
  const numeric = text.match(/^(\d{1,2})[\/\-](\d{4})$/);
  if (numeric) {
    const month = Number(numeric[1]);
    const year = Number(numeric[2]);
    if (month >= 1 && month <= 12) return makePeriod(year, month);
  }

  // "2024/10"
  const iso = text.match(/^(\d{4})[\/\-](\d{1,2})$/);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    if (month >= 1 && month <= 12) return makePeriod(year, month);
  }

  return null;
}
