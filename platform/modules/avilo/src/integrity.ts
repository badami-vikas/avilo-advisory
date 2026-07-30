// Accounting integrity checks.
//
// The importer's job so far has been to read numbers faithfully. That is not the same as
// the numbers being right: a balance sheet whose two sides disagree, or an A/R ageing
// total that contradicts the receivables figure on the balance sheet, will parse
// perfectly and produce a confident, wrong dashboard.
//
// These are the checks an accountant performs by reflex and software usually never does.
// They are reported as warnings rather than refusals: the source documents are the
// client's, the discrepancy is usually real, and the advisor is the one who should see
// it. Silence is the only unacceptable outcome.

/**
 * Money is stored as a double. Every check here therefore compares with a tolerance
 * rather than `===`: a balance sheet reconstructed from a dozen rounded line items can
 * legitimately land a cent away from its own total, and flagging that as an imbalance
 * would train the user to ignore the warning that matters.
 */
export const CENT = 0.005;

/**
 * Round a monetary amount to whole cents, half away from zero.
 *
 * `Math.round(value * 100) / 100` is the obvious version and it is wrong twice over.
 *
 * Scaling by 100 lands on the wrong side of a half-cent depending on the value: in
 * float64 `1.005 * 100` is 100.49999999999999 but `-1250.005 * 100` is
 * -125000.50000000001, so the same fractional part rounds down in one and away in the
 * other. The epsilon nudge removes that dependence on representation error.
 *
 * And `Math.round` rounds half toward +Infinity, so -0.005 becomes -0.00 while +0.005
 * becomes +0.01. In a column of expenses — which are negative in several of the exports
 * this reads — that is a systematic upward bias. Currency convention is half away from
 * zero, applied here by rounding the magnitude and reapplying the sign.
 */
export function toCents(value: number): number {
  if (!Number.isFinite(value)) return value;
  const scaled = value * 100;
  const rounded = Math.round(Math.abs(scaled) + 1e-9);
  return (scaled < 0 ? -rounded : rounded) / 100;
}

export interface IntegrityFinding {
  code:
    | "balance_sheet_unbalanced"
    | "ar_disagrees_with_ageing"
    | "ap_disagrees_with_ageing"
    | "ageing_buckets_disagree_with_total"
    | "gross_profit_disagrees";
  message: string;
  /** How far apart the two figures are, in currency units. */
  delta: number;
}

export type Amounts = Record<string, number | null | undefined>;

function get(values: Amounts, id: string): number | null {
  const value = values[id];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function money(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

/**
 * Run every check that the supplied figures make possible.
 *
 * Absent inputs are skipped rather than treated as zero. A client who has uploaded only a
 * P&L should see no balance-sheet warnings at all — "your balance sheet is out by the
 * whole of your assets" is noise, not a finding.
 */
export function checkIntegrity(values: Amounts): IntegrityFinding[] {
  const findings: IntegrityFinding[] = [];

  /* ------------------------------------------- the accounting equation */
  const assets = get(values, "bs.total_assets");
  const liabilities = get(values, "bs.total_liabilities");
  const equity = get(values, "bs.equity");

  if (assets !== null && liabilities !== null && equity !== null) {
    const delta = assets - (liabilities + equity);
    if (Math.abs(delta) > CENT) {
      findings.push({
        code: "balance_sheet_unbalanced",
        delta,
        message:
          `Balance sheet does not balance by ${money(Math.abs(delta))}. ` +
          `Assets ${money(assets)} against liabilities plus equity ` +
          `${money(liabilities + equity)}. The export is internally inconsistent, ` +
          `or a row was mapped to the wrong account.`,
      });
    }
  }

  /* ------------------------------- balance sheet against ageing reports */
  const checkAgainstAgeing = (
    balanceId: string,
    ageingId: string,
    code: IntegrityFinding["code"],
    noun: string,
  ) => {
    const onBalanceSheet = get(values, balanceId);
    const onAgeing = get(values, ageingId);
    if (onBalanceSheet === null || onAgeing === null) return;

    const delta = onBalanceSheet - onAgeing;
    if (Math.abs(delta) > CENT) {
      findings.push({
        code,
        delta,
        message:
          `${noun} on the balance sheet (${money(onBalanceSheet)}) does not match the ` +
          `ageing report total (${money(onAgeing)}), a difference of ` +
          `${money(Math.abs(delta))}. The two reports were probably run at different ` +
          `dates, or one predates a payment.`,
      });
    }
  };

  checkAgainstAgeing("bs.ar", "ar.total", "ar_disagrees_with_ageing", "Accounts receivable");
  checkAgainstAgeing("bs.ap", "ap.total", "ap_disagrees_with_ageing", "Accounts payable");

  /* ------------------------------- ageing buckets against their own total */
  for (const [prefix, noun] of [
    ["ar", "A/R ageing"],
    ["ap", "A/P ageing"],
  ] as const) {
    const total = get(values, `${prefix}.total`);
    const buckets = ["current", "1_30", "31_60", "61_90", "91_plus"].map((bucket) =>
      get(values, `${prefix}.${bucket}`),
    );
    // Every bucket must be present: summing a partial set and comparing it to the total
    // would report a shortfall that is really just a column the report did not carry.
    if (total === null || buckets.some((b) => b === null)) continue;

    const summed = buckets.reduce<number>((sum, b) => sum + (b as number), 0);
    const delta = total - summed;
    if (Math.abs(delta) > CENT) {
      findings.push({
        code: "ageing_buckets_disagree_with_total",
        delta,
        message:
          `${noun} buckets sum to ${money(summed)} but the report's own total says ` +
          `${money(total)}, a difference of ${money(Math.abs(delta))}.`,
      });
    }
  }

  /* --------------------------- the P&L's own subtotal against its parts */
  const revenue = get(values, "pl.revenue");
  const cogs = get(values, "pl.cogs");
  const grossProfit = get(values, "pl.gross_profit");
  if (revenue !== null && cogs !== null && grossProfit !== null) {
    const delta = grossProfit - (revenue - cogs);
    if (Math.abs(delta) > CENT) {
      findings.push({
        code: "gross_profit_disagrees",
        delta,
        message:
          `The P&L states gross profit of ${money(grossProfit)}, but revenue less cost ` +
          `of goods sold is ${money(revenue - cogs)}. A line was probably mapped to the ` +
          `wrong section.`,
      });
    }
  }

  return findings;
}
