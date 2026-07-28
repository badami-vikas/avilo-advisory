import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";

import {
  classifyGrid,
  findAsOfPeriod,
  parseAging,
  parseBalanceSheet,
  parseEntityReport,
  parseProfitAndLoss,
  primarySheet,
  readCsv,
  readWorkbook,
  resolveImport,
  type Classification,
  type Grid,
  type ParseResult,
  type Period,
  type ReportType,
} from "@avilo/module";
import { getDb, newId, nowIso, schema } from "../db.js";
import { clientFilesDir, ensureDir } from "../paths.js";
import { buildResolver } from "./labels.js";

export interface StagedFile {
  sourceFileId: string;
  filename: string;
  classification: Classification;
  /** Present when the detected type has a parser wired up. */
  preview: ParseResult | null;
  /** Set when the file could not be read at all. */
  error?: string;
}

const SPREADSHEET = /\.(xlsx|xlsm|xls|csv)$/i;

function toGrid(filename: string, bytes: Uint8Array): Grid {
  if (/\.csv$/i.test(filename)) {
    return readCsv(new TextDecoder().decode(bytes));
  }
  return primarySheet(readWorkbook(bytes));
}

/**
 * Stage an upload: store the file, classify it, and parse a preview — but write no
 * facts. Nothing enters the fact store until the user has seen what was detected and
 * confirmed it, which is what makes a misclassification a one-click correction rather
 * than a silently wrong dashboard.
 */
export function stageFile(
  clientId: string,
  filename: string,
  bytes: Uint8Array,
): StagedFile {
  const db = getDb();
  const client = db
    .select()
    .from(schema.clients)
    .where(eq(schema.clients.id, clientId))
    .get();
  if (!client) throw new Error(`Unknown client: ${clientId}`);

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const dir = ensureDir(clientFilesDir(client.name));
  const storedPath = join(dir, filename);
  writeFileSync(storedPath, bytes);

  const extension = (filename.match(/\.([^.]+)$/)?.[1] ?? "").toLowerCase();

  const existing = db
    .select()
    .from(schema.sourceFiles)
    .where(
      and(
        eq(schema.sourceFiles.clientId, clientId),
        eq(schema.sourceFiles.sha256, sha256),
      ),
    )
    .get();

  const sourceFileId = existing?.id ?? newId("sf");

  if (!SPREADSHEET.test(filename)) {
    // PDF ingestion lands in Phase 2. Recording the file rather than rejecting it means
    // the user's upload is not lost, and the reason is explicit rather than a silent
    // no-op — which is how the prototype behaved when a slot fell through.
    const record = {
      id: sourceFileId,
      clientId,
      filename,
      storedPath,
      sha256,
      byteSize: bytes.byteLength,
      extension,
      reportType: null,
      confidence: 0,
      classifiedBy: "rules" as const,
      periodsDetected: "[]",
      status: "failed" as const,
      error:
        "PDF import arrives in Phase 2. Export this report from QuickBooks as Excel or CSV and upload it again — structural parsing is materially more reliable than reading a PDF.",
    };
    if (existing) {
      db.update(schema.sourceFiles).set(record).where(eq(schema.sourceFiles.id, sourceFileId)).run();
    } else {
      db.insert(schema.sourceFiles).values(record).run();
    }
    return {
      sourceFileId,
      filename,
      classification: {
        reportType: null,
        confidence: 0,
        method: "rules",
        evidence: [],
        candidates: [],
        needsConfirmation: true,
      },
      preview: null,
      error: record.error,
    };
  }

  let grid: Grid;
  try {
    grid = toGrid(filename, bytes);
  } catch (cause) {
    return {
      sourceFileId,
      filename,
      classification: {
        reportType: null,
        confidence: 0,
        method: "rules",
        evidence: [],
        candidates: [],
        needsConfirmation: true,
      },
      preview: null,
      error: `Could not read the file: ${(cause as Error).message}`,
    };
  }

  const classification = classifyGrid({ filename, grid });
  const parsed = classification.reportType
    ? previewParse(clientId, classification.reportType, grid)
    : null;
  const preview = parsed?.result ?? null;

  const record = {
    id: sourceFileId,
    clientId,
    filename,
    storedPath,
    sha256,
    byteSize: bytes.byteLength,
    extension,
    reportType: classification.reportType,
    confidence: classification.confidence,
    classifiedBy: classification.method,
    periodsDetected: JSON.stringify(preview?.periods ?? []),
    status: "classified" as const,
    error: null,
  };

  if (existing) {
    db.update(schema.sourceFiles).set(record).where(eq(schema.sourceFiles.id, sourceFileId)).run();
  } else {
    db.insert(schema.sourceFiles).values(record).run();
  }

  return { sourceFileId, filename, classification, preview };
}

