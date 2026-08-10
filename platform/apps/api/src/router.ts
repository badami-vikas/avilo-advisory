import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";

import {
  CANONICAL_ACCOUNTS,
  fiscalYearToDate,
  isPeriod,
  buildNarrativePrompt,
  buildRichNarrativePrompt,
  fabricatedFigures,
  KEY_INSIGHTS_GUIDANCE,
  normalizeLabel,
  suggestMappings,
  validateExpression,
  type ReportType,
} from "@avilo/module";
import { getDb, newId, nowIso, schema } from "./db.js";
import {
  callGroq,
  groqConfig,
  groqRunner,
  readSetting,
  DEFAULT_GROQ_MODEL,
} from "./services/ai.js";
import { forgetMapping, learnMapping } from "./services/labels.js";
import { commitFile, stageFile } from "./services/import.js";
import {
  availablePeriods,
  buildPeriodReport,
  buildSeries,
  loadFormulaSpecs,
} from "./services/report.js";
import {
  activateProposal,
  exportBlueprint,
  listProposals,
  proposeBlueprint,
  rejectProposal,
  restoreVersion,
} from "./services/blueprint.js";
import { getVersion, listVersions } from "./services/versions.js";
import {
  parseSummaryOutput,
  salvageSummaryText,
  summaryDestinations,
  summaryLinkRegistry,
} from "./services/configuration.js";
import { converse } from "./services/copilot.js";
import { summaryPlainText } from "@avilo/core";

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

      const account = (id: string) =>
        report?.accounts.find((a) => a.accountId === id)?.value ?? null;

      return {
        ...client,
        latestPeriod: latest ?? null,
        periodCount: periods.length,
        revenue: account("pl.revenue"),
        cogs: account("pl.cogs"),
        overhead: account("pl.overhead"),
        cash: account("bs.cash"),
        ar: account("bs.ar"),
        ap: account("bs.ap"),
        totalAssets: account("bs.total_assets"),
        grossProfit: metric("gross_profit"),
        netOperatingIncome: metric("net_operating_income"),
        grossMarginPct: metric("gross_margin_pct"),
        noiMarginPct: metric("noi_margin_pct"),
        daysCashOnHand: metric("days_cash_on_hand"),
        dso: metric("dso"),
        dpo: metric("dpo"),
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

  /**
   * One kind of detail row for every period, keyed by period.
   *
   * The per-period `detail` query answers "what is this month made of". This answers
   * "what has every month been made of", which is what lets the growth chart draw its
   * bars as the lines that compose them rather than as a single total with the
   * composition printed underneath. One query rather than twelve: the rows for a client
   * and a kind are a few hundred at most, and twelve round trips to draw one chart is a
   * waterfall the user watches.
   */
  detailSeries: procedure
    .input(z.object({ clientId: z.string(), kind: z.string() }))
    .query(({ input }) => {
      const db = getDb();
      const rows = db
        .select()
        .from(schema.detailRows)
        .where(
          and(
            eq(schema.detailRows.clientId, input.clientId),
            eq(schema.detailRows.kind, input.kind),
          ),
        )
        .all();

      const byPeriod: Record<string, typeof rows> = {};
      for (const row of rows) {
        (byPeriod[row.period] ??= []).push(row);
      }
      return byPeriod;
    }),

  /**
   * Rewrite the computed summary as prose. User-triggered only.
   *
   * The findings are calculated before the model is involved and are passed in as its only
   * source, so this rewrites rather than analyses. Output is checked back against the
   * source figures; if it asserts a number the books do not contain, it is rejected and
   * the caller keeps the deterministic summary.
   */
  generateSummary: procedure
    .input(
      z.object({
        clientName: z.string(),
        periodLabel: z.string(),
        beats: z.array(
          z.object({
            kicker: z.string(),
            headline: z.string(),
            body: z.array(z.string()),
          }),
        ),
      }),
    )
    .mutation(async ({ input }) => {
      const config = groqConfig();
      if (!config) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No model configured. Add a Groq API key under Clients \u2192 \u22ef \u2192 Model settings. One key serves every AI feature.",
        });
      }

      const guidance = readSetting("narrative_guidance") ?? undefined;
      const registry = summaryLinkRegistry();
      const prompt = buildRichNarrativePrompt({
        ...input,
        guidance,
        destinations: summaryDestinations(registry),
      });

      try {
        /*
          Generously sized, and it has to be. The rich form wraps every run of text in a
          span object, so the same summary costs roughly three times the tokens plain prose
          did — at the old ceiling the reply was cut off mid-object, no closing brace ever
          arrived, and every generation silently fell back to salvaged plain text. The
          symptom was indistinguishable from the model ignoring the format.
        */
        const output = (await callGroq(config, prompt, 2600, { json: true })).trim();
        const source = input.beats
          .map((b) => `${b.headline} ${b.body.join(" ")}`)
          .join(" ");

        /*
          Parse to a SummaryDoc if we can, and fall back to treating the whole reply as
          plain prose if we cannot. Falling back rather than failing matters: the fabricated
          -figure check below is the guarantee, and it runs identically either way, so an
          unparseable reply costs the advisor colour and links — not correctness, and not
          the Generate button working at all.
        */
        const doc = parseSummaryOutput(output, registry);
        const text = doc ? summaryPlainText(doc) : salvageSummaryText(output);

        // The check reads the FLATTENED text, so a figure inside a coloured span is caught
        // exactly as one in plain prose is. Splitting into spans must not open a gap here.
        const fabricated = fabricatedFigures(source, text);
        if (fabricated.length > 0) {
          return {
            ok: false as const,
            text: "",
            doc: null,
            message: `Discarded — the draft contained figures not in your books (${fabricated.slice(0, 3).join(", ")}).`,
          };
        }
        return { ok: true as const, text, doc, message: "" };
      } catch (cause) {
        throw new TRPCError({ code: "BAD_GATEWAY", message: (cause as Error).message });
      }
    }),

  /**
   * Draft a starting point for Key Insights — the advisor's own commentary field.
   *
   * Same shape and same guarantee as `generateSummary`: findings computed before the model
   * is involved are its only source, and the reply is checked back against them, so it
   * cannot introduce a figure the books do not have. The difference is what happens to the
   * result. `generateSummary`'s draft is shown ALONGSIDE the deterministic summary and never
   * persisted on its own. This one is returned as plain text for the caller to drop into the
   * Key Insights textarea AS A DRAFT — the advisor still has to blur or press Cmd-Enter to
   * save it, the same action saving a hand-typed note takes. Nothing here writes to
   * `period_notes` directly; this procedure only drafts text; the existing `report.setNote`
   * mutation is still the only way anything is stored.
   */
  generateKeyInsights: procedure
    .input(
      z.object({
        clientName: z.string(),
        periodLabel: z.string(),
        beats: z.array(
          z.object({
            kicker: z.string(),
            headline: z.string(),
            body: z.array(z.string()),
          }),
        ),
      }),
    )
    .mutation(async ({ input }) => {
      const config = groqConfig();
      if (!config) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No model configured. Add a Groq API key under Clients → ⋯ → Model settings. One key serves every AI feature.",
        });
      }

      const prompt = buildNarrativePrompt({ ...input, guidance: KEY_INSIGHTS_GUIDANCE });

      try {
        const text = (await callGroq(config, prompt, 400)).trim();
        const source = input.beats.map((b) => `${b.headline} ${b.body.join(" ")}`).join(" ");

        const fabricated = fabricatedFigures(source, text);
        if (fabricated.length > 0) {
          return {
            ok: false as const,
            text: "",
            message: `Discarded — the draft contained figures not in your books (${fabricated.slice(0, 3).join(", ")}).`,
          };
        }
        return { ok: true as const, text, message: "" };
      } catch (cause) {
        throw new TRPCError({ code: "BAD_GATEWAY", message: (cause as Error).message });
      }
    }),

  /**
   * The advisor's own wording for this month's summary, if it is still valid.
   *
   * Returns nothing once the figures have moved: the caller sends the fingerprint of the
   * summary it just computed, and an edit written against different numbers is stale by
   * definition. New data supersedes a custom edit — a page showing hand-written prose
   * above figures it no longer describes is worse than no edit at all.
   */
  summaryEdit: procedure
    .input(
      z.object({
        clientId: z.string(),
        period: periodSchema,
        fingerprint: z.string(),
      }),
    )
    .query(({ input }) => {
      const db = getDb();
      const row = db
        .select()
        .from(schema.summaryEdits)
        .where(
          and(
            eq(schema.summaryEdits.clientId, input.clientId),
            eq(schema.summaryEdits.period, input.period),
          ),
        )
        .get();
      if (!row) return { body: null, superseded: false };
      if (row.sourceFingerprint !== input.fingerprint) {
        return { body: null, superseded: true };
      }
      return { body: row.body, superseded: false };
    }),

  setSummaryEdit: procedure
    .input(
      z.object({
        clientId: z.string(),
        period: periodSchema,
        body: z.string().max(8000),
        fingerprint: z.string(),
      }),
    )
    .mutation(({ input }) => {
      const db = getDb();
      requireClient(input.clientId);

      // An empty body is a request to go back to the calculated summary, not a request to
      // store emptiness.
      if (input.body.trim() === "") {
        db.delete(schema.summaryEdits)
          .where(
            and(
              eq(schema.summaryEdits.clientId, input.clientId),
              eq(schema.summaryEdits.period, input.period),
            ),
          )
          .run();
        return { ok: true };
      }

      db.insert(schema.summaryEdits)
        .values({
          clientId: input.clientId,
          period: input.period,
          body: input.body,
          sourceFingerprint: input.fingerprint,
          updatedAt: nowIso(),
        })
        .onConflictDoUpdate({
          target: [schema.summaryEdits.clientId, schema.summaryEdits.period],
          set: {
            body: input.body,
            sourceFingerprint: input.fingerprint,
            updatedAt: nowIso(),
          },
        })
        .run();
      return { ok: true };
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

  /**
   * Ask the configured model to map rows the deterministic resolver could not place.
   *
   * Returns proposals only. Nothing is persisted and no fact is written — the user
   * accepts a suggestion through the same `mapLabel` path as a manual choice, which is
   * what turns an accepted proposal into a mapping the app never has to ask about again.
   */
  suggestMappings: procedure
    .input(
      z.object({
        reportType: z.string(),
        labels: z.array(z.string()).max(100),
      }),
    )
    .mutation(async ({ input }) => {
      const runner = groqRunner(1200);
      if (!runner) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No model configured. Add a Groq API key under Clients \u2192 \u22ef \u2192 Model settings. One key serves every AI feature.",
        });
      }

      const statementOf: Record<string, string> = {
        profit_and_loss: "pl",
        balance_sheet: "balance_sheet",
        ar_aging: "ar_aging",
        ap_aging: "ap_aging",
        sales_by_customer_l12m: "sales_by_customer",
        referral_l90d: "referral",
      };

      try {
        return await suggestMappings(
          {
            labels: input.labels,
            reportType: statementOf[input.reportType] ?? "",
            // Editable without a redeploy, the same way formulas are.
            guidance: readSetting("accounting_guidance") ?? undefined,
            candidates: CANONICAL_ACCOUNTS.map((a) => ({
              id: a.id,
              label: a.label,
              statement: a.statement,
            })),
          },
          runner,
        );
      } catch (cause) {
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message: (cause as Error).message,
        });
      }
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

  /** Undo a taught mapping, so a mis-click is one click to reverse rather than permanent. */
  unmapLabel: procedure
    .input(
      z.object({
        clientId: z.string().nullable(),
        reportType: z.string(),
        rawLabel: z.string(),
        scope: z.enum(["client", "global"]).default("client"),
      }),
    )
    .mutation(({ input }) => {
      const removed = forgetMapping({
        clientId: input.scope === "global" ? null : input.clientId,
        reportType: input.reportType as ReportType,
        normalizedLabel: normalizeLabel(input.rawLabel),
      });
      return { ok: true, removed };
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

/* ------------------------------------------------------------ sticky notes */

const STICKY_COLORS = ["yellow", "blue", "green", "pink"] as const;

/**
 * The advisor's working memory for a client.
 *
 * Ordering is `pinned, sortOrder, createdAt` and is applied here rather than in the
 * component, so the board reads the same whichever surface asks for it.
 */
const stickyNotesRouter = router({
  list: procedure.input(z.object({ clientId: z.string() })).query(({ input }) => {
    const db = getDb();
    return db
      .select()
      .from(schema.stickyNotes)
      .where(eq(schema.stickyNotes.clientId, input.clientId))
      .orderBy(
        desc(schema.stickyNotes.pinned),
        schema.stickyNotes.sortOrder,
        schema.stickyNotes.createdAt,
      )
      .all();
  }),

  create: procedure
    .input(
      z.object({
        clientId: z.string(),
        body: z.string().max(4000).default(""),
        color: z.enum(STICKY_COLORS).default("yellow"),
      }),
    )
    .mutation(({ input }) => {
      const db = getDb();
      requireClient(input.clientId);
      const id = newId("note");
      // New notes go to the front of the pile: the thing just written down is the thing
      // being thought about.
      const lowest = db
        .select({ sortOrder: schema.stickyNotes.sortOrder })
        .from(schema.stickyNotes)
        .where(eq(schema.stickyNotes.clientId, input.clientId))
        .orderBy(schema.stickyNotes.sortOrder)
        .get();
      db.insert(schema.stickyNotes)
        .values({
          id,
          clientId: input.clientId,
          body: input.body,
          color: input.color,
          sortOrder: (lowest?.sortOrder ?? 0) - 1,
        })
        .run();
      return { id };
    }),

  update: procedure
    .input(
      z.object({
        id: z.string(),
        body: z.string().max(4000).optional(),
        color: z.enum(STICKY_COLORS).optional(),
        pinned: z.boolean().optional(),
      }),
    )
    .mutation(({ input }) => {
      const db = getDb();
      const { id, ...patch } = input;
      db.update(schema.stickyNotes)
        .set({ ...patch, updatedAt: nowIso() })
        .where(eq(schema.stickyNotes.id, id))
        .run();
      return { ok: true };
    }),

  remove: procedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
    const db = getDb();
    db.delete(schema.stickyNotes).where(eq(schema.stickyNotes.id, input.id)).run();
    return { ok: true };
  }),
});

