# External agents in Avilo Advisory

What an agent outside this application can do, how it is actually wired, and which parts of
the proposed gateway plan were adopted, deferred or rejected — with reasons.

Audience: whoever decides what this door should become next. For an agent *using* the door,
read [AGENTS.md](AGENTS.md); it is written to be executed, this is written to be argued
with.

---

## 1. The short version

An external agent — Claude Code, or any MCP client — can now:

- read the full registry of legal ids in a specific installation,
- read the live configuration (formulas, mappings, prompts, layout, views),
- **propose** a new configuration, validated and diffed, which a person then applies,
- read the complete history of configuration states,
- **restore** the configuration to any state it has previously been in.

It cannot activate a new state, and it cannot read a single client figure.

Three sentences carry the whole design:

> **Introducing a new state is a human decision. Returning to an old one is not.**
> **A component carries bindings, never values.**
> **The boundary is the module graph, not a rule in a prompt.**

---

## 2. Capabilities in detail

### 2.1 The six tools

| Tool | Reads | Writes | Notes |
|---|---|---|---|
| `avilo_describe_surface` | registry | — | Every legal account id, formula id, report type, prompt key, layout section, table source, button action, plus the component grammar and the rules. |
| `avilo_get_configuration` | live config | — | The document shape a proposal must take. |
| `avilo_list_versions` | history | — | Newest first: seq, author, summary, change count, whether it was itself a restore. |
| `avilo_get_version` | one state | — | The full recorded document for a version. |
| `avilo_propose_change` | — | a proposal row | Validated + diffed. **Not applied.** Returns the diff, or exact errors with paths. |
| `avilo_restore_version` | — | the live state | Only to a recorded version. Appends a new version; never truncates. |

Transport is **stdio**. Nothing is bound, opened or listened on; the only thing that can
talk to the server is a process the user launched on their own machine.

### 2.2 What an agent may change

Five levers, and nothing else exists to change:

| Lever | Substance |
|---|---|
| `formulas` | Versioned expressions evaluated at runtime — **the financial model**. |
| `mappings` | QuickBooks row label → canonical account. |
| `prompts` | `accounting_guidance`, `narrative_guidance`. |
| `layout` | Default report section order and hidden sections. |
| `views` | Whole screens, composed from a closed component registry. |

A view is a list of components, each of which names bindings:

| Type | Shape |
|---|---|
| `metric` | `{ id, type, label, valueId }` |
| `chart` | `{ id, type, label, series: [{ id, label?, kind? }] }` |
| `table` | `{ id, type, label, source }` |
| `text` | `{ id, type, label?, body }` |
| `actions` | `{ id, type, label?, buttons: [...] }` |

### 2.3 Ids are closed, with exactly one exception

Account ids, report types, prompt keys, layout section ids, table sources and button actions
must already exist. An invented id is refused and **nothing is written** — not partially,
not with a warning.

A **formula id** may be new, because "add a metric for X" has no other expression. A created
formula still has to compile: every reference must resolve to a real account, a real
formula, or a trailing window (`avg3.pl.revenue`) over one. Relaxing the id check is safe
only because the expression check replaces it (ADR-042).

### 2.4 What is out of reach

- The application's own interface — header, navigation, the assistant panel, colours, fonts.
  An agent builds screens *inside* the app; it does not restyle the app.
- Any fact, figure, client, period, override or import.
- Source code. The server has no file access.
- The component vocabulary itself. An agent composes from the registry; extending the
  registry is a source change, which is a conversation with a human.

---

## 3. Technical execution

### 3.1 The pipeline, unchanged

The MCP server is a **second front door onto an existing pipeline**, not a second
implementation:

```
document ──▶ validateBlueprint(registeredSurface())   refuse unknown ids, whole document
         ──▶ compile check on newly created formulas   refuse unresolvable references
         ──▶ diffBlueprint(candidate, live)            what would actually change
         ──▶ proposeBlueprint()                        recorded, status = "proposed"
         ──▶ [ a person ] activateProposal()           applied, and a version recorded
```

