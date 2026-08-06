import { describe, expect, it } from "vitest";
import {
  BLUEPRINT_SCHEMA_VERSION,
  diffBlueprint,
  emptyBlueprint,
  validateBlueprint,
  type RegisteredSurface,
} from "../src/blueprint.js";

const surface: RegisteredSurface = {
  accountIds: new Set(["pl.revenue", "pl.cogs", "bs.cash"]),
  formulaIds: new Set(["days_cash_on_hand", "gross_profit"]),
  reportTypes: new Set(["profit_and_loss", "balance_sheet"]),
  promptKeys: new Set(["accounting_guidance", "narrative_guidance"]),
  sectionIds: new Set(["profitability", "customers"]),
  detailKinds: new Set(["pl_expense", "ar_customer"]),
  actionIds: new Set(["export-pdf", "upload"]),
  dashboardSectionIds: new Set(["summary", "growth", "cash"]),
  clientsColumnIds: new Set(["name", "revenue", "cash"]),
  landingTileIds: new Set(["client-count", "total-revenue", "avg-noi-margin"]),
};

describe("validateBlueprint", () => {
  it("accepts a well-formed document referencing only registered ids", () => {
    const { blueprint, errors } = validateBlueprint(
      {
        schemaVersion: BLUEPRINT_SCHEMA_VERSION,
        name: "Conservative liquidity",
        exportedAt: "2026-08-05T00:00:00.000Z",
        formulas: [{ id: "days_cash_on_hand", expression: "bs.cash / (pl.cogs / 30)" }],
        mappings: [{ reportType: "profit_and_loss", rawLabel: "Discounts", accountId: "pl.revenue" }],
        prompts: [{ key: "accounting_guidance", body: "Prefer conservative mappings." }],
      },
      surface,
    );
    expect(errors).toHaveLength(0);
    expect(blueprint?.formulas).toHaveLength(1);
  });

  /*
    A formula id outside the registry is a CREATION, not an invention — "add a metric for X"
    has no other expression. The id still has to look like an identifier, and the expression
    is compiled against the live registry by `applyBlueprintDirectly` before anything is
    written (see the api package's own tests). Every other id in the grammar stays closed.
  */
  it("accepts a formula id that does not exist yet, as a creation", () => {
    const { blueprint, errors } = validateBlueprint(
      {
        ...emptyBlueprint("new metric"),
        formulas: [{ id: "made_up_metric", expression: "1" }],
      },
      surface,
    );
    expect(errors).toEqual([]);
    expect(blueprint?.formulas[0]?.id).toBe("made_up_metric");
  });

  it("rejects a formula id that is not a usable identifier", () => {
    const { blueprint, errors } = validateBlueprint(
      {
        ...emptyBlueprint("bad"),
        formulas: [{ id: "rm -rf /", expression: "1" }],
      },
      surface,
    );
    expect(blueprint).toBeNull();
    expect(errors[0]?.path).toBe("formulas[0].id");
  });

  it("rejects a reference to an account id that does not exist", () => {
    const { blueprint, errors } = validateBlueprint(
      {
        ...emptyBlueprint("bad"),
        mappings: [{ reportType: "profit_and_loss", rawLabel: "X", accountId: "pl.not_real" }],
      },
      surface,
    );
    expect(blueprint).toBeNull();
    expect(errors[0]?.path).toBe("mappings[0].accountId");
  });

  it("rejects a document from a different schema version", () => {
    const { blueprint, errors } = validateBlueprint(
      { ...emptyBlueprint("old"), schemaVersion: 999 },
      surface,
    );
    expect(blueprint).toBeNull();
    expect(errors.some((e) => e.path === "schemaVersion")).toBe(true);
  });

  /*
    The enforcement that matters most: there is no field for source code or a credential,
    so a document carrying one is refused outright rather than having the field silently
    dropped. This is the "never invent" half of ADR-016 applied to a chatbot that can
    propose configuration but must never be able to smuggle in code or a key.
  */
  it.each(["source", "code", "apiKey", "groqApiKey", "groq_api_key"])(
    "refuses a document carrying a %s field",
    (field) => {
      const { blueprint, errors } = validateBlueprint(
        { ...emptyBlueprint("sneaky"), [field]: "rm -rf /" },
        surface,
      );
      expect(blueprint).toBeNull();
      expect(errors.some((e) => e.path === field)).toBe(true);
    },
  );

  it("rejects non-object input rather than throwing", () => {
    expect(validateBlueprint("not json", surface).blueprint).toBeNull();
    expect(validateBlueprint(null, surface).blueprint).toBeNull();
    expect(validateBlueprint(42, surface).blueprint).toBeNull();
  });

  it("rejects an unknown layout section id", () => {
    const { blueprint, errors } = validateBlueprint(
      { ...emptyBlueprint("bad"), layout: { hiddenSections: ["not_a_real_section"] } },
      surface,
    );
    expect(blueprint).toBeNull();
    expect(errors.some((e) => e.message.includes("not_a_real_section"))).toBe(true);
  });
});