/* ----------------------------------------------------------- action states */

/**
 * The human half of a recommended action.
 *
 * The action itself is derived on every render and is never stored — a saved
 * recommendation would outlive the condition that produced it. Only the assignment is
 * persisted, keyed by the action's stable id.
 */
const actionsRouter = router({
  list: procedure
    .input(z.object({ clientId: z.string(), period: periodSchema }))
    .query(({ input }) => {
      const db = getDb();
      return db
        .select()
        .from(schema.actionStates)
        .where(
          and(
            eq(schema.actionStates.clientId, input.clientId),
            eq(schema.actionStates.period, input.period),
          ),
        )
        .all();
    }),

  set: procedure
    .input(
      z.object({
        clientId: z.string(),
        period: periodSchema,
        actionId: z.string().min(1),
        owner: z.string().max(120).nullable().optional(),
        dueDate: z.string().max(40).nullable().optional(),
        status: z
          .enum(["not_started", "in_progress", "done", "dropped"])
          .optional(),
      }),
    )
    .mutation(({ input }) => {
      const db = getDb();
      requireClient(input.clientId);
      const { clientId, period, actionId, ...patch } = input;
      db.insert(schema.actionStates)
        .values({
          clientId,
          period,
          actionId,
          owner: patch.owner ?? null,
          dueDate: patch.dueDate ?? null,
          status: patch.status ?? "not_started",
          updatedAt: nowIso(),
        })
        .onConflictDoUpdate({
          target: [
            schema.actionStates.clientId,
            schema.actionStates.period,
            schema.actionStates.actionId,
          ],
          // Only the fields actually sent: setting an owner must not clear a due date.
          set: { ...patch, updatedAt: nowIso() },
        })
        .run();
      return { ok: true };
    }),
});

