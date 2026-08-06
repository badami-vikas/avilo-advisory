#!/usr/bin/env -S npx tsx
/**
 * Avilo's Model Context Protocol server: the door an external agent — Claude Code, or any
 * other MCP client — uses to build and change this app's configuration.
 *
 * ## What this changes about the product, stated plainly
 *
 * Until now "no account, no cloud, no network required" was true of every path in the
 * application. This adds an inbound door, and honesty demands it be described as one. It is
 * not a network listener: the transport is stdio, so the only thing that can talk to it is a
 * process the user launched on their own machine, and nothing is opened, bound or exposed.
 * The app itself still makes no outbound request without a button press. But an external
 * program can now read and change configuration, and that is new (ADR-043).
 *
 * ## The guarantee, and its honest limit
 *
 * GUARANTEE: no tool here can read a client, a period, a fact, an override, an import or a
 * figure. This is enforced by the module graph rather than by a check inside each tool —
 * `tools.ts` imports only the configuration services, and `test/mcp-isolation.test.ts` walks
 * every file reachable from this entry point and fails if any of them so much as names a
 * client-data table. Adding a fact query to a reachable file breaks the build.
 *
 * LIMIT: this process opens the same SQLite file the application does, because that is where
 * configuration lives. The boundary is therefore at the level of code, verified by a test,
 * not at the level of the operating system. A future build that wanted a stronger claim
 * would have to put configuration in its own file or put the server behind the running app's
 * loopback API. That is worth doing if this ever runs unattended; it is not done here, and
 * pretending otherwise would be the kind of claim CLAUDE.md exists to prevent.
 *
 * ## Why an agent may restore but not activate
 *
 * `propose_change` records; it does not apply. A person activates. `restore_version` DOES
 * apply — but only to a state that was already live and therefore already accepted by a
 * person, and history is append-only, so the restore is itself just another entry that can
 * be walked back. Introducing a new state is a human decision; returning to an old one is
 * not. See `tools.ts` for the full reasoning.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  describeSurface,
  getConfiguration,
  getConfigurationVersion,
  listConfigurationVersions,
  proposeChange,
  restoreConfigurationVersion,
  type ToolResult,
} from "./tools.js";

/** MCP wants content blocks; every tool here answers with one JSON document. */
function reply(result: ToolResult) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    isError: result.ok === false,
  };
}

const server = new McpServer({
  name: "avilo-advisory",
  version: "1.10.0",
});

server.tool(
  "avilo_describe_surface",
  "Every id, component type and rule a configuration change may use: account ids, formula ids, report types, prompt keys, report section ids, table sources and button actions. Call this FIRST — an id outside this registry is refused and nothing is written. Contains no client data.",
  {},
  async () => reply(describeSurface()),
);

server.tool(
  "avilo_get_configuration",
  "The live configuration: formulas, QuickBooks label mappings, AI prompts, the default report layout, and any assistant-built views. This is the document shape a proposal must take. Contains no client data — no figures, no periods, no client names.",
  {},
  async () => reply(getConfiguration()),
);

server.tool(
  "avilo_propose_change",
  "Validate a candidate configuration, diff it against what is live, and record it for a person to review. This does NOT apply the change — there is no tool on this server that can. Returns the diff on success, or the exact validation errors (with paths) on failure, so a rejected document can be corrected and resubmitted.",
  {
    summary: z.string().min(1).describe("One line describing the intent, shown to the person reviewing."),
    document: z
      .unknown()
      .describe("A full Avilo blueprint. Start from avilo_get_configuration and modify it; omitted top-level keys mean 'leave alone', and `views` replaces the whole set."),
  },
  async ({ summary, document }) => reply(proposeChange(summary, document)),
);

server.tool(
  "avilo_list_versions",
  "The configuration's history, newest first: every state the app has actually been in, who caused it and how many things changed. Use this to find a state to return to.",
  { limit: z.number().int().min(1).max(200).optional() },
  async ({ limit }) => reply(listConfigurationVersions(limit)),
);

server.tool(
  "avilo_get_version",
  "The full configuration document recorded for one version, as it was live at that moment.",
  { id: z.string().describe("A version id from avilo_list_versions.") },
  async ({ id }) => reply(getConfigurationVersion(id)),
);

server.tool(
  "avilo_restore_version",
  "Return the configuration to a state it has already been in. Allowed without human approval precisely because it cannot introduce anything new — it names a recorded version, never a document. History is append-only, so this appends a new version rather than erasing anything, and the restore can itself be restored away from.",
  { id: z.string().describe("A version id from avilo_list_versions.") },
  async ({ id }) => reply(restoreConfigurationVersion(id)),
);

/*
  stdout is the MCP transport — anything written to it that is not a protocol frame
  corrupts the session. Diagnostics go to stderr, always.
*/
async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("avilo-mcp: ready (configuration surface only; no client data)\n");
}

main().catch((cause: unknown) => {
  process.stderr.write(`avilo-mcp: failed to start — ${(cause as Error).message}\n`);
  process.exit(1);
});