Every guard that governs the in-app assistant governs an external agent, because it is
literally the same code. An agent cannot reach a state a person could not reach, and there
is no path where a hallucinated id becomes a partially-applied change.

### 3.2 Data isolation is a property of the import graph

Every tool could have called an `assertNoClientData()` helper. That guards the tools that
exist today, not the one someone adds in six months — and the realistic failure is exactly
that: a convenient import added to a service the server already depends on, three files
away, long after anyone remembers why it mattered.

So instead:

- `tools.ts` imports only configuration services.
- `platform/apps/mcp/test/mcp-isolation.test.ts` walks the **transitive import graph** from
  `server.ts` and fails if any reachable first-party file names a client-data table
  (`facts`, `clients`, `overrides`, `sourceFiles`, `detailRows`, `periodNotes`,
  `summaryEdits`, `stickyNotes`).
- A second assertion fails if `report.ts`, `copilot.ts`, `import.ts` or `router.ts` appear in
  the graph at all — belt and braces, in case a day's code happens not to name a table.
- A third assertion fails if the walker resolves fewer than seven files, so a silently
  broken resolver cannot make the suite pass **vacuously**. This one matters: without it the
  test goes green precisely when it stops testing anything.

Making this pass required a real change: `loadFormulaSpecs` moved out of `report.ts` into
its own module. `blueprint.ts` needed the formula list to compile expressions, and importing
it from `report.ts` dragged every fact, override and source-file query into the graph.

**The guard was verified by breaking it.** A `buildPeriodReport` import was added to
`tools.ts`; the test failed, naming `schema.facts`, `schema.overrides` and
`schema.sourceFiles` in `report.ts` — three files deep. Then it was removed and the suite
went green again. A guard nobody has watched fail is not yet a guard.

### 3.3 Configuration history

`configuration_versions`: one row per state the configuration has actually been in.

The distinction that made this work is between a **proposal** (a request someone made) and a
**version** (a state that was live). Keeping only proposals meant "go back" could only mean
"activate the one snapshot `applyBlueprintDirectly` happened to take before the last
assistant action" — one step, on one path, and impossible after a human activation, because
`activateProposal` refuses to run twice.

Four properties:

- **Single writer.** `activateProposal` alone appends history, so assistant, person and
  external agent all leave a state behind. No path can change configuration silently.
- **Forward-only.** Restoring seq 3 appends a new version at the head; it does not delete 4
  and 5. Nothing is destroyed by using the feature, and an undo is itself undoable.
- **Normalized, not delta.** A stored version spells `layout` and `views` out, because an
  absent key means "leave alone" (ADR-039) — a state captured before any view existed could
  otherwise never remove one added later.
- **Baselined.** The first activation on an upgraded installation records the pre-change
  state first. Without it, the first change would be seq 1 with nothing earlier to restore,
  and the user would lose the ability to undo precisely the change they were making.

### 3.4 The asymmetry, argued

Restore applies without human approval. Propose does not. This looks inconsistent until you
compare what each can *do*:

|  | `propose_change` | `restore_version` |
|---|---|---|
| Target state | anything the agent composes | one that was already live |
| Previously approved | no | **yes, by a person** |
| Can introduce something new | yes | **no** |
| Destroys anything | n/a | no — appends |
| Reversible | n/a | yes, by another restore |

Returning to an old state is strictly weaker than choosing a new one. The worst outcome of a
misbehaving agent with restore is another entry in a log a person can walk back — which is
why this permission is defensible where an `activate` tool would not be.

### 3.5 The honest limit

The server process opens **the same SQLite file** the application does, because configuration
lives there. The isolation guarantee is therefore at the level of code, verified by a test,
not enforced by the operating system.

A stronger claim requires either configuration in its own file, or routing the server through
the running app's loopback API. Neither is done here. Stating this plainly is the point —
the alternative is a guarantee that sounds stronger than it is, which is the failure mode
this codebase has a standing rule against.

### 3.6 Verification performed

