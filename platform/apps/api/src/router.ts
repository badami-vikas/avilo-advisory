import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";

import {
  CANONICAL_ACCOUNTS,
  fiscalYearToDate,
  isPeriod,
  normalizeLabel,
  validateExpression,
  type ReportType,
} from "@avilo/module";
import { getDb, newId, nowIso, schema } from "./db.js";
import { learnMapping } from "./services/labels.js";
import { commitFile, stageFile } from "./services/import.js";
import {
  availablePeriods,
  buildPeriodReport,
  buildSeries,
  loadFormulaSpecs,
} from "./services/report.js";

const t = initTRPC.create();
export const router = t.router;
export const procedure = t.procedure;

const periodSchema = z.string().refine(isPeriod, {
  message: "Period must be in YYYY-MM form",
});

function requireClient(clientId: string) {
  const db = getDb();
  const client = db
    .select()
    .from(schema.clients)
    .where(eq(schema.clients.id, clientId))
    .get();
  if (!client) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Client not found" });
  }
  return client;
}

/* ------------------------------------------------------------------ clients */

const clientsRouter = router({
  list: procedure.query(() => {
    const db = getDb();
    const rows = db.select().from(schema.clients).orderBy(schema.clients.name).all();

    // Summary figures for the landing table's stat tiles and columns. Computed from the
    // latest period each client actually has, never from a hardcoded "current month".
    return rows.map((client) => {
      const periods = availablePeriods(client.id);
      const latest = periods[0];
      const report = latest ? buildPeriodReport(client.id, latest) : null;
      const metric = (id: string) =>
        report?.metrics.find((m) => m.id === id)?.value ?? null;

      return {
        ...client,
        latestPeriod: latest ?? null,
        periodCount: periods.length,
        revenue:
          report?.accounts.find((a) => a.accountId === "pl.revenue")?.value ?? null,
        netOperatingIncome: metric("net_operating_income"),
        grossMarginPct: metric("gross_margin_pct"),
        noiMarginPct: metric("noi_margin_pct"),
        daysCashOnHand: metric("days_cash_on_hand"),
        missingCount: report?.missingRequired.length ?? null,
        complete: report?.complete ?? false,
      };
    });
  }),

  get: procedure.input(z.object({ id: z.string() })).query(({ input }) => {
    return requireClient(input.id);
  }),

  create: procedure
    .input(
      z.object({
        name: z.string().min(1, "A client needs a name"),
        legalName: z.string().optional(),
        stage: z.string().optional(),
        industry: z.string().optional(),
        owner: z.string().optional(),
        fiscalYearStartMonth: z.number().int().min(1).max(12).optional(),
      }),
    )
    .mutation(({ input }) => {
      const db = getDb();
      const id = newId("cl");
      db.insert(schema.clients)
        .values({
          id,
          name: input.name,
          legalName: input.legalName ?? null,
          // A new client has not been onboarded yet — that is the honest starting
          // stage, and the advisor moves it to Active deliberately.
          stage: input.stage ?? "Onboarding",
          industry: input.industry ?? null,
          owner: input.owner ?? null,
          fiscalYearStartMonth: input.fiscalYearStartMonth ?? 1,
        })
        .run();
      return { id };
    }),

  update: procedure
    .input(
      z.object({
        id: z.string(),
        patch: z.object({
          name: z.string().min(1).optional(),
          legalName: z.string().nullable().optional(),
          stage: z.string().optional(),
          industry: z.string().nullable().optional(),
          owner: z.string().nullable().optional(),
          notes: z.string().nullable().optional(),
          fiscalYearStartMonth: z.number().int().min(1).max(12).optional(),
        }),
      }),
    )
    .mutation(({ input }) => {
      const db = getDb();
      requireClient(input.id);
      db.update(schema.clients)
        .set({ ...input.patch, updatedAt: nowIso() })
        .where(eq(schema.clients.id, input.id))
        .run();
      return { ok: true };
    }),

  remove: procedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
    const db = getDb();
    db.delete(schema.clients).where(eq(schema.clients.id, input.id)).run();
    return { ok: true };
  }),
});

/* ------------------------------------------------------------------- report */

