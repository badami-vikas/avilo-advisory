# Building for Avilo Advisory

This file is for an AI agent — Claude Code, or any MCP client — working on an Avilo
Advisory installation. It describes what you can change, what you cannot, and why the
boundaries are where they are. It ships inside the installed application, so the copy next
to a given build always describes *that* build.

Avilo Advisory is an offline-first financial advisory desktop app. An advisor imports
QuickBooks exports for a client; the app turns them into a month-end report, a dashboard
and a PDF. Everything runs locally.

---

## The one rule everything else follows

> **Never fabricate a figure.** Everything on screen must trace to an imported fact, a
> stored override, or a formula. "Unknown" is a first-class result.

You will notice this is not enforced by asking you nicely. It is enforced by the shape of
the data you are allowed to send: there is no field in a view component that can hold a
number. You name an account or a formula, and the application looks the figure up. A
generated dashboard is therefore exactly as trustworthy as the built-in report, by
construction rather than by good behaviour.

---

## Connecting

The MCP server is built into the installed application and speaks stdio. Run the Avilo
Advisory binary itself with `--mcp-stdio` — no separate install, no Node, no source repo.

**macOS** (installed to Applications):
```json
{
  "mcpServers": {
    "avilo": {
      "command": "/Applications/Avilo Advisory.app/Contents/MacOS/Avilo Advisory",
      "args": ["--mcp-stdio"]
    }
  }
}
```

**Windows** (per-user install — substitute your username):
```json
{
  "mcpServers": {
    "avilo": {
      "command": "C:\\Users\\<username>\\AppData\\Local\\Programs\\Avilo Advisory\\Avilo Advisory.exe",
      "args": ["--mcp-stdio"]
    }
  }
}
```

The binary reads `~/Documents/Bridge/Avilo Advisory/.data/avilo.sqlite` — the same
database the GUI uses. The app does not need to be running; both can coexist (SQLite WAL
handles concurrent readers). If the app is running, configuration changes appear without
a reload.

**From the source repo** (during development):

Claude Code launches MCP servers without inheriting your shell's `PATH`, so `npx` and
`tsx` won't be found if they live in a custom location (e.g. `~/.local/bin`). Build the
bundle once, then use the absolute path to `node`:

```bash
# One-time build (re-run after changing MCP source)
pnpm --filter @avilo/mcp build

# Find your node binary
which node     # e.g. /Users/you/.local/bin/node or /usr/local/bin/node

# Add to Claude Code (replace <node> and <repo> with your absolute paths)
claude mcp add avilo <node> <repo>/platform/apps/mcp/dist/server.js
```

`dist/server.js` is a self-contained bundle — no `tsx`, no `npx`, no PATH lookup — and
`better-sqlite3` is resolved from the repo's own `node_modules` at runtime.

Point at a different database with `AVILO_DB_PATH` / `AVILO_FILES_ROOT`.

---

## What you can see

**Configuration only. You cannot read a client, a period, a fact, an override, an import,
or any figure.** This is not a rule you are being asked to respect — the server's module
graph contains no client query, and `platform/apps/mcp/test/mcp-isolation.test.ts` walks
that graph on every test run and fails the build if one appears.

The honest limit: the server process opens the same SQLite file the app does, because
configuration lives there. The boundary is at the level of code and verified by a test, not
enforced by the operating system.

---

## What you can change

Eight levers. Everything else is source code, and source code is not reachable from here.

| Lever | What it is |
|---|---|
| `formulas` | Versioned expressions evaluated at runtime. The financial model. |
| `mappings` | QuickBooks row label → canonical account. Correctable data, not regexes. |
| `prompts` | `accounting_guidance` and `narrative_guidance`, overridable at runtime. |
| `layout` | The default report section order, and which sections are hidden. |
| `views` | Whole screens, composed from a closed component registry. |
| `dashboard` | Which panels the client dashboard shows, and in what order. |
| `clientsTable` | Which columns the clients list shows, and in what order. |
| `landingTiles` | Which portfolio aggregates appear as tiles above the clients list. |

### Arranging a surface

The last three take `{"order": [...], "hidden": [...]}` over a closed registry of ids —
`layout` does the same thing with the older key names `sectionOrder`/`hiddenSections`. An
arrangement can permute and hide; there is no field in it that can hold a value, which is
why these are safe to hand you: you choose which registered thing appears and where, and
the application computes what it says.

Two conventions differ between them, deliberately:

- **`landingTiles.order` is a selection.** Send the tiles you want; the rest do not appear.
- **`dashboard.order` and `clientsTable.order` are permutations.** Ids you omit keep their
  canonical position at the end rather than disappearing, so a panel added in a later build
  still shows up for someone whose stored arrangement predates it. Use `hidden` to remove.

### Ids are closed, with exactly one exception

Account ids, report types, prompt keys, layout section ids, table sources and button
actions all have to already exist. An id you invent is refused and **nothing is written** —
not partially, not with a warning.

The exception is a **formula id**, which may be new, because creating a metric is a
legitimate request and there is no other way to express it. A new formula still has to
compile: every id its expression references must be a real account, a real formula, or a
trailing window (`avg3.pl.revenue`) over one.

### Components

A view is a list of components. Each names bindings; none can carry a value.

| Type | Shape |
|---|---|
| `metric` | `{ id, type, label, valueId }` — an account or formula id |
| `chart` | `{ id, type, label, series: [{ id, label?, kind?: "bar" \| "line" }] }` |
| `table` | `{ id, type, label, source }` — one of the table sources |
| `text` | `{ id, type, label?, body }` — rendered as text, never as markup |
| `actions` | `{ id, type, label?, buttons: [...] }` — buttons bind to existing actions |

Call `avilo_describe_surface` for the live list of every legal id in the installation you
are connected to. Do not work from this file's examples — work from that call.

---

## What you cannot change

- **The application's own chrome.** The header, the navigation, the view dropdown, the
  assistant panel, and the clients-list search and filter controls. Everything else you can
  see on a screen is arrangeable — the panels, the columns, the tiles, the report sections.
- **Any figure, fact or import.** Not by a different route either — there isn't one.
- **Source code.** The MCP server has no file access.
- **The component vocabulary.** You compose from the registry; you cannot extend it.
  Extending it is a source change, which is a conversation with a human.

If you need something in this list, say so plainly rather than approximating it. A refusal
that explains the boundary is more useful than a workaround that half-works.

**Do not claim work you did not do.** The application does not take your word for what
changed — it compares your prose against the actual diff, and where they disagree your
wording is withheld and replaced by the server's own account of what happened (ADR-047). A
false claim does not reach the user; it just costs you the chance to explain yourself.

---

## How a change actually lands

```
avilo_describe_surface   →  learn the legal ids
avilo_get_configuration  →  read the current state
        (modify it)
avilo_propose_change     →  validated, diffed, RECORDED — not applied
        (a person activates it in the app)
```

**You cannot activate.** There is no tool for it. This is deliberate: a state nobody has
approved should not become live because an agent decided it should.

`avilo_propose_change` returns either a diff or the exact validation errors with their
paths. A rejected document wrote nothing, so correct it and submit again.

### Reverting

`avilo_restore_version` **does** apply, without a human. That looks inconsistent until you
see what it can and cannot do: it names a version that was *already live* — a state a
person already accepted — so it cannot introduce anything new. And history is append-only,
so restoring version 3 adds a new version at the head rather than deleting 4 and 5. The
restore is itself restorable.

Returning to an old state is a strictly weaker power than choosing a new one. That is the
whole argument.

Use `avilo_list_versions` to see what states exist and who caused each.

---

## Conventions worth knowing

- **Omitting a top-level key means "leave it alone", not "clear it".** Start from
  `avilo_get_configuration` and modify, rather than composing a document from scratch.
- **`views` replaces the whole set.** Resend existing views to keep them; omit one to
  delete it. This is what makes deletion expressible at all.
- **A formula edit opens a new version row.** Definitions are never silently overwritten.
- **A mapping you add survives a restore.** `learnMapping` upserts and a stored version
  only carries the mappings that existed. Correct it in the mapping UI.

---

## Reproducing a configuration elsewhere

`blueprint.export` produces a portable JSON document holding the full configuration — every
formula, mapping, prompt, the layout and every view. It holds no client data and no API
key. Another installation imports it via `blueprint.propose`, where it is validated against
*that* machine's registry before anyone can activate it.

That is the supported way to replicate local changes: send the blueprint, not the database.

---

## If you are working on the source rather than the configuration

Read `CLAUDE.md` first, then `docs/wiki/index.md`. The decisions behind everything above
are in `docs/decisions.md` — ADR-038 (blueprints), ADR-041 (binding-not-value), ADR-042
(formula creation), ADR-043 (this server). Record a decision when you make one, and file a
bug in `docs/bugs.md` the moment you spot one.