- 312 tests, 8 packages typecheck.
- The MCP server driven as a **real subprocess over a real stdio transport**, including:
  tool list contains no `activate`/`apply`/`client`/`fact`/`period`/`import`/`override`; a
  valid proposal recorded without applying; an invented button action refused with nothing
  written; and **an agent reverting a change a person had approved**.
- The isolation guard verified by deliberate violation (§3.2).
- The history UI exercised in the running app against the real database: a view added, the
  baseline restored, the view gone, two pre-existing views untouched, and the undone state
  still listed with its own Restore button.
- Migration 0008 applied to the **real pre-existing database** — 6 clients and 168 facts
  intact. `drizzle-kit generate` had re-emitted `CREATE TABLE` for three already-existing
  tables (0005–0007 were hand-written and never snapshotted); shipping that would have
  failed on the first statement for every existing install. Hand-trimmed to the new table.

---

## 4. The proposed plan: what was adopted, deferred, rejected

The plan under review was written for a different system (multi-tenant, networked, with an
authority plane, a taint lattice, an Approvals surface and egress controls). Avilo is a
single-user, offline-first desktop app on loopback with no accounts. Roughly two of five
phases transfer; the security scaffolding mostly answers a threat model that does not exist
here — but one idea in it is exactly right and was taken verbatim.

### Phase 0 — Prerequisites (token enforcement, `protectedProcedure`, kill pilot-user fallback)

**Rejected as written; the ADR was adopted.**

Avilo has no accounts, no sessions and no pilot-user fallback. The API binds to 127.0.0.1
and the desktop shell serves bundle and API from one loopback origin. Adding token
enforcement would be ceremony around a door nobody can reach.

What *was* taken: the demand for a written decision, and its central rule — **tool output is
untrusted data, never operator instruction** — extended to inbound agents. That is ADR-043.
The MCP server treats an incoming document as data to validate, never as instruction: it
cannot name an id outside the registry, and prose accompanying it has no effect on what is
written.

### Phase 1 — External Agent Gateway

**Adopted, and its core idea taken verbatim.**

This is the strongest part of the plan. The recommended shape —

> Tools: read grammar/glossary/manifests/schemas, scaffold draft, run validation, submit
> draft to Approvals, read validation feedback. **No activate, no approve, no egress —
> structurally absent, not policy-denied.**

— maps onto Avilo almost exactly, and was nearly free because the propose/activate split
already existed. "Structurally absent, not policy-denied" is the single most valuable
sentence in the document and is now the governing principle of the tool list.

**Adopted:** the six-tool shape; propose-without-activate; validation feedback returned to
the agent so it can self-correct without a human relaying errors; a distinct principal
(`mcp:external-agent`) recorded against everything the server writes, visible in history and
in the UI as "External agent (MCP)".

**Deferred:** scoped expiring tokens. They secure a network boundary. This transport is
stdio — the only caller is a process the user launched — so a token would be a secret stored
on the same machine as the thing it protects, guarding nothing. Revisit the moment any
non-stdio transport is considered.

**Deferred:** a full taint lattice with an `untrusted_external` label. Avilo has one trust
boundary, not a lattice, and the boundary is enforced by validation rather than by
propagating labels. A lattice earns its complexity when there are several sources of
differently-trusted data flowing into each other; here there is one door and everything
through it is validated identically.

**Departed from, deliberately:** the plan implies an agent submits and a human decides,
full stop. Avilo also grants `restore_version`, which applies without approval. The
justification is §3.4 — it cannot introduce a new state, and history is append-only. This
was the user's explicit requirement ("both external agent or human can revert back to
earlier state"), and it survives scrutiny because of the append-only property, not despite
it.

### Phase 2 — Agent-legible spec

**Adopted.**

`AGENTS.md` ships **inside the installer**, alongside `docs/` and the MCP source, so an
installed copy carries instructions describing *that build* rather than pointing at a
repository the user may not have. `avilo_describe_surface` is the machine-readable index:
it returns the live registry from the installation the agent is actually connected to, so an
agent never works from a stale document — the reason `AGENTS.md` tells agents to prefer the
call over its own examples.

