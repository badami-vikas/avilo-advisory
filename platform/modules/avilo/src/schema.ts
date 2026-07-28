// Drizzle schema for the Avilo Advisory module (SQLite / better-sqlite3).
//
// Design note — why this shape exists at all:
//
// The v9 prototype held ONE client for ONE month, read prior-year values by hard-coded
// column index (col 1 = prior year, col 13 = current), matched QuickBooks row labels with
// regexes compiled into JavaScript, and computed metrics with inline arithmetic. Six
// consecutive rounds of bugs in the v7→v9 build traced to those four decisions.
//
// Every one of them is inverted here:
//   * `facts` is keyed by (client, period, account) so any date range is a WHERE clause.
//   * `labelMappings` makes label→account a persisted, user-correctable ROW, never a regex.
//   * `formulas` stores expressions as versioned data evaluated at runtime.
//   * `overrides` carries full history so a manual correction is never silently lost.

import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

/* ------------------------------------------------------------------ clients */

/** One row per advisory client. This is the landing table. */
export const clients = sqliteTable(
  "clients",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    legalName: text("legal_name"),
    /** 1 = January. US calendar FY is the product default. */
    fiscalYearStartMonth: integer("fiscal_year_start_month").notNull().default(1),
    stage: text("stage").notNull().default("Active"),
    industry: text("industry"),
    owner: text("owner"),
    notes: text("notes"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => [uniqueIndex("clients_name_unique").on(t.name)],
);

/* ----------------------------------------------------------------- accounts */

/**
 * Canonical chart of accounts. Source files speak many dialects
 * ("Total Income", "Total for Income", "Income - Total"); everything is normalised
 * onto these ids, and formulas only ever reference these ids.
 */
export const accounts = sqliteTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    label: text("label").notNull(),
    /** pl | balance_sheet | ar_aging | ap_aging | referral | sales_by_customer */
    statement: text("statement").notNull(),
    /** total | line_item */
    role: text("role").notNull().default("total"),
    /** currency | count | percent */
    unit: text("unit").notNull().default("currency"),
    description: text("description"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("accounts_statement_idx").on(t.statement)],
);

/* ------------------------------------------------------------- source files */

export const sourceFiles = sqliteTable(
  "source_files",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    /** Absolute path under ~/Documents/Bridge/Avilo Advisory/<Client>/ */
    storedPath: text("stored_path").notNull(),
    sha256: text("sha256").notNull(),
    byteSize: integer("byte_size").notNull(),
    extension: text("extension").notNull(),
    /** Detected report type, e.g. "profit_and_loss". Null until classified. */
    reportType: text("report_type"),
    /** 0..1 */
    confidence: real("confidence").notNull().default(0),
    /** rules | local_llm | user */
    classifiedBy: text("classified_by").notNull().default("rules"),
    /** JSON array of period strings the file was found to contain. */
    periodsDetected: text("periods_detected").notNull().default("[]"),
    /** pending | classified | imported | failed */
    status: text("status").notNull().default("pending"),
    error: text("error"),
    uploadedAt: text("uploaded_at").notNull().default(now),
    importedAt: text("imported_at"),
  },
  (t) => [
    index("source_files_client_idx").on(t.clientId),
    uniqueIndex("source_files_client_sha_unique").on(t.clientId, t.sha256),
  ],
);

/* -------------------------------------------------------------------- facts */

/**
 * The period-aware fact store. One value per (client, period, account).
 *
 * `period` is an ISO year-month, "2024-10". Range queries are lexicographic on this
 * column, which is what makes "current financial year to date" a trivial BETWEEN
 * rather than the column-index arithmetic that broke the prototype.
 */
export const facts = sqliteTable(
  "facts",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    period: text("period").notNull(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    value: real("value").notNull(),
    sourceFileId: text("source_file_id").references(() => sourceFiles.id, {
      onDelete: "set null",
    }),
    /** Provenance: the literal text this number came from. */
    sourceRowLabel: text("source_row_label"),
    sourceColumnLabel: text("source_column_label"),
    createdAt: text("created_at").notNull().default(now),
    updatedAt: text("updated_at").notNull().default(now),
  },
  (t) => [
    uniqueIndex("facts_client_period_account_unique").on(
      t.clientId,
      t.period,
      t.accountId,
    ),
    index("facts_client_period_idx").on(t.clientId, t.period),
  ],
);

/* ----------------------------------------------------------- label mappings */

/**
 * Label → account mapping as DATA.
 *
 * This table is the direct fix for the defect class that dominated the v7→v9 build:
 * QuickBooks writes "Total for Income" where the parser's regex expected "Total Income",
 * so every field silently came back empty. Corrections made in the UI are written here
 * and reused forever. `clientId` NULL means the mapping is global.
 */
