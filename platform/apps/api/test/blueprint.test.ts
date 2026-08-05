/**
 * Blueprint propose/activate/reject, against a real seeded database.
 *
 * The thing this exists to prove: a proposal changes nothing on its own, an activated
 * one goes through the same version-history and label-learning paths a person's own edit
 * would, and a document referencing an id this app does not have is refused rather than
 * partially applied.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { schema } from "@avilo/module";
import * as dbModule from "../src/db.js";
import { configurePaths } from "../src/paths.js";
import * as blueprint from "../src/services/blueprint.js";

let dir: string;

/**
 * A fresh, seeded, on-disk database per test. `closeConnection()` clears `db.ts`'s
 * module-level cache; `configurePaths` points the NEXT `getDb()` call at a brand new
 * directory rather than the cached default `paths.ts` resolves once and remembers — an
 * env var set after that first resolution has no effect, so this goes through the
 * explicit override the host itself uses instead.
 */
function freshApi() {
  dbModule.closeConnection();
  dir = mkdtempSync(join(tmpdir(), "avilo-blueprint-"));
  configurePaths({ filesRoot: dir, dbPath: join(dir, "test.sqlite") });
  dbModule.seedReferenceData(dbModule.getDb());
  return { db: dbModule, blueprint };
}

beforeEach(() => {
  dir = "";
});

