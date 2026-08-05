// Read the live configuration into an AviloBlueprint, and apply an activated one.
//
// This is the boundary between "database rows" and "the portable document a chatbot
// proposes and someone else's copy of the app can import" (per @avilo/core/blueprint —
// see that file for why the document may hold configuration and never source or a key).

import { eq } from "drizzle-orm";
import {
  diffBlueprint,
  validateBlueprint,
  type AviloBlueprint,
  type BlueprintChange,
  type CustomView,
  type LayoutOverride,
  type RegisteredSurface,
} from "@avilo/core";
import {
  CANONICAL_ACCOUNTS,
  normalizeLabel,
  REPORT_TYPES,
  SEED_FORMULAS,
  TRAILING,
  extractDependencies,
} from "@avilo/module";
import { getDb, newId, schema } from "../db.js";
import { readSetting } from "./ai.js";
import { learnMapping } from "./labels.js";
import { loadFormulaSpecs } from "./report.js";

/** The two prompts actually read at runtime (see suggest.ts / narrative.ts / router.ts). */
export const PROMPT_KEYS = ["accounting_guidance", "narrative_guidance"] as const;

/**
 * Section ids the report layout understands, mirrored from `apps/web/src/app/report/layout.ts`.
 *
 * Not imported from there: the web package pulls in React and Vite-only assets, and this
 * file runs in apps/api. Kept as a flat list rather than re-exported from a shared
 * package because it changes rarely and the cost of drift is a rejected blueprint, not a
 * silently wrong one — `validateBlueprint` refuses an id outside this list.
 */
export const LAYOUT_SECTION_IDS = [
  "key-insights", "revenue-trend", "top-expenses", "at-a-glance", "profitability",
  "cash-position", "ar-customers", "ap-vendors", "ar-ap-timing", "service-lines",
  "top-jobs", "job-performance", "referrals", "gross-overhead", "top-customers", "flags",
] as const;

/**
 * Where a blueprint's `layout` lands: the report format panel's own DEFAULT, not any
 * client's saved layout. `ClientDetailPage.loadLayout` reads this only when a client has
 * no `report.layout` saved_views row of its own — a per-client edit always wins, matching
 * `normalizeLayout`'s existing "stored beats default" rule. Stored in the same
 * `sectionOrder`/`hiddenSections` shape the blueprint carries; the web layer's own
 * `normalizeLayout` fills in whatever sections a partial order omits.
 */
export const REPORT_LAYOUT_DEFAULT_KEY = "report_layout_default";

/** Where user-defined views live — one JSON array, same `app_settings` path as the layout default. */
export const CUSTOM_VIEWS_KEY = "custom_views";

/**
 * Detail sets a generated `table` may bind to, mirrored from `report.detail`'s own keys
 * (see `ReportView.tsx`, which reads exactly these). A table names one of these; it never
 * carries rows, so the figures in a generated table are the imported ones.
 */
export const DETAIL_KINDS = [
  "pl_income", "pl_expense", "ar_customer", "ap_vendor", "customer_sales", "referral_partner",
] as const;

/**
 * Actions a generated button may invoke.
 *
 * Closed on purpose, and small on purpose: every entry maps to something the application
 * already does and already tests. This is the answer to "can the assistant add a button" —
 * it can place one, from this list. It cannot invent an action, because a button is a
 * binding to a handler that exists, not a piece of behaviour the model authors.
 */
export const VIEW_ACTIONS = [
  "export-pdf", "upload", "open-report", "open-raw-data", "open-dashboard", "open-standard",
] as const;

export function registeredSurface(): RegisteredSurface {
  const db = getDb();
  const formulaIds = db.select({ id: schema.formulas.id }).from(schema.formulas).all();
  return {
    accountIds: new Set(CANONICAL_ACCOUNTS.map((a) => a.id)),
    formulaIds: new Set([...formulaIds.map((f) => f.id), ...SEED_FORMULAS.map((f) => f.id)]),
    reportTypes: new Set(REPORT_TYPES),
    promptKeys: new Set(PROMPT_KEYS),
    sectionIds: new Set(LAYOUT_SECTION_IDS),
    detailKinds: new Set(DETAIL_KINDS),
    actionIds: new Set(VIEW_ACTIONS),
  };
}

