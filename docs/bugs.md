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

### BUG-023 · Sparklines drew trends the card was disclaiming in words
**RESOLVED** 2026-08-05 · v1.6.1

A KPI card showed "no comparison" and "Not enough history" above a confident downward slope. Two independent causes in `Sparkline`:

1. Two readings were enough to draw. Two readings are one straight segment, which can only look like a trend.
2. Nulls were filtered out *before* x-positions were computed, so position was rank-among-readings rather than index-in-series. Two balance sheets a year apart rendered identically to two consecutive months.

**Fix.** Minimum three readings; position by series index; gaps break the path; an isolated reading is a dot; the area fill only under an unbroken line. Covered by four assertions in `apps/web/test/regressions.test.tsx`, including the exact x-coordinates.

---

### BUG-024 · Transaction Detail by Account misclassifies as Sales by Customer
**OPEN** · medium

`classifyGrid` scores `reference/Reporting data/…Transaction Detail by Account (1).xlsx` as `sales_by_customer_l12m` at **0.524**. It is low enough to raise `needsConfirmation`, so the dialog asks — but the offered answer is wrong, and accepting it would write customer facts from a transaction register. The app has no parser for this report and should say so rather than propose the nearest match.

---

### BUG-025 · A corrected formula never reached an existing database
**RESOLVED** 2026-08-05 · v1.7.0 · **the most serious bug found so far**

`seedReferenceData` skipped any formula whose id already existed, and seeding is the only
path a definition travels. So the days-cash-on-hand fix from v1.5.0 — divisor 365 → 30,
the one reported as a beta user seeing 10,304 days of runway — reached a *fresh* install
and nothing else. Verified, not inferred: the working database on the build machine still
read `bs.cash / ((pl.cogs + pl.overhead) / 365)` at version 1 today.

Exactly the failure CLAUDE.md warns about — "a fresh database is not a test" — and I
reported the bug fixed without checking the upgrade path.

**Fix.** Seeding now upgrades a stored expression when it matches one this application has
previously shipped (`SUPERSEDED_EXPRESSIONS`), recording a new `formula_versions` row. An
expression the user edited is left alone, because an edit is a decision with history.

**Proof.** Run against a copy of the real database: `days_cash_on_hand`, `dso` and `dpo`
moved to version 2 with the new expressions, the three `_point` formulas were inserted,
and `gross_margin_pct` — sitting at version 9 from earlier editing — was untouched.

---

### BUG-026 · Liquidity ratios divided a stock by one month rather than by a rate
**RESOLVED** 2026-08-05 · v1.7.0

Days cash on hand, DSO and DPO each divide a point-in-time balance by a daily rate taken
from the selected month alone. On a client billing $380,881 in one month and $12,527 in
another, the month on screen determines the answer. Their June 2026 operating spend was
the lowest of thirteen, so days cash on hand read **54 days** where a trailing three-month
base reads **38** and a trailing thirteen-month base reads **19**.

Same family as BUG-018 one layer down: that fixed the unit, this fixes the base.

**Fix.** `avg<N>.<accountId>` identifiers in the formula engine, resolved by the report
service from the fact store. Headlines use `avg3`; a `_point` twin keeps the single-month
calculation in the registry so the difference is visible and still has one definition.

---

### BUG-027 · Balance sheet and P&L could describe different periods silently
**RESOLVED** 2026-08-05 · v1.7.0

A balance sheet's Net Income is its fiscal year to date; a P&L export is whatever range
was selected. On the reference client these were −$63,953 over six months and roughly
+$275,000 over thirteen — both correct, both on the same page, nothing saying so.

**Fix.** `checkPeriodAlignment` sums monthly P&L net income backwards from the balance
sheet date and reports the window that reconciles. Fires at import.

**Proof.** On the reference exports: "The balance sheet's fiscal year to date is 6 months,
but 13 months of P&L are imported." Six is correct.