describe("diffBlueprint", () => {
  const current = {
    formulas: [{ id: "days_cash_on_hand", expression: "bs.cash / (pl.cogs / 365)" }],
    mappings: [{ reportType: "profit_and_loss", rawLabel: "Discounts", accountId: "pl.revenue" }],
    prompts: [{ key: "accounting_guidance", body: "old text" }],
  };

  it("reports a modified formula, not a blind replace", () => {
    const proposed = {
      ...emptyBlueprint("fix"),
      formulas: [{ id: "days_cash_on_hand", expression: "bs.cash / (pl.cogs / 30)" }],
    };
    const changes = diffBlueprint(proposed, current);
    expect(changes).toEqual([
      {
        section: "formulas",
        key: "days_cash_on_hand",
        kind: "modify",
        before: current.formulas[0],
        after: proposed.formulas[0],
      },
    ]);
  });

  it("reports an added mapping distinctly from a modified one", () => {
    const proposed = {
      ...emptyBlueprint("add"),
      mappings: [{ reportType: "balance_sheet", rawLabel: "New line", accountId: "bs.cash" }],
    };
    const changes = diffBlueprint(proposed, current);
    expect(changes).toEqual([
      { section: "mappings", key: "balance_sheet|New line", kind: "add", after: proposed.mappings[0] },
    ]);
  });

  it("reports nothing when the proposal matches the live configuration", () => {
    const proposed = { ...emptyBlueprint("noop"), formulas: current.formulas };
    expect(diffBlueprint(proposed, current)).toHaveLength(0);
  });

  it("reports an added layout when none is set yet", () => {
    const proposed = {
      ...emptyBlueprint("layout"),
      layout: { hiddenSections: ["profitability"] },
    };
    expect(diffBlueprint(proposed, current)).toEqual([
      { section: "layout", key: "layout", kind: "add", after: proposed.layout },
    ]);
  });

  it("reports a modified layout against a stored one, with before/after", () => {
    const withLayout = { ...current, layout: { hiddenSections: ["profitability"] } };
    const proposed = {
      ...emptyBlueprint("layout"),
      layout: { hiddenSections: ["profitability", "customers"] },
    };
    expect(diffBlueprint(proposed, withLayout)).toEqual([
      {
        section: "layout",
        key: "layout",
        kind: "modify",
        before: withLayout.layout,
        after: proposed.layout,
      },
    ]);
  });

  it("reports nothing when the proposed layout matches the stored one", () => {
    const withLayout = { ...current, layout: { hiddenSections: ["profitability"] } };
    const proposed = { ...emptyBlueprint("noop"), layout: { hiddenSections: ["profitability"] } };
    expect(diffBlueprint(proposed, withLayout)).toHaveLength(0);
  });
});

/*
  The three arrangement levers (`dashboard`, `clientsTable`, `landingTiles`).

  Pinned here rather than only at the API layer because this is where the closed-registry
  guarantee actually lives: an id outside the registry must fail the WHOLE document, and an
  arrangement must have no way to carry a value. Both are properties of the grammar, so this
  is the file that should break if either is ever loosened.
*/
describe("arrangement levers", () => {
  const base = {
    schemaVersion: BLUEPRINT_SCHEMA_VERSION,
    name: "arrangement",
    exportedAt: "2026-01-01T00:00:00.000Z",
    formulas: [],
    mappings: [],
    prompts: [],
  };

  it("accepts order and hidden over registered ids", () => {
    const { blueprint, errors } = validateBlueprint(
      {
        ...base,
        dashboard: { order: ["cash", "summary", "growth"], hidden: ["growth"] },
        clientsTable: { order: ["name", "cash", "revenue"], hidden: [] },
        landingTiles: { order: ["total-revenue", "client-count"] },
      },
      surface,
    );
    expect(errors).toEqual([]);
    expect(blueprint?.dashboard).toEqual({
      order: ["cash", "summary", "growth"],
      hidden: ["growth"],
    });
    expect(blueprint?.landingTiles).toEqual({ order: ["total-revenue", "client-count"] });
  });

  it("refuses an unregistered id and returns no blueprint at all", () => {
    const { blueprint, errors } = validateBlueprint(
      { ...base, dashboard: { hidden: ["not-a-real-panel"] } },
      surface,
    );
    expect(blueprint).toBeNull();
    expect(errors.some((e) => e.message.includes("not-a-real-panel"))).toBe(true);
  });

  it("names the surface that was wrong, so three levers do not report one error", () => {
    const { errors } = validateBlueprint(
      {
        ...base,
        clientsTable: { hidden: ["nope"] },
        landingTiles: { order: ["also-nope"] },
      },
      surface,
    );
    expect(errors.map((e) => e.path).sort()).toEqual(["clientsTable", "landingTiles"]);
  });

  it("has nowhere to put a figure — a value field is not carried through", () => {
    const { blueprint } = validateBlueprint(
      { ...base, landingTiles: { order: ["client-count"], value: 42, values: { "client-count": 42 } } },
      surface,
    );
    // The grammar has no `value`/`values`, so whatever a model sends is simply not there.
    expect(blueprint?.landingTiles).toEqual({ order: ["client-count"] });
    expect(JSON.stringify(blueprint)).not.toContain("42");
  });

  it("diffs each arrangement separately, and reports nothing when unchanged", () => {
    const proposed = {
      ...base,
      dashboard: { order: ["summary", "growth"], hidden: [] },
      clientsTable: { order: ["name"], hidden: [] },
    } as never;
    const current = {
      formulas: [],
      mappings: [],
      prompts: [],
      dashboard: { order: ["summary", "growth"], hidden: [] },
    };
    const changes = diffBlueprint(proposed, current);
    expect(changes.map((c) => c.section)).toEqual(["clientsTable"]);
    expect(changes[0]?.kind).toBe("add");
  });

  it("omitting an arrangement means leave it alone, not clear it", () => {
    const changes = diffBlueprint({ ...base } as never, {
      formulas: [],
      mappings: [],
      prompts: [],
      landingTiles: { order: ["client-count"] },
    });
    expect(changes).toEqual([]);
  });
});

