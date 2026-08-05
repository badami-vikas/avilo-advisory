// The right-panel AI chatbot's backing service.
//
// This is Avilo's counterpart to relationship-os's Chief of Staff `converse` — same shape
// (a chat turn in, a reply and an optional routed action out), narrowed to what Avilo has:
// no multi-agent routing, no Approvals surface, one action kind instead of many. Where
// theirs routes to a proposal visible in Approvals, this routes to a blueprint proposal
// visible in the panel's own review list (`blueprint.list`) — same principle, "a routed
// action is a real proposal, never fabricated feed content", scaled to one app's surface.
//
// The chatbot answers questions about the running app freely — it is told the current
// configuration, the registered accounts/formulas/prompts, and (when a client is open) that
// client's real imported periods and data gaps, so "what is missing for this client" is
// answered from the same queries the report view runs rather than guessed in the abstract.
//
// It ACTS rather than recommends: a candidate AviloBlueprint JSON block in its reply goes
// through `applyBlueprintDirectly`, which validates against the live registry and then
// applies. Validation is unchanged from the propose/activate path — an invented formula or
// account id is refused outright and nothing is written — so what the direct path removes
// is the human click, not a guard. The configuration as it stood beforehand is snapshotted
// as its own proposal first and returned as `revertId`, which is what the panel's Undo
// activates.
//
// Still out of reach, structurally: source code, UI, financial facts, file imports. There is
// no tool call wired to any of those, only to configuration.

import { eq } from "drizzle-orm";
import { ACCOUNTS_BY_ID, CANONICAL_ACCOUNTS } from "@avilo/module";
import { getDb, schema } from "../db.js";
import { callGroq, groqConfig } from "./ai.js";
import { applyBlueprintDirectly, currentConfiguration, registeredSurface } from "./blueprint.js";
import { availablePeriods, buildPeriodReport } from "./report.js";

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export interface CopilotReply {
  text: string;
  /** Present when the assistant changed configuration — already applied, not pending. */
  appliedSummary?: string;
  appliedChanges?: string[];
  /** Activating this proposal restores the configuration as it stood before. */
  revertId?: string;
  /** Present instead when the candidate failed validation; nothing was written. */
  proposalErrors?: { path: string; message: string }[];
}

const SYSTEM_PROMPT = `You are the Avilo Advisory in-app assistant.

You configure this app. When the user asks for a change you can make, MAKE IT — do not
describe what you could propose, do not ask them to review a proposal, do not explain that
a person has to activate it. Emit the blueprint block below and the change is applied
immediately, with an Undo button shown to the user. Answer as someone who just did the
thing, not as someone recommending it.

What you can change: formulas, QuickBooks label mappings, the two AI guidance prompts, and
the default report layout (section order, which sections are hidden). A layout change sets
the DEFAULT a client's report opens with; any client who has already customised their own
report layout keeps it — this never overwrites a per-client edit.

What you genuinely cannot do, and should say plainly if asked: change application source
code, add new UI, write or edit financial facts, or import files. Those are not refusals to
be worked around — there is no mechanism.

When the user is viewing a specific client, you are given that client's real data below
under "Active client data" — imported periods, which required accounts are missing for
the latest period, and which canonical accounts have never received a single fact. Ground
any answer about that client's data completeness in those figures; never guess or describe
"common areas where data might be missing" in the abstract when the real answer is right
there. If no client section is present, you are not looking at a specific client — say so
rather than inventing one.

To make a configuration change, end your reply with a fenced block:

\`\`\`avilo-blueprint
{"schemaVersion":1,"name":"...","exportedAt":"...","formulas":[...],"mappings":[...],"prompts":[...],"layout":{"sectionOrder":[...],"hiddenSections":[...]}}
\`\`\`

Omit "layout" entirely unless the user actually asked to reorder or hide report sections.
Only reference formula ids, account ids, report types, prompt keys and section ids from the
registry you were given — an id outside it will be rejected. Omit the block entirely for a
question that needs no change. Never invent an id; if unsure what an id is called, say so
instead of guessing (a wrong guess is refused anyway, but a plain "I don't have that
account" is more useful than a rejected proposal).`;

function buildContext(): string {
  const surface = registeredSurface();
  const config = currentConfiguration();
  return [
    `Registered account ids: ${[...surface.accountIds].sort().join(", ")}`,
    `Registered formula ids: ${[...surface.formulaIds].sort().join(", ")}`,
    `Registered report types: ${[...surface.reportTypes].sort().join(", ")}`,
    `Registered prompt keys: ${[...surface.promptKeys].sort().join(", ")}`,
    `Registered report section ids, in default order: ${[...surface.sectionIds].join(", ")}`,
    `Current formulas: ${JSON.stringify(config.formulas)}`,
    `Current label mapping count: ${config.mappings.length} (omitted for brevity)`,
    `Current prompts: ${JSON.stringify(config.prompts)}`,
    `Current default report layout: ${config.layout ? JSON.stringify(config.layout) : "unset (uses the built-in default order, nothing hidden)"}`,
  ].join("\n");
}

