# Bugs

Append-only evidence ledger. A fixed bug is marked RESOLVED with a date and the proof, never deleted — the failure modes here repeat, and the record is what stops them repeating silently.

Ordered newest first within each section.

---

## Migrations

### BUG-001 · `app_settings` table never created — Groq key would not save
**RESOLVED 2026-08-03** · commits `e340f60`, `13d7ca0`

**Symptom.** User entered a Groq API key, pressed Save, nothing happened. Persisted across an app restart.

**Root cause — two, sequentially.**
1. `0005_app_settings.sql` existed but was not listed in `meta/_journal.json`. Drizzle's migrator only runs migrations in the journal, so the table was never created.
2. The first fix added the entry with `when: 1754217600000` — **older than 0004's `1785644205569`**. Drizzle selects pending migrations by comparing that timestamp against the last applied one, so 0005 was read as already-past and skipped again.

**Why the first fix looked correct.** A fresh database has nothing applied, so the whole folder runs in order regardless of timestamps. It only fails on a database that already has 0004 — which is every real install.

**Proof of fix.** Against a copy of a real user database: 5 → 6 migrations applied, `app_settings` created, and `set` / `get` / overwrite / `delete` all round-trip.

**Standing lesson.** *A fresh database is not a test for a migration.* Test the upgrade path against a copy of a real one. Recorded in CLAUDE.md.

---

## AI

### BUG-002 · Decommissioned model shipped in the dropdown
**RESOLVED 2026-08-03** · commit `687bd49`

**Symptom.** None visible. The user's stored model was `mixtral-8x7b-32768`, which Groq has decommissioned; the API rejects it outright.

**Why it stayed hidden.** The only AI call site at the time was a classification fallback that fires when confidence < 0.7. Real exports score 1.0, so the model was never called and the dead configuration never surfaced.

**Fix.** Removed from the list; **Test connection** added so a configuration can be exercised on demand.

**Lesson.** A configuration that cannot be exercised is a configuration that cannot be trusted.

---

### BUG-003 · Percentage figures compared unequal in the fabrication guard
**RESOLVED 2026-08-03** · commit `264c74d` · found by a test written alongside the feature

**Symptom.** A faithful rewrite of the summary would have been discarded as fabricated.

**Root cause.** `figuresIn` normalised trailing zeros with `/\.0+$/`. That never matches when a `%` follows, and matches only all-zero fractions — so `8.40%` and `8.4%` produced different tokens, and `8.40` was left untouched even without the percent sign.

**Fix.** Normalise number and unit separately; strip trailing zeros in the fraction with `/(\.\d*?)0+$/` then the bare dot.

**Note.** Never reached a user — the guard was still correctly *rejecting*; it would have produced false positives. Regression test added.

---

### BUG-004 · AI wired at the layer that was not failing
**RESOLVED 2026-08-03** · commit `687bd49` · see ADR-014

**Symptom.** User added a Groq key and saw no change in the number of unmapped rows.

**Root cause.** The model was wired to report-type classification, which the rules already solve at 1.0 confidence. The user's actual problem — unmatched row labels — had no AI path at all.

**Lesson.** Measure which layer is failing before adding capability to one.

---

### BUG-005 · Cash line missed when a chart has a single bank account
**RESOLVED 2026-08-03** · commit `687bd49`

**Root cause.** Seeds covered `Total Bank Accounts` and `Total Cash`. A chart with one bank account prints no section total, so the detail row (`Cash in Bank`, `Checking`, `Operating Account`) is the only place the figure appears — and none were seeded. `bs.cash` came back empty.

**Fix.** Seeded the direct bank-line labels; also encoded in `ACCOUNTING_GUIDANCE` so the model knows the same rule.

---

## Interface

### BUG-006 · Contents list would not scroll
**RESOLVED 2026-08-03** · commit `78afeb4` · reported three times

