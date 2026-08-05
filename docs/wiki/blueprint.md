# The Assistant panel and blueprints

Added v1.8.0. A right-panel AI chatbot, and the governed configuration surface it proposes
changes through.

## Why this exists

The ask was: a chatbot that can "modify and optimise" the app, with every change recorded
and shareable so someone else's copy can replicate it. Two facts shaped the design:

- **The shipped app is `asar`-packed.** `electron-builder.yml` sets `asar: true` and packs
  the compiled bundle into a read-only archive. A model editing source cannot work inside
  an installed copy — only inside a dev checkout with a rebuild step, which is not what
  most users of a shared file have.
- **Avilo imports third-party QuickBooks exports.** A model with write access to app
  behaviour, reading data an unknown third party produced, is an injection surface. ADR-016
  already states the rule this needs: *a model may choose, never invent.*

So the chatbot's write surface is not source code. It is the same configuration surface a
person already edits by hand — formulas (ADR-003), QuickBooks label mappings (ADR-002), the
two AI guidance prompts (ADR-013), report layout — packaged as a **blueprint**: a single
versioned JSON document. See ADR-033/034/035 for the reasoning; `platform/packages/core/src/blueprint.ts` is the implementation, with the "why every field is or is not
in the type" argued in its own header comment.

## The shape

```
chat turn → Groq → reply text (+ optional ```avilo-blueprint block)
                                    │
                                    ▼
                          validateBlueprint (reject unknown ids)
                                    │
                                    ▼
                          diffBlueprint (against live config)
                                    │
                                    ▼
                 blueprint_proposals row, status = "proposed"
                                    │
                         person reviews the diff in the panel
                                    │
                        Apply ──────┴────── Dismiss
                          │
                          ▼
              activateProposal — writes through the SAME
              paths a manual edit uses (learnMapping,
              a new formula_versions row, app_settings)
```

Nothing the model emits executes. `validateBlueprint` is the only path from "text a model
wrote" to "a typed object the rest of the system trusts", and it has no field for source
code or a credential — not a runtime check that could be bypassed, but a fact about the
shape of the type.

## Sharing a configuration

`blueprint.export` produces the full live configuration as one JSON document — formulas,
mappings, prompts. Handing that file to someone else and having them run
`blueprint.propose` on it is the "replicate my custom local version" path: it becomes a
proposal on their machine, reviewed and activated exactly like a chatbot's own proposal.
Nothing is ever auto-applied on import.

## Where it lives, and why

`platform/packages/core` and `platform/apps/web/src/app/components/shared/AgentPanel.tsx`
deliberately mirror `relationship-os`'s own paths and `WorkspaceBlueprint` /
`AgentPanel.tsx` — same location, same propose-then-activate governance, same "a routed
action is a real proposal, never fabricated feed content" principle from the upstream
AgentPanel's own header comment. Avilo has no Chief of Staff or Approvals surface, so the
chatbot talks to `copilot.converse` instead of `chiefOfStaff.converse`, and a routed action
is a `blueprint_proposals` row reviewed right in the panel instead of a separate Approvals
screen — narrower, same shape. On integration into relationship-os, `packages/core` and
`AgentPanel.tsx` move and the local copies are deleted, same as `packages/tables` already
describes doing.

## What it cannot do, on purpose

- Cannot touch application source.
- Cannot see or emit a Groq API key — `validateBlueprint` refuses a document carrying one.
- Cannot activate its own proposal — only a person, through the panel or `blueprint.activate`.
- Cannot reference an account, formula, report type, prompt key or layout section this
  build does not have; the whole document is refused, never partially applied.

## Layout changes (v1.9.0)

`blueprint.layout` (`sectionOrder`, `hiddenSections`) activates by writing
`app_settings["report_layout_default"]` — the app-wide default a client's report opens
with. It is a fallback only: `ClientDetailPage.loadLayout` reads it exclusively when that
client has no `report.layout` row of its own in `saved_views`. A per-client edit, made
through the format panel, always wins — a blueprint has no client in scope, so it cannot
mean anything more specific than "the default." See ADR-036.

## Chat persistence (v1.9.0)

The panel's turns and proposal decisions survive a refresh, stored under
`app_settings["copilot_chat_history"]` — the same generic `settings.get`/`settings.set`
pair every other runtime override in this app already goes through (ADR-013), not a new
table. A stored turn is inert text; it is never re-validated or re-applied on load, only
displayed.
