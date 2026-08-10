# Avilo Advisory — Project Instructions

Avilo Advisory is an **offline-first, local-first financial advisory desktop app**. An advisor imports QuickBooks exports for a client, and the app turns them into a month-end report, an interactive dashboard, and a PDF. Everything runs on the advisor's machine: a Fastify + tRPC server on loopback, SQLite on disk, an Electron shell. **No account, no cloud, no network required to do the work.**

Full context: [docs/wiki/index.md](docs/wiki/index.md) · Navigation: [docs/INDEX.md](docs/INDEX.md)

## The one idea this codebase is built around

The predecessor (v9) held **one** client for **one** month, read prior-year values by hard-coded column index, matched QuickBooks row labels with regexes compiled into JavaScript, and computed metrics with inline arithmetic. Six consecutive rounds of bugs traced to those four decisions. Every one is inverted here:

| v9 did | This does | Where |
|---|---|---|
| One client, one month | `facts` keyed by (client, period, account) — any range is a WHERE clause | `modules/avilo/src/schema.ts` |
| Regexes for row labels | `label_mappings` — a persisted, user-correctable **row** | `modules/avilo/src/accounts.ts` |
| Inline metric arithmetic | `formulas` — versioned expressions evaluated at runtime | `modules/avilo/src/formulas/` |
| Silent overwrite on correction | `overrides` with full history | `modules/avilo/src/overrides.ts` |

**When you are about to encode knowledge in code, check whether it should be data.** That is the house rule, and most of the good decisions in `docs/decisions.md` are applications of it.

## Docs protocol

- `docs/wiki/` = key takeaways, terse. `docs/raw/` = full depth, plans, session records.
- **Read `docs/wiki/` by default.** Go to `docs/raw/` only when the wiki is insufficient.
- [docs/decisions.md](docs/decisions.md) — every non-trivial engineering call, with rationale and what was rejected. Append, never rewrite.
- [docs/bugs.md](docs/bugs.md) — every bug found, its root cause, and how it was proven fixed. Append; mark RESOLVED with a date rather than deleting.
- New or changed `docs/raw/` → update the matching wiki page.
- **Record a decision when you make one.** If a future reader would ask "why is it like this", it belongs in `decisions.md`.
- **File a bug the moment you spot one**, without waiting to be asked.

## Working rules

- **Verify before claiming.** This project has burned multiple cycles on "fixed" work that was not. Run the command, read the output, then say it. Evidence before assertions.
- **A fresh database is not a test.** Migration bugs here hide behind fresh installs — the failure mode is always an *existing* database. Test the upgrade path against a copy of a real one.
- **`build.mjs` does not build the web bundle.** It copies `apps/web/dist` and errors only if missing. Always `pnpm --filter @avilo/web build` before `dist:mac` / `dist:win`, then grep the packaged bundle for a string you just added.
- **Grep the asar with `asar extract-file`, never directly.** A raw `grep` on `app.asar` returns 0 for strings that are definitely present.
- **A cross-built installer proves nothing on the build host.** Per-platform native dependencies resolve to the *host's* architecture, and no content check reveals it — a Windows build that passed every inspection could not launch (BUG-016). Launch on the target, or ship no platform-divergent native deps.
- **Never import a platform-fragile dependency at module scope.** It becomes load-bearing for application start. Lazy-load it so it can only break its own feature.
- **Blast-radius check before finishing.** You own the neighbourhood, not just the file — callers, shared types, the packaged app, the other three views.
- **Never fabricate a figure.** Everything on screen must trace to an imported fact, a stored override, or a formula. "Unknown" is a first-class result.

## AI rules (canon)

The app works fully with **no model configured**. AI is additive, never load-bearing.

- **No model call without a button press.** Nothing calls out on upload, render, or navigation. Three call sites: **Suggest** (row mapping), **Generate** (executive summary), and the **Assistant** chat panel — plus **Test connection**. The panel is chat-initiated, not autonomous; it never calls out on render or a timer.
- **One key, everywhere.** `groq_api_key` in `app_settings`, read only via `groqConfig()` in `apps/api/src/services/ai.ts`. Never add a second key or a second reader. The Assistant panel goes through the same reader.
- **A model may choose, never invent.** Row mapping picks from the canonical account list or answers `skip`; a hallucinated id degrades to `skip`. Summary generation rewrites *computed* findings and is rejected if it contains a figure the books do not have (`fabricatedFigures`). The Assistant **applies** a change (formula, mapping, prompt, default layout, or a whole **view**) as a **blueprint**, validated against the live registry — an id it invents is refused outright and nothing is written — and every change is reversible from the panel's Undo (ADR-038). See `docs/wiki/blueprint.md`.
- **Generated UI binds, never carries.** The Assistant composes screens from a closed component registry (`metric`, `chart`, `table`, `text`, `actions`). A component names an account/formula/detail-set/action id; it has no field that can hold a figure, so "never fabricate a figure" holds through a generated interface by construction (ADR-041). A button binds to an action the app already has. Source code, the app's own chrome, facts and imports remain unreachable — no mechanism, not a policy.
- **Only a formula may introduce a new id** (ADR-042), and only if its expression compiles against real accounts and formulas. Every other id — accounts, report types, prompt keys, section ids, view bindings — is closed.
- **The boundary is drawn around chrome, not around content** (ADR-046). Only the header, navigation, view dropdown, assistant panel and the clients-list search/filter are off-limits; every other surface is arrangeable. The arrangements share one shape — `{order, hidden}` over a closed registry — and no field in that shape can hold a value, so widening the reach costs nothing against "never fabricate a figure". A visible-but-unreachable surface is what produced BUG-033 to BUG-036: it makes the model strain against the boundary and claim work it did not do.
- **Thirteen levers, split by who can reach them.** Nine are *configuration* — `formulas`, `mappings`, `prompts`, `layout`, `views`/`viewsPatch`, `dashboard`, `clientsTable`, `landingTiles`, `accountLabels` — global, portable, and reachable over MCP. Four are *client-scoped* — sticky notes, action assignments, client metadata, that client's report layout — and live in `services/client-levers.ts`, which the MCP import graph must never contain (ADR-049). `clients` and `sticky_notes` are client-data tables; putting those writes in `blueprint.ts` would hand an external agent a client's record, and `mcp-isolation.test.ts` fails the build if it happens. **None of the client-scoped sections carries a client id** — they act on the open client, so reaching another client's rows is impossible by construction rather than by a check.
- **A benchmark is the one number a blueprint may carry** (ADR-050). It is a threshold the advisor sets, never a reading from the books, and no displayed figure is sourced from it. `active: false` hides a metric without deleting it — deleting a formula to hide it throws away the history ADR-003 exists to keep.
- **"Already configured" is not a refusal** (ADR-052, BUG-045). A request the app has already satisfied must never render the copy for a request it cannot do — that tells the user a working capability is missing, and it cost a user three repeated attempts and a session spent believing the assistant was powerless. `alreadyConfigured` is a distinct outcome and carries the step actually outstanding, which is usually a button.
- **An author declares which levers it changes, and is held to it.** Every blueprint the
  Assistant emits carries `declares`; a diff touching anything outside it is refused whole,
  and an omitted declaration refuses everything (ADR-045). This exists because prompting
  failed twice on the same defect (BUG-031, BUG-033) — a request about a formula silently
  rewriting the report layout. When prompt text fails twice, stop writing prompt text and
  find two model outputs that can be checked against each other.