const reportRouter = router({
  periods: procedure
    .input(z.object({ clientId: z.string() }))
    .query(({ input }) => availablePeriods(input.clientId)),

  period: procedure
    .input(z.object({ clientId: z.string(), period: periodSchema }))
    .query(({ input }) => buildPeriodReport(input.clientId, input.period)),

  series: procedure
    .input(
      z.object({
        clientId: z.string(),
        start: periodSchema,
        end: periodSchema,
        ids: z.array(z.string()),
      }),
    )
    .query(({ input }) =>
      buildSeries(input.clientId, input.start, input.end, input.ids),
    ),

  /** The advisor's Key Insights note for one client-month. */
  note: procedure
    .input(z.object({ clientId: z.string(), period: periodSchema }))
    .query(({ input }) => {
      const db = getDb();
      const row = db
        .select()
        .from(schema.periodNotes)
        .where(
          and(
            eq(schema.periodNotes.clientId, input.clientId),
            eq(schema.periodNotes.period, input.period),
          ),
        )
        .get();
      return { body: row?.body ?? "" };
    }),

  setNote: procedure
    .input(
      z.object({
        clientId: z.string(),
        period: periodSchema,
        body: z.string().max(5000),
      }),
    )
    .mutation(({ input }) => {
      const db = getDb();
      requireClient(input.clientId);
      db.insert(schema.periodNotes)
        .values({
          clientId: input.clientId,
          period: input.period,
          body: input.body,
          updatedAt: nowIso(),
        })
        .onConflictDoUpdate({
          target: [schema.periodNotes.clientId, schema.periodNotes.period],
          set: { body: input.body, updatedAt: nowIso() },
        })
        .run();
      return { ok: true };
    }),

  /**
   * Entity-level detail for one period: customers owing money, vendors owed, expense
   * lines, top customers, referral partners.
   */
  detail: procedure
    .input(z.object({ clientId: z.string(), period: periodSchema }))
    .query(({ input }) => {
      const db = getDb();
      const rows = db
        .select()
        .from(schema.detailRows)
        .where(
          and(
            eq(schema.detailRows.clientId, input.clientId),
            eq(schema.detailRows.period, input.period),
          ),
        )
        .all();

      const byKind: Record<string, typeof rows> = {};
      for (const row of rows) {
        (byKind[row.kind] ??= []).push(row);
      }
      for (const list of Object.values(byKind)) {
        list.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
      }
      return byKind;
    }),

  /** Default export range: current financial year to date, per the client's FY start. */
  defaultExportRange: procedure
    .input(z.object({ clientId: z.string() }))
    .query(({ input }) => {
      const client = requireClient(input.clientId);
      const periods = availablePeriods(input.clientId);
      const latest = periods[0];
      if (!latest) return null;
      const range = fiscalYearToDate(latest, client.fiscalYearStartMonth);
      return { label: range.label, start: range.start, end: range.end };
    }),
});

/* ----------------------------------------------------------------- accounts */

const accountsRouter = router({
  list: procedure.query(() => {
    const db = getDb();
    return db.select().from(schema.accounts).orderBy(schema.accounts.sortOrder).all();
  }),
});

/* ----------------------------------------------------------------- formulas */

