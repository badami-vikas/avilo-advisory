# Import

**Every format becomes a `Grid` first** — Excel, CSV, PDF. Six parsers never learn which format a file arrived in, so a fix helps all three.

```
file → toGrid → classifyGrid → previewParse → [user confirms] → facts
```

**Nothing is written until Import is pressed.** Staging stores the file and parses a preview only.

## Classification

Deterministic scoring over titles, row markers, column headers, filename — with evidence returned. Real QuickBooks exports score **1.0**. No model involved (ADR-005, ADR-015).

## Label mapping

`normalizeLabel` lowercases, strips punctuation, and strips a leading 3–6 digit account code (`1100 Accounts Receivable` → `accounts receivable`). Then a table lookup: client mapping > global user mapping > built-in seed.

## Why rows go unmapped — usually correct

The canonical chart tracks ~12 balance-sheet totals, not a full chart of accounts.

- **Subtotals** (`Total Current Assets`) must be skipped — mapping them alongside their children double-counts. The parser already ranks section totals above detail rows (ADR-008).
- **Sub-accounts with no canonical home** (`Work in Process`, `Net Computer Equipment`) have nowhere to go.

Both are healthy. The UI says "no matching account", not "not recognised" — see BUG-009.

**Genuine misses** are seed gaps, e.g. single-bank-account charts printing no `Total Bank Accounts` (BUG-005).