export const labelMappings = sqliteTable(
  "label_mappings",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").references(() => clients.id, {
      onDelete: "cascade",
    }),
    reportType: text("report_type").notNull(),
    /** Normalised source label: lowercased, punctuation and whitespace collapsed. */
    normalizedLabel: text("normalized_label").notNull(),
    /** The literal label as it appeared, kept for display and audit. */
    rawLabel: text("raw_label").notNull(),
    accountId: text("account_id")
      .notNull()
      .references(() => accounts.id),
    /** builtin | learned | user */
    origin: text("origin").notNull().default("user"),
    confidence: real("confidence").notNull().default(1),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [
    uniqueIndex("label_mappings_scope_unique").on(
      t.clientId,
      t.reportType,
      t.normalizedLabel,
    ),
    index("label_mappings_lookup_idx").on(t.reportType, t.normalizedLabel),
  ],
);

/* ----------------------------------------------------------------- formulas */

/**
 * Formula registry. Editing a formula changes it for every client and every period
 * (locked product decision: global + versioned + retroactive).
 */
export const formulas = sqliteTable(
  "formulas",
  {
    id: text("id").primaryKey(),
    label: text("label").notNull(),
    /** mathjs expression referencing account ids and other formula ids. */
    expression: text("expression").notNull(),
    unit: text("unit").notNull().default("currency"),
    description: text("description"),
    /** Benchmark band used by the Check Formulas panel, JSON or null. */
    benchmark: text("benchmark"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    /** Points at the current row in formula_versions. */
    version: integer("version").notNull().default(1),
    sortOrder: integer("sort_order").notNull().default(0),
    updatedAt: text("updated_at").notNull().default(now),
  },
);

export const formulaVersions = sqliteTable(
  "formula_versions",
  {
    id: text("id").primaryKey(),
    formulaId: text("formula_id")
      .notNull()
      .references(() => formulas.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    expression: text("expression").notNull(),
    author: text("author").notNull().default("local"),
    note: text("note"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [
    uniqueIndex("formula_versions_unique").on(t.formulaId, t.version),
    index("formula_versions_formula_idx").on(t.formulaId),
  ],
);

/* ---------------------------------------------------------------- overrides */

/**
 * Manual value overrides.
 *
 * Semantics (locked): an override persists indefinitely across sessions and is cleared
 * only by a re-import that supplies a new value for the SAME (client, period, target).
 * When that happens the row is not deleted — it moves to status 'superseded' and keeps
 * the value, so a one-click restore is always available. An override never mutates the
 * underlying formula.
 */
export const overrides = sqliteTable(
  "overrides",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    period: text("period").notNull(),
    /** account | metric */
    targetKind: text("target_kind").notNull(),
    /** accounts.id when targetKind='account', formulas.id when 'metric' */
    targetId: text("target_id").notNull(),
    value: real("value").notNull(),
    /** The value that was on screen when the user overrode it, for the audit trail. */
    previousValue: real("previous_value"),
    reason: text("reason"),
    author: text("author").notNull().default("local"),
    /** active | superseded | restored */
    status: text("status").notNull().default("active"),
    supersededBySourceFileId: text("superseded_by_source_file_id").references(
      () => sourceFiles.id,
      { onDelete: "set null" },
    ),
    supersededValue: real("superseded_value"),
    supersededAt: text("superseded_at"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [
    index("overrides_lookup_idx").on(
      t.clientId,
      t.period,
      t.targetKind,
      t.targetId,
      t.status,
    ),
  ],
);

/* -------------------------------------------------------------------- views */

/** Persisted view overlays (columns/filters/sorts) — "views as data". */
export const savedViews = sqliteTable("saved_views", {
  id: text("id").primaryKey(),
  tableId: text("table_id").notNull(),
  name: text("name").notNull(),
  config: text("config").notNull(),
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(now),
});

/* ------------------------------------------------------------------ audit */

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    at: text("at").notNull().default(now),
    actor: text("actor").notNull().default("local"),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    detail: text("detail"),
  },
  (t) => [index("audit_log_entity_idx").on(t.entity, t.entityId)],
);

/* ------------------------------------------------------------- relations */

export const clientRelations = relations(clients, ({ many }) => ({
  facts: many(facts),
  sourceFiles: many(sourceFiles),
  overrides: many(overrides),
}));

export const factRelations = relations(facts, ({ one }) => ({
  client: one(clients, { fields: [facts.clientId], references: [clients.id] }),
  account: one(accounts, { fields: [facts.accountId], references: [accounts.id] }),
  sourceFile: one(sourceFiles, {
    fields: [facts.sourceFileId],
    references: [sourceFiles.id],
  }),
}));

export const sourceFileRelations = relations(sourceFiles, ({ one, many }) => ({
  client: one(clients, {
    fields: [sourceFiles.clientId],
    references: [clients.id],
  }),
  facts: many(facts),
}));

export type Client = typeof clients.$inferSelect;
export type NewClient = typeof clients.$inferInsert;
export type Account = typeof accounts.$inferSelect;
export type Fact = typeof facts.$inferSelect;
export type SourceFile = typeof sourceFiles.$inferSelect;
export type LabelMapping = typeof labelMappings.$inferSelect;
export type Formula = typeof formulas.$inferSelect;
export type Override = typeof overrides.$inferSelect;
