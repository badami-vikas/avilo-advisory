/**
 * The declared-levers guard (BUG-033) and the prose/diff check (BUG-034).
 *
 * Both exist because prompting failed twice on the same class of defect: a document about
 * one lever quietly changing another, and prose describing a change other than the one
 * applied. These are pinned against the exact shapes that shipped, so a future prompt tweak
 * cannot silently reintroduce either.
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
  dir = mkdtempSync(join(tmpdir(), "avilo-declares-"));
  configurePaths({ filesRoot: dir, dbPath: join(dir, "test.sqlite") });
  dbModule.seedReferenceData(dbModule.getDb());
}

/** A document adding a formula AND un-hiding a report section — the BUG-033 shape exactly. */
function formulaPlusStrayLayout() {
  const config = blueprint.currentConfiguration();
  return {
    schemaVersion: 1,
    name: "add avg NOI",
    exportedAt: new Date().toISOString(),
    ...config,
    formulas: [
      ...config.formulas,
      {
        id: "avg_net_operating_income",
        label: "Avg net operating income",
        expression: "avg3.net_operating_income",
      },
    ],
    // Nobody asked for this. In the shipped bug it arrived as an un-hide.
    layout: { sectionOrder: [...blueprint.LAYOUT_SECTION_IDS], hiddenSections: [] },
  };
}

beforeEach(() => {
  dir = "";
});

afterEach(() => {
  dbModule.closeConnection();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("declared levers", () => {
  it("refuses a formula change that also rewrites the layout, and writes NOTHING", () => {
    freshApi();
    // Hide a section first, so the stray layout edit has something real to undo.
    const hide = blueprint.proposeBlueprint("user", "Hide top jobs", {
      schemaVersion: 1,
      name: "hide",
      exportedAt: new Date().toISOString(),
      ...blueprint.currentConfiguration(),
      layout: { sectionOrder: [...blueprint.LAYOUT_SECTION_IDS], hiddenSections: ["top-jobs"] },
    });
    if ("errors" in hide) throw new Error(JSON.stringify(hide.errors));
    blueprint.activateProposal(hide.proposal.id);

    const versionsBefore = versions.listVersions().length;
    const proposalsBefore = blueprint.listProposals().length;

    const outcome = blueprint.applyBlueprintDirectly(
      "assistant",
      "Next to Avg NOI Margin, can you add Avg Net Op. Income",
      formulaPlusStrayLayout(),
      ["formulas"],
    );

    expect("outOfScope" in outcome).toBe(true);
    if (!("outOfScope" in outcome)) throw new Error("unreachable");
    expect(outcome.outOfScope.undeclared).toEqual(["layout"]);
    expect(outcome.outOfScope.changes.join(" ")).toContain("un-hid top-jobs");

    // The refusal is total: no formula, no layout change, no version, no snapshot proposal.
    expect(blueprint.currentConfiguration().formulas.some((f) => f.id === "avg_net_operating_income")).toBe(false);
    expect(blueprint.currentConfiguration().layout?.hiddenSections).toEqual(["top-jobs"]);
    expect(versions.listVersions().length).toBe(versionsBefore);
    expect(blueprint.listProposals().length).toBe(proposalsBefore);
  });

  it("applies the same document when the layout change IS declared", () => {
    freshApi();
    const outcome = blueprint.applyBlueprintDirectly(
      "assistant",
      "Add the metric and reset the layout",
      formulaPlusStrayLayout(),
      ["formulas", "layout"],
    );

    expect("proposal" in outcome).toBe(true);
    expect(
      blueprint.currentConfiguration().formulas.some((f) => f.id === "avg_net_operating_income"),
    ).toBe(true);
  });

  it("declaring nothing refuses everything — an omitted declaration is not a free pass", () => {
    freshApi();
    const outcome = blueprint.applyBlueprintDirectly(
      "assistant",
      "no declaration",
      formulaPlusStrayLayout(),
      [],
    );

    expect("outOfScope" in outcome).toBe(true);
    if (!("outOfScope" in outcome)) throw new Error("unreachable");
    expect(outcome.outOfScope.declared).toEqual([]);
    expect(outcome.outOfScope.undeclared.sort()).toEqual(["formulas", "layout"]);
    expect(versions.listVersions()).toEqual([]);
  });

  it("leaves the old behaviour intact when no declaration is passed at all", () => {
    freshApi();
    // The MCP and import paths do not declare; they must keep working unchanged.
    const outcome = blueprint.applyBlueprintDirectly(
      "user",
      "undeclared but allowed",
      formulaPlusStrayLayout(),
    );
    expect("proposal" in outcome).toBe(true);
  });

  it("still reports noChange before it reports out-of-scope", () => {
    freshApi();
    const config = blueprint.currentConfiguration();
    const identical = {
      schemaVersion: 1,
      name: "same",
      exportedAt: new Date().toISOString(),
      ...config,
    };
    expect(blueprint.applyBlueprintDirectly("assistant", "no-op", identical, [])).toEqual({
      noChange: true,
    });
  });
});
