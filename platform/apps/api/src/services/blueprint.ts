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
import type { ArrangementOverride, LayoutOverride } from "@avilo/core";
import { getDb, newId, schema } from "../db.js";
import { learnMapping } from "./labels.js";
import { loadFormulaSpecs } from "./formula-specs.js";
import {
  CLIENTS_COLUMN_IDS,
  CLIENTS_TABLE_KEY,
  CUSTOM_VIEWS_KEY,
  DASHBOARD_LAYOUT_KEY,
  DASHBOARD_SECTION_IDS,
  DEFAULT_HIDDEN_CLIENTS_COLUMNS,
  DEFAULT_LANDING_TILES,
  LANDING_TILES_KEY,
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
  CLIENTS_COLUMN_IDS,
  CLIENTS_TABLE_KEY,
  DEFAULT_HIDDEN_CLIENTS_COLUMNS,
  DEFAULT_LANDING_TILES,
  CUSTOM_VIEWS_KEY,
  DASHBOARD_LAYOUT_KEY,
  DASHBOARD_SECTION_IDS,
  DETAIL_KINDS,
  LANDING_TILES_KEY,
  LANDING_TILE_IDS,
  LAYOUT_SECTION_IDS,
  PROMPT_KEYS,
  REPORT_LAYOUT_DEFAULT_KEY,
  VIEW_ACTIONS,
  currentConfiguration,
  exportBlueprint,
  registeredSurface,
} from "./configuration.js";

/**
 * A change, in words a person can check against what they asked for.
 *
 * BUG-031 is the reason this exists rather than `${kind} ${section}: ${key}`. When the
 * assistant hid a report section in response to a request about a button, the panel
 * described it as "modify layout: layout" — technically accurate, and completely useless
 * for noticing that something unrelated had just happened to the report. A change the user
 * cannot read is a change the user cannot catch.
 */