const settingsRouter = router({
  get: procedure
    .input(z.object({ key: z.string() }))
    .query(({ input }) => {
      const db = getDb();
      return db.select().from(schema.appSettings).where(eq(schema.appSettings.key, input.key)).get() ?? null;
    }),
  set: procedure
    .input(z.object({ key: z.string(), value: z.string() }))
    .mutation(({ input }) => {
      const db = getDb();
      db.insert(schema.appSettings)
        .values({ key: input.key, value: input.value })
        .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: input.value } })
        .run();
      return { ok: true };
    }),
  delete: procedure
    .input(z.object({ key: z.string() }))
    .mutation(({ input }) => {
      const db = getDb();
      db.delete(schema.appSettings).where(eq(schema.appSettings.key, input.key)).run();
      return { ok: true };
    }),

  /**
   * Prove the key and model actually work.
   *
   * Without this there is no way to tell a working configuration from a typo: the
   * classifier only consults a model for files the rules cannot place, which for a
   * well-formed QuickBooks export is never — so a broken key stays silent indefinitely.
   */
  testConnection: procedure
    .input(z.object({ apiKey: z.string().optional(), model: z.string().optional() }))
    .mutation(async ({ input }) => {
      const stored = groqConfig();
      const config = {
        apiKey: input.apiKey?.trim() || stored?.apiKey || "",
        model: input.model?.trim() || stored?.model || DEFAULT_GROQ_MODEL,
      };
      if (!config.apiKey) {
        return { ok: false as const, message: "No API key set." };
      }
      const started = Date.now();
      try {
        const reply = await callGroq(config, 'Reply with the single word: ready', 10);
        return {
          ok: true as const,
          message: `${config.model} replied in ${Date.now() - started} ms`,
          reply: reply.trim().slice(0, 40),
        };
      } catch (cause) {
        return { ok: false as const, message: (cause as Error).message };
      }
    }),
});

