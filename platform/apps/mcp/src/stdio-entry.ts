/**
 * Exported entry point for the MCP stdio server.
 *
 * Split from server.ts so the Electron binary can import `runMcpStdio` and bundle it
 * into main.mjs without also importing the top-level `main()` auto-start in server.ts.
 * server.ts calls this; the Electron binary calls this; one copy of the server logic.
 *
 * stdout is the MCP transport — nothing may be written to it except protocol frames.
 * All diagnostics go to stderr.
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

function reply(result: ToolResult) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    isError: result.ok === false,
  };
}

export async function runMcpStdio(): Promise<void> {
  const server = new McpServer({ name: "avilo-advisory", version: "1.10.0" });

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

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("avilo-mcp: ready (configuration surface only; no client data)\n");

  // Hold the process open until the MCP client closes stdin.
  await new Promise<void>((resolve) => {
    process.stdin.once("close", resolve);
    process.stdin.once("end", resolve);
  });
}
