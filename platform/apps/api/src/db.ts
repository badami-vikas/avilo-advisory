import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";

import { schema } from "@avilo/module";
import {
  BUILTIN_LABEL_MAPPINGS,
  CANONICAL_ACCOUNTS,
  SEED_FORMULAS,
} from "@avilo/module";
import { DB_PATH, DATA_DIR, ensureDir } from "./paths.js";

const here = dirname(fileURLToPath(import.meta.url));

export type Db = BetterSQLite3Database<typeof schema>;

let cached: { db: Db; raw: Database.Database } | null = null;

export function getDb(): Db {
  return getConnection().db;
}

export function getConnection(): { db: Db; raw: Database.Database } {
  if (cached) return cached;

  ensureDir(DATA_DIR);
  const raw = new Database(DB_PATH);

  // WAL keeps reads non-blocking while an import writes; foreign keys are off by
  // default in SQLite and the schema relies on them for cascade deletes.
  raw.pragma("journal_mode = WAL");
  raw.pragma("foreign_keys = ON");

  const db = drizzle(raw, { schema });
  migrate(db, { migrationsFolder: join(here, "..", "migrations") });
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

    for (const formula of SEED_FORMULAS) {
      const existing = tx
        .select({ id: schema.formulas.id })
        .from(schema.formulas)
        .where(eq(schema.formulas.id, formula.id))
        .all();
      if (existing.length > 0) continue;

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

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export { schema, sql };