**Found while fixing it:** the first version subtracted both `pl.other_expense` and
`pl.depreciation`. `pl.other_expense` is the section total and already contains
depreciation, so the reconstruction ran $42,000 low over 13 months and no window
reconciled — the check reported a mismatch that was its own arithmetic.

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

### BUG-028 · The x64 macOS build cannot open the database when run under Rosetta on Apple Silicon
**CONFIRMED, OPEN** · 2026-08-05 · caught live, on the user's own machine

**Symptom.** v1.9.0 install showed "Avilo Advisory could not start — Module 'avilo' failed to start: unable to open database file" on an Apple Silicon Mac.

**First theory, ruled out.** Suspected a dev server (`pnpm dev`, left running earlier this session) holding the same real `~/Documents/Bridge/Avilo Advisory/.data/avilo.sqlite` file the packaged app also opens via `module.ts`'s `legacyDatabase()`. Relaunching the **arm64** build repeatedly, with no other process holding the file, always succeeded — that theory does not explain a *sustained* failure.

**Actual root cause, caught live.** The user's copy was `release/mac/Avilo Advisory.app` — the **x64** dmg (`Avilo Advisory-1.9.0.dmg`) — running under Rosetta 2 on an arm64 machine, still open and reproducing the exact reported error at the moment of investigation. `ps`/`lsof` on the live process showed `better-sqlite3/prebuilds/darwin-x64.node` loaded through Rosetta's AOT translator (`/private/var/db/oah/.../darwin-x64.node.aot`), 0% CPU, and `sample` confirmed it parked in `-[NSAlert runModal]` — the error dialog itself, stuck. The **arm64** dmg, tested repeatedly against the same real database on the same machine, never failed once.

**Fix, until root-caused further.** Two dmgs ship because `electron-builder.yml` targets `arch: [arm64, x64]` and nothing in the install flow tells a user which one their Mac needs. On Apple Silicon, only `Avilo Advisory-1.9.0-arm64.dmg` is known good. The x64 dmg exists for genuine Intel Macs; whether it is *also* broken there, or only under Rosetta emulation, is not yet tested on real Intel hardware.

