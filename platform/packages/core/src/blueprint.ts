// Blueprint: the configuration surface a chatbot — or a person — is allowed to change,
// as a single versioned, portable, human-readable JSON document.
//
// Local port of relationship-os `packages/core/src/blueprint.ts`, narrowed to what Avilo
// actually has a runtime for. Zero runtime dependencies, for the same reason the upstream
// file states: this must compile identically in apps/api (server-side, on propose) and
// apps/web (client-side, on preview) without dragging either into the other.
//
// What a blueprint may contain — and, just as deliberately, what it may NOT:
//
//   - formula overrides   (`formulas` — versioned expressions, ADR-003)
//   - label mappings      (`mappings` — QuickBooks row label -> canonical account, ADR-002)
//   - AI prompts          (`prompts` — ACCOUNTING_GUIDANCE / NARRATIVE_GUIDANCE, ADR-013)
//   - report layout       (`layout` — section order and visibility)
//
// It may NOT contain application source, and it may NOT contain a Groq API key. Both are
// enforced by the shape of the type, not by a runtime check that could be bypassed: there
// is no field to put source in, and `parseBlueprint` rejects a document that has one. The
// key stays local to `app_settings` (ADR-012) for the same reason it was kept out of the
// installer — a blueprint is the thing you might publish or hand to a colleague.
//
// This is what makes "a chatbot that can modify and optimise the app, with the change
// recorded and shareable" safe rather than aspirational: the chatbot proposes a blueprint,
// a compiler validates it against the accounts and formulas that actually exist, and a
// human activates it. Nothing it emits can execute — the compiler is the only path from
// "a document a model wrote" to "a change the app applies", exactly as the upstream
// compileBlueprint() is the only path from a WorkspaceBlueprint to a CompiledWorkspace.

/** Bumped on a breaking change to the blueprint grammar. A document with no version, or a
 * version this build does not understand, is stamped/rejected — never silently coerced. */
export const BLUEPRINT_SCHEMA_VERSION = 1 as const;

export interface FormulaOverride {
  id: string;
  expression: string;
  /** Present when the author wants to change how the figure is labelled or explained. */
  label?: string;
  description?: string;
  /** currency | percent | days | ratio | count — how the figure is rendered, never what it is. */
  unit?: string;
  /** Position in the metric list. Ordering, not value. */
  sortOrder?: number;
  /**
   * `false` hides the metric everywhere without deleting its definition or its version
   * history. "Stop showing DSO" is a display decision, and answering it by deleting the
   * formula would throw away the audit trail ADR-003 exists to keep.
   */
  active?: boolean;
  /**
   * Healthy band, driving the colour and the Check Formulas panel.
   *
   * This is the one lever that carries numbers, and it is worth being precise about why
   * that does not breach "never fabricate a figure". A benchmark is a POLICY the advisor
   * sets — "warn below 30 days of cash" — not a reading from anyone's books. No displayed
   * figure is ever sourced from here; the band only decides what colour an independently
   * computed figure is drawn in. `null` clears an existing band.
   */
  benchmark?: { min?: number; max?: number; note?: string } | null;
}

/**
 * A display name for a canonical account.
 *
 * Renaming "Total Income" to "Revenue" changes the word on screen and nothing else — every
 * figure is still resolved by the account's id, which is closed and cannot be invented. The
 * binding-not-value rule (ADR-041) is what makes this safe to hand over: the label is the
 * part that carries no data.
 */
export interface AccountLabelOverride {
  id: string;
  label?: string;
  description?: string;
}

export interface LabelMappingEntry {
  reportType: string;
  /** The raw row label as it appears in the export — matched via normalizeLabel. */
  rawLabel: string;
  accountId: string;
}

export interface PromptOverride {
  /** "accounting_guidance" | "narrative_guidance" — the two runtime-overridable prompts
   * (ADR-013). Not a closed union here: the compiler validates against the live registry
   * of overridable keys, so a new prompt surface does not require a type change here too. */
  key: string;
  body: string;
}

export interface LayoutOverride {
  sectionOrder?: string[];
  hiddenSections?: string[];
}

