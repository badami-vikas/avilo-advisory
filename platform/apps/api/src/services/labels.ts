import { and, eq, isNull, or } from "drizzle-orm";
import type { LabelResolver, ReportType } from "@avilo/module";
import { getDb, newId, schema } from "../db.js";

/**
 * Build a label resolver for one client.
 *
 * Precedence: a mapping taught for this specific client beats a global one, which beats
 * the built-in dialect table. Loaded once per import rather than queried per row.
 */
export function buildResolver(clientId: string): LabelResolver {
  const db = getDb();
  const rows = db
    .select()
    .from(schema.labelMappings)
    .where(
      or(
        isNull(schema.labelMappings.clientId),
        eq(schema.labelMappings.clientId, clientId),
      ),
    )
    .all();

  const global = new Map<string, string>();
  const scoped = new Map<string, string>();

  for (const row of rows) {
    const key = `${row.reportType}|${row.normalizedLabel}`;
    if (row.clientId === null) {
      // A user-taught global mapping outranks a built-in one.
      if (row.origin !== "builtin" || !global.has(key)) global.set(key, row.accountId);
    } else {
      scoped.set(key, row.accountId);
    }
  }

  return (normalizedLabel, reportType) => {
    const key = `${reportType}|${normalizedLabel}`;
    return scoped.get(key) ?? global.get(key) ?? null;
  };
}

/** Persist a user correction so the same label never has to be mapped twice. */
export function learnMapping(input: {
  clientId: string | null;
  reportType: ReportType;
  normalizedLabel: string;
  rawLabel: string;
  accountId: string;
}): void {
  const db = getDb();
  db.insert(schema.labelMappings)
    .values({
      id: newId("lm"),
      clientId: input.clientId,
      reportType: input.reportType,
      normalizedLabel: input.normalizedLabel,
      rawLabel: input.rawLabel,
      accountId: input.accountId,
      origin: "user",
      confidence: 1,
    })
    .onConflictDoUpdate({
      target: [
        schema.labelMappings.clientId,
        schema.labelMappings.reportType,
        schema.labelMappings.normalizedLabel,
      ],
      set: { accountId: input.accountId, origin: "user", rawLabel: input.rawLabel },
    })
    .run();
}

/**
 * Undo a taught mapping.
 *
 * A mapping is remembered forever and applied to every future import, which is the point
 * of it — and exactly why a wrong one has to be reversible. Until this existed, a mis-click
 * in the mapping list was permanent from the interface: the row vanished from "no matching
 * account" and never came back, so there was nothing left to correct.
 *
 * Only the user-taught row is deleted. The built-in dialect table is a seed, not a
 * correction, and removing a client mapping should fall back to it rather than to nothing.
 */
export function forgetMapping(input: {
  clientId: string | null;
  reportType: ReportType;
  normalizedLabel: string;
}): boolean {
  const db = getDb();
  const result = db
    .delete(schema.labelMappings)
    .where(
      and(
        input.clientId === null
          ? isNull(schema.labelMappings.clientId)
          : eq(schema.labelMappings.clientId, input.clientId),
        eq(schema.labelMappings.reportType, input.reportType),
        eq(schema.labelMappings.normalizedLabel, input.normalizedLabel),
        eq(schema.labelMappings.origin, "user"),
      ),
    )
    .run();
  return result.changes > 0;
}

export function listMappings(clientId: string) {
  const db = getDb();
  return db
    .select()
    .from(schema.labelMappings)
    .where(
      and(
        or(
          isNull(schema.labelMappings.clientId),
          eq(schema.labelMappings.clientId, clientId),
        ),
      ),
    )
    .all();
}