/*
 * The right-panel AI chatbot (relationship-os AgentPanel counterpart).
 *
 * `copilot.converse` talks to Groq — the same key and reader `settingsRouter` above
 * exercises with Test connection (ADR-011, "one key, one reader"). It never writes
 * directly; a proposed change comes back as a `blueprintProposals` row and this router's
 * `blueprint.*` procedures are the only way it is reviewed and activated.
 */
const copilotRouter = router({
  converse: procedure
    .input(
      z.object({
        history: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string() })).max(40),
        clientId: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const reply = await converse(input.history, input.clientId);
      if (!reply) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No model configured. Add a Groq API key under Clients → ⋯ → Model settings.",
        });
      }
      return reply;
    }),
});

const blueprintRouter = router({
  /** The live configuration, packaged for download as `<name>.avilo-blueprint.json`. */
  export: procedure
    .input(z.object({ name: z.string(), description: z.string().optional() }))
    .query(({ input }) => exportBlueprint(input.name, input.description)),

  /** Validate + diff an imported file or a hand-written document. Records, never applies. */
  propose: procedure
    .input(z.object({ summary: z.string(), document: z.unknown() }))
    .mutation(({ input }) => {
      const outcome = proposeBlueprint("user", input.summary, input.document);
      if ("errors" in outcome) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: outcome.errors.map((e) => `${e.path}: ${e.message}`).join("; "),
        });
      }
      return outcome.proposal;
    }),

  list: procedure.query(() => listProposals()),

  activate: procedure
    .input(z.object({ id: z.string(), note: z.string().optional() }))
    .mutation(({ input }) => activateProposal(input.id, input.note)),

  reject: procedure
    .input(z.object({ id: z.string(), note: z.string().optional() }))
    .mutation(({ input }) => rejectProposal(input.id, input.note)),
});

