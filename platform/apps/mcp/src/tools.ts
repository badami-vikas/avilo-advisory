/**
 * The tools an external agent gets, and — more importantly — the ones it does not.
 *
 * Kept separate from `server.ts` so the whole exposed surface can be read in one screen and
 * tested without standing up a stdio transport. Everything here is a thin call into the
 * same services the application's own UI uses; there is no second code path for external
 * agents, which is why an agent cannot reach a state a person could not reach.
 *
 * ## What is absent, and why
 *
 * There is no `activate`. An agent may PROPOSE a new configuration; only a person can put
 * the application into a state nobody has approved. The propose/activate split already
 * existed for the chat assistant's early design; this reuses it rather than inventing a
 * permission system.
 *
 * There is a `restore`, and it is the deliberate asymmetry. Restoring names a version that
 * was *already live* — a state a person already accepted — so it cannot introduce anything
 * new, and because history is append-only a restore is itself just another entry someone
 * can walk back. "Move the configuration to a state it has already been in" is a strictly
 * weaker power than "put it in a state of my choosing", and it is the power the user asked
 * an external agent to have (ADR-043).
 *
 * There is nothing that reads a client, a period, a fact, an override or an import. Not by
 * omission from a list but by construction: this module imports only the configuration
 * services, and `test/mcp-isolation.test.ts` walks the transitive import graph and fails if
 * any reachable file so much as names a client-data table. The honest limit of that
 * guarantee is stated in the server header.
 */
import {
  currentConfiguration,
  proposeBlueprint,
  registeredSurface,
  restoreVersion,
  DETAIL_KINDS,
  LAYOUT_SECTION_IDS,
  PROMPT_KEYS,
  VIEW_ACTIONS,
} from "@avilo/api/services/blueprint";
import { getVersion, listVersions } from "@avilo/api/services/versions";

/** The author recorded against anything this server writes. */
export const MCP_AUTHOR = "mcp:external-agent";

export interface ToolResult {
  ok: boolean;
  [key: string]: unknown;
}

/**
 * Everything an agent needs to write a valid blueprint, and nothing about any client.
 *
 * Handed over in full rather than searched, because the whole registry is small and an
 * agent that can see every legal id in one call has no reason to guess at one. A guessed id
 * is refused by `validateBlueprint` anyway; this just makes guessing unnecessary.
 */
export function describeSurface(): ToolResult {
  const surface = registeredSurface();
  return {
    ok: true,
    accountIds: [...surface.accountIds].sort(),
    formulaIds: [...surface.formulaIds].sort(),
    reportTypes: [...surface.reportTypes],
    promptKeys: [...PROMPT_KEYS],
    layoutSectionIds: [...LAYOUT_SECTION_IDS],
    tableSources: [...DETAIL_KINDS],
    buttonActions: [...VIEW_ACTIONS],
    componentTypes: {
      metric: { label: "string", valueId: "an account id or formula id" },
      chart: { label: "string", series: "[{ id, label?, kind?: bar|line }]" },
      table: { label: "string", source: "one of tableSources" },
      text: { label: "string?", body: "string (rendered as text, never markup)" },
      actions: { label: "string?", buttons: "[one of buttonActions]" },
    },
    rules: [
      "A component carries BINDINGS, never values. There is no field that can hold a figure; a metric names an id and the app looks the number up.",
      "Only a formula id may be new. Account ids, report types, prompt keys, section ids, table sources and button actions are closed — an id outside this list is refused and nothing is written.",
      "A new formula's expression must compile against real accounts and formulas.",
      "`views` replaces the whole set: resend existing views to keep them, omit one to delete it.",
      "Omitting a top-level key means 'leave it alone', not 'clear it'.",
    ],
  };
}

/** The live configuration, in the shape a proposal must take. */
export function getConfiguration(): ToolResult {
  return { ok: true, configuration: currentConfiguration() };
}

/**
 * Validate, diff and record a candidate configuration. Never applies it.
 *
 * A rejected document returns its validation errors verbatim so an agent can correct and
 * resubmit without a human relaying the message.
 */
export function proposeChange(summary: string, document: unknown): ToolResult {
  const outcome = proposeBlueprint(MCP_AUTHOR, summary, document);
  if ("errors" in outcome) {
    return {
      ok: false,
      errors: outcome.errors,
      hint: "Nothing was written. Fix the paths listed above and submit again.",
    };
  }
  const { proposal } = outcome;
  if (proposal.diff.length === 0) {
    return {
      ok: true,
      proposalId: proposal.id,
      diff: [],
      status: proposal.status,
      note: "This document matches the live configuration — activating it would change nothing.",
    };
  }
  return {
    ok: true,
    proposalId: proposal.id,
    diff: proposal.diff,
    status: proposal.status,
    note: "Recorded as a proposal. It is NOT live: a person activates it in the app. This server has no tool that can.",
  };
}

export function listConfigurationVersions(limit?: number): ToolResult {
  return {
    ok: true,
    versions: listVersions(limit ?? 50).map((v) => ({
      id: v.id,
      seq: v.seq,
      author: v.author,
      summary: v.summary,
      changeCount: v.diff.length,
      restoredFrom: v.restoredFrom,
      createdAt: v.createdAt,
    })),
  };
}

export function getConfigurationVersion(id: string): ToolResult {
  const version = getVersion(id);
  if (!version) return { ok: false, error: `No configuration version with id ${id}` };
  return { ok: true, version };
}

/** Return the configuration to a state it has already been in. Appends; never truncates. */
export function restoreConfigurationVersion(id: string): ToolResult {
  let outcome;
  try {
    outcome = restoreVersion(id, MCP_AUTHOR);
  } catch (cause) {
    return { ok: false, error: (cause as Error).message };
  }
  if ("errors" in outcome) return { ok: false, errors: outcome.errors };
  if ("noChange" in outcome) {
    return { ok: true, changed: false, note: "That is already the live configuration; nothing was written." };
  }
  return {
    ok: true,
    changed: true,
    version: {
      id: outcome.version.id,
      seq: outcome.version.seq,
      summary: outcome.version.summary,
      changeCount: outcome.version.diff.length,
    },
    note: "Applied, and recorded as a new version at the head of history. It can itself be restored away from.",
  };
}