/**
 * Order and visibility over a closed set of ids — the shape shared by every "arrange this
 * surface" lever (`dashboard`, `clientsTable`, `landingTiles`).
 *
 * One type rather than three because the safety argument is identical in each case and
 * worth making once: an arrangement can only *permute and hide* things the application
 * already builds. There is no field for a new panel, a new column, or a tile's value — so
 * widening the assistant's reach across these surfaces adds no way to put an unsourced
 * figure on screen. It is the binding-not-value rule applied to layout instead of content.
 */
export interface ArrangementOverride {
  order?: string[];
  hidden?: string[];
}

/**
 * A component the assistant may place in a view.
 *
 * The generative-UI contract, and the reason this is a closed union rather than anything
 * resembling markup: the assistant composes from a vocabulary it cannot extend. `type`
 * selects a real React component that already exists and is already tested; the rest of
 * the fields are *bindings*, never content.
 *
 * The binding rule is what keeps CLAUDE.md's "never fabricate a figure" true through a
 * generated interface. A metric carries `valueId` — an account or formula id resolved
 * against the live report — never a number. A chart carries series ids, never points. A
 * table names a detail set the importer produced. There is no field anywhere in this union
 * that lets a model put a figure on screen, so a generated dashboard is exactly as
 * trustworthy as the books behind it.
 *
 * `text` is the one place free prose reaches the page. It is rendered as plain text, never
 * as HTML, and it is the assistant's own words rather than a figure — the same standing as
 * a sticky note.
 */
export type ViewComponent =
  | { id: string; type: "metric"; label: string; valueId: string }
  | {
      id: string;
      type: "chart";
      label: string;
      series: { id: string; label?: string; kind?: "bar" | "line" }[];
    }
  | { id: string; type: "table"; label: string; source: string }
  | { id: string; type: "text"; label?: string; body: string }
  | { id: string; type: "actions"; label?: string; buttons: string[] };

/**
 * A named view, composed of approved components — what "build me a dashboard for overdue
 * invoices" produces. Appears in the client page's view picker beside the built-in ones.
 */
export interface CustomView {
  id: string;
  label: string;
  layout: "grid" | "stack";
  components: ViewComponent[];
}

export interface AviloBlueprint {
  schemaVersion: typeof BLUEPRINT_SCHEMA_VERSION;
  /** Free-text name for the export, shown in the picker when importing. */
  name: string;
  description?: string;
  /** ISO timestamp of export, for display only — never compared for staleness. */
  exportedAt: string;
  formulas: FormulaOverride[];
  mappings: LabelMappingEntry[];
  prompts: PromptOverride[];
  layout?: LayoutOverride;
  /** User-defined views. Absent means "leave the existing views alone" (see ADR-039). */
  views?: CustomView[];
  /**
   * Add, replace or delete individual views without resending the set.
   *
   * `views` replaces wholesale, which is right for export/import — a blueprint IS the set of
   * views it describes — and wrong for an author editing one of several. A model that forgets
   * to resend a view deletes it, which is what BUG-042 was, and the guard that caught it only
   * covers the empty-array case. Naming the view you mean removes the class of mistake rather
   * than one instance of it.
   *
   * `views` and `viewsPatch` in the same document is refused: they express the same intent
   * two ways, and applying both leaves the result dependent on ordering.
   */
  viewsPatch?: { upsert?: CustomView[]; remove?: string[] };
  /** Display names for canonical accounts. Absent means "leave labels alone". */
  accountLabels?: AccountLabelOverride[];
  /** Which dashboard panels appear, and in what order. */
  dashboard?: ArrangementOverride;
  /** Which columns the clients list shows, and in what order. */
  clientsTable?: ArrangementOverride;
  /** Which portfolio aggregates appear as tiles above the clients list. */
  landingTiles?: ArrangementOverride;
}

export function emptyBlueprint(name: string): AviloBlueprint {
  return {
    schemaVersion: BLUEPRINT_SCHEMA_VERSION,
    name,
    exportedAt: new Date().toISOString(),
    formulas: [],
    mappings: [],
    prompts: [],
  };
}

/* ---------------------------------------------------------------- validation */

export interface BlueprintError {
  path: string;
  message: string;
}

