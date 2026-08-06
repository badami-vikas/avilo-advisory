# Decisions

Every non-trivial engineering call, why it was made, and what was rejected. Append-only — a superseded decision gets a new entry marking it superseded, rather than being edited away.

Format: **ADR-nnn · date · decision** → why · rejected · consequence.

---

## Architecture

### ADR-001 · Facts are keyed by (client, period, account)
**Decision.** One `facts` table keyed by client, period and canonical account id, rather than a shaped row per report.

**Why.** v9 held one client for one month and read the prior year by hard-coded column index (col 1 = prior year, col 13 = current). Any question outside that shape needed new code. With this key, "last six months for this client" is a WHERE clause.

**Rejected.** A table per report type — fast to write, but every cross-report question becomes a join nobody wants to maintain.

**Consequence.** Every number on every surface comes from one place. Series, ranges and comparisons are queries rather than features.

---

### ADR-002 · Row labels are data, not regexes
**Decision.** `label_mappings` maps a normalised QuickBooks row label to a canonical account. Built-in dialects are seeds in the same table shape, and any user correction is persisted and outranks them.

**Why.** v9 matched labels with regexes compiled into JavaScript. QuickBooks Online emits `Total for Income`; the regex expected `Total Income`; every field came back empty and the only fix was editing and redeploying code.

**Rejected.** A longer regex list. It has the same failure mode one dialect later.

**Consequence.** A label the app has never seen costs one click, once, forever. This is also what made AI row mapping possible later (ADR-014) — the accept path already existed.

---

### ADR-003 · Metrics are versioned expressions
**Decision.** `formulas` stores expressions as data, evaluated at runtime, with full version history.

**Why.** v9 computed metrics inline in render functions and had a separate hand-written panel *describing* them in prose. The two drifted. Here the expression **is** the definition: the panel renders it, the engine evaluates it, the required-data checklist is derived from its dependencies.

**Consequence.** One source of truth, three consumers. Changing a definition is a data edit with history, not a deploy.

---

### ADR-004 · Corrections are overrides with history
**Decision.** A manual correction writes an `overrides` row carrying its predecessor, never mutating the fact.

**Why.** v9's balance-sheet parser let a later matching row silently overwrite an earlier correct value. A silently lost correction is indistinguishable from a bug in the arithmetic.

**Consequence.** "Where did that number come from" is always answerable.

---

## Import

### ADR-005 · Classification is deterministic signature matching
**Decision.** Six known report types are identified by scoring titles, row markers, column headers and filename, with the evidence returned alongside the answer.

**Why.** v9 asked a cloud model to look at a PDF and guess. Wrong tool: this is a stable-answer matching problem, and it must work with the network off.

**Consequence.** Real QuickBooks exports score 1.0. Measured — this is why the model fallback was later removed as dead weight (ADR-015).

---

### ADR-006 · Every format converges on one Grid
**Decision.** Excel, CSV and PDF all become a `Grid` before any parser runs.

**Consequence.** A PDF that reconstructs cleanly is parsed by exactly the code that parses Excel, and inherits every fix made there. Six parsers never learn which format a file arrived in.

---

### ADR-007 · Nothing is written until the user confirms
**Decision.** Staging stores the file, classifies it and parses a preview, but writes no facts. Import writes.

**Why.** A misclassification should cost a click, not a wrong dashboard.

---

### ADR-008 · Section totals outrank detail rows
**Decision.** Balance-sheet matches are ranked (`total …` = 2, detail = 1); the highest rank claims the account. Equal-rank collisions are reported as genuine ambiguity.

**Why.** QuickBooks prints a detail line *and* a section total for the same account. First-match-wins picks whichever appeared first.

**Consequence.** This is also why subtotals must never be mapped — see ADR-016.

---

### ADR-009 · Account codes are stripped before matching
**Date.** 2026-08-03

**Decision.** `normalizeLabel` strips a leading 3–6 digit code, so `1100 Accounts Receivable` normalises to `accounts receivable`.

**Why.** Charts of accounts with numbered rows missed every seeded label. 3–6 digits deliberately: `12 Month Revenue` must not lose its `12`.

---

### ADR-026 · A group total replaces the rows it covers, everywhere
**Date.** 2026-08-05

**Decision.** `import/grouping.ts` is the one implementation of QuickBooks' `parent / children / Total for parent` shape, shared by the ageing and entity parsers. The P&L applies the same rule through its own ranking.

**Why.** ADR-008 established this for balance-sheet accounts and it was never generalised, so every list-shaped report shipped the naive reading. Three separate beta complaints — job codes listed as customers, receivables counted twice, a customer called "20200" worth $1.3m — were one missing rule applied in three places (BUG-020, BUG-021).

**Detail.** A parent that bills nothing directly prints as a bare label with no figures. It has to be carried into the collapse as a marker: without it there is nothing for the children to be spliced away from, and the group's job lines survive alongside their own total. This was the second half of the fix and the non-obvious half.

**Rejected.** Detecting groups from indentation. Indentation survives Excel and dies in PDF; the total row is present in both.

**Consequence.** Every entity list reconciles to its report's own grand total, and that is the assertion the tests make rather than a row count.

---

### ADR-027 · Only a section's own total closes it
**Date.** 2026-08-05

**Decision.** The P&L walker closes a section when it meets the total *for that section*, not on any total row.

