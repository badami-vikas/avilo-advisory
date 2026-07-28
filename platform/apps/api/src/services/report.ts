import { and, eq, gte, lte } from "drizzle-orm";
import {
  displayValue,
  evaluateFormulas,
  formatPeriod,
  type EvaluationScope,
  type FormulaSpec,
  type MetricResult,
  type OverrideRecord,
  type Period,
  type ResolvedValue,
} from "@avilo/module";
import { getDb, schema } from "../db.js";

export interface AccountCell {
  accountId: string;
  label: string;
  unit: string;
  /** Shown as the field's tooltip. */
  description: string | null;
  value: number | null;
  source: "fact" | "override" | "missing";
  divergesFrom?: number;
  sourceRowLabel?: string;
  sourceColumnLabel?: string;
  sourceFilename?: string;
  /** True when an active formula needs this account and it has no value. */
  requiredButMissing: boolean;
}

export interface PeriodReport {
  period: Period;
  periodLabel: string;
  accounts: AccountCell[];
  metrics: MetricResult[];
  /** Accounts required by active formulas that have no value for this period. */
  missingRequired: string[];
  complete: boolean;
}

export function loadFormulaSpecs(): FormulaSpec[] {
  const db = getDb();
  return db
    .select()
    .from(schema.formulas)
    .orderBy(schema.formulas.sortOrder)
    .all()
    .map((f) => ({
      id: f.id,
      label: f.label,
      expression: f.expression,
      unit: f.unit,
      active: f.active,
    }));
}

function loadOverrides(clientId: string, period: Period): OverrideRecord[] {
  const db = getDb();
  return db
    .select()
    .from(schema.overrides)
    .where(
      and(
        eq(schema.overrides.clientId, clientId),
        eq(schema.overrides.period, period),
        eq(schema.overrides.status, "active"),
      ),
    )
    .all()
    .map((row) => ({
      id: row.id,
      clientId: row.clientId,
      period: row.period,
      targetKind: row.targetKind as "account" | "metric",
      targetId: row.targetId,
      value: row.value,
      status: "active" as const,
    }));
}

/**
 * Build one period's report.
 *
 * Order matters: facts are loaded, overrides applied on top, then formulas evaluated
 * against the resolved scope. Because the checklist comes from the same dependency graph
 * the evaluator uses, a metric can never be shown as missing an input that the checklist
 * does not also demand.
 */
export function buildPeriodReport(clientId: string, period: Period): PeriodReport {
  const db = getDb();

  const factRows = db
    .select({
      accountId: schema.facts.accountId,
      value: schema.facts.value,
      sourceRowLabel: schema.facts.sourceRowLabel,
      sourceColumnLabel: schema.facts.sourceColumnLabel,
      filename: schema.sourceFiles.filename,
    })
    .from(schema.facts)
    .leftJoin(
      schema.sourceFiles,
      eq(schema.facts.sourceFileId, schema.sourceFiles.id),
    )
    .where(
      and(eq(schema.facts.clientId, clientId), eq(schema.facts.period, period)),
    )
    .all();

  const accountDefs = db.select().from(schema.accounts).orderBy(schema.accounts.sortOrder).all();
  const overrides = loadOverrides(clientId, period);

  const factByAccount = new Map(factRows.map((f) => [f.accountId, f]));
  const overrideByTarget = new Map(
    overrides.filter((o) => o.targetKind === "account").map((o) => [o.targetId, o]),
  );
  const metricOverrideByTarget = new Map(
    overrides.filter((o) => o.targetKind === "metric").map((o) => [o.targetId, o]),
  );

  const scopeAccounts = new Map<string, ResolvedValue>();
  const cells: AccountCell[] = [];

  for (const def of accountDefs) {
    const fact = factByAccount.get(def.id);
    const resolved = displayValue(fact?.value, overrideByTarget.get(def.id));

    if (resolved.value !== null) {
      scopeAccounts.set(def.id, {
        value: resolved.value,
        source: resolved.source === "override" ? "override" : "fact",
        ...(resolved.divergesFrom !== undefined
          ? { divergesFrom: resolved.divergesFrom }
          : {}),
      });
    }

    cells.push({
      accountId: def.id,
      label: def.label,
      unit: def.unit,
      description: def.description,
      value: resolved.value,
      source: resolved.source,
      ...(resolved.divergesFrom !== undefined
        ? { divergesFrom: resolved.divergesFrom }
        : {}),
      ...(fact?.sourceRowLabel ? { sourceRowLabel: fact.sourceRowLabel } : {}),
      ...(fact?.sourceColumnLabel ? { sourceColumnLabel: fact.sourceColumnLabel } : {}),
      ...(fact?.filename ? { sourceFilename: fact.filename } : {}),
      requiredButMissing: false,
    });
  }

  const scope: EvaluationScope = {
    accounts: scopeAccounts,
    metricOverrides: new Map(
      [...metricOverrideByTarget].map(([id, o]) => [
        id,
        { value: o.value, source: "override" as const },
      ]),
    ),
  };

  const specs = loadFormulaSpecs();
  const evaluation = evaluateFormulas(specs, scope);

  const missing = new Set(evaluation.missingAccounts);
  for (const cell of cells) {
    cell.requiredButMissing = missing.has(cell.accountId);
  }

  return {
    period,
    periodLabel: formatPeriod(period),
    accounts: cells,
    metrics: [...evaluation.metrics.values()],
    missingRequired: [...missing].sort(),
    complete: missing.size === 0,
  };
}

/** Periods that have at least one fact for this client, most recent first. */
export function availablePeriods(clientId: string): Period[] {
  const db = getDb();
  const rows = db
    .selectDistinct({ period: schema.facts.period })
    .from(schema.facts)
    .where(eq(schema.facts.clientId, clientId))
    .all();
  return rows.map((r) => r.period).sort().reverse();
}

/** A metric's value across a period range — the series behind every chart. */
export interface SeriesPoint {
  period: Period;
  periodLabel: string;
  values: Record<string, number | null>;
}

export function buildSeries(
  clientId: string,
  start: Period,
  end: Period,
  metricIds: string[],
): SeriesPoint[] {
  const db = getDb();

  const periods = db
    .selectDistinct({ period: schema.facts.period })
    .from(schema.facts)
    .where(
      and(
        eq(schema.facts.clientId, clientId),
        gte(schema.facts.period, start),
        lte(schema.facts.period, end),
      ),
    )
    .all()
    .map((r) => r.period)
    .sort();

  return periods.map((period) => {
    const report = buildPeriodReport(clientId, period);
    const values: Record<string, number | null> = {};
    for (const id of metricIds) {
      const metric = report.metrics.find((m) => m.id === id);
      if (metric) {
        values[id] = metric.value;
        continue;
      }
      const account = report.accounts.find((a) => a.accountId === id);
      values[id] = account?.value ?? null;
    }
    return { period, periodLabel: formatPeriod(period), values };
  });
}
