# Avilo Advisory

Offline, local-first monthly business snapshot for a small-business advisory practice.
Structured to be lifted into [relationship-os](https://github.com/manishsbhoopalam8498/relationship-os)
as `platform/modules/avilo`.

All six QuickBooks report types import from Excel, CSV or PDF, all dashboard sections
render, and PDF export honours a chosen period range.

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
| `pnpm share` | Publishes this machine over a Cloudflare Tunnel (needs `AVILO_PASSWORD`) |
| `pnpm --filter @avilo/api migrations:generate` | Regenerates SQL after a schema change |
| `pnpm app:install` | Runs it as a background service on `127.0.0.1:5180`, starting at login |
| `pnpm app:uninstall` | Removes the service. Data is untouched |
| `AVILO_PASSWORD=… pnpm share` | Publishes over a Cloudflare Tunnel |
| `pnpm --filter @avilo/api exec tsx src/scripts/check-integrity.ts` | Accounting checks over stored data |

### Which port is which

| Port | What it is |
| --- | --- |
| 5177 | The web app in development (`pnpm dev`) |
| 5178 | The API in development. JSON only — a browser shows `{"ok":true,…}` |
| 5180 | The installed service: one process serving both the app and its API |

`127.0.0.1` and `localhost` are the same loopback interface. The literal IP is used
because `localhost` can resolve to IPv6 `::1`, which is a different bind.

## Hosting it

Two supported routes. Both serve the built bundle from the API itself, so `/trpc` stays
same-origin and one session cookie covers the app and its data together.

### Publish from this machine (free)

```bash
AVILO_PASSWORD='your long passphrase' pnpm share
```

Builds, starts the API on loopback, and opens a Cloudflare Tunnel to it. The database and
every uploaded file stay on this computer; Cloudflare terminates TLS at its edge and
stores nothing. No inbound port is opened on the machine or the router. The URL lives
until you press Ctrl-C, and a new one is issued next time.

The passphrase check lives in `pnpm share` rather than in this document, because the
server's own guard keys on its *bind address* — and a tunnel binds to `127.0.0.1` like
everything else. Publishing would otherwise have been the one path that skipped the login
gate entirely. `AVILO_BEHIND_CLOUDFLARE=1` tells the server it is reachable, which turns
the gate on and makes it refuse to start without a passphrase.

### Render (paid)

`render.yaml` deploys this as a single Render web service.

**Hosting inverts this application's central assumption.** It has no user accounts and no
per-record permissions, which was correct while it bound to loopback and the only
reachable client was the person at the keyboard. On a public address that same design
shows every client's financials to anyone with the URL. So:

- Binding off `127.0.0.1` **without `AVILO_PASSWORD` is a startup error**, not a warning.
  An accidentally-public deploy fails loudly at boot rather than serving quietly.
- Access is one shared passphrase over a signed, `HttpOnly`, `Secure` session cookie,
  rate-limited per address. That is proportionate for a single practice; it is not
  multi-tenancy, and two advisers cannot be told apart in the audit log.
- **A disk is mandatory.** SQLite is a file and Render replaces the filesystem on every
  deploy. Without the mounted disk in `render.yaml`, every client and every imported
  figure is erased on each push. Disks need a paid instance; the free tier also idles the
  service, so for this application "free" means silent data loss.

| Variable | Purpose |
| --- | --- |
| `AVILO_HOST` | Bind address. Defaults to `127.0.0.1` |
| `AVILO_PORT` | Overrides `PORT`, so an ambient value cannot claim the API's port |
| `AVILO_PASSWORD` | Enables the login gate. Required off loopback; min 12 characters |
| `AVILO_DB_PATH` | SQLite file. Point at the mounted disk |
| `AVILO_FILES_ROOT` | Uploaded source files. Point at the mounted disk |
| `AVILO_SESSION_SECRET` | Optional. Without it, rotating the passphrase ends all sessions |
| `AVILO_BEHIND_CLOUDFLARE` | Set by `pnpm share`. Forces the gate on and trusts `CF-Connecting-IP` |

Render's free tier has no persistent disk, so a free deploy is not a cheaper version of
the same thing — it loses every client and figure on each deploy and each idle spin-down.
Use the tunnel above instead.

GitHub Pages cannot host this at all — it serves static files, and there is no backend to
answer `/trpc`. Cloudflare Workers cannot either without rewriting the data layer:
`better-sqlite3` is a native module and Workers has no filesystem.

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

## Accounting integrity

Reading numbers faithfully is not the same as the numbers being right. A balance sheet
whose two sides disagree parses perfectly and produces a confident, wrong dashboard, so
these run on every import and can be run over stored data at any time:

- the accounting equation, Assets = Liabilities + Equity
- the balance sheet's A/R and A/P against the ageing reports' totals
- ageing buckets against the ageing report's own stated total
- gross profit against revenue less cost of goods sold

They are warnings, not refusals: the discrepancy is usually real, the documents are the
client's, and the advisor is who should see it. Missing inputs are skipped rather than
treated as zero, so a client with only a P&L sees no balance-sheet noise.

**Money is rounded to cents on write, half away from zero.** The obvious
`Math.round(v * 100) / 100` is wrong twice: in float64 `1.005 * 100` is
100.49999999999999 while `-1250.005 * 100` is -125000.50000000001, so the same fractional
part rounds in opposite directions; and `Math.round` rounds half toward +Infinity, so
-0.005 becomes -0.00 while +0.005 becomes +0.01 — a systematic upward bias across a
column of negatives, which is how several of these exports carry expenses.

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

## What's in the table

Editing is inline everywhere — double-click a cell, type, Enter. There is no modal.

Filters, sorts and column visibility are a **stored overlay** over the same rows, so a
saved "list" in the **All** dropdown and the table itself are one mechanism, not two.
Column footers carry a selectable aggregate: average for numeric columns, distinct count
for text, with sum/min/max/median/range available. Empty cells are excluded from
statistics rather than counted as zero.

## Sections, and one that is deliberately absent

The report renders fourteen blocks and two charts, matching the v9.2 prototype's
inventory with two exceptions.

**Key Insights is not built.** In the prototype that panel was written by a cloud model,
and the file carried a field for an Anthropic API key. That is the one thing this build
cannot do and still be what it claims to be, so it is absent rather than faked. *Flags to
review* covers the deterministic half of what it did: it is derived from the benchmark
bands declared on each formula, so editing a benchmark changes the panel and the two
cannot drift.

**Top 5 jobs this month is not built.** No report supplies job-level revenue — Sales by
Customer is per customer, not per job. *Top customers* shows what the data actually
supports, and *Job performance* states its twelve-month basis rather than implying a
monthly one.

## Known gaps

- **PDF import reconstructs geometry, and cannot recover what the export discarded.**
  Rows are grouped by baseline and columns by clustered right edges — deterministic, no
  model, no network — and the resulting grid feeds the same six parsers Excel does. Excel
  remains more reliable because it states its structure rather than drawing one. A scan
  has no text layer and is refused rather than imported empty.
- **A combined group export is refused with an explanation**, rather than half-parsed.
  Per-report exports parse exactly; a merged document cannot.
- The table renders the `@bridge/tables` contract as DOM. relationship-os draws the same
  contract with `@glideapps/glide-data-grid`. Swapping the renderer is contained, because
  no caller knows how a cell is painted.
- The web bundle is ~1.3 MB (405 KB gzipped), dominated by mathjs. It is served from
  localhost, so this costs approximately nothing; worth trimming with a narrower mathjs
  import if it ever ships over a network.

## Defects designed out, with the test that holds them down

Every entry below was a real failure in the v7→v9 build or was found while verifying this
one. Each has a named regression test.

| Defect | Where it is prevented |
| --- | --- |
| `"Total for Income"` not matching a regex expecting `"Total Income"` | `label_mappings` rows, not regexes |
| `row.length - 1` selecting the trailing `Total` column | headers parsed into periods; `Total` refused |
| Prior-year read by hard-coded column index | every period in the file is extracted |
| A date **range** read as a period — `"November 2023 - October 2024"` → `2024-11` | ranges refused; day component cannot eat a year's leading digits |
| `"As of October 31, 2024"` treated as a dated column header | preamble excluded; a value column must contain numbers |
| A detail line claiming an account before its section total | matches ranked; totals supersede detail lines |
| A later balance-sheet row silently overwriting an earlier value | equal-rank collisions keep the first and warn |
| A guessed job count | taken from an explicit column or reported absent |
| A PDF's right-aligned columns split by drawn width | columns clustered on right edges, not left |
| A scanned PDF importing as an empty report | no text layer is refused by name |
| A public bind with no passphrase | startup error, not a warning |
| A tunnel publishing loopback with no passphrase | the gate keys on reachability, not bind address |
| One attacker's failures locking out every user | throttle keyed on `CF-Connecting-IP` behind the tunnel |
| A new formula rendering as dollars | the unit is read from the formula, not inferred from its id |
| A forged or expired session cookie | HMAC over the payload, expiry inside the signature |
| A 12-month job count labelled "this month" | job performance states its basis |
| `formatPeriod` throwing and blanking a page | display formatters degrade; `assertPeriod` still throws |
| Every `button` hidden in print, deleting metric cards from the PDF | chrome hidden by intent (`.no-print`), not by element type |

## Tests

126 unit tests plus a 27-check end-to-end smoke test over real HTTP and real SQLite.
Coverage is concentrated on the four things that broke in the v7→v9 build: parsers,
the formula evaluator, override precedence, and period/range arithmetic.

```bash
pnpm test                                              # unit
pnpm dev                                               # then, in another shell:
pnpm --filter @avilo/api exec tsx src/scripts/smoke.ts # end-to-end
```
