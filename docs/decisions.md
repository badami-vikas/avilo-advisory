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
