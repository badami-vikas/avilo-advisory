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
// configuration and the registered accounts/formulas/prompts, which is as close to "read
// access to the codebase" as a model calling out over HTTP can safely have. A Groq chat
// completion has no filesystem; actually modifying code is not a capability this
// architecture can grant it, only describe — which the system prompt does explicitly.
// Anything it proposes changing goes out as a candidate AviloBlueprint JSON block, which
// the caller runs through `proposeBlueprint` — the same validate-then-diff path an
// imported file takes. It cannot write a fact, a mapping, or a formula directly; there is
// no tool call wired to any mutation, only to text.

import { callGroq, groqConfig } from "./ai.js";
import { currentConfiguration, proposeBlueprint, registeredSurface } from "./blueprint.js";

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export interface CopilotReply {
  text: string;
  /** Present when the model proposed a configuration change; already recorded, not yet activated. */
  proposalId?: string;
  proposalSummary?: string;
  proposalErrors?: { path: string; message: string }[];
}

const SYSTEM_PROMPT = `You are the Avilo Advisory in-app assistant.

You can explain how the app works, why a figure is computed the way it is, and what
configuration exists. You cannot touch application source code, and you cannot write
directly to the database — the only thing you can change is proposed configuration
(formulas, QuickBooks label mappings, the two AI guidance prompts), and even that is never
applied by you: it becomes a proposal a person reviews and activates.

To propose a configuration change, end your reply with a fenced block:

\`\`\`avilo-blueprint
{"schemaVersion":1,"name":"...","exportedAt":"...","formulas":[...],"mappings":[...],"prompts":[...]}
\`\`\`

Only reference formula ids, account ids, report types and prompt keys from the registry
you were given — an id outside it will be rejected. Omit the block entirely for a question
that needs no change. Never invent an id; if unsure what an id is called, say so instead of
guessing (a wrong guess is refused anyway, but a plain "I don't have that account" is more
useful than a rejected proposal).`;

function buildContext(): string {
  const surface = registeredSurface();
  const config = currentConfiguration();
  return [
    `Registered account ids: ${[...surface.accountIds].sort().join(", ")}`,
    `Registered formula ids: ${[...surface.formulaIds].sort().join(", ")}`,
    `Registered report types: ${[...surface.reportTypes].sort().join(", ")}`,
    `Registered prompt keys: ${[...surface.promptKeys].sort().join(", ")}`,
    `Current formulas: ${JSON.stringify(config.formulas)}`,
    `Current label mapping count: ${config.mappings.length} (omitted for brevity)`,
    `Current prompts: ${JSON.stringify(config.prompts)}`,
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
export async function converse(history: ChatTurn[]): Promise<CopilotReply | null> {
  const config = groqConfig();
  if (!config) return null;

  const prompt = [
    SYSTEM_PROMPT,
    "",
    "--- Current configuration ---",
    buildContext(),
    "",
    "--- Conversation ---",
    ...history.map((turn) => `${turn.role === "user" ? "User" : "Assistant"}: ${turn.text}`),
    "Assistant:",
  ].join("\n");

  const raw = await callGroq(config, prompt, 1200);
  const { reply, candidate } = extractBlueprintBlock(raw);

  if (candidate === null) return { text: reply || raw.trim() };

  const summary = history[history.length - 1]?.text.slice(0, 120) ?? "Chatbot proposal";
  const outcome = proposeBlueprint("chatbot", summary, candidate);

  if ("errors" in outcome) {
    return {
      text: reply || raw.trim(),
      proposalErrors: outcome.errors,
    };
  }

  return {
    text: reply || raw.trim(),
    proposalId: outcome.proposal.id,
    proposalSummary: outcome.proposal.summary,
  };
}
