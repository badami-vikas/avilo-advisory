/**
 * Configuration history: every state this installation's configuration has been in.
 *
 * The distinction this module exists to draw is between a *proposal* and a *version*. A
 * proposal is a request someone made; a version is a state that was actually live. Before
 * this, only proposals were recorded, which meant "go back" could only mean "activate the
 * one snapshot row `applyBlueprintDirectly` happened to take just before the last assistant
 * action" — a single step, available only on that path, and unavailable entirely after a
 * human activated an imported document. `activateProposal` also refuses to run a second
 * time, so a state that had already been applied could never be returned to.
 *
 * Three rules govern what is written here:
 *
 * 1. **Every activation appends a version**, whoever caused it — the assistant, a person,
 *    or an external agent over MCP. One writer (`activateProposal`) so no path can apply a
 *    change without leaving a record of the state it produced.
 *
 * 2. **A version stores the whole configuration, normalized.** Not a delta. An absent key
 *    in a blueprint means "leave this alone" (ADR-039), so a state captured with `views`
 *    omitted could never be restored over a state that had views — restoring it would
 *    silently keep them. `normalize` spells out `layout` and `views` so a restore is exact.
 *
 * 3. **Restore is forward-only.** Returning to seq 3 appends a new version at the head; it
 *    does not truncate history to 3. Nothing is ever destroyed by using this, and an undo
 *    is itself undoable. That property is what makes it safe to let an external agent
 *    restore without a human in the loop (ADR-043): the worst case is another entry in a
 *    log a person can walk back.
 */
import { desc, eq } from "drizzle-orm";
import { diffBlueprint, type AviloBlueprint, type BlueprintChange } from "@avilo/core";
import { getDb, newId, schema } from "../db.js";
import { LAYOUT_SECTION_IDS, exportBlueprint } from "./configuration.js";

export interface VersionRecord {
  id: string;
  seq: number;
  author: string;
  summary: string;
  blueprint: AviloBlueprint;
  diff: BlueprintChange[];
  proposalId: string | null;
  restoredFrom: string | null;
  createdAt: string;
}

function rowToRecord(row: typeof schema.configurationVersions.$inferSelect): VersionRecord {
  return {
    id: row.id,
    seq: row.seq,
    author: row.author,
    summary: row.summary,
    blueprint: JSON.parse(row.blueprint) as AviloBlueprint,
    diff: JSON.parse(row.diff) as BlueprintChange[],
    proposalId: row.proposalId,
    restoredFrom: row.restoredFrom,
    createdAt: row.createdAt,
  };
}

/**
 * Spell out the keys whose absence means "leave alone".
 *
 * Without this a version captured before any view existed would restore as a no-op against
 * a configuration that has views, because `activateProposal` skips an absent `views`. The
 * empty array is the difference between "I have no opinion" and "there are none".
 */
export function normalizeVersionDocument(blueprint: AviloBlueprint): AviloBlueprint {
  return {
    ...blueprint,
    layout: blueprint.layout ?? { sectionOrder: [...LAYOUT_SECTION_IDS], hiddenSections: [] },
    views: blueprint.views ?? [],
  };
}

function nextSeq(): number {
  const db = getDb();
  const top = db
    .select({ seq: schema.configurationVersions.seq })
    .from(schema.configurationVersions)
    .orderBy(desc(schema.configurationVersions.seq))
    .limit(1)
    .get();
  return (top?.seq ?? 0) + 1;
}

/**
 * Record the configuration as it stands right now.
 *
 * Called by `activateProposal` after it writes, so the stored document is the state the
 * application is actually in rather than the document that was requested — the two differ
 * whenever a blueprint omits a section, and the state is what a restore needs.
 */
export function recordVersion(args: {
  author: string;
  summary: string;
  proposalId?: string | null;
  restoredFrom?: string | null;
}): VersionRecord {
  const db = getDb();
  const seq = nextSeq();
  const blueprint = normalizeVersionDocument(exportBlueprint(`Version ${seq}: ${args.summary}`.slice(0, 120)));

  const previous = db
    .select()
    .from(schema.configurationVersions)
    .orderBy(desc(schema.configurationVersions.seq))
    .limit(1)
    .get();
  const diff = previous
    ? diffBlueprint(blueprint, JSON.parse(previous.blueprint) as AviloBlueprint)
    : [];

  const id = newId("cv");
  db.insert(schema.configurationVersions)
    .values({
      id,
      seq,
      author: args.author,
      summary: args.summary,
      blueprint: JSON.stringify(blueprint),
      diff: JSON.stringify(diff),
      proposalId: args.proposalId ?? null,
      restoredFrom: args.restoredFrom ?? null,
    })
    .run();

  return rowToRecord(
    db.select().from(schema.configurationVersions).where(eq(schema.configurationVersions.id, id)).get()!,
  );
}

/**
 * Guarantee there is a state to go back TO before the first change is applied.
 *
 * On an installation upgraded from an earlier build, history starts empty while the
 * configuration is already whatever the user has built up. Without a baseline the first
 * change would be seq 1 and there would be nothing earlier to restore — the user would
 * have lost the ability to undo precisely the change they were about to make. Called at
 * the top of `activateProposal`, before it writes.
 */
export function ensureBaseline(): void {
  const db = getDb();
  const any = db.select({ id: schema.configurationVersions.id }).from(schema.configurationVersions).limit(1).get();
  if (any) return;
  recordVersion({ author: "baseline", summary: "Configuration before history was kept" });
}

export function listVersions(limit = 100): VersionRecord[] {
  const db = getDb();
  return db
    .select()
    .from(schema.configurationVersions)
    .orderBy(desc(schema.configurationVersions.seq))
    .limit(limit)
    .all()
    .map(rowToRecord);
}

export function getVersion(id: string): VersionRecord | null {
  const db = getDb();
  const row = db
    .select()
    .from(schema.configurationVersions)
    .where(eq(schema.configurationVersions.id, id))
    .get();
  return row ? rowToRecord(row) : null;
}
