/**
 * What the configuration surface IS: the registry a blueprint is validated against, and
 * the current state read back out of the database in blueprint shape.
 *
 * Split out of `blueprint.ts` so the dependency graph stays acyclic. `versions.ts` needs
 * `exportBlueprint` to snapshot a state, and `blueprint.ts` needs `recordVersion` to write
 * one after every activation; with both halves in one file that is a cycle. This module is
 * the shared floor — it imports neither of them, and both import it.
 *
 * `blueprint.ts` re-exports everything here, so existing callers are unaffected.
 */
import type { AviloBlueprint, CustomView, LayoutOverride, RegisteredSurface } from "@avilo/core";
import { CANONICAL_ACCOUNTS, REPORT_TYPES, SEED_FORMULAS } from "@avilo/module";
import { getDb, schema } from "../db.js";
import { readSetting } from "./ai.js";

/** The two prompts actually read at runtime (see suggest.ts / narrative.ts / router.ts). */
export const PROMPT_KEYS = ["accounting_guidance", "narrative_guidance"] as const;

/**
 * Section ids the report layout understands, mirrored from `apps/web/src/app/report/layout.ts`.
 *
 * Not imported from there: the web package pulls in React and Vite-only assets, and this
 * file runs in apps/api. Kept as a flat list rather than re-exported from a shared
 * package because it changes rarely and the cost of drift is a rejected blueprint, not a
 * silently wrong one — `validateBlueprint` refuses an id outside this list.
 */
export const LAYOUT_SECTION_IDS = [
  "key-insights", "revenue-trend", "top-expenses", "at-a-glance", "profitability",
  "cash-position", "ar-customers", "ap-vendors", "ar-ap-timing", "service-lines",
  "top-jobs", "job-performance", "referrals", "gross-overhead", "top-customers", "flags",
] as const;

/**
 * Where a blueprint's `layout` lands: the report format panel's own DEFAULT, not any
 * client's saved layout.
 */
export const REPORT_LAYOUT_DEFAULT_KEY = "report_layout_default";

/** Where user-defined views live — one JSON array, same `app_settings` path as the layout default. */
export const CUSTOM_VIEWS_KEY = "custom_views";

/**
 * Detail sets a generated `table` may bind to, mirrored from `report.detail`'s own keys.
 * A table names one of these; it never carries rows, so the figures in a generated table
 * are the imported ones.
 */
export const DETAIL_KINDS = [
  "pl_income", "pl_expense", "ar_customer", "ap_vendor", "customer_sales", "referral_partner",
] as const;

/**
 * Actions a generated button may invoke.
 *
 * Closed on purpose, and small on purpose: every entry maps to something the application
 * already does and already tests. It cannot invent an action, because a button is a
 * binding to a handler that exists, not a piece of behaviour the model authors.
 */
export const VIEW_ACTIONS = [
  "export-pdf", "upload", "open-report", "open-raw-data", "open-dashboard", "open-standard",
] as const;

export function registeredSurface(): RegisteredSurface {
  const db = getDb();
  const formulaIds = db.select({ id: schema.formulas.id }).from(schema.formulas).all();
  return {
    accountIds: new Set(CANONICAL_ACCOUNTS.map((a) => a.id)),
    formulaIds: new Set([...formulaIds.map((f) => f.id), ...SEED_FORMULAS.map((f) => f.id)]),
    reportTypes: new Set(REPORT_TYPES),
    promptKeys: new Set(PROMPT_KEYS),
    sectionIds: new Set(LAYOUT_SECTION_IDS),
    detailKinds: new Set(DETAIL_KINDS),
    actionIds: new Set(VIEW_ACTIONS),
  };
}

/** The current live configuration, in the same shape a blueprint carries. */
export function currentConfiguration(): {
  formulas: AviloBlueprint["formulas"];
  mappings: AviloBlueprint["mappings"];
  prompts: AviloBlueprint["prompts"];
  layout?: LayoutOverride;
  views?: CustomView[];
} {
  const db = getDb();
  const formulas = db.select().from(schema.formulas).all().map((f) => ({
    id: f.id,
    expression: f.expression,
    label: f.label,
    ...(f.description ? { description: f.description } : {}),
  }));
  const mappings = db.select().from(schema.labelMappings).all().map((m) => ({
    reportType: m.reportType,
    rawLabel: m.rawLabel,
    accountId: m.accountId,
  }));
  const prompts = PROMPT_KEYS.map((key) => ({ key, body: readSetting(key) ?? "" })).filter(
    (p) => p.body !== "",
  );
  const storedLayout = readSetting(REPORT_LAYOUT_DEFAULT_KEY);
  let layout: LayoutOverride | undefined;
  if (storedLayout) {
    try {
      layout = JSON.parse(storedLayout) as LayoutOverride;
    } catch {
      // A corrupt stored value must not block export or diffing — treat as unset.
    }
  }
  const storedViews = readSetting(CUSTOM_VIEWS_KEY);
  let views: CustomView[] | undefined;
  if (storedViews) {
    try {
      views = JSON.parse(storedViews) as CustomView[];
    } catch {
      // Same rule as the layout above — a corrupt row must not block export or diffing.
    }
  }

  return {
    formulas,
    mappings,
    prompts,
    ...(layout ? { layout } : {}),
    ...(views ? { views } : {}),
  };
}

/** The full current configuration as an exportable blueprint. */
export function exportBlueprint(name: string, description?: string): AviloBlueprint {
  const config = currentConfiguration();
  return {
    schemaVersion: 1,
    name,
    ...(description ? { description } : {}),
    exportedAt: new Date().toISOString(),
    ...config,
  };
}