**Why.** An expense list nests. Closing on the first `Total for Bank Charges & Fees` discarded every line below it, and Top Expenses rendered two rows out of nineteen (BUG-019).

**Consequence.** Sub-group totals now fall inside an open section, so they are separately excluded from `detailLines` — a total and its children in the same list would double-count. Both halves are needed; either alone is a different wrong answer.

---

### ADR-028 · A permanent decision needs a visible undo
**Date.** 2026-08-05

**Decision.** A mapped row stays in the list showing what it was mapped to, with Undo. Rows can be multi-selected and mapped together, and the copy states that a mapping applies to future uploads.

**Why.** ADR-002 makes a mapping durable, which is the feature. Removing the row on success made it also unreversible, and left the durability invisible — people re-mapped the same rows every month and reported it as the app forgetting. The stronger a stored decision is, the more it needs a way back.

**Detail.** `forgetMapping` deletes only the `origin = 'user'` row, so undoing falls back to the built-in dialect table rather than to nothing.

---

### ADR-029 · A sparkline may not out-claim the words beside it
**Date.** 2026-08-05

**Decision.** No line below three readings; readings positioned by their month rather than by rank; gaps drawn as gaps; an isolated reading drawn as a dot; the area fill only under an unbroken line.

**Why.** A card read "no comparison · Not enough history" and showed a confident decline. Both halves were the component's fault. Two readings can only be one straight segment, and a straight segment reads as a trend however it is coloured. Separately, the nulls were filtered out before the x-positions were computed, so two balance sheets a year apart drew exactly like two consecutive months — a smooth twelve-month slope that was two dots and an assumption.

**Rejected.** A flat line when there is no comparison. Flat is not neutral; it asserts stability, which is a claim about months that were never measured. Nothing is the honest shape of nothing.

**Consequence.** Same rule as ADR-023 and the fabrication guard, applied to pixels: the picture may not assert more than the figures support.

---

### ADR-030 · A ratio divides a stock by a rate, and one month is not a rate
**Date.** 2026-08-05

**Decision.** Liquidity ratios use a trailing three-month base via `avg<N>.<accountId>`
identifiers in the formula engine. Each keeps a `_point` twin computing the same thing on
the selected month.

**Why.** Grounding the metrics against a real client's books (the `/finance:reconciliation`
and `/finance:financial-statements` frameworks) showed the base was arbitrary: 54 days of
runway on the selected month, 38 on a trailing quarter, 19 on a trailing year, from one
cash balance. Three months is long enough to survive one lumpy month and short enough that
a business genuinely running out of money is not reassured by last summer.

**Rejected.** Computing the point-in-time figure in the chart. That is inline metric
arithmetic, which is what ADR-003 exists to prevent — so the twin is a registry entry.

**Detail.** A trailing window with no supplied history falls back to the period's own
value. The mean of one month is that month, and the alternative is telling a user that
`pl.cogs` is missing while it is on screen.

---

### ADR-031 · A shipped correction must reach databases that already exist
**Date.** 2026-08-05

**Decision.** Seeding upgrades a formula whose stored expression matches one the
application previously shipped, listed in `SUPERSEDED_EXPRESSIONS`, and records a new
version row. A user-edited expression is never touched.

**Why.** Seeding skipped anything already present, so corrected definitions only reached
fresh installs. A fix shipped, tested and reported as done sat unused on every existing
machine (BUG-025). The list is append-only and is the upgrade path.

**Rejected.** Overwriting unconditionally on version bump — it silently reverts a user's
own edit, which ADR-003 makes a first-class decision with history.

---

### ADR-032 · The statements must be checked against each other, not only within themselves
**Date.** 2026-08-05

**Decision.** `checkPeriodAlignment` reconciles the balance sheet's fiscal-year-to-date net
income against the imported P&L and names the window that matches.

**Why.** `integrity.ts` already checked *within* a period — the accounting equation, GL
control against ageing subledger, buckets against their total. Nothing checked that the
two statements covered the same stretch of time, and they routinely do not.

**Consequence.** "Unknown is a first-class result" extended to time: the app can now say
these two numbers are not comparable, instead of printing both.

---

### ADR-033 · A blueprint holds configuration, never source or a key
**Date.** 2026-08-05

**Decision.** `AviloBlueprint` (`@avilo/core`) is a versioned JSON document limited to
formula overrides, QuickBooks label mappings, the two AI guidance prompts, and report
layout. It has no field for source code and no field for a credential.

**Why.** The user asked for a chatbot that can "modify and optimise" the app, with the
change recorded and shareable so someone else's local copy can replicate it. The shipped
app is `asar`-packed (read-only to the running process), so source editing cannot work
inside an installed copy — only a dev checkout with a rebuild, which is not what a shared
file's recipient has. Separately, Avilo ingests third-party QuickBooks exports; a model
with write access to app behaviour and read access to untrusted import data is an
injection surface. ADR-016's rule — a model may choose, never invent — is the same rule
one level up: it may choose *configuration*, never invent *code*.

**Rejected.** Real source editing gated to a dev checkout, as a second artifact type
(a git patch). Considered and set aside for this release: two artifact types is real
surface for a first beta, and almost everything a user actually wants to change —
mapping accuracy, a formula's base, a prompt's tone — is already configuration (ADR-002,
ADR-003, ADR-013). Revisit if a real request needs more.

