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

- **No model call without a button press.** Nothing calls out on upload, render, or navigation. Two call sites only: **Suggest** (row mapping) and **Generate** (executive summary), plus **Test connection**.
- **One key, everywhere.** `groq_api_key` in `app_settings`, read only via `groqConfig()` in `apps/api/src/services/ai.ts`. Never add a second key or a second reader.
- **A model may choose, never invent.** Row mapping picks from the canonical account list or answers `skip`; a hallucinated id degrades to `skip`. Summary generation rewrites *computed* findings and is rejected if it contains a figure the books do not have (`fabricatedFigures`).
- **The deterministic narrative is the source of truth.** `insights.ts` is pure functions. Generated prose is a rewrite of it for sending to a client, never a replacement.
- **Prompts are data.** `ACCOUNTING_GUIDANCE` and `NARRATIVE_GUIDANCE` are overridable at runtime via `app_settings` — mapping accuracy is tuned by editing text, not by shipping a binary.
- **New data supersedes a custom edit.** An edited summary is stored with a fingerprint of the findings it was written against; when the figures move, the edit is set aside.

## Stack

pnpm workspace monorepo. React 18 + Vite 6 + TypeScript 5.7 + Tailwind 4 + Radix + chart.js 4.5 · Fastify 5 + tRPC 11 + Drizzle + better-sqlite3 · Electron 43 + electron-builder 25. Groq is the only external service and is optional.

```
platform/apps/{web,api,desktop}   platform/modules/avilo   platform/packages/tables
```

## Commands

```bash
pnpm dev                 # web + api
pnpm test                # 242 tests
pnpm typecheck           # 6 packages
pnpm --filter @avilo/web build && pnpm app:win   # installer — build web FIRST
```

Data lives in `~/Documents/Bridge/Avilo Advisory/` (`.data/avilo.sqlite` + imported files).

## Status

v1.6.0. Shipping to a first beta user. Windows installer is **unsigned** — SmartScreen will warn, and no build of this app has yet been launched on Windows by us (BUG-016 was fixed in 1.4.2 and remains unconfirmed on real hardware).

The first beta round returned six data-correctness bugs, all fixed and all validated against the real client exports in `reference/Reporting data` — every parser assertion is against the report's own printed total, never a row count. Open items in [docs/wiki/progress.md](docs/wiki/progress.md).