export function describeBlueprintChange(change: BlueprintChange): string {
  if (change.section === "layout") {
    const before = (change.before ?? {}) as LayoutOverride;
    const after = (change.after ?? {}) as LayoutOverride;
    const wasHidden = new Set(before.hiddenSections ?? []);
    const nowHidden = new Set(after.hiddenSections ?? []);
    const hid = [...nowHidden].filter((s) => !wasHidden.has(s));
    const shown = [...wasHidden].filter((s) => !nowHidden.has(s));

    const parts: string[] = [];
    if (hid.length > 0) parts.push(`hid ${hid.join(", ")}`);
    if (shown.length > 0) parts.push(`un-hid ${shown.join(", ")}`);

    const orderChanged =
      JSON.stringify(before.sectionOrder ?? []) !== JSON.stringify(after.sectionOrder ?? []);
    // Reordering is implied by hiding, so only call it out when it is the actual change.
    if (orderChanged && parts.length === 0) parts.push("reordered the sections");

    return `Report layout — ${parts.length > 0 ? parts.join("; ") : "changed"}`;
  }

  /*
    The three arrangement levers describe themselves the same way the report layout does,
    for the same reason: "modify dashboard: dashboard" is unreadable, and an unreadable
    change is one nobody catches.
  */
  const ARRANGEMENT_NOUNS = {
    dashboard: ["Dashboard", "panel"],
    clientsTable: ["Clients list", "column"],
    landingTiles: ["Portfolio tiles", "tile"],
  } as const;

  if (change.section in ARRANGEMENT_NOUNS) {
    const [surface, noun] = ARRANGEMENT_NOUNS[change.section as keyof typeof ARRANGEMENT_NOUNS];
    const before = (change.before ?? {}) as ArrangementOverride;
    const after = (change.after ?? {}) as ArrangementOverride;
    const wasHidden = new Set(before.hidden ?? []);
    const nowHidden = new Set(after.hidden ?? []);
    const hid = [...nowHidden].filter((s) => !wasHidden.has(s));
    const shown = [...wasHidden].filter((s) => !nowHidden.has(s));

    const parts: string[] = [];
    if (hid.length > 0) parts.push(`hid ${hid.join(", ")}`);
    if (shown.length > 0) parts.push(`showed ${shown.join(", ")}`);
    if (
      JSON.stringify(before.order ?? []) !== JSON.stringify(after.order ?? []) &&
      parts.length === 0
    ) {
      parts.push(`reordered the ${noun}s`);
    }

    return `${surface} — ${parts.length > 0 ? parts.join("; ") : "changed"}`;
  }

  if (change.section === "formulas") {
    const after = change.after as { expression?: string } | undefined;
    const before = change.before as { expression?: string } | undefined;
    if (change.kind === "add") return `Formula ${change.key} added: ${after?.expression ?? ""}`;
    return `Formula ${change.key}: ${before?.expression ?? "?"} → ${after?.expression ?? "?"}`;
  }

  if (change.section === "views") {
    const after = change.after as { label?: string; components?: unknown[] } | undefined;
    const before = change.before as { label?: string } | undefined;
    if (change.kind === "remove") return `Removed view "${before?.label ?? change.key}"`;
    const count = after?.components?.length ?? 0;
    const verb = change.kind === "add" ? "Added" : "Updated";
    return `${verb} view "${after?.label ?? change.key}" (${count} component${count === 1 ? "" : "s"})`;
  }

  if (change.section === "mappings") {
    const after = change.after as { accountId?: string } | undefined;
    return `Mapping ${change.key} → ${after?.accountId ?? "?"}`;
  }

  return `Prompt ${change.key} rewritten`;
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

  // The three arrangement levers follow the same "absent means leave alone" rule.
  for (const [field, key] of [
    ["dashboard", DASHBOARD_LAYOUT_KEY],
    ["clientsTable", CLIENTS_TABLE_KEY],
    ["landingTiles", LANDING_TILES_KEY],
  ] as const) {
    const arrangement = blueprint[field];
    if (!arrangement) continue;
    const value = JSON.stringify(arrangement);
    db.insert(schema.appSettings)
      .values({ key, value })
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
    dashboard: liveNow.dashboard ?? { order: [...DASHBOARD_SECTION_IDS], hidden: [] },
    clientsTable: liveNow.clientsTable ?? {
      order: [...CLIENTS_COLUMN_IDS],
      hidden: [...DEFAULT_HIDDEN_CLIENTS_COLUMNS],
    },
    landingTiles: liveNow.landingTiles ?? { order: [...DEFAULT_LANDING_TILES], hidden: [] },
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
export type BlueprintSection = BlueprintChange["section"];

export function applyBlueprintDirectly(
  author: string,
  summary: string,
  candidate: unknown,
  /**
   * The levers the author SAID it was changing. When supplied, a diff touching anything
   * outside this set is refused whole — see the `outOfScope` guard below.
   */
  declared?: readonly BlueprintSection[],
):
  | { proposal: ProposalRecord; revertId: string }
  | { noChange: true }
  | { outOfScope: { declared: BlueprintSection[]; undeclared: BlueprintSection[]; changes: string[] } }
  | { errors: { path: string; message: string }[] } {
  /*
    An empty `views` array from a MODEL means "I had nothing to say about views", not
    "delete every view the user built" — BUG-042.

    `views` replaces the whole set (ADR-039), which makes it the one section where `[]` is
    destructive while everywhere else an empty array is the natural way to write "no entries
    here". A model composing a document pads it with empty sections, and that padding wiped
    three of the user's views on a request about the summary's wording. `declares` could not
    catch it: the author had declared `views`. It was padding, not intent, and nothing
    downstream can tell those apart after the fact.

    Scoped to this function deliberately, NOT to the grammar. A snapshot writes `views: []`
    to mean "there genuinely were none", which is how Undo removes a view it just created —
    putting this rule in `validateBlueprint` broke exactly that, and the test for it caught
    the mistake. This is the model-authored entry point; the snapshot and restore paths
    reach `activateProposal` directly and keep the faithful reading.

    The cost, stated exactly: the assistant cannot delete a user's LAST remaining view.
    Deleting one of several still works, because that list is non-empty.
  */
  if (
    typeof candidate === "object" &&
    candidate !== null &&
    Array.isArray((candidate as { views?: unknown }).views) &&
    (candidate as { views: unknown[] }).views.length === 0
  ) {
    const { views: _dropped, ...rest } = candidate as Record<string, unknown>;
    candidate = rest;
  }

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
  const diff = diffBlueprint(blueprint, currentConfiguration());
  if (diff.length === 0) return { noChange: true };

  /*
    Hold the author to what it said it was doing.

    BUG-031 and BUG-033 are the same failure twice: a request about a formula arrived as a
    document that ALSO rewrote the report layout, silently un-hiding a section the user had
    deliberately hidden. The model composes a whole blueprint, includes keys it has no reason
    to touch, and gets them wrong. The prompt has said "omit what you are not changing" since
    v1.9.3 and a small model does not reliably comply — so this stops being a prompting
    problem and becomes a check.

    The declaration is the author's own statement of intent, made before the diff is known.
    Refusing the whole document rather than filtering the stray entries is deliberate: a
    partly-applied change is exactly the state the propose/activate split exists to prevent,
    and the author can resubmit having either narrowed the document or widened the
    declaration honestly.
  */
  if (declared) {
    const allowed = new Set<BlueprintSection>(declared);
    const undeclared = [...new Set(diff.map((c) => c.section))].filter((s) => !allowed.has(s));
    if (undeclared.length > 0) {
      return {
        outOfScope: {
          declared: [...allowed],
          undeclared,
          changes: diff.filter((c) => undeclared.includes(c.section)).map(describeBlueprintChange),
        },
      };
    }
  }

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