/** The current live configuration, in the same shape a blueprint carries. */
export function currentConfiguration(): {
  formulas: AviloBlueprint["formulas"];
  mappings: AviloBlueprint["mappings"];
  prompts: AviloBlueprint["prompts"];
  layout?: LayoutOverride;
  views?: CustomView[];
} {
  const db = getDb();
  const formulas = db.select().from(schema.formulas).all().map((f) => ({
    id: f.id,
    expression: f.expression,
    label: f.label,
    ...(f.description ? { description: f.description } : {}),
  }));
  const mappings = db.select().from(schema.labelMappings).all().map((m) => ({
    reportType: m.reportType,
    rawLabel: m.rawLabel,
    accountId: m.accountId,
  }));
  const prompts = PROMPT_KEYS.map((key) => ({ key, body: readSetting(key) ?? "" })).filter(
    (p) => p.body !== "",
  );
  const storedLayout = readSetting(REPORT_LAYOUT_DEFAULT_KEY);
  let layout: LayoutOverride | undefined;
  if (storedLayout) {
    try {
      layout = JSON.parse(storedLayout) as LayoutOverride;
    } catch {
      // A corrupt stored value must not block export or diffing — treat as unset.
    }
  }
  const storedViews = readSetting(CUSTOM_VIEWS_KEY);
  let views: CustomView[] | undefined;
  if (storedViews) {
    try {
      views = JSON.parse(storedViews) as CustomView[];
    } catch {
      // Same rule as the layout above — a corrupt row must not block export or diffing.
    }
  }

  return {
    formulas,
    mappings,
    prompts,
    ...(layout ? { layout } : {}),
    ...(views ? { views } : {}),
  };
}

/** The full current configuration as an exportable blueprint. */
export function exportBlueprint(name: string, description?: string): AviloBlueprint {
  const config = currentConfiguration();
  return {
    schemaVersion: 1,
    name,
    ...(description ? { description } : {}),
    exportedAt: new Date().toISOString(),
    ...config,
  };
}

export interface ProposalRecord {
  id: string;
  author: string;
  summary: string;
  blueprint: AviloBlueprint;
  diff: BlueprintChange[];
  status: "proposed" | "active" | "rejected";
  createdAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
}

function rowToRecord(row: typeof schema.blueprintProposals.$inferSelect): ProposalRecord {
  return {
    id: row.id,
    author: row.author,
    summary: row.summary,
    blueprint: JSON.parse(row.blueprint) as AviloBlueprint,
    diff: JSON.parse(row.diff) as BlueprintChange[],
    status: row.status as ProposalRecord["status"],
    createdAt: row.createdAt,
    decidedAt: row.decidedAt,
    decisionNote: row.decisionNote,
  };
}

/**
 * Validate a candidate document, diff it against the live configuration, and record it as
 * a proposal. Nothing is applied here — this is the "propose" half of propose/activate.
 */
export function proposeBlueprint(
  author: string,
  summary: string,
  candidate: unknown,
): { proposal: ProposalRecord } | { errors: { path: string; message: string }[] } {
  const { blueprint, errors } = validateBlueprint(candidate, registeredSurface());
  if (!blueprint) return { errors };

  const diff = diffBlueprint(blueprint, currentConfiguration());
  const db = getDb();
  const id = newId("bp");
  db.insert(schema.blueprintProposals)
    .values({
      id,
      author,
      summary,
      blueprint: JSON.stringify(blueprint),
      diff: JSON.stringify(diff),
      status: "proposed",
    })
    .run();

  return { proposal: rowToRecord(db.select().from(schema.blueprintProposals).where(eq(schema.blueprintProposals.id, id)).get()!) };
}

export function listProposals(): ProposalRecord[] {
  const db = getDb();
  return db
    .select()
    .from(schema.blueprintProposals)
    .orderBy(schema.blueprintProposals.createdAt)
    .all()
    .reverse()
    .map(rowToRecord);
}

/**
 * Apply an activated proposal's blueprint to the live configuration.
 *
 * Formula changes go through a fresh `formula_versions` row rather than an in-place
 * overwrite, matching ADR-031/ADR-003's rule that a definition change is a data edit with
 * history, never a silent replace. Mapping changes go through `learnMapping`, the same
 * function a manual correction uses (ADR-002), so an activated blueprint mapping is
 * indistinguishable in the audit trail from one a person typed by hand. Prompt changes
 * write to `app_settings`, the one existing runtime-override path (ADR-013).
 */
