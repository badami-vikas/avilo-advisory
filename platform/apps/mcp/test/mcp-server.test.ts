/**
 * The MCP server as an external agent actually meets it: spawned as a real subprocess,
 * driven over a real stdio transport, against a real on-disk database.
 *
 * Calling the tool functions directly would prove the logic and miss everything that has
 * historically gone wrong with this kind of component — a transport that never connects, a
 * schema the client rejects, a tool that throws on the way out. This drives the same path
 * Claude Code does.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = dirname(fileURLToPath(import.meta.url));
let dir: string;
let client: Client;

/** Every tool answers with one JSON document in a single text block. */
async function call(name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name, arguments: args })) as {
    content: { type: string; text: string }[];
  };
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "avilo-mcp-"));
  client = new Client({ name: "test-agent", version: "1.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: "npx",
      args: ["tsx", join(here, "..", "src", "server.ts")],
      env: {
        ...process.env,
        AVILO_FILES_ROOT: dir,
        AVILO_DB_PATH: join(dir, "mcp-test.sqlite"),
      } as Record<string, string>,
    }),
  );
}, 60_000);

afterAll(async () => {
  await client?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("avilo MCP server", () => {
  it("advertises exactly the intended tools, and no way to activate a change", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();

    expect(names).toEqual([
      "avilo_describe_surface",
      "avilo_get_configuration",
      "avilo_get_version",
      "avilo_list_versions",
      "avilo_propose_change",
      "avilo_restore_version",
    ]);

    /*
      The load-bearing absence. An external agent may record a proposal; only a person can
      put the app into a state nobody has approved. If a tool matching these ever appears,
      that decision has been reversed and this test should be the thing that says so.
      */
    for (const forbidden of ["activate", "apply", "client", "fact", "period", "import", "override"]) {
      expect(names.filter((n) => n.includes(forbidden))).toEqual([]);
    }
  });

  it("hands over the registry an agent needs, with no client data in it", async () => {
    const surface = await call("avilo_describe_surface");
    expect(surface.ok).toBe(true);
    expect((surface.accountIds as string[]).length).toBeGreaterThan(10);
    expect(surface.buttonActions).toContain("export-pdf");
    expect(surface.tableSources).toContain("ar_customer");

    // Nothing client-shaped anywhere in the payload.
    const serialized = JSON.stringify(surface);
    for (const leak of ["clientId", "period", "\"facts\"", "override"]) {
      expect(serialized).not.toContain(leak);
    }
  });

  it("records a valid proposal WITHOUT applying it", async () => {
    const config = (await call("avilo_get_configuration")).configuration as Record<string, unknown>;

    const proposed = await call("avilo_propose_change", {
      summary: "Add an overdue invoices view",
      document: {
        schemaVersion: 1,
        name: "agent change",
        exportedAt: new Date().toISOString(),
        ...config,
        views: [
          {
            id: "overdue",
            label: "Overdue invoices",
            layout: "grid",
            components: [
              { id: "t", type: "metric", label: "Total receivable", valueId: "ar.total" },
              { id: "tbl", type: "table", label: "By customer", source: "ar_customer" },
              { id: "act", type: "actions", buttons: ["export-pdf"] },
            ],
          },
        ],
      },
    });

    expect(proposed.ok).toBe(true);
    expect((proposed.diff as unknown[]).length).toBeGreaterThan(0);
    expect(proposed.status).toBe("proposed");

    // The proposal exists, but the configuration is untouched: no version was written.
    const after = (await call("avilo_get_configuration")).configuration as { views?: unknown[] };
    expect(after.views ?? []).toEqual([]);
    expect((await call("avilo_list_versions")).versions).toEqual([]);
  });

  it("refuses a document naming an id this build does not have, and writes nothing", async () => {
    const config = (await call("avilo_get_configuration")).configuration as Record<string, unknown>;

    const rejected = await call("avilo_propose_change", {
      summary: "Invent an action",
      document: {
        schemaVersion: 1,
        name: "bad",
        exportedAt: new Date().toISOString(),
        ...config,
        views: [
          {
            id: "bad",
            label: "Bad",
            layout: "grid",
            components: [{ id: "b", type: "actions", buttons: ["delete-all-clients"] }],
          },
        ],
      },
    });

    expect(rejected.ok).toBe(false);
    expect(JSON.stringify(rejected.errors)).toContain("delete-all-clients");
    expect((await call("avilo_list_versions")).versions).toEqual([]);
  });

  it("lets the agent revert to a state a person approved, without being able to invent one", async () => {
    /*
      The agent cannot activate, so a person's approval is simulated the only honest way:
      by going through the same service the app's own UI calls, in this process, against the
      same database file the server has open. WAL mode is what makes the two connections
      agree on what is there.
    */
    const { configurePaths } = await import("@avilo/api/src/paths.js");
    const dbModule = await import("@avilo/api/src/db.js");
    const blueprintService = await import("@avilo/api/services/blueprint");
    configurePaths({ filesRoot: dir, dbPath: join(dir, "mcp-test.sqlite") });

    const config = blueprintService.currentConfiguration();
    const approved = blueprintService.proposeBlueprint("user", "Person adds a view", {
      schemaVersion: 1,
      name: "approved",
      exportedAt: new Date().toISOString(),
      ...config,
      views: [
        {
          id: "approved-view",
          label: "Approved view",
          layout: "grid",
          components: [{ id: "m", type: "metric", label: "Total receivable", valueId: "ar.total" }],
        },
      ],
    });
    if ("errors" in approved) throw new Error(JSON.stringify(approved.errors));
    blueprintService.activateProposal(approved.proposal.id);
    dbModule.closeConnection();

    // The agent can now see the history, and the baseline recorded before that change.
    const listed = (await call("avilo_list_versions")).versions as { id: string; author: string; seq: number }[];
    expect(listed.map((v) => v.author)).toEqual(["user", "baseline"]);

    const baseline = listed.find((v) => v.author === "baseline")!;
    const restored = await call("avilo_restore_version", { id: baseline.id });
    expect(restored.ok).toBe(true);
    expect(restored.changed).toBe(true);

    // The view is gone, and the restore is itself the newest version — nothing was erased.
    const after = (await call("avilo_get_configuration")).configuration as { views?: unknown[] };
    expect(after.views ?? []).toEqual([]);

    const history = (await call("avilo_list_versions")).versions as { seq: number; author: string }[];
    expect(history.length).toBe(3);
    expect(history[0]!.author).toBe("mcp:external-agent");
  });

  it("reports a missing version rather than throwing", async () => {
    const missing = await call("avilo_restore_version", { id: "cv_does_not_exist" });
    expect(missing.ok).toBe(false);
    expect(String(missing.error)).toContain("cv_does_not_exist");
  });
});
