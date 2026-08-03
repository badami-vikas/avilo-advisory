---
title: AI mapping, narrative generation and the migration bug
type: raw
doc_kind: audit
status: complete
related_wiki: ../wiki/ai.md
updated: 2026-08-03
tags: [ai, groq, migrations, import, dashboard]
---

# Session record — 2026-08-03

Full-depth record of one working session, from `78afeb4` to `264c74d` plus the summary-edit work. Wiki summary: [ai.md](../wiki/ai.md), [import.md](../wiki/import.md).

## Starting complaint

> "Why aren't these basic balance sheet terms not getting mapped? Since the app has no AI embedded, how will it work. Should I provide a provision to use groq key?"

Screenshot showed 17 rows under "not recognised", including `1100 Accounts Receivable`, `1200 Work in Process`, `Total Other Current Assets`, `Total Current Assets`, `1400 Net Computer Equipment` — all set to Skip.

## Diagnosis

Two distinct causes, conflated by the UI wording.

**Real gaps.** `1100 Accounts Receivable` failed because the seed table has `Accounts Receivable` but the export prefixes an account code. Fixed by stripping leading 3–6 digit codes in `normalizeLabel` (ADR-009). `1000 Cash in Bank` failed because seeds covered only `Total Bank Accounts` / `Total Cash`, and a chart with one bank account prints no section total (BUG-005).

**Not gaps.** `Total Current Assets` and `Total Other Current Assets` are subtotals. The balance-sheet parser already ranks `total …` rows above detail rows and treats section totals as authoritative (ADR-008) — mapping a subtotal *alongside* its children double-counts. `Work in Process` and `Net Computer Equipment` are sub-accounts with no canonical home; the app tracks ~12 balance-sheet totals, not a full chart of accounts.

The word "unrecognised" made a healthy import read as failure. Reworded (BUG-009).

## The AI placement mistake

Groq was first wired to **classification** — `classifyWithFallback` on upload, firing when rule confidence < 0.7. Measured on a realistic balance sheet:

```
reportType:        balance_sheet
confidence:        1.0
needsConfirmation: false   ← the model is never called
```

So the key sat unused while the user's actual problem went untouched. Moved to row mapping (ADR-014), which is open-vocabulary and where no seed table can ever be complete.

The user pushed back correctly: *"Why isn't the platform using groq model to classify when fuzzy logic fails?"* — the answer being that fuzzy logic was not failing at classification; it was failing at mapping.

## What the model does now

`suggest.ts` sends the unmatched labels, the canonical account list filtered to the report's statement, and `ACCOUNTING_GUIDANCE`. Reply format is `<row>|<account id or skip>|<reason>`.

Live result against the user's own key:

| Row | Result |
|---|---|
| `1000 Cash in Bank` | `bs.cash` |
| `1100 Accounts Receivable` | `bs.ar` |
| `2000 Accounts Payable` | `bs.ap` |
| `Total Liabilities` | `bs.total_liabilities` |
| `Retained Earnings` | `bs.equity` |
| `Total Current Assets` | skip — *"subtotal of other rows"* |
| `1200 Work in Process` | skip — *"no matching account"* |
| `Total Other Current Assets` | skip |
| `1400 Net Computer Equipment` | skip |

It reasons about subtotals unprompted once the guidance says to.

### Safety

`parseSuggestions` is deliberately tolerant. Anything not in the canonical set — `skip`, a hallucinated id, malformed output, an out-of-range row number — resolves to `null`, rendered as Skip. A hallucination therefore degrades to the state the user was already in. Eleven tests cover this.

### Learning loop

An accepted suggestion routes through the same `mapLabel` mutation as a manual choice, so it persists to `label_mappings` and is never asked again — on any future import, for that client or globally. Cost decays to zero (ADR-017).

## The migration bug

The Groq key would not save. Two sequential root causes, documented at BUG-001. The important lesson: **the first fix tested clean on a fresh database and still failed on every real install**, because Drizzle compares journal timestamps against the last applied migration. Verified the second fix against a copy of the user's actual database — 5 → 6 migrations, table created, full round-trip.

## The dead model

The user's stored model was `mixtral-8x7b-32768`, decommissioned by Groq. Never surfaced because nothing called it. This is what motivated **Test connection**: a configuration that cannot be exercised cannot be trusted (BUG-002).

## Narrative generation

`insights.ts` already writes the executive summary from measured facts. The user asked how it appears without AI — it branches on computed values:

```js
headline: revenue.direction === "up" ? "A bigger month" : …
```

Generate does **not** replace this. It receives the finished findings as its only source and rewrites them as prose. Output is checked with `fabricatedFigures`: any number in the draft that is not in the source causes rejection with the reason shown.

Live output, every figure traceable:

> "You had a bigger month at Acme Construction, with revenue reaching $482,000, which is up 8.4% on September… you are owed $3,593,607, with 22.1% of this amount being over 90 days old."

A test written alongside caught BUG-003 in the guard's own normalisation.

## Editable summary

User decision: *"Always new data supersedes custom edit."*

Implemented with a content-based fingerprint (FNV-1a over kicker/headline/body). The edit is stored with the fingerprint of the findings it was written against; a read sends the current fingerprint and the server withholds a stale edit, returning `superseded: true` so the UI can explain itself. Content-based rather than a timestamp so that re-importing the same file does not discard the advisor's wording.

Verified against the real database:

```
same fingerprint  → { body: 'My own wording…', superseded: false }
figures moved     → { body: null,              superseded: true  }
cleared           → { body: null,              superseded: false }
```

## Verification limits encountered

The browser preview pane runs backgrounded, so `requestAnimationFrame` never fires: chart.js's throttled event proxy never flushes and zero scroll events fire. Radix menus needing real pointer events do not open. Verification was done through the tRPC layer and by extracting the packaged bundle instead — stated rather than implied (BUG-015).
