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

/*
  BUG-042 — the padding that deleted three views.

  The user asked for the executive summary to be restyled. The reply refused in prose, and
  the document beneath it carried "views":[] as part of the empty-section scaffolding the
  worked examples used to demonstrate. `declares` named views, so the guard above passed,
  and every view the user had built was removed.

  The guard could not have caught this: an author that declares a lever and then sends an
  empty list for it is, on its face, asking for that lever to be emptied. The fix is to deny
  the model that sentence at all.
*/
describe("an empty views array from the assistant", () => {
  beforeEach(freshApi);
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function withOneView() {
    const outcome = blueprint.applyBlueprintDirectly(
      "assistant",
      "build a view",
      {
        schemaVersion: 1,
        name: "v",
        exportedAt: new Date().toISOString(),
        views: [{ id: "keep-me", label: "Keep me", layout: "grid", components: [] }],
      },
      ["views"],
    );
    expect("proposal" in outcome).toBe(true);
    return outcome;
  }

  it("does not delete the views the user built", () => {
    withOneView();
    const outcome = blueprint.applyBlueprintDirectly(
      "assistant",
      "restyle the summary",
      {
        schemaVersion: 1,
        name: "restyle",
        exportedAt: new Date().toISOString(),
        prompts: [{ key: "narrative_guidance", body: "One paragraph. Colour the figures." }],
        views: [],
      },
      ["prompts", "views"],
    );
    expect("proposal" in outcome).toBe(true);
    const sections = ("proposal" in outcome ? outcome.proposal.diff : []).map((c) => c.section);
    expect(sections).toEqual(["prompts"]);
    expect(blueprint.currentConfiguration().views).toHaveLength(1);
  });

  it("still deletes a view when the list is non-empty", () => {
    withOneView();
    blueprint.applyBlueprintDirectly(
      "assistant",
      "add another",
      {
        schemaVersion: 1,
        name: "v2",
        exportedAt: new Date().toISOString(),
        views: [
          { id: "keep-me", label: "Keep me", layout: "grid", components: [] },
          { id: "drop-me", label: "Drop me", layout: "grid", components: [] },
        ],
      },
      ["views"],
    );
    blueprint.applyBlueprintDirectly(
      "assistant",
      "delete drop-me",
      {
        schemaVersion: 1,
        name: "v3",
        exportedAt: new Date().toISOString(),
        views: [{ id: "keep-me", label: "Keep me", layout: "grid", components: [] }],
      },
      ["views"],
    );
    expect(blueprint.currentConfiguration().views?.map((v) => v.id)).toEqual(["keep-me"]);
  });

  /*
    The regression this fix caused on its first attempt, pinned. Putting the rule in
    `validateBlueprint` meant a snapshot could no longer say "there were no views", so Undo
    of a newly-built view silently left the view in place — the safety net that recovered
    the user's data, broken by the fix for losing it.
  */
  it("leaves undo of a view creation working", () => {
    const outcome = withOneView();
    const revertId = "proposal" in outcome ? outcome.revertId : "";
    blueprint.activateProposal(revertId, "user");
    expect(blueprint.currentConfiguration().views ?? []).toEqual([]);
  });
});
