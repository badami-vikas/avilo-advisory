// Record, activate and revert configuration changes.
//
// This is the boundary between "database rows" and "the portable document a chatbot
// proposes and someone else's copy of the app can import" (per @avilo/core/blueprint —
// see that file for why the document may hold configuration and never source or a key).
//
// The registry and the current-state reader live in `configuration.ts`; everything here is
// about the transitions between states. `versions.ts` records the states themselves.

import { eq } from "drizzle-orm";
import {
  diffBlueprint,
  validateBlueprint,
  type AviloBlueprint,
  type BlueprintChange,
} from "@avilo/core";
import {
  CANONICAL_ACCOUNTS,
  normalizeLabel,
  TRAILING,
  extractDependencies,
} from "@avilo/module";
import { getDb, newId, schema } from "../db.js";
import { learnMapping } from "./labels.js";
import { loadFormulaSpecs } from "./formula-specs.js";
import {
  CUSTOM_VIEWS_KEY,
  LAYOUT_SECTION_IDS,
  REPORT_LAYOUT_DEFAULT_KEY,
  currentConfiguration,
  exportBlueprint,
  registeredSurface,
} from "./configuration.js";
import {
  ensureBaseline,
  getVersion,
  listVersions,
  normalizeVersionDocument,
  recordVersion,
  type VersionRecord,
} from "./versions.js";

/*
  Re-exported so every existing importer of these from `blueprint.js` keeps working. They
  are defined in `configuration.ts` because `versions.ts` needs them too, and a single file
  holding both the surface and the transitions made that a dependency cycle.
*/
export {
  CUSTOM_VIEWS_KEY,
  DETAIL_KINDS,
  LAYOUT_SECTION_IDS,
  PROMPT_KEYS,
  REPORT_LAYOUT_DEFAULT_KEY,
  VIEW_ACTIONS,
  currentConfiguration,
  exportBlueprint,
  registeredSurface,
} from "./configuration.js";

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
export function activateProposal(
  id: string,
  note?: string,
  version?: { author?: string; restoredFrom?: string },
): ProposalRecord {
  const db = getDb();
  const row = db.select().from(schema.blueprintProposals).where(eq(schema.blueprintProposals.id, id)).get();
  if (!row) throw new Error(`No proposal with id ${id}`);
  if (row.status !== "proposed") throw new Error(`Proposal ${id} is already ${row.status}`);

  /*
    Capture where we are BEFORE writing, so the first change on an installation upgraded
    from a build without history still has a state to go back to. No-op once history exists.
  */
  ensureBaseline();

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

  /*
    The single place a version is written. Every route into the live configuration — the
    assistant, a person activating an imported document, an external agent over MCP —
    passes through here, so none of them can change the configuration without leaving a
    state a restore can return to.
  */
  recordVersion({
    author: version?.author ?? row.author,
    summary: row.summary,
    proposalId: id,
    ...(version?.restoredFrom ? { restoredFrom: version.restoredFrom } : {}),
  });

  return rowToRecord(db.select().from(schema.blueprintProposals).where(eq(schema.blueprintProposals.id, id)).get()!);
}

/**
 * Put the configuration back into a state it has already been in.
 *
 * Goes through `proposeBlueprint` + `activateProposal` rather than writing rows directly,
 * so a restore is validated, diffed and audited on exactly the same path as any other
 * change — a formula it brings back opens a new `formula_versions` row like any edit, and
 * the restore itself becomes the newest version. The one asymmetry worth knowing: a label
 * mapping learned after the target version survives the restore, because `learnMapping`
 * upserts and the stored document only carries the mappings that existed. Same limitation
 * the assistant's Undo has always had.
 *
 * Returns `noChange` when the target state is the state you are already in, so a restore
 * that would do nothing writes nothing — the guard BUG-030 established for the assistant.
 */
export function restoreVersion(
  id: string,
  author: string,
): { version: VersionRecord } | { noChange: true } | { errors: { path: string; message: string }[] } {
  const target = getVersion(id);
  if (!target) throw new Error(`No configuration version with id ${id}`);

  const document = normalizeVersionDocument(target.blueprint);

  /*
    Compare like with like. A stored version always spells `layout` and `views` out, while
    `currentConfiguration()` omits them when nothing is stored — diffing one against the
    other reports a change every time, so "restore the state you are already in" would
    write a pointless version instead of reporting `noChange`. Normalize both sides.
  */
  const liveNow = currentConfiguration();
  const live = {
    ...liveNow,
    layout: liveNow.layout ?? { sectionOrder: [...LAYOUT_SECTION_IDS], hiddenSections: [] },
    views: liveNow.views ?? [],
  };
  if (diffBlueprint(document, live).length === 0) return { noChange: true };

  const recorded = proposeBlueprint(author, `Restored version ${target.seq} — ${target.summary}`, document);
  if ("errors" in recorded) return recorded;

  activateProposal(recorded.proposal.id, `Restore of version ${target.seq}`, {
    author,
    restoredFrom: target.id,
  });

  return { version: listVersions(1)[0]! };
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
