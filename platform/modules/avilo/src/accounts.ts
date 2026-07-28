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

  // --- Operational
  {
    id: "ops.job_count",
    label: "Jobs completed",
    statement: "sales_by_customer",
    role: "total",
    unit: "count",
    sortOrder: 210,
  },
];

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