export interface RegisteredSurface {
  /** Every canonical account id the compiler may reference (`pl.revenue`, `bs.cash`, …). */
  accountIds: ReadonlySet<string>;
  /** Every formula id currently in the registry, active or not. */
  formulaIds: ReadonlySet<string>;
  /** Every report type the importer knows (`profit_and_loss`, `ar_aging`, …). */
  reportTypes: ReadonlySet<string>;
  /** Every prompt key that is actually read at runtime. */
  promptKeys: ReadonlySet<string>;
  /** Every section id the report layout understands. */
  sectionIds: ReadonlySet<string>;
  /** Every detail set a `table` component may bind to (`pl_expense`, `ar_customer`, …). */
  detailKinds: ReadonlySet<string>;
  /** Every action an `actions` component may place a button for. */
  actionIds: ReadonlySet<string>;
  /** Every panel the client dashboard can render. */
  dashboardSectionIds: ReadonlySet<string>;
  /** Every column the clients list can render. */
  clientsColumnIds: ReadonlySet<string>;
  /** Every portfolio aggregate that can be shown as a tile above the clients list. */
  landingTileIds: ReadonlySet<string>;
}

/**
 * Reject a document outside the grammar — a reference to an account, formula, report type,
 * prompt or section this application does not have — rather than silently drop or apply
 * whatever half of it happens to line up. A blueprint generated against a different
 * client's chart of accounts, or by a model that invented an id, fails validation as a
 * whole and is never partially activated.
 *
 * `unknown` at the parameter boundary, not `AviloBlueprint`, because the first thing this
 * function must do is confirm the document IS one — it is the boundary between "text a
 * model produced" and "a typed object the rest of the system trusts" (ADR-016: a model may
 * choose, never invent — this is the "never invent" enforcement point for blueprints).
 */