const formulasRouter = router({
  list: procedure.query(() => {
    const db = getDb();
    return db.select().from(schema.formulas).orderBy(schema.formulas.sortOrder).all();
  }),

  history: procedure.input(z.object({ id: z.string() })).query(({ input }) => {
    const db = getDb();
    return db
      .select()
      .from(schema.formulaVersions)
      .where(eq(schema.formulaVersions.formulaId, input.id))
      .orderBy(desc(schema.formulaVersions.version))
      .all();
  }),

  validate: procedure
    .input(z.object({ id: z.string(), expression: z.string() }))
    .query(({ input }) =>
      validateExpression(
        input.expression,
        input.id,
        loadFormulaSpecs(),
        CANONICAL_ACCOUNTS.map((a) => a.id),
      ),
    ),

  /**
   * Update a formula. Global and versioned: the change applies to every client and every
   * period, retroactively, because metrics are computed on read rather than stored.
   * Rejected up front if the expression is invalid or would create a cycle — a bad edit
   * here would otherwise break every client's dashboard at once.
   */
  update: procedure
    .input(
      z.object({
        id: z.string(),
        expression: z.string().min(1),
        note: z.string().optional(),
      }),
    )
    .mutation(({ input }) => {
      const db = getDb();
      const existing = db
        .select()
        .from(schema.formulas)
        .where(eq(schema.formulas.id, input.id))
        .get();
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Formula not found" });
      }

      const validation = validateExpression(
        input.expression,
        input.id,
        loadFormulaSpecs(),
        CANONICAL_ACCOUNTS.map((a) => a.id),
      );
      if (!validation.ok) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: validation.error ?? "Invalid expression",
        });
      }

      const nextVersion = existing.version + 1;
      db.transaction((tx) => {
        tx.insert(schema.formulaVersions)
          .values({
            id: `${input.id}@${nextVersion}`,
            formulaId: input.id,
            version: nextVersion,
            expression: input.expression,
            author: "local",
            note: input.note ?? null,
          })
          .run();
        tx.update(schema.formulas)
          .set({
            expression: input.expression,
            version: nextVersion,
            updatedAt: nowIso(),
          })
          .where(eq(schema.formulas.id, input.id))
          .run();
        tx.insert(schema.auditLog)
          .values({
            id: newId("a"),
            action: "formula.update",
            entity: "formula",
            entityId: input.id,
            detail: JSON.stringify({
              from: existing.expression,
              to: input.expression,
              version: nextVersion,
            }),
          })
          .run();
      });

      return { version: nextVersion };
    }),

  rollback: procedure
    .input(z.object({ id: z.string(), version: z.number().int() }))
    .mutation(({ input }) => {
      const db = getDb();
      const target = db
        .select()
        .from(schema.formulaVersions)
        .where(
          and(
            eq(schema.formulaVersions.formulaId, input.id),
            eq(schema.formulaVersions.version, input.version),
          ),
        )
        .get();
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Version not found" });
      }
      const existing = db
        .select()
        .from(schema.formulas)
        .where(eq(schema.formulas.id, input.id))
        .get();
      const nextVersion = (existing?.version ?? 1) + 1;

      db.transaction((tx) => {
        tx.insert(schema.formulaVersions)
          .values({
            id: `${input.id}@${nextVersion}`,
            formulaId: input.id,
            version: nextVersion,
            expression: target.expression,
            author: "local",
            note: `Rolled back to v${input.version}`,
          })
          .run();
        tx.update(schema.formulas)
          .set({
            expression: target.expression,
            version: nextVersion,
            updatedAt: nowIso(),
          })
          .where(eq(schema.formulas.id, input.id))
          .run();
      });
      return { version: nextVersion };
    }),
});

/* ---------------------------------------------------------------- overrides */

const overridesRouter = router({
  list: procedure
    .input(z.object({ clientId: z.string(), period: periodSchema.optional() }))
    .query(({ input }) => {
      const db = getDb();
      const where = input.period
        ? and(
            eq(schema.overrides.clientId, input.clientId),
            eq(schema.overrides.period, input.period),
          )
        : eq(schema.overrides.clientId, input.clientId);
      return db
        .select()
        .from(schema.overrides)
        .where(where)
        .orderBy(desc(schema.overrides.createdAt))
        .all();
    }),

  /**
   * Set a value override. Local to this client and period, permanent across sessions,
   * and explicitly NOT a formula change — the distinction the UI forces the user to make.
   */
  set: procedure
    .input(
      z.object({
        clientId: z.string(),
        period: periodSchema,
        targetKind: z.enum(["account", "metric"]),
        targetId: z.string(),
        value: z.number().finite(),
        previousValue: z.number().finite().nullable().optional(),
        reason: z.string().optional(),
      }),
    )
    .mutation(({ input }) => {
      const db = getDb();
      requireClient(input.clientId);

      db.transaction((tx) => {
        // One active override per target. A re-entry replaces the previous one, which
        // moves to 'restored' history rather than vanishing.
        tx.update(schema.overrides)
          .set({ status: "restored" })
          .where(
            and(
              eq(schema.overrides.clientId, input.clientId),
              eq(schema.overrides.period, input.period),
              eq(schema.overrides.targetKind, input.targetKind),
              eq(schema.overrides.targetId, input.targetId),
              eq(schema.overrides.status, "active"),
            ),
          )
          .run();

        tx.insert(schema.overrides)
          .values({
            id: newId("ov"),
            clientId: input.clientId,
            period: input.period,
            targetKind: input.targetKind,
            targetId: input.targetId,
            value: input.value,
            previousValue: input.previousValue ?? null,
            reason: input.reason ?? null,
            author: "local",
            status: "active",
          })
          .run();
      });

      return { ok: true };
    }),

  clear: procedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
    const db = getDb();
    db.update(schema.overrides)
      .set({ status: "restored" })
      .where(eq(schema.overrides.id, input.id))
      .run();
    return { ok: true };
  }),

  /** Reinstate a superseded override, the one-click restore the product promises. */
  restore: procedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
    const db = getDb();
    const row = db
      .select()
      .from(schema.overrides)
      .where(eq(schema.overrides.id, input.id))
      .get();
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Override not found" });

    db.transaction((tx) => {
      tx.update(schema.overrides)
        .set({ status: "restored" })
        .where(
          and(
            eq(schema.overrides.clientId, row.clientId),
            eq(schema.overrides.period, row.period),
            eq(schema.overrides.targetKind, row.targetKind),
            eq(schema.overrides.targetId, row.targetId),
            eq(schema.overrides.status, "active"),
          ),
        )
        .run();
      tx.update(schema.overrides)
        .set({ status: "active", supersededAt: null, supersededValue: null })
        .where(eq(schema.overrides.id, input.id))
        .run();
    });
    return { ok: true };
  }),
});

