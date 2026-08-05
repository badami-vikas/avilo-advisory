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
  type RegisteredSurface,
} from "@avilo/core";
import {
  CANONICAL_ACCOUNTS,
  normalizeLabel,
  REPORT_TYPES,
  SEED_FORMULAS,
} from "@avilo/module";
import { getDb, newId, schema } from "../db.js";
import { readSetting } from "./ai.js";
import { learnMapping } from "./labels.js";

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

export function registeredSurface(): RegisteredSurface {
  const db = getDb();
  const formulaIds = db.select({ id: schema.formulas.id }).from(schema.formulas).all();
  return {
    accountIds: new Set(CANONICAL_ACCOUNTS.map((a) => a.id)),
    formulaIds: new Set([...formulaIds.map((f) => f.id), ...SEED_FORMULAS.map((f) => f.id)]),
    reportTypes: new Set(REPORT_TYPES),
    promptKeys: new Set(PROMPT_KEYS),
    sectionIds: new Set(LAYOUT_SECTION_IDS),
  };
}

/** The current live configuration, in the same shape a blueprint carries. */
export function currentConfiguration(): {
  formulas: AviloBlueprint["formulas"];
  mappings: AviloBlueprint["mappings"];
  prompts: AviloBlueprint["prompts"];
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
  return { formulas, mappings, prompts };
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
    if (!existing || existing.expression === formula.expression) continue;
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

  db.update(schema.blueprintProposals)
    .set({ status: "active", decidedAt: new Date().toISOString(), decisionNote: note ?? null })
    .where(eq(schema.blueprintProposals.id, id))
    .run();

  return rowToRecord(db.select().from(schema.blueprintProposals).where(eq(schema.blueprintProposals.id, id)).get()!);
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