export function validateBlueprint(
  candidate: unknown,
  surface: RegisteredSurface,
): { blueprint: AviloBlueprint | null; errors: BlueprintError[] } {
  const errors: BlueprintError[] = [];
  const fail = (path: string, message: string) => errors.push({ path, message });

  if (typeof candidate !== "object" || candidate === null) {
    return { blueprint: null, errors: [{ path: "$", message: "Not a JSON object." }] };
  }
  const doc = candidate as Record<string, unknown>;

  if (doc.schemaVersion !== BLUEPRINT_SCHEMA_VERSION) {
    fail(
      "schemaVersion",
      `Expected ${BLUEPRINT_SCHEMA_VERSION}, got ${JSON.stringify(doc.schemaVersion)}. ` +
        "This build cannot read a blueprint from a different schema version.",
    );
  }
  if (typeof doc.name !== "string" || doc.name.trim() === "") {
    fail("name", "A blueprint must have a non-empty name.");
  }

  // The enforcement that matters most: there is no field for source code or a key, so if
  // one shows up the document was tampered with or hand-authored outside this grammar —
  // either way, refuse it outright rather than silently stripping the field.
  for (const forbidden of ["source", "sourceFiles", "code", "apiKey", "groqApiKey", "groq_api_key"]) {
    if (forbidden in doc) {
      fail(forbidden, "This field is not part of the blueprint grammar and is never accepted.");
    }
  }

  const formulas = Array.isArray(doc.formulas) ? doc.formulas : [];
  const validFormulas: FormulaOverride[] = [];
  formulas.forEach((entry, i) => {
    if (typeof entry !== "object" || entry === null) {
      fail(`formulas[${i}]`, "Not an object.");
      return;
    }
    const f = entry as Record<string, unknown>;
    if (typeof f.id !== "string" || typeof f.expression !== "string") {
      fail(`formulas[${i}]`, "Requires string `id` and `expression`.");
      return;
    }
    /*
      A formula id the registry does not have is a CREATION, not an invention.

      This is the one place the "never invent an id" rule is deliberately relaxed, because
      "add a metric for X" is a real thing to ask for and there is no other way to express
      it. The safety it gives up is recovered twice over downstream: the id must look like
      an identifier (so it cannot smuggle punctuation into a key), and `applyBlueprintDirectly`
      compiles the expression against the live accounts and formulas before writing, so a
      new formula whose body references something imaginary is still refused whole.

      Every OTHER id in a blueprint — accounts, report types, prompt keys, section ids,
      view bindings — remains closed. Those name things that already exist; only a formula
      can bring a new name into being.
    */
    if (!surface.formulaIds.has(f.id) && !/^[a-z][a-z0-9_.]{1,63}$/i.test(f.id)) {
      fail(
        `formulas[${i}].id`,
        `"${f.id}" is not a usable formula id — letters, digits, underscores and dots only.`,
      );
      return;
    }
    /*
      Presentation fields, each optional and each independently checked.

      `unit` is closed to what the renderers actually implement — an unknown unit is a
      metric that draws as nothing, which is worse than a rejected document. `benchmark`
      is the only place a number enters a blueprint, and it is a threshold rather than a
      reading; `null` clears a band that already exists.
    */
    const UNITS = ["currency", "percent", "days", "ratio", "count"];
    if (f.unit !== undefined && (typeof f.unit !== "string" || !UNITS.includes(f.unit))) {
      fail(`formulas[${i}].unit`, `Unknown unit "${String(f.unit)}". One of: ${UNITS.join(", ")}.`);
      return;
    }
    if (f.sortOrder !== undefined && typeof f.sortOrder !== "number") {
      fail(`formulas[${i}].sortOrder`, "Must be a number.");
      return;
    }
    if (f.active !== undefined && typeof f.active !== "boolean") {
      fail(`formulas[${i}].active`, "Must be true or false.");
      return;
    }
    let benchmark: { min?: number; max?: number; note?: string } | null | undefined;
    if (f.benchmark !== undefined) {
      if (f.benchmark === null) {
        benchmark = null;
      } else if (typeof f.benchmark !== "object") {
        fail(`formulas[${i}].benchmark`, "Must be an object with min/max/note, or null to clear.");
        return;
      } else {
        const b = f.benchmark as Record<string, unknown>;
        if (b.min !== undefined && typeof b.min !== "number") {
          fail(`formulas[${i}].benchmark.min`, "Must be a number.");
          return;
        }
        if (b.max !== undefined && typeof b.max !== "number") {
          fail(`formulas[${i}].benchmark.max`, "Must be a number.");
          return;
        }
        benchmark = {
          ...(typeof b.min === "number" ? { min: b.min } : {}),
          ...(typeof b.max === "number" ? { max: b.max } : {}),
          ...(typeof b.note === "string" ? { note: b.note } : {}),
        };
      }
    }

    validFormulas.push({
      id: f.id,
      expression: f.expression,
      ...(typeof f.label === "string" ? { label: f.label } : {}),
      ...(typeof f.description === "string" ? { description: f.description } : {}),
      ...(typeof f.unit === "string" ? { unit: f.unit } : {}),
      ...(typeof f.sortOrder === "number" ? { sortOrder: f.sortOrder } : {}),
      ...(typeof f.active === "boolean" ? { active: f.active } : {}),
      ...(benchmark !== undefined ? { benchmark } : {}),
    });
  });

  const mappings = Array.isArray(doc.mappings) ? doc.mappings : [];
  const validMappings: LabelMappingEntry[] = [];
  mappings.forEach((entry, i) => {
    if (typeof entry !== "object" || entry === null) {
      fail(`mappings[${i}]`, "Not an object.");
      return;
    }
    const m = entry as Record<string, unknown>;
    if (
      typeof m.reportType !== "string" ||
      typeof m.rawLabel !== "string" ||
      typeof m.accountId !== "string"
    ) {
      fail(`mappings[${i}]`, "Requires string `reportType`, `rawLabel`, `accountId`.");
      return;
    }
    if (!surface.reportTypes.has(m.reportType)) {
      fail(`mappings[${i}].reportType`, `Unknown report type "${m.reportType}".`);
      return;
    }
    if (!surface.accountIds.has(m.accountId)) {
      fail(`mappings[${i}].accountId`, `Unknown account id "${m.accountId}".`);
      return;
    }
    validMappings.push({ reportType: m.reportType, rawLabel: m.rawLabel, accountId: m.accountId });
  });

  const prompts = Array.isArray(doc.prompts) ? doc.prompts : [];
  const validPrompts: PromptOverride[] = [];
  prompts.forEach((entry, i) => {
    if (typeof entry !== "object" || entry === null) {
      fail(`prompts[${i}]`, "Not an object.");
      return;
    }
    const p = entry as Record<string, unknown>;
    if (typeof p.key !== "string" || typeof p.body !== "string") {
      fail(`prompts[${i}]`, "Requires string `key` and `body`.");
      return;
    }
    if (!surface.promptKeys.has(p.key)) {
      fail(`prompts[${i}].key`, `Unknown prompt key "${p.key}".`);
      return;
    }
    validPrompts.push({ key: p.key, body: p.body });
  });

  let layout: LayoutOverride | undefined;
  if (doc.layout !== undefined) {
    if (typeof doc.layout !== "object" || doc.layout === null) {
      fail("layout", "Not an object.");
    } else {
      const l = doc.layout as Record<string, unknown>;
      const sectionOrder = Array.isArray(l.sectionOrder)
        ? l.sectionOrder.filter((s): s is string => typeof s === "string")
        : undefined;
      const hiddenSections = Array.isArray(l.hiddenSections)
        ? l.hiddenSections.filter((s): s is string => typeof s === "string")
        : undefined;
      for (const id of [...(sectionOrder ?? []), ...(hiddenSections ?? [])]) {
        if (!surface.sectionIds.has(id)) {
          fail("layout", `Unknown section id "${id}".`);
        }
      }
      layout = { ...(sectionOrder ? { sectionOrder } : {}), ...(hiddenSections ? { hiddenSections } : {}) };
    }
  }

  /*
    The three arrangement levers. Each permutes and hides a closed set of ids the
    application already builds, so the only way to fail is to name something that does not
    exist — and naming it fails the document whole, exactly as an invented account id does.
  */
  const arrangements: Partial<Record<"dashboard" | "clientsTable" | "landingTiles", ArrangementOverride>> = {};
  const arrangementFields = [
    ["dashboard", surface.dashboardSectionIds, "dashboard panel"],
    ["clientsTable", surface.clientsColumnIds, "clients list column"],
    ["landingTiles", surface.landingTileIds, "portfolio tile"],
  ] as const;

  for (const [field, known, noun] of arrangementFields) {
    if (doc[field] === undefined) continue;
    if (typeof doc[field] !== "object" || doc[field] === null) {
      fail(field, "Not an object.");
      continue;
    }
    const a = doc[field] as Record<string, unknown>;
    const order = Array.isArray(a.order)
      ? a.order.filter((s): s is string => typeof s === "string")
      : undefined;
    const hidden = Array.isArray(a.hidden)
      ? a.hidden.filter((s): s is string => typeof s === "string")
      : undefined;
    for (const id of [...(order ?? []), ...(hidden ?? [])]) {
      if (!known.has(id)) fail(field, `Unknown ${noun} "${id}".`);
    }
    arrangements[field] = { ...(order ? { order } : {}), ...(hidden ? { hidden } : {}) };
  }

  /*
    Views. Every id a component binds to is checked here against the live registry, which
    is what makes a generated interface safe to render without inspecting it: by the time a
    `CustomView` exists, every metric resolves, every series resolves, every table names a
    real detail set and every button names a real action. The renderer needs no defensive
    checks of its own, and a model that invents `revenue_chart` gets the whole document
    refused rather than a view with one broken tile in it.
  */
  /*
    One view validator, two entry points.

    `views` replaces the whole set; `viewsPatch.upsert` names individual views. The
    component checking has to be identical in both — a `metric` that may not carry a figure
    is the guarantee (ADR-041), and a second copy of that check is how the two eventually
    disagree about what a component may hold. Extracted rather than duplicated for exactly
    that reason.
  */
  const validateViewList = (raw: unknown, at: string): CustomView[] | null => {
    if (!Array.isArray(raw)) {
      fail(at, "Not an array.");
      return null;
    }
    const valueIds = (id: string) => surface.accountIds.has(id) || surface.formulaIds.has(id);
    const seen = new Set<string>();
    const collected: CustomView[] = [];

    raw.forEach((rawV, i) => {
      if (typeof rawV !== "object" || rawV === null) return fail(`${at}[${i}]`, "Not an object.");
      const v = rawV as Record<string, unknown>;
      if (typeof v.id !== "string" || v.id === "") return fail(`${at}[${i}].id`, "Missing id.");
      if (typeof v.label !== "string" || v.label === "")
        return fail(`${at}[${i}].label`, "Missing label.");
      if (seen.has(v.id)) return fail(`${at}[${i}].id`, `Duplicate view id "${v.id}".`);
      seen.add(v.id);

      const layoutKind = v.layout === "stack" ? "stack" : "grid";
      if (!Array.isArray(v.components))
        return fail(`${at}[${i}].components`, "Not an array.");

      const components: ViewComponent[] = [];
      v.components.forEach((rawC, j) => {
          const at2 = `${at}[${i}].components[${j}]`;
          if (typeof rawC !== "object" || rawC === null) return fail(at2, "Not an object.");
          const c = rawC as Record<string, unknown>;
          const id = typeof c.id === "string" && c.id !== "" ? c.id : `${v.id}-${j}`;
          const label = typeof c.label === "string" ? c.label : "";

          switch (c.type) {
            case "metric": {
              if (typeof c.valueId !== "string" || !valueIds(c.valueId))
                return fail(`${at2}.valueId`, `Unknown account or formula id "${String(c.valueId)}".`);
              components.push({ id, type: "metric", label: label || c.valueId, valueId: c.valueId });
              return;
            }
            case "chart": {
              if (!Array.isArray(c.series) || c.series.length === 0)
                return fail(`${at2}.series`, "A chart needs at least one series.");
              const series: { id: string; label?: string; kind?: "bar" | "line" }[] = [];
              for (const rawS of c.series) {
                const s = (typeof rawS === "string" ? { id: rawS } : rawS) as Record<string, unknown>;
                if (typeof s?.id !== "string" || !valueIds(s.id))
                  return fail(`${at2}.series`, `Unknown account or formula id "${String(s?.id)}".`);
                series.push({
                  id: s.id,
                  ...(typeof s.label === "string" ? { label: s.label } : {}),
                  ...(s.kind === "line" || s.kind === "bar" ? { kind: s.kind } : {}),
                });
              }
              components.push({ id, type: "chart", label: label || "Chart", series });
              return;
            }
            case "table": {
              if (typeof c.source !== "string" || !surface.detailKinds.has(c.source))
                return fail(`${at2}.source`, `Unknown table source "${String(c.source)}".`);
              components.push({ id, type: "table", label: label || c.source, source: c.source });
              return;
            }
            case "text": {
              if (typeof c.body !== "string" || c.body === "")
                return fail(`${at2}.body`, "A text block needs a body.");
              components.push({ id, type: "text", ...(label ? { label } : {}), body: c.body });
              return;
            }
            case "actions": {
              if (!Array.isArray(c.buttons) || c.buttons.length === 0)
                return fail(`${at2}.buttons`, "An actions block needs at least one button.");
              const buttons: string[] = [];
              for (const b of c.buttons) {
                if (typeof b !== "string" || !surface.actionIds.has(b))
                  return fail(`${at2}.buttons`, `Unknown action "${String(b)}".`);
                buttons.push(b);
              }
              components.push({ id, type: "actions", ...(label ? { label } : {}), buttons });
              return;
            }
            default:
              return fail(`${at2}.type`, `Unknown component type "${String(c.type)}".`);
          }
        });

      collected.push({ id: v.id, label: v.label, layout: layoutKind, components });
    });

    return collected;
  };

  let views: CustomView[] | undefined;
  if (doc.views !== undefined) {
    const collected = validateViewList(doc.views, "views");
    if (collected) views = collected;
  }

  /*
    `views` and `viewsPatch` together are refused rather than merged. They express the same
    intent two ways, and any merge order is a rule nobody asked for that someone would later
    have to reverse-engineer from behaviour.
  */
  let viewsPatch: { upsert?: CustomView[]; remove?: string[] } | undefined;
  if (doc.viewsPatch !== undefined) {
    if (doc.views !== undefined) {
      fail("viewsPatch", "Send `views` or `viewsPatch`, never both — they express the same intent two ways.");
    } else if (typeof doc.viewsPatch !== "object" || doc.viewsPatch === null) {
      fail("viewsPatch", "Not an object.");
    } else {
      const patch = doc.viewsPatch as Record<string, unknown>;
      const upsert = patch.upsert === undefined ? undefined : validateViewList(patch.upsert, "viewsPatch.upsert");
      let remove: string[] | undefined;
      if (patch.remove !== undefined) {
        if (!Array.isArray(patch.remove)) fail("viewsPatch.remove", "Not an array.");
        else if (patch.remove.some((r) => typeof r !== "string"))
          fail("viewsPatch.remove", "Every entry must be a view id string.");
        else remove = patch.remove as string[];
      }
      if (upsert === undefined && remove === undefined) {
        fail("viewsPatch", "Needs `upsert`, `remove`, or both.");
      } else {
        viewsPatch = { ...(upsert ? { upsert } : {}), ...(remove ? { remove } : {}) };
      }
    }
  }

  /*
    Account display labels. The id must already exist — this renames what is on screen, it
    never brings an account into being, and the figure behind the label is still resolved by
    that closed id.
  */
  let accountLabels: AccountLabelOverride[] | undefined;
  if (doc.accountLabels !== undefined) {
    if (!Array.isArray(doc.accountLabels)) {
      fail("accountLabels", "Not an array.");
    } else {
      const collected: AccountLabelOverride[] = [];
      doc.accountLabels.forEach((raw, i) => {
        if (typeof raw !== "object" || raw === null) return fail(`accountLabels[${i}]`, "Not an object.");
        const a = raw as Record<string, unknown>;
        if (typeof a.id !== "string" || !surface.accountIds.has(a.id))
          return fail(`accountLabels[${i}].id`, `Unknown account id "${String(a.id)}".`);
        if (typeof a.label !== "string" && typeof a.description !== "string")
          return fail(`accountLabels[${i}]`, "Needs a `label` or a `description` to change.");
        collected.push({
          id: a.id,
          ...(typeof a.label === "string" ? { label: a.label } : {}),
          ...(typeof a.description === "string" ? { description: a.description } : {}),
        });
      });
      accountLabels = collected;
    }
  }

  if (errors.length > 0) return { blueprint: null, errors };

  return {
    blueprint: {
      schemaVersion: BLUEPRINT_SCHEMA_VERSION,
      name: doc.name as string,
      ...(typeof doc.description === "string" ? { description: doc.description } : {}),
      exportedAt: typeof doc.exportedAt === "string" ? doc.exportedAt : new Date().toISOString(),
      formulas: validFormulas,
      mappings: validMappings,
      prompts: validPrompts,
      ...(layout ? { layout } : {}),
      ...(views ? { views } : {}),
      ...(viewsPatch ? { viewsPatch } : {}),
      ...(accountLabels ? { accountLabels } : {}),
      ...arrangements,
    },
    errors: [],
  };
}