afterEach(() => {
  dbModule.closeConnection();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("blueprint propose/activate/reject", () => {
  it("records a proposal without changing the live formula", async () => {
    const { db, blueprint } = freshApi();

    const outcome = blueprint.proposeBlueprint("user", "Widen the DSO benchmark", {
      schemaVersion: 1,
      name: "test",
      exportedAt: new Date().toISOString(),
      formulas: [{ id: "dso", expression: "ar.total / avg3.pl.revenue * 45" }],
      mappings: [],
      prompts: [],
    });

    expect("proposal" in outcome).toBe(true);
    if (!("proposal" in outcome)) throw new Error("expected a proposal");
    expect(outcome.proposal.status).toBe("proposed");
    expect(outcome.proposal.diff).toEqual([
      {
        section: "formulas",
        key: "dso",
        kind: "modify",
        before: {
          id: "dso",
          expression: "ar.total / avg3.pl.revenue * 30",
          label: "Days sales outstanding (DSO)",
          description:
            "Average days to collect. Outstanding receivables divided by trailing three-month average revenue.",
        },
        after: { id: "dso", expression: "ar.total / avg3.pl.revenue * 45" },
      },
    ]);

    const live = db
      .getDb()
      .select()
      .from(schema.formulas)
      .all()
      .find((f: { id: string }) => f.id === "dso");
    expect(live.expression).toBe("ar.total / avg3.pl.revenue * 30");
  });

  it("activating writes a new formula version, matching a manual edit's audit trail", async () => {
    const { db, blueprint } = freshApi();

    const outcome = blueprint.proposeBlueprint("chatbot", "Widen DSO", {
      schemaVersion: 1,
      name: "t",
      exportedAt: new Date().toISOString(),
      formulas: [{ id: "dso", expression: "ar.total / avg3.pl.revenue * 45" }],
      mappings: [],
      prompts: [],
    });
    if (!("proposal" in outcome)) throw new Error("expected a proposal");

    const activated = blueprint.activateProposal(outcome.proposal.id);
    expect(activated.status).toBe("active");

    const row = db.getDb().select().from(schema.formulas).all().find((f: { id: string }) => f.id === "dso");
    expect(row.expression).toBe("ar.total / avg3.pl.revenue * 45");
    expect(row.version).toBe(2);

    const versions = db
      .getDb()
      .select()
      .from(schema.formulaVersions)
      .all()
      .filter((v: { formulaId: string }) => v.formulaId === "dso");
    expect(versions).toHaveLength(2);
    expect(versions[1].author).toBe("blueprint:chatbot");
  });

  it("a rejected proposal never touches the live configuration", async () => {
    const { db, blueprint } = freshApi();

    const outcome = blueprint.proposeBlueprint("chatbot", "Bad idea", {
      schemaVersion: 1,
      name: "t",
      exportedAt: new Date().toISOString(),
      formulas: [{ id: "dso", expression: "ar.total / avg3.pl.revenue * 999" }],
      mappings: [],
      prompts: [],
    });
    if (!("proposal" in outcome)) throw new Error("expected a proposal");

    const rejected = blueprint.rejectProposal(outcome.proposal.id, "Not now");
    expect(rejected.status).toBe("rejected");
    expect(rejected.decisionNote).toBe("Not now");

    const row = db.getDb().select().from(schema.formulas).all().find((f: { id: string }) => f.id === "dso");
    expect(row.expression).toBe("ar.total / avg3.pl.revenue * 30");
  });

  it("refuses a document referencing an account id that does not exist", async () => {
    const { blueprint } = freshApi();

    const outcome = blueprint.proposeBlueprint("chatbot", "Bad account", {
      schemaVersion: 1,
      name: "t",
      exportedAt: new Date().toISOString(),
      formulas: [],
      mappings: [{ reportType: "profit_and_loss", rawLabel: "X", accountId: "pl.not_real_account" }],
      prompts: [],
    });

    expect("errors" in outcome).toBe(true);
    if (!("errors" in outcome)) throw new Error("expected errors");
    expect(outcome.errors[0]!.path).toBe("mappings[0].accountId");
  });

  it("refuses a document that smuggles a field outside the grammar", async () => {
    const { blueprint } = freshApi();

    const outcome = blueprint.proposeBlueprint("chatbot", "Sneaky", {
      schemaVersion: 1,
      name: "t",
      exportedAt: new Date().toISOString(),
      formulas: [],
      mappings: [],
      prompts: [],
      groq_api_key: "gsk_stolen",
    });

    expect("errors" in outcome).toBe(true);
  });

  it("cannot activate the same proposal twice", async () => {
    const { blueprint } = freshApi();

    const outcome = blueprint.proposeBlueprint("chatbot", "Once", {
      schemaVersion: 1,
      name: "t",
      exportedAt: new Date().toISOString(),
      formulas: [{ id: "dso", expression: "ar.total / avg3.pl.revenue * 50" }],
      mappings: [],
      prompts: [],
    });
    if (!("proposal" in outcome)) throw new Error("expected a proposal");

    blueprint.activateProposal(outcome.proposal.id);
    expect(() => blueprint.activateProposal(outcome.proposal.id)).toThrow(/already active/);
  });

  it("activating a layout proposal writes the app-wide default, readable back via settings", async () => {
    const { db, blueprint } = freshApi();

    const outcome = blueprint.proposeBlueprint("chatbot", "Hide profitability", {
      schemaVersion: 1,
      name: "t",
      exportedAt: new Date().toISOString(),
      formulas: [],
      mappings: [],
      prompts: [],
      layout: { hiddenSections: ["profitability"] },
    });
    if (!("proposal" in outcome)) throw new Error("expected a proposal");
    expect(outcome.proposal.diff).toEqual([
      { section: "layout", key: "layout", kind: "add", after: { hiddenSections: ["profitability"] } },
    ]);

    blueprint.activateProposal(outcome.proposal.id);

    const row = db
      .getDb()
      .select()
      .from(schema.appSettings)
      .all()
      .find((r: { key: string }) => r.key === "report_layout_default");
    expect(row && JSON.parse(row.value)).toEqual({ hiddenSections: ["profitability"] });

    // Exported again, the layout now round-trips through `currentConfiguration`.
    const exported = blueprint.exportBlueprint("after");
    expect(exported.layout).toEqual({ hiddenSections: ["profitability"] });
  });

  it("applying directly changes the live configuration, and the returned revert restores it", async () => {
    const { db, blueprint } = freshApi();

    const before = blueprint.exportBlueprint("before").formulas.find((f) => f.id === "dso");
    expect(before).toBeDefined();

    const outcome = blueprint.applyBlueprintDirectly("assistant", "Change DSO", {
      schemaVersion: 1,
      name: "t",
      exportedAt: new Date().toISOString(),
      formulas: [{ id: "dso", expression: "ar.total / avg3.pl.revenue * 50" }],
      mappings: [],
      prompts: [],
    });
    if (!("proposal" in outcome)) throw new Error("expected an applied proposal");

    // Applied, not merely recorded: status is active and the live row already moved.
    expect(outcome.proposal.status).toBe("active");
    const live = db.getDb().select().from(schema.formulas).all().find((f: { id: string }) => f.id === "dso");
    expect(live.expression).toBe("ar.total / avg3.pl.revenue * 50");

    // The snapshot taken beforehand puts the original expression back.
    blueprint.activateProposal(outcome.revertId);
    const reverted = db.getDb().select().from(schema.formulas).all().find((f: { id: string }) => f.id === "dso");
    expect(reverted.expression).toBe(before.expression);
  });

  it("undo clears a layout the assistant added when there was no layout override before", async () => {
    const { db, blueprint } = freshApi();

    const layoutKey = () =>
      db
        .getDb()
        .select()
        .from(schema.appSettings)
        .all()
        .find((r: { key: string }) => r.key === "report_layout_default");

    expect(layoutKey()).toBeUndefined();

    const outcome = blueprint.applyBlueprintDirectly("assistant", "Hide referrals", {
      schemaVersion: 1,
      name: "t",
      exportedAt: new Date().toISOString(),
      formulas: [],
      mappings: [],
      prompts: [],
      layout: { hiddenSections: ["referrals"] },
    });
    if (!("proposal" in outcome)) throw new Error("expected an applied proposal");
    expect(JSON.parse(layoutKey().value).hiddenSections).toEqual(["referrals"]);

    // An absent `layout` would mean "leave it alone", so the snapshot must spell out the
    // empty state — otherwise this undo silently leaves referrals hidden.
    blueprint.activateProposal(outcome.revertId);
    expect(JSON.parse(layoutKey().value).hiddenSections).toEqual([]);
  });

  it("applying directly writes nothing when the document references an unknown id", async () => {
    const { db, blueprint } = freshApi();

    const outcome = blueprint.applyBlueprintDirectly("assistant", "Invent a formula", {
      schemaVersion: 1,
      name: "t",
      exportedAt: new Date().toISOString(),
      formulas: [{ id: "not.a.real.formula", expression: "1 + 1" }],
      mappings: [],
      prompts: [],
    });

    expect("errors" in outcome).toBe(true);
    // Not even the pre-apply snapshot is recorded when validation fails first.
    expect(db.getDb().select().from(schema.blueprintProposals).all()).toHaveLength(0);
  });

  it("export produces a document that re-validates and diffs to nothing against itself", async () => {
    const { blueprint } = freshApi();

    const exported = blueprint.exportBlueprint("my custom avilo");
    const outcome = blueprint.proposeBlueprint("user", "round trip", exported);

    expect("proposal" in outcome).toBe(true);
    if (!("proposal" in outcome)) throw new Error("expected a proposal");
    expect(outcome.proposal.diff).toEqual([]);
  });
});