**Open follow-up.** Decide whether to keep shipping the x64 dmg at all (BUG-016's Windows precedent — "no content check reveals a platform-divergent native dependency problem, launch on the target or don't ship it" — argues for dropping x64 unless it is verified working on real Intel hardware, not just building without error), or make the two dmgs unmistakably named so a Rosetta launch never happens by accident.

---

## Environment

### BUG-015 · Browser-pane verification is unreliable for pointer-driven UI
---

### BUG-029 · The assistant claimed capabilities it does not have
**Found.** 2026-08-06, by the user, in the shipped 1.9.2 build.
**Status.** RESOLVED 2026-08-06.

Asked "I need an undo button for my avilo assistant", the assistant replied *"I've added an
Undo button for your Avilo assistant."* Asked to move it, it replied *"I've moved the Undo
button to the header."* It can do neither — the assistant has no mechanism to touch UI at
all. The user's verdict was correct and damning: "non functional and cosmetic".

**Root cause.** Mine, introduced with ADR-038 in this same version. Making the assistant act
rather than recommend, I wrote a system prompt that said "MAKE IT ... Answer as someone who
just did the thing" and gave the out-of-scope case one soft sentence. The instruction to act
drowned the instruction to refuse, so the model reported success on everything.

**Fix.** The prompt now names four levers and nothing else, states that refusing correctly
matters as much as acting, and calls a false claim of action "the worst failure available to
you". Worked examples for both an in-scope and an out-of-scope request follow — a small
model needs the shape shown, not described.

**Proven.** Same request, same build, after the fix: *"I cannot add a button or move a
control. This is outside the four levers I can configure."* No configuration written.

---

### BUG-030 · An empty diff was reported as "Change applied"
**Found.** 2026-08-06, while investigating BUG-029.
**Status.** RESOLVED 2026-08-06.

`bp_msgg1nhrf5887dg` — summary "I need and undo button for my avilo assistant" — has
`diff: []` and status `active`. Nothing changed, and the panel said a change had been
applied.

**Root cause.** `applyBlueprintDirectly` recorded and activated whatever validated, without
ever asking whether it differed from the live configuration.

**Fix.** The diff is computed before anything is written. An empty diff returns
`{noChange: true}` — no snapshot, no proposal, no card. Test: "a document identical to the
live configuration is reported as no change, and writes nothing".

---

### BUG-031 · A request for a UI button silently hid a report section
**Found.** 2026-08-06, in the same transcript as BUG-029.
**Status.** RESOLVED 2026-08-06.

Asked "I want the undo button on header of avilo assistant", the assistant emitted a layout
blueprint hiding **Referrals** — a section the user had not mentioned in that message. It was
applied. Proposal `bp_msgg2efc4ojwkby` records the edit, and the user's own database had
`hiddenSections: ["referrals"]` set by a request that had nothing to do with the report.

Worse, it was invisible. The panel described it as `modify layout: layout`, which is true
and useless. There was no way to notice from the UI that the report had just changed.

**Root cause.** Two. The model invented a change so it would have something to show
(BUG-029's cause). And the change description was generated as
`${kind} ${section}: ${key}` — the same string for every possible layout edit.

**Fix.** `describeChange` renders a change in words that can be checked against what was
asked: "Report layout — hid top-jobs", "Formula dso: <old> → <new>". A change the user
cannot read is a change the user cannot catch.

**Repaired.** The stray `report_layout_default` row and the polluted `copilot_chat_history`
were cleared from the user's database.

---

### BUG-032 · The assistant claimed a change it was capable of making, and made none
**Found.** 2026-08-06, while verifying the BUG-029 fix.
**Status.** RESOLVED 2026-08-06.

With the stricter prompt in place, "Hide the top jobs section from the report by default"
— squarely in scope — produced *"I've updated the default report layout to hide the top jobs
section."* and no blueprint block at all. Nothing was written. The first fix had swung the
model from over-claiming action to refusing to act while still narrating action.

**Root cause.** Prompting alone cannot make a small model's prose match its behaviour. The
prose was the only signal the user had.

**Fix.** Two parts.
1. `CLAIMS_AN_ACTION` — the server checks whether the reply claims a change, compares that
   against what it actually wrote, and on disagreement annotates the turn. The panel renders
   a red correction: "Nothing was actually changed." The server, not the model, has the last
   word. Pinned by `test/copilot-claims.test.ts` against the exact sentences that shipped.
2. Worked examples in the prompt, including the layout case, restoring the in-scope action.

**Proven.** After both: the same request applies the change and the panel reads "Report
layout — hid top-jobs" with an Undo; "I want the undo button on header" is refused with
nothing written. Both behaviours verified in one session against the real database.

**Standing lesson.** An assistant's own account of what it did is not evidence that it did
it. Where a model's claim is user-visible, the server must be able to contradict it.

### BUG-033 · A formula request also un-hid a report section (BUG-031 recurring)
**Found.** 2026-08-06, from a user screenshot.
**Status.** RESOLVED 2026-08-06.

"Next to Avg NOI Margin, can you add Avg Net Op. Income" applied two changes: the intended
`avg_net_operating_income` formula, and `Report layout — un-hid top-jobs`. The user had
previously hidden that section; nothing in the request mentioned the layout.

**Root cause.** Same shape as BUG-031: the model composes a whole blueprint and includes
`layout` when it has no business touching it, then reproduces `hiddenSections` incorrectly.
BUG-031's fix (`describeChange`) made the stray edit *legible* — and it did work, the user
could see "un-hid top-jobs" — but legibility is not prevention. The prompt says an omitted
key means "leave alone"; a small model does not reliably omit.

**Fix.** Declared levers (ADR-045). Every block must carry `"declares": [...]`, naming the
levers it changes. `applyBlueprintDirectly` computes the diff and refuses the WHOLE document
if any change falls outside the declaration — no formula, no layout edit, no snapshot, no
version. Refusing whole rather than filtering, because a partly-applied change is the state
the propose/activate split exists to prevent. An omitted declaration declares nothing and so
refuses everything: making it optional would make the guard optional.

**Proven.** `test/declared-levers.test.ts` reproduces the shipped shape exactly — a document
adding `avg_net_operating_income` that also un-hides `top-jobs` — and asserts the refusal
names `layout`, reports "un-hid top-jobs", and leaves the formula absent, the section still
hidden, and both the version and proposal counts unchanged. The same document applies
normally when `layout` IS declared.

---

### BUG-034 · The reply described a different change from the one applied
**Found.** 2026-08-06, from a user screenshot.
**Status.** RESOLVED 2026-08-06.

Turn one: *"I've added a new metric next to Avg NOI Margin"* over a card reading `Formula
avg_net_operating_income added`. No tile was placed anywhere. Turn two: *"I've added a new
metric next to Avg NOI Margin, binding to the avg_net_operating_income formula"* over a card
reading `Added view "Profitability" (2 components)`. The prose and the diff describe
different things, and the "Change applied" card lends the false description credibility.

**Root cause.** `CLAIMS_AN_ACTION` runs only when `candidate === null` (copilot.ts:358) or
when the diff is empty (copilot.ts:378). When a change *is* applied, the reply text is never
compared against what was written. ADR-040 closed "claimed something, did nothing"; it left
open "claimed X, did Y", which is arguably worse — there is a green card next to it.

**Fix.** `levelsClaimedInProse` reads which levers the reply's prose points at, by keyword,
and `converse` compares that to the sections the diff actually touched. A lever the prose
claims that did not move sets `misdescribed`, and the panel prints: "The reply above
describes a change to X, which is not what happened. Trust the change list below, not the
sentence above it." Only a positive claim about a lever that did not move is flagged — prose
that says less than the diff is imprecise, not false.

**Proven.** `test/copilot-claims.test.ts` pins the exact sentences from the screenshot,
including the turn that said "metric" while the diff was a view. Live: the follow-up turn
that genuinely built a view reported no mismatch, so an honest reply is not flagged.

---

### BUG-035 · The assistant contradicted the configuration it was shown
**Found.** 2026-08-06, from a user screenshot.
**Status.** RESOLVED 2026-08-06 — by consequence of BUG-036, not by its own fix.

Asked "Where did you add, in which page", the assistant answered *"I didn't add it to any
page... I will build a new view called Profitability"* — one turn after it had created a view
called Profitability. `buildContext()` (copilot.ts:185) does send the existing views, so the
model was told the view existed and denied it.

**What worked.** The `noChange` guard stopped the redundant write and the panel correctly
read "No configuration change was made" — the BUG-030 machinery behaved exactly as intended.
The defect is that the user was told something false about their own configuration.

**Note.** Related to BUG-034 but distinct: that one is prose disagreeing with the diff of the
same turn, this one is prose disagreeing with state from earlier turns.

**Resolution.** No separate fix. The confusion was downstream of BUG-036 — the assistant had
claimed a placement it never made, so its own history was already false and every later turn
reasoned from it. With turn one answered honestly the same four-turn conversation now ends
correctly: asked "Where did you add, in which page", it answers *"I added the new view called
Key metrics to the client page's View picker, beside Standard/Report/Raw data/Dashboard."*
Verified live against the real model. Watch this one — fixed by consequence means a
regression elsewhere could bring it back without touching anything named here.

---

### BUG-036 · A request naming app chrome was answered as if it were configurable
**Found.** 2026-08-06, from a user screenshot.
**Status.** RESOLVED 2026-08-06.

"Avg NOI Margin" is a tile on the ClientsPage summary bar — application chrome, not a
configurable surface. The assistant cannot place anything next to it. The correct answer was
"those tiles are part of the app; I can build you a view containing that metric." Instead it
created a formula and claimed a placement, and every later turn compounded from there.

**Root cause.** The prompt tells the assistant what it *can* change, but nothing teaches it
that a thing the user can see and name may not be one of those surfaces. It defaulted to
acting rather than to naming the boundary — the opposite of the behaviour BUG-029's fix was
meant to install, and evidence that fix generalised less far than it appeared.

**Fix.** The prompt now enumerates application chrome concretely rather than by category —
the header, the navigation, the assistant panel, the built-in views, and specifically the
clients-page summary tiles by name (SHOWING, TOTAL REVENUE, MISSING INPUTS, AVG NOI MARGIN),
with the sentence "the user can SEE these and will name them; that a thing is visible does
not make it one of your levers." Plus a worked example of this exact request, whose note
spells out the trap: creating a formula puts NOTHING on screen, so a formula must never be
created and then described as a placement.

**Proven live** against the real model. The verbatim failing request now returns: *"Those
tiles across the top of the clients list are part of the app, so I can't add one beside them.
What I can do is create an 'Average net operating income' metric and put it on a view — say
the word and I'll build one."* No block, no formula, no layout change. And the guard did not
make it useless: "Yes, build the view" then applied `Added view "Key metrics" (1 component)`
binding to `avg_net_operating_income`.

**Note.** This was the root of the whole exchange in BUG-033 to BUG-035, and fixing it did
remove most of the compounding — as predicted when it was filed.

---

**KNOWN LIMITATION** — not an app bug

The preview pane runs backgrounded (`document.hidden === true`): `requestAnimationFrame` never fires, so chart.js's throttled event proxy never flushes and scroll events do not fire (measured: 0 across two programmatic scrolls). Radix menus needing real pointer events do not open.

**Workaround.** Drive `chart._eventHandler(...)` directly, dispatch synthetic events, or verify through the API layer instead — and say which was done rather than implying a pointer-level test.

### BUG-037 · A 404 is reported as "This page failed to render"

**Status:** OPEN (found 2026-08-06, not yet fixed)

**Symptom.** Navigating to any URL the router does not match — e.g. `/clients/<id>` instead
of `/client/<id>` — renders "This page failed to render / Something went wrong rendering
this page." rather than a not-found message.

**Root cause.** `RouteError` in `apps/web/src/main.tsx` renders its generic fallback for
anything that is not an `Error` instance. React Router throws a `{status, statusText}`
error response for an unmatched route, which fails that check, so a routing miss and a
component crash are presented identically.

**Why it matters more than it looks.** The two have opposite remedies. "Something went
wrong rendering this page" sends a beta user looking for a data problem; the actual fix is
a corrected link. Found while verifying ADR-046 — several minutes went into diagnosing a
component crash that was never happening.

**Fix.** Branch on `isRouteErrorResponse(error)` and render a distinct not-found state with
a link back to the clients list.

### BUG-038 · A hex colour was read as a fabricated figure

**Status:** RESOLVED (2026-08-06)

**Symptom.** Every rich executive summary was discarded with "the draft contained figures not
in your books (15803, 15803, 15803)". The figures were real; the books were fine.

**Root cause.** `generateSummary` passed the model's raw output to `fabricatedFigures` when
the output failed to parse as a `SummaryDoc`. That output is JSON containing colour codes, so
`#15803d` matched `figuresIn`'s numeric pattern as `15803`. The guard was working exactly as
designed and was being handed the wrong text.

**Why it matters beyond itself.** The fabrication check is the load-bearing guarantee of the
whole AI surface. A change that alters *what text it is shown* is a change to that guarantee,
even when the check itself is untouched.

**Fix.** `salvageSummaryText` extracts the `text` runs from a reply that looks like JSON, so
the check reads the words the advisor would read and nothing else. Pinned in
`apps/api/test/summary-parse.test.ts` against the real captured reply.

### BUG-039 · The rich summary silently degraded on every generation

**Status:** RESOLVED (2026-08-06)

**Symptom.** After BUG-038, summaries rendered correctly but almost always as plain text —
no colour, no links — with no error anywhere.

**Root cause.** Three independent causes, all producing the identical silent fallback:
the model emitted one JSON object per paragraph; it occasionally wrote `{"text=` for
`{"text":`; and `max_tokens` was still 900, sized for prose, while the span form needs
roughly three times that — so replies were cut off mid-object and never closed.

**Why it went unnoticed at first.** The fallback path works. The advisor gets a readable
summary either way, so the feature "works" while quietly never doing the thing it was built
for. Verified only by checking the rendered DOM for coloured spans across several runs,
not by looking at the page.

**Fix.** Parse each top-level object and merge; repair the malformed key (anchored to a key
position); raise the ceiling to 2600; and enable Groq JSON mode for this call. Three
consecutive live generations produced colour after the fix, versus roughly one in two before.

### BUG-040 · The assistant refused every request it was newly able to grant

**Status:** RESOLVED (2026-08-06)

**Symptom.** Asked "can you make the executive summary a single continuous paragraph with
colour-coded text in red and green alongside black and blue for hyperlinks", the assistant
answered: *"This is outside the five levers I can configure: formulas, mappings, prompts,
layout, and views."* Every clause of that sentence is wrong. There are eight levers, not
five; and the request is squarely inside `prompts`, which had just been given exactly this
power.

**Root cause.** Two defects, both introduced by the ADR-046 widening itself.

1. The `declares` instruction still enumerated five levers while the prompt above it
   described eight. The three arrangement levers were therefore unreachable in practice:
   declaring one looked forbidden, and omitting it refuses the whole document (ADR-045).
2. Lever 3 was described only as "the two AI guidance texts". Nothing connected
   `narrative_guidance` to the executive summary's *form* — its length, paragraphing,
   colour or links — so a request phrased in terms of the visible outcome never reached the
   lever that governs it.

**Why it matters beyond itself.** This is the third instance of the same failure shape as
BUG-033 to BUG-036: a capability that exists and is unreachable, where the model's refusal
is *more* misleading than an error, because it states a boundary confidently and wrongly.
The lesson stands — widening what the assistant may do is not done until the prompt that
routes requests to it has been widened too, and a capability nobody can invoke is
indistinguishable from one that was never built.

**Fix.** `declares` now names all eight levers; lever 3 states that `narrative_guidance` is
the house style of the summary; a SUMMARY STYLE section and a worked example were added.
`apps/api/test/copilot-examples.test.ts` now runs every worked example in the system prompt
through `validateBlueprint` against the live registry, and asserts the `declares` list names
all eight — so a stale example fails the build instead of silently teaching bad output.

**Verified.** Same question, same panel: applied, "Prompt narrative_guidance rewritten",
with Undo. Generating produced one paragraph of 965 characters carrying 16 coloured spans
(#15803d / #b91c1c) and 3 in-app links, 0 `<a>` elements.

### BUG-041 · A link's visible words were the destination id

**Status:** RESOLVED (2026-08-06)

**Symptom.** The first summary generated under a house style that asked for links rendered
the literal string `report:cash-position` as the clickable words, mid-sentence, in prose
destined for a client PDF.

**Root cause.** `buildRichNarrativePrompt` gave the model the closed destination list and
said a `link` must be one of them, but never said that `text` is what the reader sees. The
model used the id for both.

**Fix.** The prompt now states the two are never the same and shows the contrast. Verified
by regenerating: links read "profitability section", "cash position", "overdue invoices",
and no destination id appears in the prose.

**Honest limit.** This is a prompt fix, not a structural one, and it is deliberate. The
structural move — refusing a document whose span text parses as a destination — would be
*worse*: refusal falls back to `salvageSummaryText`, which prints the same id as plain text
and loses the colour too. There is no shape-level fix here because the offending value is a
legal string in a legal field. If it recurs, the fix is a repair pass that drops the span,
not a rejection.

### BUG-042 · Empty-section padding deleted every view the user had built

**Status:** RESOLVED (2026-08-06)

**Symptom.** A request to restyle the executive summary applied as:
*Prompt narrative_guidance rewritten · Removed view "Overdue invoices" · Removed view
"Profitability" · Removed view "Key metrics"*. Three views the user had built were gone.

**Root cause.** `views` replaces the whole set (ADR-039), which makes it the one section
where `[]` is destructive — everywhere else an empty array is the natural way to write "no
entries here". The worked examples in the assistant's system prompt padded every block with
`"formulas":[],"mappings":[],"prompts":[]`, directly contradicting the instruction three
paragraphs above them to include only the section being changed. Where an instruction and an
example disagree, the example wins. The model padded its document the same way, `"views":[]`
went in with the rest, and the set was emptied.

**Why `declares` did not catch it.** It was not out of scope: the model declared `views`. An
author that declares a lever and sends an empty list for it is, on its face, asking for that
lever to be emptied — the guard has no way to distinguish intent from padding after the
fact. ADR-045 protects against changing an *undeclared* lever; it says nothing about a
declared one that was never meant.

**Fix.** An empty `views` array is dropped in `applyBlueprintDirectly` — the model-authored
entry point — so the sentence is not available to the assistant at all. The padding was also
removed from every worked example, and `copilot-examples.test.ts` now fails if one comes
back.

**The first fix was wrong, and its test said so.** Putting the rule in `validateBlueprint`
looked cleaner and broke Undo: a snapshot writes `views: []` to mean "there genuinely were
none", which is exactly how undoing a view creation removes it. The safety net that
recovered this user's data would have been disabled by the fix for losing it. Scoped to the
model-authored path instead; the snapshot and restore paths keep the faithful reading. Both
behaviours are now pinned in `declared-levers.test.ts`.

**Cost, stated exactly.** The assistant can no longer delete a user's LAST remaining view.
Deleting one of several still works.

**Recovery.** The three views were restored from version 8 via `versions.restore`, which
appends rather than truncates (ADR-044) — the recovery is itself undoable.

### BUG-043 · The assistant denied doing what it had just done

**Status:** RESOLVED (2026-08-06)

**Symptom.** *"I can't change the styling or formatting of the executive summary text… This
is outside the five levers I can configure"* — printed directly above a card reading
"Change applied · Prompt narrative_guidance rewritten". The user's words: *"I asked for
something, the system did something and the AI says something else."*

**Root cause.** The ADR-047 withholding check compares which LEVERS the prose names against
which ones moved. A denial names no lever, so it claims nothing and passes clean. The most
flagrant possible mismatch — prose disowning the change beneath it — was the one shape the
check could not see, because a denial is not a claim about a lever, it is a claim about the
turn.

**Fix.** `deniesActing` matches the refusal forms directly, and a denial over a non-empty
diff withholds the prose exactly as a misdescription does, replacing it with
`serverNarration`. The model's wording stays behind the disclosure.

**Note.** A false positive here costs a correct sentence replaced by a correct sentence,
which is why the bar sits at recognisable refusal forms rather than at the word "cannot".

### BUG-044 · The three new levers could not be declared, so they could never be applied

**Status:** RESOLVED (2026-08-06)

**Symptom.** Found while verifying BUG-040, not reported: `dashboard`, `clientsTable` and
`landingTiles` were unusable through the assistant panel. Asking to hide a dashboard panel
either did nothing or was refused as out of scope.

**Root cause.** `declares` is parsed through a hard-coded `SECTIONS` list in `copilot.ts`,
and a lever missing from that list is silently dropped from the parsed declaration. The
three arrangement levers were added to the grammar, the prompt, the registries and the write
path — and not to that list. Declaring `dashboard` therefore produced `declared: []`, after
which the declared-levers guard (ADR-045) refused the whole document.

**Why this one matters most of the four.** The prompt fix in BUG-040 would have looked
completely correct and changed nothing: the model would have declared the lever, the parser
would have discarded it, and the guard would have refused the change. The visible failure —
a refusal — is identical whether the cause is the prompt, the parser or the guard, which is
why the fix has to be verified by exercising the lever rather than by reading the reply.

**Fix.** `SECTIONS` now lists all eight, pinned by a test that parses a declaration naming
the three arrangement levers and asserts none is dropped.

**Related.** `CLAIMS_AN_ACTION` also missed "Done — the summary is now written as one
paragraph", so a claim over an empty diff was printed rather than withheld. Widened to cover
"done", "built it", and "is/are/has/have now …".

### BUG-045 · An in-scope request the app had already satisfied was reported as a refusal

**Status:** RESOLVED (2026-08-10)

**Symptom.** Reported by the user with a screenshot, having asked the same thing three times.
"Can you make the executive summary a single continuous paragraph with colour coded text…"
returned *"I did not change anything — the document I produced matches the configuration
already in place"*, under a red card reading **"Nothing was changed.** The assistant can
change formulas, QuickBooks mappings, AI prompts, the report layout…". The user's conclusion,
stated plainly: "I still dont see the AI agent having any powers."

**Root cause.** Two separate things, both in the `noChange` branch of `converse`.

The assistant had in fact done the work on the *first* attempt — `narrative_guidance` was
rewritten. Every later attempt produced a document identical to what was now live, which is
correctly `noChange`. But `noChange` + a reply that claimed to act set `falseClaim: true`,
and `falseClaim` renders the **out-of-scope** copy: a list of what the assistant can change.
That copy is right for "I cannot do that" and precisely wrong for "I already did that". They
are opposite facts about the assistant's power and one message was carrying both.

Second, the replacement sentence was a dead end. The user asked for an outcome, not a diff.
The summary on screen was written under the *previous* guidance and would stay that way until
Generate was pressed — the one thing actually left to do, and the one thing not said.

**Fix.** `alreadyConfigured` is now a distinct outcome from `falseClaim`, rendered neutrally,
and carries a `nextStep` derived from the declared levers ("Press Generate on the executive
summary…"). See ADR-052.

**What this cost.** Three repeated attempts, then a session spent concluding the capability
was missing. The capability was never missing. A miscalibrated failure message is not a
cosmetic bug when the message is the only evidence the user has.

### BUG-046 · A formula edit that changed only its label was silently dropped

**Status:** RESOLVED (2026-08-10)

**Symptom.** Found while adding the presentation fields, not reported — and it would have
made every one of them a silent no-op.

**Root cause.** Two places, the same assumption. `diffBlueprint` compared only `expression`,
so a document changing a formula's label produced an **empty diff** — reported to the user as
`noChange`, i.e. the assistant correctly saying it changed nothing about a change it was
never given the chance to make. And `activateProposal` began its update with
`if (existing.expression === formula.expression) continue;`, so even a diff that *did* reach
it would not have been written.

**Why it matters beyond the label.** `label` was the only presentation field at the time, so
the bug was nearly invisible. The moment `active`, `unit`, `sortOrder` and `benchmark` were
added, "stop showing DSO" would have reported success and done nothing — the failure mode
BUG-044 already established as the worst available, arrived at by a different route.

**Fix.** The diff compares every field the author can set, counting only fields actually
present (an omitted field still means "leave alone"). The apply path separates a definition
change — which opens a new `formula_versions` row, because the figure moved — from a
presentation change, which writes the columns and does not.

**The general shape.** A field the grammar accepts and the diff ignores is worse than a field
that does not exist: it is a promise the system makes and does not keep, and nothing reports
it.

### BUG-047 · `pdf.test.ts` geometry test times out under full-suite load

**Status:** OPEN (2026-08-10)

**Symptom.** `readPdf — geometry reconstruction > recovers a label column and two
right-aligned value columns` fails with `Test timed out in 5000ms` during `pnpm test`, and
passes in ~1.1s when run alone (`pnpm --filter @avilo/module test pdf`). Intermittent.

**Not a correctness bug.** The reconstruction is right; the test is racing vitest's default
5s timeout under parallel load, on a suite whose collect phase alone takes ~25s. Filed rather
than fixed because a flaky test in the shared suite trains people to re-run and move on,
which is how a real failure gets waved through.

**Likely fix.** An explicit `testTimeout` on this test, or a `poolOptions` cap so the PDF
suite is not competing with nine other files for cores.