export function activateProposal(id: string, note?: string): ProposalRecord {
  const db = getDb();
  const row = db.select().from(schema.blueprintProposals).where(eq(schema.blueprintProposals.id, id)).get();
  if (!row) throw new Error(`No proposal with id ${id}`);
  if (row.status !== "proposed") throw new Error(`Proposal ${id} is already ${row.status}`);

  const blueprint = JSON.parse(row.blueprint) as AviloBlueprint;

  for (const formula of blueprint.formulas) {
    const existing = db.select().from(schema.formulas).where(eq(schema.formulas.id, formula.id)).get();

    /*
      A formula id with no row is a NEW metric, and it is created here.

      This branch did not exist until v1.9.4, which meant "add a formula" was silently a
      no-op: the loop skipped anything without an existing row, so a blueprint that added a
      metric activated cleanly and changed nothing. `registeredSurface().formulaIds` unions
      the database with `SEED_FORMULAS`, so validation passed and the write never happened.
    */
    if (!existing) {
      const maxOrder = db.select().from(schema.formulas).all()
        .reduce((max, f) => Math.max(max, f.sortOrder ?? 0), 0);
      db.insert(schema.formulas)
        .values({
          id: formula.id,
          label: formula.label ?? formula.id,
          expression: formula.expression,
          unit: "currency",
          ...(formula.description ? { description: formula.description } : {}),
          sortOrder: maxOrder + 10,
          version: 1,
          active: true,
        })
        .run();
      db.insert(schema.formulaVersions)
        .values({
          id: `${formula.id}@1`,
          formulaId: formula.id,
          version: 1,
          expression: formula.expression,
          author: `blueprint:${row.author}`,
          note: `Created by proposal ${id}: ${row.summary}`,
        })
        .run();
      continue;
    }

    if (existing.expression === formula.expression) continue;
    const nextVersion = existing.version + 1;
    db.update(schema.formulas)
      .set({
        expression: formula.expression,
        version: nextVersion,
        ...(formula.label ? { label: formula.label } : {}),
        ...(formula.description ? { description: formula.description } : {}),
      })
      .where(eq(schema.formulas.id, formula.id))
      .run();
    db.insert(schema.formulaVersions)
      .values({
        id: `${formula.id}@${nextVersion}`,
        formulaId: formula.id,
        version: nextVersion,
        expression: formula.expression,
        author: `blueprint:${row.author}`,
        note: `From proposal ${id}: ${row.summary}`,
      })
      .run();
  }

  for (const mapping of blueprint.mappings) {
    learnMapping({
      clientId: null,
      reportType: mapping.reportType as never,
      normalizedLabel: normalizeLabel(mapping.rawLabel),
      rawLabel: mapping.rawLabel,
      accountId: mapping.accountId,
    });
  }

  for (const prompt of blueprint.prompts) {
    db.insert(schema.appSettings)
      .values({ key: prompt.key, value: prompt.body })
      .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: prompt.body } })
      .run();
  }

  if (blueprint.layout) {
    const value = JSON.stringify(blueprint.layout);
    db.insert(schema.appSettings)
      .values({ key: REPORT_LAYOUT_DEFAULT_KEY, value })
      .onConflictDoUpdate({ target: schema.appSettings.key, set: { value } })
      .run();
  }

  /*
    Views are written whole, not merged. The blueprint's `views` IS the set of views after
    activation, which is what makes removal expressible at all — a view the document omits
    is gone. Absent entirely (the common case for a formula-only change) means "leave views
    alone", the same rule ADR-039 established for layout.
  */
  if (blueprint.views) {
    const value = JSON.stringify(blueprint.views);
    db.insert(schema.appSettings)
      .values({ key: CUSTOM_VIEWS_KEY, value })
      .onConflictDoUpdate({ target: schema.appSettings.key, set: { value } })
      .run();
  }

  db.update(schema.blueprintProposals)
    .set({ status: "active", decidedAt: new Date().toISOString(), decisionNote: note ?? null })
    .where(eq(schema.blueprintProposals.id, id))
    .run();

  return rowToRecord(db.select().from(schema.blueprintProposals).where(eq(schema.blueprintProposals.id, id)).get()!);
}

/**
 * Validate, record, and apply in one step — the assistant acting rather than recommending.
 *
 * Every guard that governed propose/activate still runs: `validateBlueprint` refuses an id
 * outside the live registry, so a hallucinated formula or account is rejected outright and
 * nothing is written. What changes is only who presses the button. Formula edits still open
 * a new `formula_versions` row and mappings still go through `learnMapping`, so the audit
 * trail is identical to a human activation, just with `author: "assistant"`.
 *
 * Reversibility replaces the pre-approval: the configuration as it stood a moment before is
 * captured as its own `proposed` blueprint first, and its id comes back as `revertId`, so
 * "undo that" is one activation away. The one thing an undo does not take back is a newly
 * learned label mapping — `learnMapping` upserts and the snapshot only carries the mappings
 * that existed, so a mapping the assistant added survives the revert and has to be corrected
 * in the mapping UI like any other. Formulas, prompts and layout revert exactly.
 */