**Root cause — two, sequentially.**
1. The nav is a flex item; `align-items: stretch` made it taller than its own content, so `overflow-y: auto` had nothing to scroll. Fixed with `self-start`.
2. `max-height: 100vh` is right once the list pins to the top and wrong before that. It starts ~378px down the page, so in an 820px window a 502px list hung 60px off the bottom — clipped by the *viewport*, not by itself.

**Fix.** Measure available height from `getBoundingClientRect().top` on scroll and resize.

**Why it "passed" earlier.** Tested at a window height where it happened to work.

---

### BUG-007 · Duplicate legend with strikethrough
**RESOLVED 2026-08-03** · commit `78afeb4` · user screenshot

**Root cause.** `TrendLine` never received `showLegend`, so chart.js drew its own legend under the HTML one, and its click handler used the default hide-and-strike behaviour.

**Fix.** Prop passed; then generalised — no chart draws a canvas legend, one shared `Legend` for all (ADR-020).

---

### BUG-008 · Operating income stacked to a meaningless total
**RESOLVED 2026-08-03** · self-caught before shipping

**Root cause.** Stacking Revenue + Cost of sales + Overhead sums to 364,800 — a number that is not any real quantity.

**Fix.** Restacked as revenue split into its parts: [Cost of sales, Overhead, Operating income] = 204,000.

---

### BUG-009 · "Not recognised" described a healthy import as a failure
**RESOLVED 2026-08-03** · commit `264c74d`

**Symptom.** User saw "17 rows not recognised" on a correct balance-sheet import and reasonably read it as a bug.

**Root cause.** Wording, not logic. Most of those rows are subtotals and sub-accounts the canonical chart has no slot for, and skipping them is *correct* — mapping a subtotal alongside its children double-counts (ADR-008).

**Fix.** Reworded to "N rows have no matching account", with a line explaining that skipping subtotals is expected.

---

## Packaging

### BUG-010 · Packaged app shipped without the changes
**RESOLVED 2026-08-03**

**Root cause.** `build.mjs` copies `apps/web/dist` and errors only if missing — it does **not** rebuild it. A stale bundle ships silently.

**Fix / standing rule.** Always `pnpm --filter @avilo/web build` before `dist:mac` / `dist:win`, then grep the packaged bundle for a string just added. In CLAUDE.md.

---

### BUG-011 · Verification method gave false negatives on the packaged app
**RESOLVED 2026-08-03** · my error, caught same session

**Symptom.** Reported accounting guidance as missing from the shipped app.

**Root cause.** Grepping `app.asar` directly returns 0 for strings that are definitely present — including `groq.com`, known to have shipped and worked.

**Fix / standing rule.** Use `npx asar extract-file app.asar dist/main.mjs` and grep the extracted file. In CLAUDE.md.

---

## Data

### BUG-012 · Two stray empty client rows
**OPEN** · low priority

`New client` and `New client 2` exist with no data. Created during early testing. Harmless; delete when convenient.

---

## Security

### BUG-013 · No Content-Security-Policy on the loopback server
**OPEN** · low priority for a local-only app, worth closing before any hosted mode

The Fastify server sets no CSP header. Acceptable while the surface is loopback-only and single-user; would need addressing before any networked deployment.

---

### BUG-014 · Groq key stored in plain text
**OPEN** · accepted for local-only beta

The key sits unencrypted in the user's local SQLite. Reasonable while everything is on the advisor's own machine, and the file is in their own home directory — but worth telling beta users, and worth revisiting if the app ever syncs.

---

## Environment

### BUG-015 · Browser-pane verification is unreliable for pointer-driven UI
**KNOWN LIMITATION** — not an app bug

The preview pane runs backgrounded (`document.hidden === true`): `requestAnimationFrame` never fires, so chart.js's throttled event proxy never flushes and scroll events do not fire (measured: 0 across two programmatic scrolls). Radix menus needing real pointer events do not open.

**Workaround.** Drive `chart._eventHandler(...)` directly, dispatch synthetic events, or verify through the API layer instead — and say which was done rather than implying a pointer-level test.
