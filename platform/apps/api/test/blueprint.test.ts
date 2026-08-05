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

  it("a document identical to the live configuration is reported as no change, and writes nothing", async () => {
    const { db, blueprint } = freshApi();

    // BUG-030: a model told to act will sometimes emit a blueprint just to have something
    // to show. Echoing the current configuration back is not a change and must not be
    // recorded or announced as one.
    const outcome = blueprint.applyBlueprintDirectly(
      "assistant",
      "Add an undo button",
      blueprint.exportBlueprint("echo"),
    );

    expect(outcome).toEqual({ noChange: true });
    expect(db.getDb().select().from(schema.blueprintProposals).all()).toHaveLength(0);
  });

  it("applying directly writes nothing when the document references an unknown id", async () => {
    const { db, blueprint } = freshApi();

    const base = {
      schemaVersion: 1,
      name: "t",
      exportedAt: new Date().toISOString(),
      formulas: [],
      mappings: [],
      prompts: [],
    };

    /*
      Since v1.9.4 an unknown FORMULA id is a creation, not an error — that is how "add a
      metric" works. Everything else stays closed, and a created formula still has to
      compile: these are the cases that must keep failing whole.
    */
    const refused: unknown[] = [
      // A mapping onto an account this build does not have.
      { ...base, mappings: [{ reportType: "profit_and_loss", rawLabel: "X", accountId: "pl.imaginary" }] },
      // A brand-new formula whose body references a figure that does not exist.
      { ...base, formulas: [{ id: "made_up_ratio", expression: "pl.revenue / pl.imaginary" }] },
      // A new formula whose body does not parse at all.
      { ...base, formulas: [{ id: "broken_ratio", expression: "pl.revenue /" }] },
      // A formula id that is not a usable identifier.
      { ...base, formulas: [{ id: "rm -rf /", expression: "1 + 1" }] },
      // A section id outside the registry.
      { ...base, layout: { hiddenSections: ["not-a-section"] } },
    ];

    for (const doc of refused) {
      const outcome = blueprint.applyBlueprintDirectly("assistant", "bad", doc);
      expect("errors" in outcome, JSON.stringify(doc).slice(0, 90)).toBe(true);
    }

    // Not even the pre-apply snapshot is recorded when validation fails first.
    expect(db.getDb().select().from(schema.blueprintProposals).all()).toHaveLength(0);
  });

  it("builds a view from approved components, and undo removes it", async () => {
    const { db, blueprint } = freshApi();

    const outcome = blueprint.applyBlueprintDirectly("assistant", "Overdue invoices", {
      schemaVersion: 1,
      name: "t",
      exportedAt: new Date().toISOString(),
      formulas: [],
      mappings: [],
      prompts: [],
      views: [
        {
          id: "overdue-invoices",
          label: "Overdue invoices",
          layout: "grid",
          components: [
            { id: "m1", type: "metric", label: "Total receivable", valueId: "ar.total" },
            { id: "c1", type: "chart", label: "Trend", series: [{ id: "ar.total", kind: "bar" }] },
            { id: "t1", type: "table", label: "By customer", source: "ar_customer" },
            { id: "a1", type: "actions", buttons: ["export-pdf"] },
          ],
        },
      ],
    });
    if (!("proposal" in outcome)) throw new Error("expected an applied proposal");

    const stored = () =>
      db.getDb().select().from(schema.appSettings).all()
        .find((r: { key: string }) => r.key === "custom_views");

    expect(JSON.parse(stored().value)).toHaveLength(1);
    expect(outcome.proposal.diff[0]).toMatchObject({ section: "views", kind: "add" });

    blueprint.activateProposal(outcome.revertId);
    expect(JSON.parse(stored().value)).toEqual([]);
  });

  it("refuses a view whose component binds to an id or action this build does not have", async () => {
    const { db, blueprint } = freshApi();

    const base = {
      schemaVersion: 1,
      name: "t",
      exportedAt: new Date().toISOString(),
      formulas: [],
      mappings: [],
      prompts: [],
    };
    const view = (components: unknown[]) => ({
      ...base,
      views: [{ id: "v", label: "V", layout: "grid", components }],
    });

    // A metric bound to an invented figure, a table bound to an invented source, a button
    // bound to an invented action, and a component type that does not exist.
    for (const components of [
      [{ id: "a", type: "metric", label: "X", valueId: "revenue_chart" }],
      [{ id: "a", type: "table", label: "X", source: "invoices" }],
      [{ id: "a", type: "actions", buttons: ["delete-everything"] }],
      [{ id: "a", type: "iframe", src: "https://example.com" }],
    ]) {
      const outcome = blueprint.applyBlueprintDirectly("assistant", "bad", view(components));
      expect("errors" in outcome, JSON.stringify(components)).toBe(true);
    }

    // Nothing written by any of them — refusal is whole-document, never partial.
    expect(
      db.getDb().select().from(schema.appSettings).all()
        .find((r: { key: string }) => r.key === "custom_views"),
    ).toBeUndefined();
    expect(db.getDb().select().from(schema.blueprintProposals).all()).toHaveLength(0);
  });

  it("creates a formula that did not exist, with a version-1 history row", async () => {
    const { db, blueprint } = freshApi();

    const outcome = blueprint.applyBlueprintDirectly("assistant", "Add overdue ratio", {
      schemaVersion: 1,
      name: "t",
      exportedAt: new Date().toISOString(),
      // Not in SEED_FORMULAS and not in the database — this is a genuinely new metric.
      formulas: [{ id: "ar_to_revenue", expression: "ar.total / pl.revenue", label: "AR to revenue" }],
      mappings: [],
      prompts: [],
    });
    if (!("proposal" in outcome)) throw new Error("expected an applied proposal");

    const created = db.getDb().select().from(schema.formulas).all()
      .find((f: { id: string }) => f.id === "ar_to_revenue");
    expect(created).toBeDefined();
    expect(created.expression).toBe("ar.total / pl.revenue");
    expect(created.label).toBe("AR to revenue");

    const history = db.getDb().select().from(schema.formulaVersions).all()
      .filter((v: { formulaId: string }) => v.formulaId === "ar_to_revenue");
    expect(history).toHaveLength(1);
    expect(history[0].version).toBe(1);
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
