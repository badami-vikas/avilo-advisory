// Canonical chart of accounts + the built-in label dialect table.
//
// The built-in mappings below are seeds, not law. Every one of them can be overridden
// from the UI, and every user correction is persisted to `label_mappings` and reused.
// That is the structural difference from the prototype, where the equivalent knowledge
// lived in regexes and could only be changed by editing and redeploying code.

export interface AccountDef {
  id: string;
  label: string;
  statement: string;
  role: "total" | "line_item";
  unit: "currency" | "count" | "percent";
  description?: string;
  sortOrder: number;
}

export const CANONICAL_ACCOUNTS: AccountDef[] = [
  // --- Profit & Loss
  {
    id: "pl.revenue",
    label: "Total revenue",
    statement: "pl",
    role: "total",
    unit: "currency",
    description: "Total income for the period.",
    sortOrder: 10,
  },
  {
    id: "pl.cogs",
    label: "Cost of goods sold",
    statement: "pl",
    role: "total",
    unit: "currency",
    description: "Total cost of sales / cost of goods sold.",
    sortOrder: 20,
  },
  {
    id: "pl.overhead",
    label: "Overhead (operating expenses)",
    statement: "pl",
    role: "total",
    unit: "currency",
    description: "Total operating expenses excluding cost of sales.",
    sortOrder: 30,
  },
  {
    id: "pl.other_income",
    label: "Other income",
    statement: "pl",
    role: "total",
    unit: "currency",
    sortOrder: 40,
  },
  {
    id: "pl.other_expense",
    label: "Other expense",
    statement: "pl",
    role: "total",
    unit: "currency",
    sortOrder: 50,
  },
  {
    id: "pl.depreciation",
    label: "Depreciation & amortisation",
    statement: "pl",
    role: "line_item",
    unit: "currency",
    description:
      "Tracked separately so the Top Expenses panel can exclude it, as the v9 review required.",
    sortOrder: 60,
  },

  // --- Balance sheet
  {
    id: "bs.cash",
    label: "Total cash in bank accounts",
    statement: "balance_sheet",
    role: "total",
    unit: "currency",
    sortOrder: 110,
  },
  {
    id: "bs.ar",
    label: "Accounts receivable",
    statement: "balance_sheet",
    role: "total",
    unit: "currency",
    sortOrder: 120,
  },
  {
    id: "bs.ap",
    label: "Accounts payable",
    statement: "balance_sheet",
    role: "total",
    unit: "currency",
    sortOrder: 130,
  },
  {
    id: "bs.total_assets",
    label: "Total assets",
    statement: "balance_sheet",
    role: "total",
    unit: "currency",
    sortOrder: 140,
  },
  {
    id: "bs.total_liabilities",
    label: "Total liabilities",
    statement: "balance_sheet",
    role: "total",
    unit: "currency",
    sortOrder: 150,
  },
  {
    id: "bs.equity",
    label: "Total equity",
    statement: "balance_sheet",
    role: "total",
    unit: "currency",
    sortOrder: 160,
  },

  // --- A/R ageing buckets
  {
    id: "ar.current",
    label: "A/R current",
    statement: "ar_aging",
    role: "total",
    unit: "currency",
    sortOrder: 310,
  },
  {
    id: "ar.1_30",
    label: "A/R 1–30 days",
    statement: "ar_aging",
    role: "total",
    unit: "currency",
    sortOrder: 320,
  },
  {
    id: "ar.31_60",
    label: "A/R 31–60 days",
    statement: "ar_aging",
    role: "total",
    unit: "currency",
    sortOrder: 330,
  },
  {
    id: "ar.61_90",
    label: "A/R 61–90 days",
    statement: "ar_aging",
    role: "total",
    unit: "currency",
    sortOrder: 340,
  },
  {
    id: "ar.91_plus",
    label: "A/R 91+ days",
    statement: "ar_aging",
    role: "total",
    unit: "currency",
    sortOrder: 350,
  },
  {
    id: "ar.total",
    label: "Total accounts receivable (ageing)",
    statement: "ar_aging",
    role: "total",
    unit: "currency",
    sortOrder: 360,
  },

  // --- A/P ageing buckets
  {
    id: "ap.current",
    label: "A/P current",
    statement: "ap_aging",
    role: "total",
    unit: "currency",
    sortOrder: 410,
  },
  {
    id: "ap.1_30",
    label: "A/P 1–30 days",
    statement: "ap_aging",
    role: "total",
    unit: "currency",
    sortOrder: 420,
  },
  {
    id: "ap.31_60",
    label: "A/P 31–60 days",
    statement: "ap_aging",
    role: "total",
    unit: "currency",
    sortOrder: 430,
  },
  {
    id: "ap.61_90",
    label: "A/P 61–90 days",
    statement: "ap_aging",
    role: "total",
    unit: "currency",
    sortOrder: 440,
  },
  {
    id: "ap.91_plus",
    label: "A/P 91+ days",
    statement: "ap_aging",
    role: "total",
    unit: "currency",
    sortOrder: 450,
  },
  {
    id: "ap.total",
    label: "Total accounts payable (ageing)",
    statement: "ap_aging",
    role: "total",
    unit: "currency",
    sortOrder: 460,
  },

  // --- Operational
  {
    id: "ops.job_count",
    label: "Jobs completed",
    statement: "sales_by_customer",
    role: "total",
    unit: "count",
    description:
      "Inferred as the number of distinct customers billed in the period unless the export carries an explicit job count.",
    sortOrder: 510,
  },
  {
    id: "ops.customer_count",
    label: "Customers billed",
    statement: "sales_by_customer",
    role: "total",
    unit: "count",
    sortOrder: 520,
  },
  {
    id: "ops.referral_total",
    label: "Referred revenue (last 90 days)",
    statement: "referral",
    role: "total",
    unit: "currency",
    sortOrder: 610,
  },
];

