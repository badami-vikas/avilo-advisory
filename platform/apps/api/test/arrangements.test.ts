/**
 * The three arrangement levers, end to end through the real apply path.
 *
 * The core package pins the grammar; this pins the behaviour that only exists once a
 * database is involved — that an arrangement is written where the web app reads it, that
 * the declared-levers guard covers the new sections as it does the old ones, and that a
 * restore returns the arrangement rather than only the formulas.
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
  dir = mkdtempSync(join(tmpdir(), "avilo-arrange-"));
  configurePaths({ filesRoot: dir, dbPath: join(dir, "test.sqlite") });
  dbModule.seedReferenceData(dbModule.getDb());
}

const doc = (extra: Record<string, unknown>) => ({
  schemaVersion: 1,
  name: "arrangement",
  exportedAt: new Date().toISOString(),
  ...blueprint.currentConfiguration(),
  ...extra,
});

beforeEach(() => {
  dir = "";
});

afterEach(() => {
  dbModule.closeConnection();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("arrangement levers", () => {
  it("writes the tile arrangement where the clients page reads it", () => {
    freshApi();
    const outcome = blueprint.applyBlueprintDirectly(
      "assistant",
      "Show total cash instead of missing inputs",
      doc({ landingTiles: { order: ["client-count", "total-cash"], hidden: [] } }),
      ["landingTiles"],
    );
    expect("proposal" in outcome).toBe(true);

    const stored = dbModule
      .getDb()
      .select()
      .from(dbModule.schema.appSettings)
      .all()
      .find((r) => r.key === "landing_tiles");
    expect(JSON.parse(stored!.value)).toEqual({
      order: ["client-count", "total-cash"],
      hidden: [],
    });
    expect(blueprint.currentConfiguration().landingTiles?.order).toContain("total-cash");
  });

  it("refuses a tile change that also rearranges the dashboard, and writes NOTHING", () => {
    freshApi();
    const before = versions.listVersions().length;
    const outcome = blueprint.applyBlueprintDirectly(
      "assistant",
      "Just the tiles, please",
      doc({
        landingTiles: { order: ["client-count"] },
        dashboard: { hidden: ["warnings"] },
      }),
      ["landingTiles"],
    );

    expect("outOfScope" in outcome).toBe(true);
    if (!("outOfScope" in outcome)) throw new Error("unreachable");
    expect(outcome.outOfScope.undeclared).toEqual(["dashboard"]);
    // The refusal is total — the DECLARED half is not written either.
    expect(blueprint.currentConfiguration().landingTiles).toBeUndefined();
    expect(blueprint.currentConfiguration().dashboard).toBeUndefined();
    expect(versions.listVersions().length).toBe(before);
  });

  it("describes an arrangement change in words, not as `modify dashboard: dashboard`", () => {
    freshApi();
    const outcome = blueprint.applyBlueprintDirectly(
      "assistant",
      "Hide the early warnings panel",
      doc({ dashboard: { hidden: ["warnings"] } }),
      ["dashboard"],
    );
    if (!("proposal" in outcome)) throw new Error("expected an applied change");
    const described = outcome.proposal.diff.map(blueprint.describeBlueprintChange);
    expect(described).toEqual(["Dashboard — hid warnings"]);
  });

  it("refuses a panel id this build does not have", () => {
    freshApi();
    const outcome = blueprint.applyBlueprintDirectly(
      "assistant",
      "Hide a panel that does not exist",
      doc({ dashboard: { hidden: ["imaginary-panel"] } }),
      ["dashboard"],
    );
    expect("errors" in outcome).toBe(true);
    expect(blueprint.currentConfiguration().dashboard).toBeUndefined();
  });

  /*
    The property that makes an agent-initiated restore safe has to hold for the NEW levers
    too, or "every change leaves a state you can return to" quietly becomes "every change
    except the ones added most recently".
  */
  it("restores an arrangement, not just the formulas", () => {
    freshApi();
    blueprint.applyBlueprintDirectly(
      "assistant",
      "Hide two columns",
      doc({ clientsTable: { hidden: ["industry", "legalName"] } }),
      ["clientsTable"],
    );
    const afterFirst = versions.listVersions()[0]!;

    blueprint.applyBlueprintDirectly(
      "assistant",
      "Actually hide a third",
      doc({ clientsTable: { hidden: ["industry", "legalName", "dpo"] } }),
      ["clientsTable"],
    );
    expect(blueprint.currentConfiguration().clientsTable?.hidden).toHaveLength(3);

    const restored = blueprint.restoreVersion(afterFirst.id, "user");
    expect("noChange" in restored).toBe(false);
    expect(blueprint.currentConfiguration().clientsTable?.hidden).toEqual([
      "industry",
      "legalName",
    ]);
  });
});