export function applyBlueprintDirectly(
  author: string,
  summary: string,
  candidate: unknown,
):
  | { proposal: ProposalRecord; revertId: string }
  | { noChange: true }
  | { errors: { path: string; message: string }[] } {
  const { blueprint, errors } = validateBlueprint(candidate, registeredSurface());
  if (!blueprint) return { errors };

  /*
    Compile every NEWLY CREATED formula before anything is written.

    `validateBlueprint` lets an unknown formula id through, because creating a metric is a
    legitimate request and there is no other way to express it. This is where a created
    formula earns its place: the expression must parse, and every id it references must be a
    real account, a real formula, or a trailing window over one. Without it, "add a metric
    for the overdue ratio" could write a row whose body names a figure that does not exist,
    surfacing later as a broken tile on someone's report.

    Deliberately scoped to creations. An EDIT to an existing formula keeps whatever the
    formulas router already allows — re-checking those here would reject the seeded
    definitions that legitimately use `avgN.` windows, which `validateExpression` does not
    model.
  */
  const knownIds = new Set<string>([
    ...CANONICAL_ACCOUNTS.map((a) => a.id),
    ...loadFormulaSpecs().map((f) => f.id),
    ...blueprint.formulas.map((f) => f.id),
  ]);
  const resolvable = (dep: string) => {
    if (knownIds.has(dep)) return true;
    // `avg3.pl.revenue` is a trailing window over `pl.revenue` — real if its target is.
    const trailing = TRAILING.exec(dep);
    return trailing !== null && knownIds.has(trailing[2]!);
  };

  const db0 = getDb();
  const expressionErrors: { path: string; message: string }[] = [];
  blueprint.formulas.forEach((f, i) => {
    const exists = db0.select().from(schema.formulas).where(eq(schema.formulas.id, f.id)).get();
    if (exists) return;
    let deps: string[];
    try {
      deps = extractDependencies(f.expression);
    } catch (cause) {
      expressionErrors.push({ path: `formulas[${i}].expression`, message: (cause as Error).message });
      return;
    }
    const unknown = deps.filter((d) => !resolvable(d));
    if (unknown.length > 0) {
      expressionErrors.push({
        path: `formulas[${i}].expression`,
        message: `Unknown reference${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}`,
      });
    }
  });
  if (expressionErrors.length > 0) return { errors: expressionErrors };

  /*
    A document that matches the live configuration is not a change, and must not be
    reported as one. This is the guard for BUG-030: a model that has been told to act will
    sometimes emit a blueprint simply to have something to show, and an empty diff shown as
    "Change applied" teaches the user that the panel's claims mean nothing. Nothing is
    recorded either — not the snapshot, not the proposal.
  */
  if (diffBlueprint(blueprint, currentConfiguration()).length === 0) return { noChange: true };

  /*
    An absent `layout` in a blueprint means "leave layout alone", not "clear it" — so a
    snapshot of a configuration that had no layout override could never undo one being
    added. The snapshot spells the empty state out instead: the full default order with
    nothing hidden, which is behaviourally identical to unset.
  */
  const before = exportBlueprint(`Before: ${summary}`.slice(0, 120));
  const snapshot = proposeBlueprint("revert", `Configuration before: ${summary}`, {
    ...before,
    layout: before.layout ?? { sectionOrder: [...LAYOUT_SECTION_IDS], hiddenSections: [] },
    // Same reason as layout: an absent `views` means "leave alone", so undoing the creation
    // of the very first view needs the empty set said out loud.
    views: before.views ?? [],
  });
  if ("errors" in snapshot) return snapshot;

  const recorded = proposeBlueprint(author, summary, blueprint);
  if ("errors" in recorded) return recorded;

  return {
    proposal: activateProposal(recorded.proposal.id, "Applied by the assistant"),
    revertId: snapshot.proposal.id,
  };
}

export function rejectProposal(id: string, note?: string): ProposalRecord {
  const db = getDb();
  const row = db.select().from(schema.blueprintProposals).where(eq(schema.blueprintProposals.id, id)).get();
  if (!row) throw new Error(`No proposal with id ${id}`);
  if (row.status !== "proposed") throw new Error(`Proposal ${id} is already ${row.status}`);

  db.update(schema.blueprintProposals)
    .set({ status: "rejected", decidedAt: new Date().toISOString(), decisionNote: note ?? null })
    .where(eq(schema.blueprintProposals.id, id))
    .run();

  return rowToRecord(db.select().from(schema.blueprintProposals).where(eq(schema.blueprintProposals.id, id)).get()!);
}
