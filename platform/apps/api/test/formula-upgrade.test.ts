/**
 * Seeding must carry a corrected formula into a database that already exists.
 *
 * This is the bug the file exists for: seeding skipped any formula whose id was already
 * present, so when the days-cash-on-hand divisor was fixed from 365 to 30 and shipped,
 * every machine that had already run the app kept the broken definition. The fix was real,
 * the tests passed, the fresh install was correct, and the beta user still saw 10,304 days
 * of runway. A fresh database is not a test.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

let dir: string;
let db: Database.Database;

/** The formulas table as it stood before this change, with the shipped-then rows. */
function legacyDatabase(expression: string) {
  db.exec(`
    CREATE TABLE formulas (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      expression TEXT NOT NULL,
      unit TEXT NOT NULL DEFAULT 'currency',
      description TEXT,
      benchmark TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      version INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE formula_versions (
      id TEXT PRIMARY KEY,
      formula_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      expression TEXT NOT NULL,
      author TEXT NOT NULL,
      note TEXT
    );
  `);
  db.prepare(
    "INSERT INTO formulas (id, label, expression, unit, version, sort_order) VALUES (?,?,?,?,?,?)",
  ).run("days_cash_on_hand", "Days cash on hand", expression, "days", 1, 50);
}

/**
 * The upgrade rule, mirrored from `src/db.ts`: replace a stored expression only when it
 * is one this application shipped, so a definition the user edited is left alone.
 */
function applyUpgrade(target: string, superseded: string[]): void {
  const row = db
    .prepare("SELECT expression, version FROM formulas WHERE id = 'days_cash_on_hand'")
    .get() as { expression: string; version: number } | undefined;
  if (!row) return;
  if (row.expression.trim() === target.trim()) return;
  if (!superseded.includes(row.expression.trim())) return;

  const next = row.version + 1;
  db.prepare("UPDATE formulas SET expression = ?, version = ? WHERE id = 'days_cash_on_hand'").run(
    target,
    next,
  );
  db.prepare(
    "INSERT INTO formula_versions (id, formula_id, version, expression, author, note) VALUES (?,?,?,?,?,?)",
  ).run(`days_cash_on_hand@${next}`, "days_cash_on_hand", next, target, "system", "Corrected");
}

const SUPERSEDED = [
  "bs.cash / ((pl.cogs + pl.overhead) / 365)",
  "bs.cash / ((pl.cogs + pl.overhead) / 30)",
];
const CURRENT = "bs.cash / ((avg3.pl.cogs + avg3.pl.overhead) / 30)";

const expressionNow = () =>
  (db.prepare("SELECT expression FROM formulas WHERE id = 'days_cash_on_hand'").get() as {
    expression: string;
  }).expression;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "avilo-upgrade-"));
  db = new Database(join(dir, "test.sqlite"));
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("formula upgrade on an existing database", () => {
  it("replaces the 365-day divisor that shipped before v1.5.0", () => {
    legacyDatabase("bs.cash / ((pl.cogs + pl.overhead) / 365)");
    applyUpgrade(CURRENT, SUPERSEDED);
    expect(expressionNow()).toBe(CURRENT);
  });

  it("replaces the single-month base that shipped in v1.5.0", () => {
    legacyDatabase("bs.cash / ((pl.cogs + pl.overhead) / 30)");
    applyUpgrade(CURRENT, SUPERSEDED);
    expect(expressionNow()).toBe(CURRENT);
  });

  it("leaves an expression the user edited alone", () => {
    const theirs = "bs.cash / ((pl.cogs + pl.overhead) / 45)";
    legacyDatabase(theirs);
    applyUpgrade(CURRENT, SUPERSEDED);
    expect(expressionNow()).toBe(theirs);
  });

  it("records the upgrade as a new version rather than rewriting history", () => {
    legacyDatabase("bs.cash / ((pl.cogs + pl.overhead) / 365)");
    applyUpgrade(CURRENT, SUPERSEDED);

    const row = db
      .prepare("SELECT version FROM formulas WHERE id = 'days_cash_on_hand'")
      .get() as { version: number };
    expect(row.version).toBe(2);

    const versions = db
      .prepare("SELECT version, expression FROM formula_versions WHERE formula_id = ?")
      .all("days_cash_on_hand") as { version: number; expression: string }[];
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ version: 2, expression: CURRENT });
  });

  it("is idempotent — a second start changes nothing", () => {
    legacyDatabase("bs.cash / ((pl.cogs + pl.overhead) / 365)");
    applyUpgrade(CURRENT, SUPERSEDED);
    applyUpgrade(CURRENT, SUPERSEDED);
    applyUpgrade(CURRENT, SUPERSEDED);

    expect(expressionNow()).toBe(CURRENT);
    const row = db
      .prepare("SELECT version FROM formulas WHERE id = 'days_cash_on_hand'")
      .get() as { version: number };
    expect(row.version).toBe(2);
  });
});
