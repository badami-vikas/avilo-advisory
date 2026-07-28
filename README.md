# Avilo Advisory

Offline, local-first monthly business snapshot for a small-business advisory practice.
Structured to be lifted into [relationship-os](https://github.com/manishsbhoopalam8498/relationship-os)
as `platform/modules/avilo`.

**Phase 1 (this build): a working vertical slice.** Client table → element page → P&L
import → formula engine with overrides. Phase 2 adds the remaining five importers, the
rest of the dashboard sections, and the ranged PDF export.

## Run it

```bash
pnpm install && pnpm dev
```

Then open **http://127.0.0.1:5177**. Requires Node 24 and pnpm 11.

| Command | What it does |
| --- | --- |
| `pnpm dev` | Starts the API (5178) and web client (5177) |
| `pnpm test` | Runs the test suite |
| `pnpm typecheck` | Typechecks every package |
| `pnpm seed:demo` | Loads a demo client so you can see a populated dashboard |
| `pnpm seed:demo --reset` | Removes all client data, keeping accounts and formulas |
| `pnpm --filter @avilo/api migrations:generate` | Regenerates SQL after a schema change |

## Offline

There is no CDN link, no web font, no telemetry and no cloud API. Every dependency is
bundled. The API binds to `127.0.0.1` only and makes no outbound requests. Verified
against the production bundle: no external hosts, no `XMLHttpRequest`, no `WebSocket`.

- **Database** — `~/Documents/Bridge/Avilo Advisory/.data/avilo.sqlite`
- **Uploaded files** — `~/Documents/Bridge/Avilo Advisory/<Client>/Source files/`

That path follows the platform's local-files rule, so files already sit where
relationship-os will expect them.

## Layout

```
platform/
  apps/
    api/        @avilo/api      Fastify + tRPC + Drizzle over SQLite
    web/        @avilo/web      React + Vite + Tailwind
  modules/
    avilo/      @avilo/module   Domain layer: schema, accounts, periods,
                                formula engine, classifier, importers
  packages/
    tables/     @avilo/tables   Port of @bridge/tables — the table contract
reference/                      The v9.2 single-file prototype and session log
```

The domain layer has no framework and no I/O. Integration is: move
`platform/modules/avilo`, delete `packages/tables` and repoint imports at
`@bridge/tables`, swap the Drizzle driver for Supabase.

## How this differs from the v9 prototype

The prototype was a 101 KB single HTML file. Six of the nine correction rounds in its
build log traced to four structural decisions, each inverted here.

| v9 prototype | This build |
| --- | --- |
| One client, one month; prior-year read by column index | Fact store keyed `(client, period, account)`; any range is a `BETWEEN` |
| Row labels matched by regexes compiled into JS | `label_mappings` rows, editable in the UI, learned once and reused |
| Current month found via `row.length - 1` | Columns identified by parsing headers into periods; `Total` is refused |
| Formulas hardcoded in render functions | Versioned mathjs expressions evaluated at runtime |
| Nothing persisted across reloads | SQLite |
| Cloud model reads PDFs | Deterministic classifier, offline, with an optional local-model tiebreak |
| CDN dependencies | Everything bundled |

## Design decisions worth knowing

**HyperFormula was rejected.** It is the obvious formula engine and it is
`GPL-3.0-only`, which would virally licence a private commercial module. `mathjs`
(Apache-2.0) is used instead. Its `parse()` gives an AST, which is what makes automatic
dependency extraction possible.

**The checklist is derived, not written.** Required inputs come from walking the formula
dependency graph. It cannot drift from what the dashboard renders, because both read the
same graph. Deactivate a formula and its inputs stop being required; add a reference and
they start.

**Formula edits are global; value overrides are local.** The editor makes you choose,
and states the blast radius of each. A formula edit is versioned, retroactive, and
rejected up front if it would create a cycle or reference an unknown account — a bad
global edit would otherwise break every client at once.

**An override is never deleted.** A re-import that supplies a new value moves the
override to `superseded`, keeping its value, author and reason, with one-click restore.

**Expression safety is enforced by AST allowlisting**, not by shadowing mathjs globals —
shadowing `parse` would disable the engine's own parser, and an unrecognised function is
refused rather than merely hidden.

**PDF export is the browser's print-to-PDF**, which is vector. The v9 session established
that the html2canvas raster pipeline produced unacceptably soft text.

## Known gaps in Phase 1

- Only the P&L importer is wired up. Uploading a Balance Sheet stages and classifies it
  but has no parser yet, so Days cash on hand stays flagged — which is the derived
  checklist working, not a bug.
- PDF ingestion is deferred; Excel/CSV only. The upload dialog says so rather than
  silently doing nothing.
- The table renders the `@bridge/tables` contract as DOM. relationship-os draws the same
  contract with `@glideapps/glide-data-grid`. Swapping the renderer is contained,
  because no caller knows how a cell is painted.
- Column right-click context menus, saved views and filters are stubbed in the toolbar.
- The web bundle is ~1.2 MB (371 KB gzipped), dominated by mathjs. It is served from
  localhost, so this is a load-time cost of about nothing; worth trimming with a
  narrower mathjs import if it ever ships over a network.

## Tests

63 unit tests plus a 27-check end-to-end smoke test over real HTTP and real SQLite.
Coverage is concentrated on the four things that broke in the v7→v9 build: parsers,
the formula evaluator, override precedence, and period/range arithmetic.

```bash
pnpm test                                              # unit
pnpm dev                                               # then, in another shell:
pnpm --filter @avilo/api exec tsx src/scripts/smoke.ts # end-to-end
```