/* ------------------------------------------------------------------- import */

const importRouter = router({
  stage: procedure
    .input(
      z.object({
        clientId: z.string(),
        files: z.array(
          z.object({
            filename: z.string(),
            /** base64 payload; the browser never sends this anywhere but localhost. */
            content: z.string(),
          }),
        ),
      }),
    )
    .mutation(async ({ input }) => {
      requireClient(input.clientId);
      // Sequential rather than concurrent: staging writes the stored copy and the
      // source_files row, and a multi-file upload of the same report twice must resolve
      // to one row deterministically rather than racing on the sha256 lookup.
      const staged = [];
      for (const file of input.files) {
        staged.push(
          await stageFile(
            input.clientId,
            file.filename,
            new Uint8Array(Buffer.from(file.content, "base64")),
          ),
        );
      }
      return staged;
    }),

  /** Teach a label→account mapping, then the caller re-stages to see the effect. */
  mapLabel: procedure
    .input(
      z.object({
        clientId: z.string().nullable(),
        reportType: z.string(),
        rawLabel: z.string(),
        accountId: z.string(),
        scope: z.enum(["client", "global"]).default("client"),
      }),
    )
    .mutation(({ input }) => {
      learnMapping({
        clientId: input.scope === "global" ? null : input.clientId,
        reportType: input.reportType as ReportType,
        normalizedLabel: normalizeLabel(input.rawLabel),
        rawLabel: input.rawLabel,
        accountId: input.accountId,
      });
      return { ok: true };
    }),

  commit: procedure
    .input(
      z.object({
        clientId: z.string(),
        sourceFileId: z.string(),
        reportType: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        return await commitFile(
          input.clientId,
          input.sourceFileId,
          input.reportType as ReportType | undefined,
        );
      } catch (cause) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: (cause as Error).message,
        });
      }
    }),

  files: procedure
    .input(z.object({ clientId: z.string() }))
    .query(({ input }) => {
      const db = getDb();
      return db
        .select()
        .from(schema.sourceFiles)
        .where(eq(schema.sourceFiles.clientId, input.clientId))
        .orderBy(desc(schema.sourceFiles.uploadedAt))
        .all();
    }),
});

/* -------------------------------------------------------------------- lists */

/**
 * Saved lists.
 *
 * A "list" is a persisted ViewConfig over the same rows — the Baserow precedent the
 * platform already adopts: filters and sorts are a stored overlay, not a separate table
 * or a separate component. "All" is the implicit list with no overlay.
 */
const viewsRouter = router({
  list: procedure
    .input(z.object({ tableId: z.string() }))
    .query(({ input }) => {
      const db = getDb();
      return db
        .select()
        .from(schema.savedViews)
        .where(eq(schema.savedViews.tableId, input.tableId))
        .all();
    }),

  save: procedure
    .input(
      z.object({
        id: z.string().optional(),
        tableId: z.string(),
        name: z.string().min(1),
        config: z.string(),
      }),
    )
    .mutation(({ input }) => {
      const db = getDb();
      const id = input.id ?? newId("view");
      db.insert(schema.savedViews)
        .values({
          id,
          tableId: input.tableId,
          name: input.name,
          config: input.config,
          isDefault: false,
        })
        .onConflictDoUpdate({
          target: schema.savedViews.id,
          set: { name: input.name, config: input.config },
        })
        .run();
      return { id };
    }),

  remove: procedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
    const db = getDb();
    db.delete(schema.savedViews).where(eq(schema.savedViews.id, input.id)).run();
    return { ok: true };
  }),
});

export const appRouter = router({
  views: viewsRouter,
  clients: clientsRouter,
  report: reportRouter,
  accounts: accountsRouter,
  formulas: formulasRouter,
  overrides: overridesRouter,
  import: importRouter,
});

export type AppRouter = typeof appRouter;
