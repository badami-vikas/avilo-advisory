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
    if (!surface.formulaIds.has(f.id)) {
      fail(`formulas[${i}].id`, `Unknown formula id "${f.id}".`);
      return;
    }
    validFormulas.push({
      id: f.id,
      expression: f.expression,
      ...(typeof f.label === "string" ? { label: f.label } : {}),
      ...(typeof f.description === "string" ? { description: f.description } : {}),
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
    },
    errors: [],
  };
}

/* -------------------------------------------------------------------- diff */

export type ChangeKind = "add" | "modify" | "remove" | "unchanged";

export interface BlueprintChange {
  section: "formulas" | "mappings" | "prompts" | "layout";
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
  },
): BlueprintChange[] {
  const changes: BlueprintChange[] = [];

  const byId = <T extends { id?: string; key?: string; reportType?: string; rawLabel?: string }>(
    list: T[],
    keyOf: (item: T) => string,
  ) => new Map(list.map((item) => [keyOf(item), item]));

  const formulaKey = (f: FormulaOverride) => f.id;
  const currentFormulas = byId(current.formulas, formulaKey);
  for (const f of proposed.formulas) {
    const existing = currentFormulas.get(f.id);
    if (!existing) changes.push({ section: "formulas", key: f.id, kind: "add", after: f });
    else if (existing.expression !== f.expression)
      changes.push({ section: "formulas", key: f.id, kind: "modify", before: existing, after: f });
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

  return changes;
}