/** The ageing buckets, in the order QuickBooks prints them. */
export const AGING_BUCKETS = [
  { id: "current", label: "Current", patterns: [/^current$/i, /^not (yet )?due$/i] },
  { id: "1_30", label: "1–30 days", patterns: [/^1\s*[-–]\s*30$/, /^1\s*[-–]\s*30 days$/i] },
  { id: "31_60", label: "31–60 days", patterns: [/^31\s*[-–]\s*60$/, /^31\s*[-–]\s*60 days$/i] },
  { id: "61_90", label: "61–90 days", patterns: [/^61\s*[-–]\s*90$/, /^61\s*[-–]\s*90 days$/i] },
  {
    id: "91_plus",
    label: "91+ days",
    patterns: [/^91/, /over 90/i, /91 and over/i, /^>\s*90$/],
  },
] as const;

export type AgingBucketId = (typeof AGING_BUCKETS)[number]["id"];

export function matchAgingBucket(header: string): AgingBucketId | null {
  const text = header.trim();
  for (const bucket of AGING_BUCKETS) {
    if (bucket.patterns.some((p) => p.test(text))) return bucket.id;
  }
  return null;
}

export const ACCOUNTS_BY_ID = new Map(CANONICAL_ACCOUNTS.map((a) => [a.id, a]));

/**
 * Normalise a source row label for matching.
 *
 * Lowercase, strip punctuation, collapse whitespace. "Total for Income:" and
 * "TOTAL FOR INCOME" both become "total for income", so the dialect problem reduces to
 * a table lookup instead of an ever-growing regex.
 */
export function normalizeLabel(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[‘’“”]/g, "")
    .replace(/[^a-z0-9%&/ -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface BuiltinMapping {
  reportType: string;
  normalizedLabel: string;
  accountId: string;
}

function seed(
  reportType: string,
  accountId: string,
  labels: string[],
): BuiltinMapping[] {
  return labels.map((label) => ({
    reportType,
    normalizedLabel: normalizeLabel(label),
    accountId,
  }));
}

/**
 * Built-in QuickBooks dialects.
 *
 * The "total for X" family is included because that exact wording is what QuickBooks
 * Online actually emits and what broke the v9 parser — every field came back empty
 * because the regex expected "Total X". Both orders are seeded here, and anything else
 * the user encounters is a one-time click in the import review screen.
 */
export const BUILTIN_LABEL_MAPPINGS: BuiltinMapping[] = [
  ...seed("profit_and_loss", "pl.revenue", [
    "Total Income",
    "Total for Income",
    "Total Revenue",
    "Total for Revenue",
    "Income",
    "Total Sales",
    "Total Operating Income",
    "Total for Operating Income",
  ]),
  ...seed("profit_and_loss", "pl.cogs", [
    "Total Cost of Goods Sold",
    "Total for Cost of Goods Sold",
    "Total Cost of Sales",
    "Total for Cost of Sales",
    "Cost of Goods Sold",
    "COGS",
  ]),
  ...seed("profit_and_loss", "pl.overhead", [
    "Total Expenses",
    "Total for Expenses",
    "Total Operating Expenses",
    "Total for Operating Expenses",
    "Total Overhead",
    "Total for Overhead",
  ]),
  ...seed("profit_and_loss", "pl.other_income", [
    "Total Other Income",
    "Total for Other Income",
  ]),
  ...seed("profit_and_loss", "pl.other_expense", [
    "Total Other Expenses",
    "Total for Other Expenses",
    "Total Other Expense",
  ]),
  ...seed("profit_and_loss", "pl.depreciation", [
    "Depreciation",
    "Amortization",
    "Depreciation and Amortization",
    "Depreciation & Amortization",
    "Depreciation Expense",
  ]),

  ...seed("balance_sheet", "bs.cash", [
    "Total Bank Accounts",
    "Total for Bank Accounts",
    "Total Cash",
    "Total Cash and Cash Equivalents",
  ]),
  ...seed("balance_sheet", "bs.ar", [
    "Total Accounts Receivable",
    "Total for Accounts Receivable",
    "Accounts Receivable (A/R)",
    "Accounts Receivable",
  ]),
  ...seed("balance_sheet", "bs.ap", [
    "Total Accounts Payable",
    "Total for Accounts Payable",
    "Accounts Payable (A/P)",
    "Accounts Payable",
  ]),
  ...seed("balance_sheet", "bs.total_assets", [
    "Total Assets",
    "Total for Assets",
  ]),
  ...seed("balance_sheet", "bs.total_liabilities", [
    "Total Liabilities",
    "Total for Liabilities",
  ]),
  ...seed("balance_sheet", "bs.equity", [
    "Total Equity",
    "Total for Equity",
    "Total Owner's Equity",
  ]),
];