/**
 * Configuration history, and the way back to any point in it.
 *
 * Read-only apart from `restore`, and `restore` cannot introduce a state that has not
 * already been live — it names a recorded version, never a document. That is what makes
 * the same surface safe to expose to a person and to an external agent over MCP.
 */
const versionsRouter = router({
  list: procedure
    .input(z.object({ limit: z.number().int().min(1).max(200).optional() }).optional())
    .query(({ input }) => listVersions(input?.limit ?? 100)),

  get: procedure.input(z.object({ id: z.string() })).query(({ input }) => {
    const version = getVersion(input.id);
    if (!version) throw new TRPCError({ code: "NOT_FOUND", message: `No version ${input.id}` });
    return version;
  }),

  restore: procedure
    .input(z.object({ id: z.string(), author: z.string().default("user") }))
    .mutation(({ input }) => {
      const outcome = restoreVersion(input.id, input.author);
      if ("errors" in outcome) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: outcome.errors.map((e) => `${e.path}: ${e.message}`).join("; "),
        });
      }
      return outcome;
    }),
});

export const appRouter = router({
  versions: versionsRouter,
  views: viewsRouter,
  stickyNotes: stickyNotesRouter,
  actions: actionsRouter,
  clients: clientsRouter,
  report: reportRouter,
  accounts: accountsRouter,
  formulas: formulasRouter,
  overrides: overridesRouter,
  import: importRouter,
  settings: settingsRouter,
  copilot: copilotRouter,
  blueprint: blueprintRouter,
});