/* -------------------------------------------------------------------- diff */

export type ChangeKind = "add" | "modify" | "remove" | "unchanged";

export interface BlueprintChange {
  section:
    | "formulas" | "mappings" | "prompts" | "layout" | "views"
    | "dashboard" | "clientsTable" | "landingTiles" | "accountLabels";
  key: string;
  kind: ChangeKind;
  before?: unknown;
  after?: unknown;
}

/**
 * What a blueprint would change against the current live configuration.
 *
 * This is what the chat panel shows before a proposal is activated, and what
 * `blueprint_proposals.diff` stores — the record CLAUDE.md's docs protocol and ADR-004
 * require ("where did that number come from" must always be answerable) extended to
 * configuration: where did this FORMULA come from, and what did it replace.
 */
export function diffBlueprint(
  proposed: AviloBlueprint,
  current: {
    formulas: FormulaOverride[];
    mappings: LabelMappingEntry[];
    prompts: PromptOverride[];
    layout?: LayoutOverride;
    views?: CustomView[];
    dashboard?: ArrangementOverride;
    clientsTable?: ArrangementOverride;
    landingTiles?: ArrangementOverride;
    accountLabels?: AccountLabelOverride[];
  },
): BlueprintChange[] {
  const changes: BlueprintChange[] = [];

  const byId = <T extends { id?: string; key?: string; reportType?: string; rawLabel?: string }>(
    list: T[],
    keyOf: (item: T) => string,
  ) => new Map(list.map((item) => [keyOf(item), item]));

  /*
    Compare every field the author can set, not just the expression.

    Until the presentation fields existed this only ever compared `expression`, and once
    they did that omission became a silent no-op: "rename this metric" produced an empty
    diff, which `applyBlueprintDirectly` reports as `noChange` — the assistant correctly
    saying it changed nothing, about a change it was never given the chance to make. A
    field the grammar accepts and the diff ignores is worse than a field that does not
    exist. An omitted field means "leave alone", so only fields actually present count.
  */
  const formulaKey = (f: FormulaOverride) => f.id;
  const currentFormulas = byId(current.formulas, formulaKey);
  const formulaDiffers = (existing: FormulaOverride, f: FormulaOverride) => {
    if (existing.expression !== f.expression) return true;
    if (f.label !== undefined && existing.label !== f.label) return true;
    if (f.description !== undefined && existing.description !== f.description) return true;
    if (f.unit !== undefined && existing.unit !== f.unit) return true;
    if (f.sortOrder !== undefined && existing.sortOrder !== f.sortOrder) return true;
    if (f.active !== undefined && (existing.active ?? true) !== f.active) return true;
    if (f.benchmark !== undefined) {
      const a = f.benchmark === null ? null : f.benchmark;
      const b = existing.benchmark ?? null;
      if (JSON.stringify(a) !== JSON.stringify(b)) return true;
    }
    return false;
  };
  for (const f of proposed.formulas) {
    const existing = currentFormulas.get(f.id);
    if (!existing) changes.push({ section: "formulas", key: f.id, kind: "add", after: f });
    else if (formulaDiffers(existing, f))
      changes.push({ section: "formulas", key: f.id, kind: "modify", before: existing, after: f });
  }

  /*
    Account labels diff per account, for the same reason views do: "Renamed Total Income to
    Revenue" is checkable against what the user asked for, and "accountLabels changed" is not.
  */
  if (proposed.accountLabels) {
    const currentLabels = byId(current.accountLabels ?? [], (a) => a.id);
    for (const a of proposed.accountLabels) {
      const existing = currentLabels.get(a.id);
      const changedLabel = a.label !== undefined && existing?.label !== a.label;
      const changedDesc = a.description !== undefined && existing?.description !== a.description;
      if (!existing) changes.push({ section: "accountLabels", key: a.id, kind: "add", after: a });
      else if (changedLabel || changedDesc)
        changes.push({ section: "accountLabels", key: a.id, kind: "modify", before: existing, after: a });
    }
  }

  const mappingKey = (m: LabelMappingEntry) => `${m.reportType}|${m.rawLabel}`;
  const currentMappings = byId(current.mappings, mappingKey);
  for (const m of proposed.mappings) {
    const key = mappingKey(m);
    const existing = currentMappings.get(key);
    if (!existing) changes.push({ section: "mappings", key, kind: "add", after: m });
    else if (existing.accountId !== m.accountId)
      changes.push({ section: "mappings", key, kind: "modify", before: existing, after: m });
  }

  const currentPrompts = byId(current.prompts, (p) => p.key);
  for (const p of proposed.prompts) {
    const existing = currentPrompts.get(p.key);
    if (!existing) changes.push({ section: "prompts", key: p.key, kind: "add", after: p });
    else if (existing.body !== p.body)
      changes.push({ section: "prompts", key: p.key, kind: "modify", before: existing, after: p });
  }

  if (proposed.layout) {
    const same = JSON.stringify(proposed.layout) === JSON.stringify(current.layout ?? {});
    if (!same) {
      changes.push({
        section: "layout",
        key: "layout",
        kind: current.layout ? "modify" : "add",
        ...(current.layout ? { before: current.layout } : {}),
        after: proposed.layout,
      });
    }
  }

  /*
    Views diff per view, not as one blob. A blueprint that carries three views and changes
    one must report one change — "Added view Overdue invoices" — rather than "views
    changed", or the panel is back to the unreadable `modify layout: layout` that let
    BUG-031 through unnoticed. A view present now and absent from the proposal is a
    removal, which is how the assistant deletes a view it built.
  */
  if (proposed.views) {
    const currentViews = byId(current.views ?? [], (v) => v.id);
    const proposedIds = new Set(proposed.views.map((v) => v.id));

    for (const v of proposed.views) {
      const existing = currentViews.get(v.id);
      if (!existing) changes.push({ section: "views", key: v.id, kind: "add", after: v });
      else if (JSON.stringify(existing) !== JSON.stringify(v))
        changes.push({ section: "views", key: v.id, kind: "modify", before: existing, after: v });
    }
    for (const v of current.views ?? []) {
      if (!proposedIds.has(v.id))
        changes.push({ section: "views", key: v.id, kind: "remove", before: v });
    }
  }

  for (const field of ["dashboard", "clientsTable", "landingTiles"] as const) {
    const next = proposed[field];
    if (!next) continue;
    const before = current[field];
    if (JSON.stringify(next) === JSON.stringify(before ?? {})) continue;
    changes.push({
      section: field,
      key: field,
      kind: before ? "modify" : "add",
      ...(before ? { before } : {}),
      after: next,
    });
  }

  return changes;
}