**Not adopted:** publishing an installable authoring skill and treating this as an
ecosystem play. That is a distribution decision for a product with one beta user; the
machinery to support it is in place if it is ever wanted.

### Phase 3 — Sandbox / preview hardening (iframe jail, isolated-vm, E2B)

**Rejected, and this is the most substantive disagreement.**

Sandboxing is what you need when a model emits **code**. ADR-041 made that unnecessary by
construction: a `ViewComponent` has no field that can hold code, markup or even a number. A
`metric` names an id; the application looks the figure up. `text` is rendered as text, never
as HTML — there is no path from model output to markup on the page.

Importing an iframe jail would add a dependency, a failure mode and a maintenance burden to
contain a class of risk the data model already eliminates. It would also be quietly
corrosive: a sandbox around generated views invites someone to later relax the schema —
"it's sandboxed, so a raw `value` field is fine now" — which is precisely the guarantee
worth keeping.

**Revisit only if** the component registry ever admits a type that carries executable or
markup content. At that point a sandbox stops being redundant and becomes mandatory.

**Deferred:** the circuit-breaker pattern. Breakers protect a caller from a failing
dependency under load. This server is synchronous, local, single-user, and every write is
already reversible; the failure it would guard against is not one this shape produces.

### Phase 4 — Dev-time hardening (CODEOWNERS, earned auto-merge)

**Not applicable, with one part kept in spirit.**

CODEOWNERS presumes multiple humans and a review gate on a shared repository. What the phase
is *actually* protecting — that governance code should not change without deliberate
attention — is served here by the tests: the isolation guard, the tool-list assertion that
fails if an `activate` tool ever appears, and the forward-only history tests. Those run on
every commit and do not depend on anyone remembering to look.

The recommendation **never to move the approval gate itself** is adopted without
qualification.

### Reuse intake (Apache-2.0 provenance, pinned commit, import candidates)

**Not applicable.** No third-party agent framework was imported. The server is the official
`@modelcontextprotocol/sdk` plus roughly 150 lines calling services this repository already
had.

---

## 5. Summary table

| Phase | Verdict | Reason |
|---|---|---|
| 0 · Token enforcement | Rejected | No accounts, no sessions, loopback only |
| 0 · ADR on untrusted tool output | **Adopted** | ADR-043, extended to inbound agents |
| 1 · Propose-not-activate gateway | **Adopted verbatim** | Structurally absent beats policy-denied |
| 1 · Validation feedback to agent | **Adopted** | Self-correction without a human relay |
| 1 · Distinct external principal | **Adopted** | Visible in history and UI |
| 1 · Scoped expiring tokens | Deferred | Secures a network boundary; transport is stdio |
| 1 · Taint lattice | Deferred | One boundary, not a lattice |
| 1 · No unattended apply | **Departed from** | Restore is weaker than activate; §3.4 |
| 2 · Agent-legible spec | **Adopted** | `AGENTS.md` in the installer + live registry call |
| 2 · Ecosystem / installable skill | Not adopted | Distribution decision, premature |
| 3 · Iframe sandbox | **Rejected** | ADR-041 dissolves the risk; would invite schema relaxation |
| 3 · Circuit breaker | Deferred | Synchronous, local, reversible |
| 4 · CODEOWNERS | Not applicable | Served by tests that always run |
| 4 · Never move the approval gate | **Adopted** | — |
| Reuse intake | Not applicable | No framework imported |

---

## 6. What would change the answers

- **Any non-stdio transport** → Phase 0 and the deferred token work become required
  immediately, before the transport ships.
- **A component type carrying code or markup** → Phase 3's sandbox becomes mandatory.
- **More than one human on the repository** → Phase 4's CODEOWNERS becomes worth its cost.
- **Unattended operation** → the §3.5 limit stops being acceptable; move configuration to
  its own store or route through the loopback API.

Depth: [ADR-041, ADR-042, ADR-043, ADR-044](docs/decisions.md) ·
Wiki: [docs/wiki/mcp.md](docs/wiki/mcp.md) · Agent reference: [AGENTS.md](AGENTS.md)
