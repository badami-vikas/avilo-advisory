import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";

import {
  classifyGrid,
  parseProfitAndLoss,
  primarySheet,
  readCsv,
  readWorkbook,
  resolveImport,
  type Classification,
  type Grid,
  type ParseResult,
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
  const preview = classification.reportType
    ? previewParse(clientId, classification.reportType, grid)
    : null;

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

export function previewParse(
  clientId: string,
  reportType: ReportType,
  grid: Grid,
): ParseResult | null {
  const resolveLabel = buildResolver(clientId);
  if (reportType === "profit_and_loss") {
    return parseProfitAndLoss(grid, { resolveLabel });
  }
  // Phase 2 wires the remaining five parsers. Returning null keeps the review screen
  // honest about what this build can and cannot ingest.
  return null;
}

export interface CommitResult {
  factsWritten: number;
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
  const parsed = previewParse(clientId, reportType, grid);

  if (!parsed) {
    throw new Error(
      `No parser is wired up for ${reportType} in this build. Phase 2 adds the remaining report types.`,
    );
  }

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
    periods: parsed.periods,
    supersededOverrides,
    notices: resolution.notices,
    warnings: parsed.warnings,
  };
}
