import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { dirname } from "node:path";
import { eq, sql } from "drizzle-orm";

import { schema } from "@avilo/module";
import {
  BUILTIN_LABEL_MAPPINGS,
  CANONICAL_ACCOUNTS,
  SEED_FORMULAS,
} from "@avilo/module";
import { dbPath, ensureDir, migrationsDir } from "./paths.js";

export type Db = BetterSQLite3Database<typeof schema>;

let cached: { db: Db; raw: Database.Database } | null = null;

export function getDb(): Db {
  return getConnection().db;
}

export function getConnection(): { db: Db; raw: Database.Database } {
  if (cached) return cached;

  // The database's own directory rather than a derived one: the host can put the
  // database anywhere, including outside the files root.
  const file = dbPath();
  ensureDir(dirname(file));
  const raw = new Database(file);

  // WAL keeps reads non-blocking while an import writes; foreign keys are off by
  // default in SQLite and the schema relies on them for cascade deletes.
  raw.pragma("journal_mode = WAL");
  raw.pragma("foreign_keys = ON");

  const db = drizzle(raw, { schema });
  migrate(db, { migrationsFolder: migrationsDir() });
  seedReferenceData(db);

  cached = { db, raw };
  return cached;
}

/**
 * Seed *reference* data only: the canonical chart of accounts, the formula registry, and
 * the built-in QuickBooks label dialects.
 *
 * This is not demo data. No client, no fact, and no figure is created here — the
 * application starts empty and shows honest empty states, per docs/dummy.md.
 */
export function seedReferenceData(db: Db): void {
  db.transaction((tx) => {
    for (const account of CANONICAL_ACCOUNTS) {
      tx.insert(schema.accounts)
        .values({
          id: account.id,
          label: account.label,
          statement: account.statement,
          role: account.role,
          unit: account.unit,
          description: account.description ?? null,
          sortOrder: account.sortOrder,
        })
        .onConflictDoNothing()
        .run();
    }

    /*
      Every expression this application has ever shipped for a formula, most recent last.

      A stored expression matching one of these is a definition the user inherited and
      never edited, so replacing it is a correction. Anything else is theirs. Append here
      whenever a seed expression changes — the list is the upgrade path.
    */
    const SUPERSEDED_EXPRESSIONS: Record<string, string[]> = {
      days_cash_on_hand: [
        "bs.cash / ((pl.cogs + pl.overhead) / 365)",
        "bs.cash / ((pl.cogs + pl.overhead) / 30)",
      ],
      dso: ["ar.total / pl.revenue * 30", "ar.total / pl.revenue * 365"],
      dpo: [
        "ap.total / ((pl.cogs + pl.overhead)) * 30",
        "ap.total / ((pl.cogs + pl.overhead)) * 365",
      ],
    };

    for (const formula of SEED_FORMULAS) {
      const existing = tx
        .select({
          id: schema.formulas.id,
          expression: schema.formulas.expression,
          version: schema.formulas.version,
        })
        .from(schema.formulas)
        .where(eq(schema.formulas.id, formula.id))
        .all();

      /*
        Upgrade a definition the user has never touched.

        Seeding used to skip any formula that already existed, which meant a corrected
        expression only ever reached a *fresh* database. The days-cash-on-hand divisor was
        fixed from 365 to 30 and shipped, and every beta machine kept the broken formula,
        because seeding is the only path a definition travels and that path was closed.
        Exactly the failure mode CLAUDE.md warns about: a fresh database is not a test.

        Superseded expressions are listed rather than blind-overwriting, so a formula the
        user has edited themselves is left alone — an edit is a decision with history
        (ADR-003), not something a release quietly reverts.
      */
      const current = existing[0];
      if (current) {
        const superseded = SUPERSEDED_EXPRESSIONS[formula.id] ?? [];
        const untouched = superseded.includes(current.expression.trim());
        if (current.expression.trim() === formula.expression.trim() || !untouched) continue;

        const nextVersion = current.version + 1;
        tx.update(schema.formulas)
          .set({
            expression: formula.expression,
            label: formula.label,
            description: formula.description,
            benchmark: formula.benchmark ? JSON.stringify(formula.benchmark) : null,
            unit: formula.unit,
            sortOrder: formula.sortOrder,
            version: nextVersion,
          })
          .where(eq(schema.formulas.id, formula.id))
          .run();

        tx.insert(schema.formulaVersions)
          .values({
            id: `${formula.id}@${nextVersion}`,
            formulaId: formula.id,
            version: nextVersion,
            expression: formula.expression,
            author: "system",
            note: "Corrected definition shipped with the application",
          })
          .onConflictDoNothing()
          .run();
        continue;
      }

      tx.insert(schema.formulas)
        .values({
          id: formula.id,
          label: formula.label,
          expression: formula.expression,
          unit: formula.unit,
          description: formula.description,
          benchmark: formula.benchmark ? JSON.stringify(formula.benchmark) : null,
          active: true,
          version: 1,
          sortOrder: formula.sortOrder,
        })
        .run();

      tx.insert(schema.formulaVersions)
        .values({
          id: `${formula.id}@1`,
          formulaId: formula.id,
          version: 1,
          expression: formula.expression,
          author: "system",
          note: "Initial definition",
        })
        .onConflictDoNothing()
        .run();
    }

    for (const mapping of BUILTIN_LABEL_MAPPINGS) {
      tx.insert(schema.labelMappings)
        .values({
          id: `builtin:${mapping.reportType}:${mapping.normalizedLabel}`,
          clientId: null,
          reportType: mapping.reportType,
          normalizedLabel: mapping.normalizedLabel,
          rawLabel: mapping.normalizedLabel,
          accountId: mapping.accountId,
          origin: "builtin",
          confidence: 1,
        })
        .onConflictDoNothing()
        .run();
    }
  });
}

/**
 * Close the database and forget the handle.
 *
 * A desktop application quits and relaunches far more often than a server restarts, and
 * SQLite's WAL leaves a `-wal` file behind if the connection is not closed cleanly.
 * Recoverable, but it means the next launch starts by replaying a journal instead of
 * opening a file.
 */
export function closeConnection(): void {
  if (!cached) return;
  cached.raw.close();
  cached = null;
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export { schema, sql };