/** Detail rows a parse produced, ready for the detail_rows table. */
export interface ParsedDetail {
  kind: string;
  label: string;
  value: number;
  bucket: string | null;
  count: number | null;
  period: string;
}

export interface ParsedFile {
  result: ParseResult;
  details: ParsedDetail[];
}

/**
 * Snapshot reports (balance sheet, ageing, referral) have no month columns, so their
 * period comes from the report header. When that is missing we fall back to the latest
 * period the client already has data for, and say so — writing a snapshot against the
 * wrong month is worse than refusing.
 */
function snapshotPeriod(clientId: string, grid: Grid): Period | null {
  const explicit = findAsOfPeriod(grid);
  if (explicit) return explicit;

  const db = getDb();
  const rows = db
    .selectDistinct({ period: schema.facts.period })
    .from(schema.facts)
    .where(eq(schema.facts.clientId, clientId))
    .all();
  return (rows.map((r) => r.period).sort().reverse()[0] ?? null) as Period | null;
}

export function previewParse(
  clientId: string,
  reportType: ReportType,
  grid: Grid,
): ParsedFile | null {
  const resolveLabel = buildResolver(clientId);

  if (reportType === "profit_and_loss") {
    const result = parseProfitAndLoss(grid, { resolveLabel });
    const details: ParsedDetail[] = [];
    for (const line of result.detailLines) {
      for (const amount of line.amounts) {
        details.push({
          kind: `pl_${line.section}`,
          label: line.label,
          value: amount.value,
          bucket: null,
          count: null,
          period: amount.period,
        });
      }
    }
    return { result, details };
  }

  if (reportType === "balance_sheet") {
    const fallback = snapshotPeriod(clientId, grid) ?? undefined;
    return {
      result: parseBalanceSheet(grid, { resolveLabel, fallbackPeriod: fallback }),
      details: [],
    };
  }

  if (reportType === "ar_aging" || reportType === "ap_aging") {
    const period = snapshotPeriod(clientId, grid);
    if (!period) {
      return {
        result: {
          reportType,
          periods: [],
          facts: [],
          unmatched: [],
          ignoredColumns: [],
          warnings: [
            "This ageing report carries no date, and this client has no other data to date it against. Import a Profit & Loss or Balance Sheet first.",
          ],
        },
        details: [],
      };
    }
    const parsed = parseAging(grid, { period, reportType });
    return {
      result: parsed,
      details: parsed.entities.map((entity) => ({
        kind: reportType === "ar_aging" ? "ar_customer" : "ap_vendor",
        label: entity.label,
        value: entity.total,
        bucket: entity.bucket,
        count: null,
        period,
      })),
    };
  }

  if (reportType === "sales_by_customer_l12m" || reportType === "referral_l90d") {
    const period = snapshotPeriod(clientId, grid);
    if (!period) {
      return {
        result: {
          reportType,
          periods: [],
          facts: [],
          unmatched: [],
          ignoredColumns: [],
          warnings: [
            "This report carries no date, and this client has no other data to date it against. Import a Profit & Loss first.",
          ],
        },
        details: [],
      };
    }
    const parsed = parseEntityReport(grid, {
      period,
      reportType,
      totalAccountId:
        reportType === "referral_l90d" ? "ops.referral_total" : undefined,
    });
    return {
      result: parsed,
      details: parsed.entities.map((entity) => ({
        kind:
          reportType === "referral_l90d" ? "referral_partner" : "customer_sales",
        label: entity.label,
        value: entity.value,
        bucket: null,
        count: entity.count,
        period,
      })),
    };
  }

  // A combined group report needs splitting into its constituent reports, which is
  // deliberately out of scope: it is the one path where per-report exports are strictly
  // better, and the dialog says so.
  return null;
}

export interface CommitResult {
  factsWritten: number;
  detailsWritten: number;
  periods: string[];
  supersededOverrides: number;
  notices: string[];
  warnings: string[];
}

/**
 * Commit a staged file to the fact store.
 *
 * Override handling is the pure rule from @avilo/module: the fact is always written, and
 * an active override on the same target is moved to 'superseded' rather than deleted, so
 * the manual value and its author survive and can be restored in one click.
 */
