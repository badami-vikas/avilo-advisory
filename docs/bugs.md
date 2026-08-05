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

### BUG-016 · Windows build would not launch — `ReferenceError: DOMMatrix is not defined`
**RESOLVED 2026-08-03** · v1.4.2 · **found by the first beta user, on the first launch**

**Symptom.** Electron error dialog on startup, before any window: `A JavaScript error occurred in the main process — ReferenceError: DOMMatrix is not defined`, thrown from inside `app.asar` at `ModuleJob.run`. The app never started. macOS was unaffected.

**Root cause — a chain, and every link matters.**
1. `modules/avilo/src/import/pdf.ts` imported pdfjs **statically at module scope**, so pdfjs became load-bearing for application start.
2. pdfjs evaluates `const SCALE_MATRIX = new DOMMatrix();` at its own module scope.
3. pdfjs polyfills `DOMMatrix` from `@napi-rs/canvas`, guarded by `if (isNodeJS)`. Electron's main process **is** `isNodeJS` (`process.type === "browser"`), so the branch runs.
4. `@napi-rs/canvas` resolves one prebuilt binary per platform through separate optional packages. Cross-building on macOS resolved **the build host's**: the Windows installer shipped `@napi-rs/canvas-darwin-arm64` and `skia.darwin-arm64.node`, with no win32 binary.
5. On Windows the require failed, pdfjs warned `Cannot polyfill DOMMatrix` and continued, then `new DOMMatrix()` threw — inside the ES module loader, before any of our code ran.

**Why every user was affected, not just PDF users.** Because the import was static, the failure happened while `main.mjs` was still loading. Whether anyone ever opened a PDF was irrelevant.

**Fix — two independent parts, deliberately.**
- **pdfjs is now loaded on first use** (`await import(...)` inside `readPdf`), with a minimal `DOMMatrix` / `Path2D` / `ImageData` shim installed first. Only text positions are ever read, so no real canvas is needed. A dependency one feature needs must only be able to break that feature.
- **`@napi-rs/canvas` is excluded from the package** (`!node_modules/@napi-rs/**`). Shipping a per-platform native binary chosen by the build host is a trap; excluding it makes every platform take the path that is actually tested.

**Proof of fix.** `@napi-rs/canvas` was moved out of `node_modules` entirely — exactly what Windows sees — and all 9 PDF tests still passed, with pdfjs logging only `Cannot load "@napi-rs/canvas"`. Verified in the rebuilt Windows package: 0 napi-rs entries, shim present in `main.mjs`, pdfjs's 312 files intact.

**Blast radius checked.** `better-sqlite3`, the other native dependency, is structurally safe — it ships *all* platform prebuilds in one package (win32-x64 and win32-arm64 confirmed present and unpacked in the Windows build), rather than splitting per-platform.

**Standing lesson.** *A cross-built installer is not verified by inspecting it on the build host.* Per-platform native dependencies resolve to the host's architecture and nothing in the build output says so. Either launch it on the target, or exclude native dependencies the product does not actually need. Added to CLAUDE.md.

---

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

### BUG-017 · P&L first-match-wins produced a plausible wrong revenue
**RESOLVED** 2026-08-05 · v1.5.0

`profit-and-loss.ts` kept the first row that mapped to each account and discarded the rest. A chart of accounts feeds many rows into one canonical account, so revenue came out as the `Discounts given` line (−1,000) rather than `Total for Income` (380,881.41), and overhead read about a thousand pounds with every expense row mapped to it. Gross profit and NOI were wrong downstream, and `Amortization` / `Depreciation` both claiming `pl.depreciation` produced a duplicate warning per month.

**Fix.** Rank and resolve after the walk, matching the balance sheet (ADR-008): a section total wins outright, and with no total the detail rows are summed.

**Proof.** Against `reference/Reporting data/…Profit and Loss by Month (1).xlsx`, 2025-08: revenue 380,881.41, COGS 49,033.39, overhead 35,727.10 — each equal to the file's own total row. Computed gross profit 331,848.02 and NOI 296,120.92 match the P&L's printed rows 25 and 63 to the cent. Zero duplicate warnings.

---

### BUG-018 · Days cash on hand was twelve times too long
**RESOLVED** 2026-08-05 · v1.5.0

`days_cash_on_hand` divided by 365 while every P&L column is a single month, so daily spend came out roughly twelve times too small. A beta user reported 10,304 days of runway. The same unit mismatch is called out in the DSO/DPO comment directly below it, which is what makes this one embarrassing rather than subtle.

**Fix.** A 30-day month, as DSO and DPO already used.

---

### BUG-019 · Top Expenses stopped reading at the first sub-group total
**RESOLVED** 2026-08-05 · v1.6.0

The P&L walker closed the current section on *any* total row. A real expense list nests — `Bank Charges & Fees` / `Credit Card rewards` / `Total for Bank Charges & Fees` — so the section closed at the first sub-group and the thirty lines below it were never captured as detail lines. Top Expenses showed two rows, one of them a negative credit-card rebate.

**Fix.** Only the section's own total closes it (`Total for Expenses` closes Expenses). Sub-group totals are additionally excluded from `detailLines`, so they cannot double-count against the children they cover.

**Proof.** Against the reference P&L, 2025-08: 19 expense lines, 6 COGS, 4 income, 3 other — where the parser previously produced 4 expense lines and nothing after `Total for Bank Charges & Fees`. `phase2-parsers.test.ts` covers it with a nested fixture; the test fails against the previous parser.

---

### BUG-020 · A/R and A/P ageing counted job lines as customers
**RESOLVED** 2026-08-05 · v1.6.0

QuickBooks prints a customer, their jobs, and a `Total for <customer>` row. The parser emitted all three as separate entities, so one customer owing 190,957.75 appeared as a −184,107.55 credit, a job code owing 375,065.30, and a total — and the same money was counted twice on the same page. The reference A/R report has 13 customers; the parser returned 20 entities, seven of them job codes or duplicated totals.

**Fix.** `import/grouping.ts` collapses `parent / children / Total for parent` runs into one entry. A parent that bills nothing directly prints as a bare label with no figures and is passed in as a marker, otherwise there is nothing for the children to be spliced away from.

**Proof.** 13 entities, summing to 329,593.77 — the report's own TOTAL row, to the cent.

---

### BUG-021 · Sales by Customer read the wrong column as the customer name
**RESOLVED** 2026-08-05 · v1.6.0

`findLayout` chose the label column by skipping blank headers. A Sales by Customer Summary is headed `["", "Jul 2025", …, "Total"]`, so the label column became `Jul 2025` and every customer was labelled with their July figure. The grand total row was not recognised as one and entered the ranking as a customer called `20200` worth $1.3m. Top customers was unusable, which is what the beta user reported as "not populating".

**Fix.** The label column is the leftmost column that is not an amount or a count — blank header included, since QuickBooks never names it. Group collapsing (BUG-020) applies here too.

**Proof.** 65 customers with real names, summing to 1,309,617.08 — the file's grand total, to the cent. Previously 119 entities led by `20200`, `0` and a job code.

---

### BUG-022 · A taught mapping could not be undone
**RESOLVED** 2026-08-05 · v1.6.0

Mapping a row removed it from the "no matching account" list. The mapping is permanent and applied to every future import, so a mis-click was unreversible from the interface — the row you needed to correct was the one that had just disappeared.

**Fix.** The row stays, shows what it was mapped to, and offers Undo (`import.unmapLabel` → `forgetMapping`, which deletes only the user-taught row so the built-in dialect table remains as a fallback). Covered by `apps/web/test/mapping.test.tsx`.

---

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