/**
 * Read-only summary of one client's actual books — real periods, real missing-account
 * gaps for the latest period, and canonical accounts that have never received a fact for
 * this client at all. Composed from the same queries the report view and dashboard use
 * (`availablePeriods`/`buildPeriodReport` in report.ts), not a separate source of truth,
 * so the assistant's answer about "what's missing" can never diverge from what the client
 * detail page itself shows. This is read-only: nothing here can be written back by the
 * model, same as every other fact this file feeds it.
 */
function clientDataSummary(clientId: string): string {
  const db = getDb();
  const client = db.select().from(schema.clients).where(eq(schema.clients.id, clientId)).get();
  if (!client) return `Active client: unknown client id "${clientId}" (not found).`;

  const periods = availablePeriods(clientId);
  if (periods.length === 0) {
    return [
      `Active client: ${client.name} (id ${clientId}).`,
      `No periods imported yet — nothing has been uploaded for this client.`,
    ].join("\n");
  }

  const latest = periods[0]!;
  const report = buildPeriodReport(clientId, latest);
  const missing = report.missingRequired.map(
    (id) => `${id} (${ACCOUNTS_BY_ID.get(id)?.label ?? id})`,
  );

  const everHad = new Set<string>(
    db
      .selectDistinct({ accountId: schema.facts.accountId })
      .from(schema.facts)
      .where(eq(schema.facts.clientId, clientId))
      .all()
      .map((r) => r.accountId),
  );
  const neverPopulated = CANONICAL_ACCOUNTS.filter((a) => !everHad.has(a.id)).map(
    (a) => `${a.id} (${a.label}, ${a.statement})`,
  );

  const files = db
    .select({ filename: schema.sourceFiles.filename, status: schema.sourceFiles.status, reportType: schema.sourceFiles.reportType })
    .from(schema.sourceFiles)
    .where(eq(schema.sourceFiles.clientId, clientId))
    .all();
  const failedFiles = files.filter((f) => f.status === "failed");

  return [
    `Active client: ${client.name} (id ${clientId}).`,
    `Imported periods: ${periods.length} (${periods[periods.length - 1]} through ${latest}).`,
    `Latest period ${latest}: ${report.complete ? "complete — every account an active formula needs has a value" : `INCOMPLETE — missing ${missing.length} required account(s): ${missing.join(", ")}`}.`,
    `Canonical accounts that have NEVER received a single fact for this client, across all ${periods.length} imported period(s) (${neverPopulated.length} of ${CANONICAL_ACCOUNTS.length}): ${neverPopulated.length > 0 ? neverPopulated.join("; ") : "none — every canonical account has data at least once"}.`,
    `Imported files: ${files.length} total${failedFiles.length > 0 ? `, ${failedFiles.length} FAILED (${failedFiles.map((f) => f.filename).join(", ")})` : ""}.`,
  ].join("\n");
}

function extractBlueprintBlock(text: string): { reply: string; candidate: unknown | null } {
  const match = /```avilo-blueprint\s*([\s\S]*?)```/.exec(text);
  if (!match) return { reply: text.trim(), candidate: null };

  const reply = (text.slice(0, match.index) + text.slice(match.index + match[0].length)).trim();
  try {
    return { reply, candidate: JSON.parse(match[1]!.trim()) as unknown };
  } catch {
    return { reply, candidate: null };
  }
}

/**
 * One chat turn: send the conversation plus a description of the live configuration to
 * Groq, and if the reply proposes a change, validate and record it as a blueprint
 * proposal. Returns `null` when no model is configured — callers must handle that
 * (AI is additive everywhere, ADR-010), not fall back to a canned reply.
 */
export async function converse(history: ChatTurn[], clientId?: string): Promise<CopilotReply | null> {
  const config = groqConfig();
  if (!config) return null;

  const prompt = [
    SYSTEM_PROMPT,
    "",
    "--- Current configuration ---",
    buildContext(),
    ...(clientId ? ["", "--- Active client data ---", clientDataSummary(clientId)] : []),
    "",
    "--- Conversation ---",
    ...history.map((turn) => `${turn.role === "user" ? "User" : "Assistant"}: ${turn.text}`),
    "Assistant:",
  ].join("\n");

  const raw = await callGroq(config, prompt, 1200);
  const { reply, candidate } = extractBlueprintBlock(raw);

  if (candidate === null) return { text: reply || raw.trim() };

  const summary = history[history.length - 1]?.text.slice(0, 120) ?? "Assistant change";
  const outcome = applyBlueprintDirectly("assistant", summary, candidate);

  if ("errors" in outcome) {
    return {
      text: reply || raw.trim(),
      proposalErrors: outcome.errors,
    };
  }

  return {
    text: reply || raw.trim(),
    appliedSummary: outcome.proposal.summary,
    appliedChanges: outcome.proposal.diff.map((c) => `${c.kind} ${c.section}: ${c.key}`),
    revertId: outcome.revertId,
  };
}
