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
         snapshot of the CURRENT config recorded first,
              as its own proposal → this is `revertId`
                                    │
                                    ▼
              activateProposal — applied immediately, writing
              through the SAME paths a manual edit uses
              (learnMapping, a new formula_versions row,
              app_settings)
                                    │
                        panel shows "Change applied" + Undo
                                    │
                   Undo = activate the snapshot proposal
```

**The assistant acts (v1.9.2, ADR-038).** It used to stop at a proposal a person had to
approve; it now applies and offers Undo. What guards the write is unchanged —
`validateBlueprint` refuses an id this build does not have, and refuses it *before* the
snapshot is taken, so a rejected document leaves no trace at all. What was removed is the
click, not a check.

Undo restores formulas, prompts and layout exactly. It does not un-learn a label mapping
the assistant added: `learnMapping` upserts and the snapshot carries only the mappings that
already existed. Correct that one in the mapping UI, like any other mapping.

Nothing the model emits executes. `validateBlueprint` is the only path from "text a model
wrote" to "a typed object the rest of the system trusts", and it has no field for source
code or a credential — not a runtime check that could be bypassed, but a fact about the
shape of the type.

## Sharing a configuration

`blueprint.export` produces the full live configuration as one JSON document — formulas,
mappings, prompts. Handing that file to someone else and having them run
`blueprint.propose` on it is the "replicate my custom local version" path: it becomes a
proposal on their machine, reviewed and activated by hand. **Import is still
propose-then-approve** — only the assistant applies directly, because only the assistant is
acting on a request the user just typed. A file that arrived from someone else has no such
context, so it keeps the review step.

## Where it lives, and why

`platform/packages/core` and `platform/apps/web/src/app/components/shared/AgentPanel.tsx`
deliberately mirror `relationship-os`'s own paths and `WorkspaceBlueprint` /
`AgentPanel.tsx` — same location, same blueprint-validated governance, same "a routed
action is a real proposal, never fabricated feed content" principle from the upstream
AgentPanel's own header comment. Avilo has no Chief of Staff or Approvals surface, so the
chatbot talks to `copilot.converse` instead of `chiefOfStaff.converse`, and a routed action
is a `blueprint_proposals` row reviewed right in the panel instead of a separate Approvals
screen — narrower, same shape. On integration into relationship-os, `packages/core` and
`AgentPanel.tsx` move and the local copies are deleted, same as `packages/tables` already
describes doing.

## What the assistant can see (v1.9.2)

With a client open, `copilot.converse` receives that client's real books alongside the
configuration registry: how many periods are imported and their range, which accounts an
active formula needs and is missing for the latest period, which canonical accounts have
never received a single fact across every imported period, and how many source files
failed to import.

It is composed from `availablePeriods` / `buildPeriodReport` in `apps/api/src/services/
report.ts` — the same functions the report view itself calls — so the assistant's answer
about what is missing cannot drift from what the screen shows. Read-only: there is no path
from the chat panel to a `facts` row.

Before this, "what data is missing for this client?" produced a generic list of things that
are *commonly* missing in accounting data, because the model had the account registry but
no client. That answer was plausible and useless.

## What it cannot do, on purpose

- Cannot touch application source.
- Cannot see or emit a Groq API key — `validateBlueprint` refuses a document carrying one.
- Cannot write a financial fact, import a file, or add UI. Configuration is the entire
  surface — there is no mechanism for the rest, not a policy against it.
- Cannot make a change that is not reversible from the panel (ADR-038), with the one
  documented exception of an added label mapping.
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
