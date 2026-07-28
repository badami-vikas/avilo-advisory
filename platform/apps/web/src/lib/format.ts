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