**Consequence.** `validateBlueprint` refuses a document carrying a forbidden field
outright — not a runtime check on a value, a fact about the type's shape — and refuses any
id (account, formula, report type, prompt key, layout section) outside the live registry,
the whole document at once rather than dropping the bad part silently.

---

### ADR-034 · Propose, diff, activate — never applied on write
**Date.** 2026-08-05

**Decision.** A blueprint is validated and diffed against live configuration, then stored
as a `blueprint_proposals` row with `status = 'proposed'`. A separate `activate` call —
issued by a person, never by the chatbot that proposed it — is the only path to changing
anything.

**Why.** Mirrors relationship-os's `WorkspaceBlueprint`: blueprint changes go through
`workspace.blueprint.propose` / `.activate`, never applied directly. `diffBlueprint` is
what the panel shows before Apply — the record ADR-004 already requires ("where did that
number come from") extended to configuration: where did this formula come from, and what
did it replace.

**Consequence.** `activateProposal` writes through the exact paths a manual edit already
uses — `learnMapping` for a mapping, a new `formula_versions` row for a formula (ADR-031),
`app_settings` for a prompt — so an activated blueprint change is indistinguishable in the
audit trail from a person typing the same edit by hand.

---

### ADR-035 · The chatbot and its governance mirror relationship-os, not just its style
**Date.** 2026-08-05

**Decision.** `platform/packages/core` and `apps/web/.../components/shared/AgentPanel.tsx`
sit at the same paths relationship-os uses for `packages/core/src/blueprint.ts` and its own
`AgentPanel.tsx`, and follow the same shape: a persistent right panel, a `converse`-shaped
procedure, a routed action that becomes a real, reviewable proposal rather than fabricated
feed content.

**Why.** Avilo is meant to lift into relationship-os as `platform/modules/avilo`
(README.md); the AI surface should not diverge in shape only to be rewritten at
integration. Avilo has no Chief of Staff or Approvals surface, so `copilot.converse`
substitutes for `chiefOfStaff.converse` and the panel's own proposal card substitutes for
an Approvals entry — narrower, same principle.

**Consequence.** Integration is deleting these two paths and repointing imports at
`@bridge/core` / the platform's own `AgentPanel.tsx`, the same move already documented for
`packages/tables`.

---

### ADR-036 · A layout blueprint sets the app-wide default, never a per-client edit
**Date.** 2026-08-05

**Decision.** `blueprint.layout` (`sectionOrder`/`hiddenSections`) is applied by writing
`app_settings["report_layout_default"]`. `ClientDetailPage.loadLayout` reads it only as a
fallback, when a client has no `report.layout` row of its own in `saved_views` — a
per-client edit always wins and this write path never touches it.

**Why.** The report layout was already "views as data" (`apps/web/src/app/report/
layout.ts`'s own header), stored per client because "two clients rarely want the same
report." A blueprint proposing a layout change is necessarily global — it has no client in
scope — so it can only sensibly mean "change the default," never "overwrite every client's
customization." Chat persistence (below) follows the same instinct in miniature: extend the
existing mechanism rather than add a parallel one.

**Consequence.** `diffBlueprint`'s `current` parameter grew an optional `layout` field so a
second proposed layout diffs against the first rather than always reading as a fresh
`"add"`. `AgentPanel` chat history persists through the same generic `settings.get`/
`settings.set` pair every other runtime override already uses (ADR-013), under
`copilot_chat_history` — no new table, because a chat transcript is exactly the kind of
single JSON blob that path already exists to hold.

---

### ADR-037 · The macOS installer ships arm64 only, until x64 is verified on real hardware
**Date.** 2026-08-05

**Decision.** `electron-builder.yml`'s `mac.target` dropped `x64`. Only
`Avilo Advisory-<version>-arm64.dmg` is built and distributed.

**Why.** BUG-028: the x64 dmg, run under Rosetta on the user's own Apple Silicon Mac,
could not open the database — caught live, with the process parked in the OS error
dialog and `better-sqlite3`'s `darwin-x64` prebuild loaded through Rosetta's AOT
translator. The arm64 dmg, tested repeatedly against the same real database on the same
machine, never failed. This is BUG-016's rule again, on the other platform: a
cross-built (or emulated) installer proves nothing the build host can check, and no
content inspection reveals it — launch on the actual target, or don't ship it.

**Consequence.** Intel Mac users have no installer until x64 is verified on real Intel
hardware, not just built without error. Re-add `x64` to `mac.target` only after that
verification — see BUG-028's open follow-up.

---

## AI

### ADR-010 · The app must work with no model configured
**Decision.** AI is additive everywhere. No feature depends on it; no surface breaks without it.

**Consequence.** Every model entry point is optional-by-construction — a runner that returns `undefined` when unconfigured, and callers written to carry on.

---

### ADR-011 · One key, one reader
**Date.** 2026-08-03

**Decision.** `groq_api_key` lives in `app_settings` and is read only by `groqConfig()`. All three AI features go through it.

**Rejected.** Per-feature keys. There is no scenario where an advisor wants mapping on one account and narrative on another.

---

### ADR-012 · The key never ships in the binary
**Decision.** No key is compiled in, seeded, or bundled. It exists only in the user's local SQLite, created at runtime.

**Verification.** `grep -c gsk_` on the installer returns 0. Re-checked on every release build.

---

### ADR-013 · Prompts are data
**Date.** 2026-08-03

**Decision.** `ACCOUNTING_GUIDANCE` and `NARRATIVE_GUIDANCE` are exported constants overridable at runtime via `app_settings`.

**Why.** Same reasoning as ADR-003. Mapping accuracy is tuned by editing text; tuning must not require shipping a binary. This is also what a "skill" is for a model reached over HTTP — it has no filesystem, so domain expertise travels inside the request.

---

### ADR-014 · AI belongs at row mapping, not classification
**Date.** 2026-08-03 · **supersedes the fallback added earlier that day**

**Decision.** The model maps unmatched row labels. It does not classify files.

**Why.** Classification is six stable answers the rules solve at 1.0 confidence — the model was never called. Row mapping is open-vocabulary: every bookkeeper names their chart differently and no seed table can enumerate that. Measured before moving it.

**Consequence.** The user's actual complaint — 17 unmapped rows — was untouched by the original placement.

---

### ADR-015 · No model call without a button press
**Date.** 2026-08-03

**Decision.** Upload is rules-only. Two call sites: **Suggest** and **Generate**, plus **Test connection**.

**Why.** The classification fallback fired automatically and silently, spending quota on a decision nobody asked for and delivering a wrong answer wearing the same face as a right one. Pressing a button is what says *I want speed here and I will check the result*.

---

### ADR-016 · A model may choose, never invent
**Decision.** Row mapping picks from the canonical account list or answers `skip`; anything else — including a hallucinated id — degrades to `skip`. Summary generation receives computed findings as its only source and is rejected if it emits a figure not among them.

**Why.** This is the property that makes it acceptable to put a model near a client's statements. A wrongly mapped row silently corrupts a balance sheet; an unmapped row costs one click.

**Consequence.** Hallucination degrades to the state the user was already in.

---

### ADR-017 · Cost is controlled by persistence, not by click-gating
**Date.** 2026-08-03

**Decision.** Prefer AI output that becomes stored data over output recomputed per view.

**Why.** An accepted mapping is written to `label_mappings` and never asked again — cost decays to zero. A per-view "explain this" button pays again forever. Click-gating helps; persistence is the real lever.

---

### ADR-018 · The deterministic narrative stays the source of truth
**Decision.** `insights.ts` computes the executive summary from measured facts. Generate rewrites that text for client consumption; it never replaces it or analyses independently.

**Why.** An advisor can defend a computed sentence. They cannot defend a fluent one a model invented.

---

### ADR-019 · New data supersedes a custom edit
**Date.** 2026-08-03 · **user decision**

**Decision.** An edited summary is stored with a fingerprint of the findings it was written against. When the figures change, the fingerprint no longer matches and the edit is set aside with a notice.

**Why.** The alternative is a page confidently showing hand-written prose above numbers it no longer describes — the exact failure this app exists to prevent.

**Detail.** Content-based hash, not a timestamp: re-importing the same file must not discard the advisor's wording.

---

### ADR-024 · Native dependencies a feature does not need are not shipped
**Date.** 2026-08-03

**Decision.** `@napi-rs/canvas` is excluded from the package, and pdfjs is loaded lazily behind a minimal DOM shim.

**Why.** pdfjs pulls canvas in to *render* pages. Nothing here renders — the importer reads text positions and advance widths only. But canvas resolves one prebuilt binary per platform through separate optional packages, so a cross-build ships the build host's: the Windows installer carried the darwin binary and no win32 one. pdfjs then could not polyfill `DOMMatrix`, and its top-level `new DOMMatrix()` threw inside the ES module loader. The app refused to launch for every Windows user, PDF or no PDF (BUG-016).

**Rejected.** Installing the win32 optional package alongside the darwin one. It makes the installer bigger, still depends on the build host resolving correctly, and buys nothing — the product never renders a page.

**Consequence.** Every platform takes the path that is actually tested. Proven by removing canvas from `node_modules` entirely and re-running the PDF suite: all 9 tests pass.

**Corollary — a general rule.** A dependency only one feature needs must only be able to break that feature. Any import that can fail on a platform belongs behind a lazy load, never at module scope where it becomes load-bearing for application start.

---

### ADR-025 · A cross-built installer is not verified on the build host
**Date.** 2026-08-03

**Decision.** Treat "inspected the package on macOS" as no evidence at all about Windows.

**Why.** Per-platform native dependencies resolve to the host's architecture, and nothing in the build output says so. Every content check passed on a Windows installer that could not start (BUG-016).

**Consequence.** Either launch on the target platform before shipping, or remove the native dependencies that make platform divergence possible. Recorded in CLAUDE.md.

---

## Interface

### ADR-020 · One legend, one verb, every chart
**Decision.** Legends are HTML, shared, and never drawn by chart.js. Nothing selected draws everything; selecting isolates; selecting again restores.

**Exception.** The ageing doughnut dims instead of isolating — remove a slice and the remaining ring stops being a share of anything.

---

### ADR-021 · Every panel states its own basis
**Decision.** One month picker anchors the page; each panel declares how far back it looks from that month end.

**Why.** These figures *cannot* share a window — a P&L is a month, a balance is a day, a customer ranking is a year — but they can share an **end**.

---

### ADR-022 · Every visual can show its own figures
**Date.** 2026-08-03

**Decision.** The shared chart `Frame` takes optional table data and renders a Data/Chart toggle.

**Why.** "Show me the numbers" was previously answered by leaving for the raw-data view and matching a series by eye.

---

### ADR-023 · Derived is recomputed; only human input is stored
**Decision.** Recommendations, warnings and insights are recomputed every render. Only owner, due date, status, notes and summary edits persist.

**Consequence.** The analysis can never go stale relative to the data. ADR-019 is this rule applied to an edit.

---

### ADR-038 · The assistant applies configuration changes itself; Undo replaces the pre-approval
**Date.** 2026-08-05

**Decision.** A blueprint block in the assistant's reply goes through
`applyBlueprintDirectly` — validate, snapshot, apply — instead of `proposeBlueprint`.
The change is live when the reply renders. The configuration as it stood immediately
before is recorded as its own proposal and returned as `revertId`; the panel's Undo
activates it.

**Why.** The propose/activate split was the right default when nobody had used the
panel yet. In practice it produced an assistant that answered every request for a change
with a paragraph explaining that it could propose one — the user's words: "I want an AI
agent that acts, not recommends." The pre-approval was buying less than it cost:
`validateBlueprint` was already the thing preventing a bad write, and it still runs
unchanged.

**What did NOT change.** An id outside the live registry is refused and nothing is
written — not even the snapshot (`applyBlueprintDirectly` validates first). Formula edits
still open a `formula_versions` row, mappings still go through `learnMapping`. The blast
radius is unchanged: configuration only. Facts, source code, UI and imports remain
unreachable — there is no mechanism, not a policy.

**Rejected.** A setting to toggle auto-apply. Two behaviours to reason about, and the
one the user asked for would have been the non-default.

**Consequence.** `CLAUDE.md`'s AI canon changes: "never activated by the model itself"
becomes "applied by the model, reversible by the user". Undo restores formulas, prompts
and layout exactly. It does **not** un-learn a label mapping the assistant added —
`learnMapping` upserts and the snapshot carries only the mappings that existed — so that
one is corrected in the mapping UI like any other. Known and accepted, not a silent gap.

---

### ADR-039 · An absent `layout` means "leave it alone", so a revert must spell out the empty state
**Date.** 2026-08-05

**Decision.** When `applyBlueprintDirectly` snapshots a configuration that has no layout
override, it writes an explicit `{sectionOrder: <all sections>, hiddenSections: []}` rather
than omitting the field.

**Why.** Caught in live testing, not by the type system: the first Undo of an
assistant-hidden section did nothing. `activateProposal` writes layout only
`if (blueprint.layout)`, which is correct for an imported document that shouldn't disturb
layout — but it makes "layout was unset" and "don't touch layout" the same document. The
snapshot has to distinguish them, and the only way to say "unset" in this schema is to say
the default out loud.

**Consequence.** A revert leaves a `report_layout_default` row where there was none. That
is behaviourally identical — the row holds the built-in order with nothing hidden — and
`normalizeLayout` already treats a partial order the same way. Regression test:
"undo clears a layout the assistant added when there was no layout override before".

---

### ADR-040 · The server has the last word on what the assistant did
**Date.** 2026-08-06

**Decision.** `converse` compares the model's prose against what was actually written. If
the reply claims an action (`CLAIMS_AN_ACTION`) and no change was applied, the turn is
returned with `falseClaim: true` and the panel renders a correction over it. A blueprint
whose diff is empty returns `noChange` and writes nothing at all. Every applied change is
described in readable words by `describeChange`, never as `${kind} ${section}: ${key}`.

**Why.** ADR-038 made the assistant act, and within one version it was claiming to have
added UI buttons (BUG-029), reporting empty diffs as applied changes (BUG-030), silently
hiding a report section in response to an unrelated request (BUG-031), and narrating layout
changes it had not made (BUG-032). Every one of those reached the user as confident prose
with nothing to contradict it.

Tightening the prompt was necessary and insufficient — it fixed over-claiming and
immediately produced under-acting, with the narration unchanged. The model is a small hosted
one and its prose does not reliably track its behaviour. So the check moved to where the
truth already lives: the server knows exactly what it wrote.

**Rejected.** Reverting to propose-then-approve. The user asked for an assistant that acts,
and the failure was never that it acted — it was that it *said* it acted when it had not.

**Rejected.** A status line under every reply. Correct, and noise on the questions that make
up most of the panel's use. The correction appears only where prose and behaviour disagree.

**Consequence.** `CLAIMS_AN_ACTION` is deliberately loose. A false positive costs one
redundant line under an answer that changed nothing anyway; a false negative is an
unchallenged lie. Tuning it, keep that asymmetry.

**Standing rule.** Where a model's claim is shown to a user, something that knows the truth
must be able to contradict it. An assistant's own account of its work is not evidence.

---

### ADR-041 · Generative UI: the assistant composes screens from a closed component registry
**Date.** 2026-08-06

**Decision.** A blueprint may carry `views` — named screens built from a closed union of
component types (`metric`, `chart`, `table`, `text`, `actions`). They appear in the client
page's View picker, are addressable by URL, and are created, edited and removed by the
assistant through the same validate → snapshot → apply → undo path as every other change.

**The rule that makes it safe: a component carries BINDINGS, NEVER VALUES.** A metric names
an account or formula id and the figure is looked up from the same `PeriodReport` the report
view renders. A chart names series ids; the points come from `report.series`. A table names
a detail set the importer produced. There is no field in `ViewComponent` that can hold a
number, so "never fabricate a figure" survives a generated interface *by construction*
rather than by instruction. Verified on real data: the assistant's "Overdue invoices" view
shows $60,000 receivable, which is the imported `ar.total` fact, and its customer table sums
to exactly that.

**Buttons are bindings too.** `VIEW_ACTIONS` is a closed list of things the application
already does. The assistant places a button; it never authors behaviour.

**Why a registry rather than letting the model write UI.** The model composes from a
vocabulary it cannot extend. `validateBlueprint` checks every binding against the live
registry before a view can be stored, which is why `DynamicView` has no defensive branches:
an unknown id never becomes a stored view, because the whole document is refused. Nothing
the model emits is executed, and no path exists from its output to markup — `text` renders
as text, never HTML.

**Rejected.** Preview-then-confirm, which the proposal that prompted this recommended. It
contradicts ADR-038 and buys little for a change that is cheap and already reversible: the
snapshot and Undo already existed. Preview earns its cost for expensive or irreversible
actions; a view is neither.

**Consequence.** `views` replaces the whole set on apply, which is how removal is
expressible at all — and why the assistant is told to send existing views back alongside a
new one. Absent entirely means "leave views alone", the same rule ADR-039 set for layout.

---

### ADR-042 · A new formula id is a creation; every other id stays closed
**Date.** 2026-08-06

**Decision.** `validateBlueprint` accepts a formula id outside the registry, provided it
looks like an identifier. `applyBlueprintDirectly` then compiles the expression against the
live accounts and formulas — including `avgN.` trailing windows — and refuses the document
if anything it references does not exist. Creation writes a `formulas` row and a version-1
`formula_versions` row, the same audit trail an edit leaves.

**Why.** "Add a metric for X" has no other expression, and it was silently broken: the
apply loop skipped any formula without an existing row, so a blueprint adding a metric
activated cleanly and changed nothing. `registeredSurface().formulaIds` unions the database
with `SEED_FORMULAS`, so validation passed and the write never happened.

**The asymmetry is deliberate.** Only a formula can bring a new name into being. Accounts,
report types, prompt keys, section ids and every view binding name things that already
exist, and stay closed. Relaxing the id check for formulas is safe only because the
expression check replaces it — a created formula that references an imaginary figure is
refused whole.

**Consequence.** The expression check runs on creations only. Re-checking edits would reject
seeded definitions that legitimately use `avgN.` windows, which `validateExpression` does
not model — a pre-existing limitation this ADR does not attempt to fix.

---

### ADR-043 · An MCP server for external agents: propose-only, restore-allowed, data-free
**Date.** 2026-08-06

**Decision.** Ship `@avilo/mcp`, a stdio Model Context Protocol server exposing six tools
over the configuration surface: `describe_surface`, `get_configuration`, `list_versions`,
`get_version`, `propose_change`, `restore_version`. An external agent can read the registry,
read the configuration, record a proposal, read history, and return the app to a state it
has already been in. It cannot activate a new state, and it cannot read client data.

**Why an inbound door at all.** The assistant panel could already change configuration, but
only through a Groq model, only in prose, and only for whoever was sitting at the app. The
user wanted Claude Code and other external agents to build views and edit the financial
model directly. Reusing the blueprint pipeline made that nearly free: the validation, diff,
audit and history all already existed, and an MCP tool is a second front door onto them
rather than a second implementation.

**This changes a product claim, and that is stated rather than glossed.** "No account, no
cloud, no network required" stays true of the application; it is no longer true that
nothing outside the app can reach it. The transport is stdio — nothing is bound, opened or
listened on, and only a process the user launched can talk to it — but an external program
can now read and change configuration. `AGENTS.md` and `docs/wiki/mcp.md` say so plainly.

**Why propose-only.** The propose/activate split already existed. An agent records; a person
activates. A state nobody has approved should not become live because a model decided it
should, and making activation structurally absent is stronger than making it policy-denied
— there is no tool to misuse.

**Why restore IS allowed without a human.** Restoring names a version that was already live,
so it cannot introduce anything new; and history is append-only, so a restore appends rather
than truncating and is itself restorable. "Move the configuration to a state it has already
been in" is strictly weaker than "put it in a state of my choosing". That asymmetry is what
lets an agent revert — which the user asked for — without letting it decide anything.

**Why the data boundary is a test and not a check.** Every tool could have called a
`assertNoClientData()` helper; that guards the tools that exist, not the one someone adds in
six months. Instead `tools.ts` imports only configuration services, and
`test/mcp-isolation.test.ts` walks the transitive import graph from `server.ts` and fails if
any reachable file names a client-data table. This required splitting `loadFormulaSpecs` out
of `report.ts` — importing it dragged every fact and override query into the graph.

**Rejected: routing through the running app's loopback API.** Would have made the boundary
an OS-level one rather than a code-level one, but requires the app to be running to use the
agent, which is exactly backwards for an agent doing setup work. Revisit if this ever runs
unattended.

**Consequence, stated honestly.** The server process opens the same SQLite file the
application does, because configuration lives there. The isolation guarantee is at the level
of code, verified by a test, not enforced by the operating system. A stronger claim needs
configuration in its own file or the loopback route above.

---

### ADR-044 · Configuration history is a table of states, not a list of requests
**Date.** 2026-08-06

**Decision.** Add `configuration_versions`: one row per state the configuration has actually
been in, holding the full normalized document and the diff from its predecessor.
`activateProposal` is the single writer, so every route into the live configuration —
assistant, person, external agent — appends a version. `restoreVersion` returns to any of
them, appending rather than truncating.

**Why.** A proposal is a *request*; a version is a state that was *live*. Keeping only
proposals meant "go back" could only mean "activate the one snapshot `applyBlueprintDirectly`
happened to take before the last assistant action" — one step, on one path, and unavailable
entirely after a human activated an imported document, because `activateProposal` refuses to
run twice. Asking for multi-step revert on top of that structure was asking the wrong table
a question it could not answer.

**Forward-only.** Restoring seq 3 writes a new version at the head; it does not delete 4 and
5. Nothing is destroyed by using the feature, an undo is undoable, and the UI says so
("Restoring adds a new entry rather than deleting the ones after it"). This property is
load-bearing for ADR-043: it is why an external agent may restore unsupervised.

**Normalized, not delta.** A stored version spells `layout` and `views` out, because an
absent key means "leave alone" (ADR-039) — a state captured before any view existed could
otherwise never remove one added later. The `noChange` guard normalizes both sides before
diffing; comparing a normalized document against a raw `currentConfiguration()` reported a
change every time and was caught by the tests before it shipped.

**A baseline is written before the first change.** On an installation upgraded from an
earlier build, history starts empty while the configuration is already whatever the user
built up. Without it, the first change would be seq 1 with nothing earlier to restore — the
user would lose the ability to undo precisely the change they were making.

---

### ADR-045 · An author declares which levers it is changing, and is held to it
**Date.** 2026-08-06

**Decision.** Every blueprint the assistant emits must carry `"declares": [...]`, naming the
levers it changes. `applyBlueprintDirectly` computes the diff and refuses the **whole**
document if any change falls outside that declaration. An omitted declaration declares
nothing and therefore refuses everything. `declares` is stripped by `validateBlueprint`
before storage, so an exported blueprint never carries it — it is a statement of intent in
the chat protocol, not part of the portable document.

**Why.** BUG-031 and BUG-033 are the same failure twice, three versions apart: a request
about one lever arrived as a document that also rewrote the report layout, silently undoing
a section the user had deliberately hidden. The prompt has said "omit what you are not
changing" since v1.9.3. A small model does not reliably comply, and after the second
occurrence this stopped being a prompting problem.

The declaration works because it is made **before the diff is known**. The model states
intent in one place and expresses it in another; the server compares them. Neither the
prompt nor the model has to become more reliable — the disagreement between two things the
model already produces is what gets caught.

**Refuse whole, not filter.** Dropping the undeclared entries and applying the rest would be
friendlier and wrong: a partly-applied change is exactly the state the propose/activate split
exists to prevent, and it would leave the user with a change nobody described. The author can
resubmit having either narrowed the document or widened the declaration honestly.

**Rejected: making the declaration optional.** An optional guard is not a guard — the failure
it catches is precisely the model being careless, and a careless model omits the field. The
cost of strictness is a refused turn the model can correct; the cost of laxity is a silent
edit to the user's report.

**Consequence.** The MCP and import paths pass no declaration and are unaffected — an
external agent composes its document deliberately and its proposal is reviewed by a person
before it lands, so the guard addresses a risk those paths do not carry. Verified live: the
request that produced BUG-033 now refuses with an offer of what *can* be done, and the
follow-up "yes, build the view" still applies normally.

**Companion, same commit.** `levelsClaimedInProse` closes the other half (BUG-034). ADR-040
gave the server the last word on *whether* something changed; it left open *what* changed, so
"I've added a metric" could sit above a card reading `Added view "Profitability"` with a green
tick lending it credibility. The prose is now compared to the diff by keyword, and a lever the
prose claims that did not move is marked on screen: trust the change list, not the sentence.

**Standing lesson, sharpened.** ADR-040 said a model's account of what it did is not evidence.
The sharper form: when prompting fails twice on the same class of defect, stop writing prompt
text and find two model outputs that can be checked against each other.

### ADR-046 · The assistant's reach is drawn around chrome, not around content

**Decision.** Three levers were added — `dashboard`, `clientsTable`, `landingTiles` — and the
boundary the assistant is told about was redrawn. It used to be "these five things are
yours, everything else on screen is the application". It is now "the header, the navigation,
the view dropdown, the assistant panel and the clients-list search/filter are the
application; every other surface is arrangeable".

**Why.** The old line was drawn where the code happened to be flexible, not where a user
would draw it. An advisor looking at the clients page sees four summary tiles and a table of
columns and has no way to tell that one is configurable and the other is chrome — so they
ask, and the assistant refuses something that looks arbitrary, or worse, claims to have done
it. BUG-036 and its two follow-ups were all this shape. Prompting was tried twice; the third
attempt is to remove the pressure by making the request answerable.

**Why it does not weaken anything.** All three levers have one shape,
`{order, hidden}` over a closed registry of ids the application already builds. An
arrangement can permute and hide; it has no field that can hold a value. So the reach
grows across surfaces while "never fabricate a figure" holds for exactly the reason it held
for generated views (ADR-041) — not because the model is asked to behave, but because there
is nowhere to put a number. Every id is closed; the formula-creation exception (ADR-042) is
untouched.

**Consequences, and what had to be got right.**

- `normalizeVersionDocument` must spell out each arrangement to the app's **real** default
  when unset, not to an empty one. The clients table hides eleven columns by default;
  normalizing to `hidden: []` would have made restoring the baseline itself a change,
  silently showing eleven columns nobody asked for.
- `landingTiles` treats `order` as a **selection**; the other levers append unmentioned ids.
  Appending is right for a panel — one added in a later build should not vanish for someone
  with an older stored arrangement. It is wrong for tiles: seventeen aggregates exist and
  four show by default, so "show me these five" must mean five.
- `levelsClaimedInProse` now discriminates by noun (tile / column / panel) rather than by
  verb. "Hid" and "reordered" apply to four surfaces now, so keying off the verb would have
  reported a misdescription every time the assistant correctly hid a panel — a check that
  cries wolf is a check nobody reads.
- Unknown ids are dropped at render, not just refused at propose time. A stored arrangement
  can outlive the build that wrote it (a restore from an older installation, a blueprint from
  a colleague), and it has already passed validation against a *different* registry.

**Rejected: letting the assistant emit markup for the executive summary.** The request that
prompted this round also asked for colour-coded prose and hyperlinks. Colour and in-app links
are fine and are being built — the app resolves both. Arbitrary external URLs and raw HTML
are not: an external link in a client-facing PDF is an outbound request from an application
whose premise is that nothing leaves the machine without a button press, and raw HTML makes
model output into page content. The capability the user asked for is delivered without either.

### ADR-047 · The server's account replaces the model's, rather than arguing with it

**Decision.** Where the server knows what happened and the model's prose says otherwise, the
prose is **withheld** and replaced by a sentence generated from the diff (`serverNarration`).
The model's wording is carried in `suppressed` and shown collapsed, behind a disclosure.

**Why.** BUG-030 and BUG-034 both ended in a correction card: print the claim, rebut it
underneath. That is honest and it is still the wrong shape — the user reads the false
sentence, and being told afterwards that it was wrong does not un-read it. The rule this
establishes: *where something knows the truth, it gets to speak first*, not merely to append
a footnote.

Withheld rather than deleted, because someone debugging their assistant needs to see what it
actually said. The default is not reading it; the option is always there.

**Consequence.** `serverNarration` takes the change list — the same list the "Change applied"
card renders. It has no input the model authors, so it cannot claim a lever that did not
move. The misdescription card no longer says "trust the list below, not the sentence above";
the sentence above *is* the list.

**What this does not fix.** The model still generates false sentences; they are no longer
displayed. Full tool-calling for the assistant panel — where the document and the claim are
one structured object — remains the stronger version and is not built.

### ADR-048 · Rich text for the executive summary: spans, not markup

**Decision.** Generated summaries return a `SummaryDoc` — a list of blocks of spans, each
span carrying text and optionally a `color` or an in-app `link` id. Colour is unrestricted.
Links resolve against a registry of destinations inside the application. There is no field
for markup and no field for a URL.

**Why not HTML.** The request was colour-coded prose with hyperlinks, which HTML would have
delivered in an afternoon. It would also have made model output into page content, and put a
live external link into a PDF an advisor sends to a client — an outbound request from an
application whose whole premise is that nothing leaves the machine without a button press.
So the ADR-041 move again: a closed grammar, where the unwanted state is not refused by a
filter but is unrepresentable.

**Colour was never the risk.** It is unvalidated beyond "is a colour": React assigns it
through the CSSOM, which drops anything that is not one. The worst outcome is green on a bad
number, which the advisor can see and correct. Restricting it would have bought nothing and
cost the thing that was actually asked for.

**Five defects found by running it against the live model, none of which a unit test would
have produced.** Recorded because each one was invisible from the code:

1. **Raw JSON reached `fabricatedFigures`.** On a parse failure the model's output was passed
   through as prose — so the hex colour `#15803d` read as the figure `15803`, and a perfectly
   faithful summary was discarded for containing numbers "not in your books". The check was
   right; it was being shown the wrong text. `salvageSummaryText` now extracts the words.
2. **One object per paragraph.** The model emitted several top-level JSON objects rather than
   one with several blocks. Taking the first `{` to the last `}` spanned them all and parsed
   nothing.
3. **`{"text=` for `{"text":`.** Repaired, anchored to a key position so it can never corrupt
   an `=` inside a legitimate value.
4. **The token ceiling was still sized for prose.** The span form costs roughly three times
   the tokens, so replies were truncated mid-object and *every* generation silently degraded
   to plain text. Indistinguishable, from the outside, from the model ignoring the format.
5. **Report links had nothing to scroll to.** Section ids existed in the layout config but
   were never rendered into the DOM, and a `report:` link clicked from the dashboard pointed
   at a different view entirely. Both fixed — ids are rendered, and a cross-view link
   switches view before scrolling.

Groq's JSON mode (`response_format: json_object`) was then enabled for this call, which took
the rich form from landing about half the time to landing every time in testing.
