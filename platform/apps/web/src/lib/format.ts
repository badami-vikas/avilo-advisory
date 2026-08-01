const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const currencyPrecise = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** Compact money for table cells: $214M, $18.6M, $42K. */
export function money(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${sign}$${Math.round(abs / 1_000)}K`;
  return currency.format(value);
}

export function moneyFull(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return currencyPrecise.format(value);
}

export function percent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined) return "—";
  return `${value.toFixed(digits)}%`;
}

export function days(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${Math.round(value)} days`;
}

export function count(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return integer.format(value);
}

/**
 * Parse a hand-typed figure, tolerating what people actually type into a financial
 * table: "$1,234.56", "(1,234)" for a negative, "41.8%".
 *
 * Throws rather than returning NaN or 0 — a silently-zeroed figure in an accounting
 * application is the worst possible outcome of a typo.
 */
export function parseFigure(raw: string): number {
  let text = raw.trim();
  if (text === "") throw new Error("Enter a number, or press Escape to cancel.");
  let negative = false;
  // Accounting notation: parentheses mean negative.
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  const numeric = Number(text.replace(/[$,\s%]/g, ""));
  if (!Number.isFinite(numeric)) throw new Error(`"${raw}" is not a number.`);
  return negative ? -numeric : numeric;
}

export function byUnit(
  value: number | null | undefined,
  unit: string | undefined,
): string {
  switch (unit) {
    case "percent":
      return percent(value);
    case "days":
      return days(value);
    case "count":
      return count(value);
    case "ratio":
      return value === null || value === undefined ? "—" : value.toFixed(2);
    default:
      return moneyFull(value);
  }
}
