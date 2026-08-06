/**
 * Configuration history, against a real seeded database.
 *
 * What this exists to prove: every route into the live configuration leaves a version
 * behind, restoring is exact (including for the keys whose absence means "leave alone"),
 * and restoring never destroys the history it walks — so an undo is itself undoable, which
 * is the property the MCP server's restore permission rests on.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as dbModule from "../src/db.js";
import { configurePaths } from "../src/paths.js";
import * as blueprint from "../src/services/blueprint.js";
import * as versions from "../src/services/versions.js";

let dir: string;

function freshApi() {
  dbModule.closeConnection();
  dir = mkdtempSync(join(tmpdir(), "avilo-versions-"));
  configurePaths({ filesRoot: dir, dbPath: join(dir, "test.sqlite") });
  dbModule.seedReferenceData(dbModule.getDb());
}

/** Apply a document the way the assistant does, and return the head version. */
function apply(summary: string, document: unknown) {
  const outcome = blueprint.applyBlueprintDirectly("assistant", summary, document);
  if ("errors" in outcome) throw new Error(JSON.stringify(outcome.errors));
  if ("noChange" in outcome) throw new Error(`expected a change for: ${summary}`);
  return outcome;
}

function withView(id: string, label: string) {
  const config = blueprint.currentConfiguration();
  return {
    schemaVersion: 1,
    name: label,
    exportedAt: new Date().toISOString(),
    ...config,
    views: [
      ...(config.views ?? []),
      {
        id,
        label,
        layout: "grid" as const,
        components: [
          { id: `${id}-tile`, type: "metric" as const, label: "Total receivable", valueId: "ar.total" },
        ],
      },
    ],
  };
}

beforeEach(() => {
  dir = "";
});

afterEach(() => {
  dbModule.closeConnection();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("configuration history", () => {
  it("records a baseline before the first change, so the first change is undoable", () => {
    freshApi();
    expect(versions.listVersions()).toEqual([]);

    apply("Add an overdue view", withView("overdue", "Overdue invoices"));

    const history = versions.listVersions();
    // Baseline (seq 1) + the assistant's own change (seq 2).
    expect(history.map((v) => v.seq)).toEqual([2, 1]);
    expect(history[1]!.author).toBe("baseline");
    expect(history[0]!.author).toBe("assistant");
  });

  it("records a version whoever made the change — assistant, person, or external agent", () => {
    freshApi();
    apply("Assistant change", withView("a", "A"));

    const proposal = blueprint.proposeBlueprint("user", "Person's change", withView("b", "B"));
    if ("errors" in proposal) throw new Error(JSON.stringify(proposal.errors));
    blueprint.activateProposal(proposal.proposal.id);

    const mcp = blueprint.proposeBlueprint("mcp:external-agent", "Agent change", withView("c", "C"));
    if ("errors" in mcp) throw new Error(JSON.stringify(mcp.errors));
    blueprint.activateProposal(mcp.proposal.id);

    expect(versions.listVersions().map((v) => v.author)).toEqual([
      "mcp:external-agent",
      "user",
      "assistant",
      "baseline",
    ]);
  });

  it("restores an earlier state exactly, including removing a view added since", () => {
    freshApi();
    apply("Add first view", withView("first", "First"));
    const afterFirst = versions.listVersions()[0]!;
    apply("Add second view", withView("second", "Second"));

    expect(blueprint.currentConfiguration().views?.map((v) => v.id)).toEqual(["first", "second"]);

    const restored = blueprint.restoreVersion(afterFirst.id, "user");
    if ("errors" in restored) throw new Error(JSON.stringify(restored.errors));
    if ("noChange" in restored) throw new Error("expected the restore to change something");

    expect(blueprint.currentConfiguration().views?.map((v) => v.id)).toEqual(["first"]);
  });

  it("restores back to the empty state — the key whose absence means 'leave alone'", () => {
    freshApi();
    // Baseline is written on the first activation and carries `views: []` spelled out.
    apply("Add a view", withView("only", "Only"));
    const baseline = versions.listVersions().find((v) => v.author === "baseline")!;

    const restored = blueprint.restoreVersion(baseline.id, "user");
    if ("errors" in restored || "noChange" in restored) {
      throw new Error("expected the restore to remove the view");
    }

    expect(blueprint.currentConfiguration().views ?? []).toEqual([]);
  });

  it("appends rather than truncating, so a restore can itself be restored away from", () => {
    freshApi();
    apply("Add first view", withView("first", "First"));
    const afterFirst = versions.listVersions()[0]!;
    apply("Add second view", withView("second", "Second"));
    const afterSecond = versions.listVersions()[0]!;

    blueprint.restoreVersion(afterFirst.id, "user");

    // History grew; nothing was erased.
    const history = versions.listVersions();
    expect(history.length).toBe(4); // baseline, first, second, + the restore itself
    expect(history[0]!.seq).toBe(4);
    expect(history[0]!.restoredFrom).toBe(afterFirst.id);
    expect(history.some((v) => v.id === afterSecond.id)).toBe(true);

    // And the undone state is still reachable — the restore is undoable.
    const redo = blueprint.restoreVersion(afterSecond.id, "user");
    if ("errors" in redo || "noChange" in redo) throw new Error("expected redo to apply");
    expect(blueprint.currentConfiguration().views?.map((v) => v.id)).toEqual(["first", "second"]);
  });

  it("writes nothing when the target state is the state you are already in", () => {
    freshApi();
    apply("Add a view", withView("only", "Only"));
    const head = versions.listVersions()[0]!;
    const before = versions.listVersions().length;

    expect(blueprint.restoreVersion(head.id, "user")).toEqual({ noChange: true });
    expect(versions.listVersions().length).toBe(before);
  });

  it("brings a formula back through the normal version-history path", () => {
    freshApi();
    const config = blueprint.currentConfiguration();
    const baselineExpression = config.formulas.find((f) => f.id === "gross_profit")?.expression;
    expect(baselineExpression).toBeTruthy();

    apply("Change gross profit", {
      schemaVersion: 1,
      name: "edit",
      exportedAt: new Date().toISOString(),
      ...config,
      formulas: config.formulas.map((f) =>
        f.id === "gross_profit" ? { ...f, expression: "pl.revenue - pl.cogs - 1" } : f,
      ),
    });
    const baseline = versions.listVersions().find((v) => v.author === "baseline")!;

    const restored = blueprint.restoreVersion(baseline.id, "user");
    if ("errors" in restored || "noChange" in restored) throw new Error("expected a restore");

    const now = blueprint.currentConfiguration().formulas.find((f) => f.id === "gross_profit");
    expect(now?.expression).toBe(baselineExpression);
  });
});