- **Where the server knows the truth, the server speaks first** (ADR-047). A reply whose prose claims a change that was not made, or names a lever that did not move, is not printed and rebutted underneath — it is *withheld*, and replaced by a sentence generated from the diff. The model's wording stays available behind a disclosure. Printing a lie and arguing with it still shows the user the lie.
- **Generated prose binds too** (ADR-048). The executive summary's rich form is a list of spans: text plus an optional colour or an in-app link id. Colour is unrestricted — it was never the risk. There is no field for markup and no field for a URL, so a summary that reaches a client PDF cannot carry an outbound link. Same move as ADR-041, applied to prose.
- **The server has the last word on what the Assistant did.** Its prose is not evidence. A reply claiming a change that was not written is corrected on screen; a blueprint whose diff is empty writes nothing and reports nothing; every applied change is described in words the user can check against what they asked for (ADR-040, BUG-029 to BUG-032). Where a model's claim is user-visible, something that knows the truth must be able to contradict it.
- **The Assistant sees the open client's data, read-only.** With a client open it is given that client's real imported periods, the accounts an active formula needs and is missing, and the canonical accounts that have never received a fact — composed from the same `report.ts` queries the report view runs, so its answer can never diverge from the screen. It reads; it cannot write a fact.
- **An external agent reaches configuration, never the books.** `@avilo/mcp` is a stdio MCP
  server exposing the same blueprint pipeline to Claude Code and other agents. It can
  describe the surface, read configuration, record a **proposal**, read history, and
  **restore** a version — it cannot activate a new state, and it cannot read a client, a
  fact or a figure. The data boundary is the module graph, checked by
  `test/mcp-isolation.test.ts`, not a rule in a prompt (ADR-043). This is an inbound door:
  the app still makes no outbound request without a button press, but "nothing outside can
  reach it" is no longer true, and `AGENTS.md` says so.
- **Every change to the configuration leaves a state you can return to.**
  `configuration_versions`, written by `activateProposal` alone, so no path can change
  configuration without recording the result. Restore is forward-only — it appends rather
  than truncating, so an undo is itself undoable, which is what makes it safe to let an
  agent revert unsupervised (ADR-044).
- **The deterministic narrative is the source of truth.** `insights.ts` is pure functions. Generated prose is a rewrite of it for sending to a client, never a replacement.
- **Prompts are data.** `ACCOUNTING_GUIDANCE` and `NARRATIVE_GUIDANCE` are overridable at runtime via `app_settings` — mapping accuracy is tuned by editing text, not by shipping a binary.
- **New data supersedes a custom edit.** An edited summary is stored with a fingerprint of the findings it was written against; when the figures move, the edit is set aside.

## Stack

pnpm workspace monorepo. React 18 + Vite 6 + TypeScript 5.7 + Tailwind 4 + Radix + chart.js 4.5 · Fastify 5 + tRPC 11 + Drizzle + better-sqlite3 · Electron 43 + electron-builder 25. Groq is the only external service and is optional.

```
platform/apps/{web,api,desktop,mcp}   platform/modules/avilo   platform/packages/tables
```

## Commands

```bash
pnpm dev                 # web + api
pnpm test                # 289 tests
pnpm typecheck           # 6 packages
pnpm --filter @avilo/web build && pnpm app:win   # installer — build web FIRST
```

Data lives in `~/Documents/Bridge/Avilo Advisory/` (`.data/avilo.sqlite` + imported files).

## Status

v1.8.0. Shipping to a first beta user. Windows installer is **unsigned** — SmartScreen will warn, and no build of this app has yet been launched on Windows by us (BUG-016 was fixed in 1.4.2 and remains unconfirmed on real hardware).

The first beta round returned six data-correctness bugs, all fixed and all validated against the real client exports in `reference/Reporting data` — every parser assertion is against the report's own printed total, never a row count. Open items in [docs/wiki/progress.md](docs/wiki/progress.md).