export function commitFile(
  clientId: string,
  sourceFileId: string,
  reportTypeOverride?: ReportType,
): CommitResult {
  const db = getDb();

  const file = db
    .select()
    .from(schema.sourceFiles)
    .where(eq(schema.sourceFiles.id, sourceFileId))
    .get();
  if (!file) throw new Error(`Unknown source file: ${sourceFileId}`);

  const reportType = (reportTypeOverride ?? file.reportType) as ReportType | null;
  if (!reportType) throw new Error("This file has no report type. Choose one first.");

  // Re-read from the stored copy so a commit is reproducible from disk.
  const bytes = new Uint8Array(readFileSync(file.storedPath));
  const grid = toGrid(file.filename, bytes);
  const parsedFile = previewParse(clientId, reportType, grid);

  if (!parsedFile) {
    throw new Error(
      reportType === "combined_group_report"
        ? "A combined group report cannot be split automatically. Export each report separately from QuickBooks — the per-report exports parse exactly, which a merged document cannot."
        : `No parser is wired up for ${reportType}.`,
    );
  }

  const parsed = parsedFile.result;

  const activeOverrides = db
    .select()
    .from(schema.overrides)
    .where(
      and(
        eq(schema.overrides.clientId, clientId),
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

  const resolution = resolveImport(
    parsed.facts.map((f) => ({
      period: f.period,
      accountId: f.accountId,
      value: f.value,
    })),
    activeOverrides,
  );

  let factsWritten = 0;
  let detailsWritten = 0;
  let supersededOverrides = 0;

  db.transaction((tx) => {
    for (const fact of parsed.facts) {
      tx.insert(schema.facts)
        .values({
          id: newId("f"),
          clientId,
          period: fact.period,
          accountId: fact.accountId,
          value: fact.value,
          sourceFileId,
          sourceRowLabel: fact.sourceRowLabel,
          sourceColumnLabel: fact.sourceColumnLabel,
        })
        .onConflictDoUpdate({
          target: [
            schema.facts.clientId,
            schema.facts.period,
            schema.facts.accountId,
          ],
          set: {
            value: fact.value,
            sourceFileId,
            sourceRowLabel: fact.sourceRowLabel,
            sourceColumnLabel: fact.sourceColumnLabel,
            updatedAt: nowIso(),
          },
        })
        .run();
      factsWritten += 1;
    }

    // Detail rows are replaced wholesale for the periods this file covers: a re-import
    // of an ageing report must not leave last month's customers behind as ghosts.
    const touchedPeriods = new Set(parsedFile.details.map((d) => d.period));
    const detailKinds = new Set(parsedFile.details.map((d) => d.kind));
    for (const detailPeriod of touchedPeriods) {
      for (const kind of detailKinds) {
        tx.delete(schema.detailRows)
          .where(
            and(
              eq(schema.detailRows.clientId, clientId),
              eq(schema.detailRows.period, detailPeriod),
              eq(schema.detailRows.kind, kind),
            ),
          )
          .run();
      }
    }

    for (const detail of parsedFile.details) {
      tx.insert(schema.detailRows)
        .values({
          id: newId("d"),
          clientId,
          period: detail.period,
          kind: detail.kind,
          label: detail.label,
          value: detail.value,
          bucket: detail.bucket,
          count: detail.count,
          sourceFileId,
        })
        .onConflictDoUpdate({
          target: [
            schema.detailRows.clientId,
            schema.detailRows.period,
            schema.detailRows.kind,
            schema.detailRows.label,
            schema.detailRows.bucket,
          ],
          set: { value: detail.value, count: detail.count, sourceFileId },
        })
        .run();
      detailsWritten += 1;
    }

    for (const action of resolution.actions) {
      if (action.kind !== "supersede_override") continue;
      tx.update(schema.overrides)
        .set({
          status: "superseded",
          supersededBySourceFileId: sourceFileId,
          supersededValue: action.supersededValue,
          supersededAt: nowIso(),
        })
        .where(eq(schema.overrides.id, action.overrideId))
        .run();
      supersededOverrides += 1;
    }

    tx.update(schema.sourceFiles)
      .set({
        status: "imported",
        reportType,
        importedAt: nowIso(),
        periodsDetected: JSON.stringify(parsed.periods),
      })
      .where(eq(schema.sourceFiles.id, sourceFileId))
      .run();

    tx.insert(schema.auditLog)
      .values({
        id: newId("a"),
        action: "import.commit",
        entity: "source_file",
        entityId: sourceFileId,
        detail: JSON.stringify({
          reportType,
          periods: parsed.periods,
          factsWritten,
          supersededOverrides,
        }),
      })
      .run();
  });

  return {
    factsWritten,
    detailsWritten,
    periods: parsed.periods,
    supersededOverrides,
    notices: resolution.notices,
    warnings: parsed.warnings,
  };
}
