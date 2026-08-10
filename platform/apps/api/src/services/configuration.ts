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
import type {
  ArrangementOverride, AviloBlueprint, CustomView, LayoutOverride, RegisteredSurface,
  SummaryDoc, SummaryLinkRegistry,
} from "@avilo/core";
import { validateSummaryDoc } from "@avilo/core";
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

/**
 * The three "arrange an existing surface" registries.
 *
 * These exist because the assistant's reach was drawn too tightly: a panel the advisor can
 * see but cannot ask for is a boundary that produces false claims rather than refusals
 * (BUG-036, and the round after it). The rule is now the one the user actually stated —
 * the application's own chrome is fixed; the *content* surfaces are arrangeable.
 *
 * Mirrored by hand from the web package for the same reason LAYOUT_SECTION_IDS is: apps/api
 * cannot import React. Drift costs a rejected blueprint, never a wrong one.
 */

/** Panel ids rendered by `apps/web/src/app/dashboard/Dashboard.tsx`. */
export const DASHBOARD_SECTION_IDS = [
  "kpi-strip", "summary", "growth", "quality", "profitability", "cash", "customers",
  "receivables", "payables", "referrals", "forecast", "goal", "warnings", "actions",
] as const;

/** Column ids from `COLUMNS` in `apps/web/src/app/pages/ClientsPage.tsx`. */
export const CLIENTS_COLUMN_IDS = [
  "name", "stage", "latestPeriod", "revenue", "netOperatingIncome", "grossMarginPct",
  "noiMarginPct", "daysCashOnHand", "grossProfit", "cogs", "overhead", "cash", "ar", "ap",
  "totalAssets", "dso", "dpo", "legalName", "industry", "data",
] as const;

/**
 * Portfolio aggregates that may appear as a tile above the clients list.
 *
 * Every entry is computed by the app from the rows already on screen. There is no tile
 * whose value the assistant supplies — it picks *which* aggregate to show, never what it
 * reads. That is why widening this lever cannot fabricate a figure.
 */
export const LANDING_TILE_IDS = [
  "client-count", "clients-with-data", "missing-inputs",
  "total-revenue", "total-net-operating-income", "total-gross-profit", "total-cogs",
  "total-overhead", "total-cash", "total-ar", "total-ap", "total-assets",
  "avg-gross-margin", "avg-noi-margin", "avg-days-cash", "avg-dso", "avg-dpo",
] as const;

/*
  The DEFAULTS below matter more than they look. A stored version normalizes an unset
  arrangement by spelling it out, and if what it spells out is not what the app actually
  renders when unset, restoring the baseline silently changes the screen — showing eleven
  columns nobody asked for. These mirror the web package's own defaults for that reason.
*/

/** `DEFAULT_HIDDEN` in ClientsPage.tsx — columns off until the advisor turns them on. */
export const DEFAULT_HIDDEN_CLIENTS_COLUMNS = [
  "grossProfit", "cogs", "overhead", "cash", "ar", "ap", "totalAssets", "dso", "dpo",
  "legalName", "industry",
] as const;

/** The four tiles the clients page has always shown, in order. */
export const DEFAULT_LANDING_TILES = [
  "client-count", "total-revenue", "missing-inputs", "avg-noi-margin",
] as const;

/** Where each arrangement lands in `app_settings`. */
export const DASHBOARD_LAYOUT_KEY = "dashboard_layout";
export const CLIENTS_TABLE_KEY = "clients_table_layout";
export const LANDING_TILES_KEY = "landing_tiles";

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
    dashboardSectionIds: new Set(DASHBOARD_SECTION_IDS),
    clientsColumnIds: new Set(CLIENTS_COLUMN_IDS),
    landingTileIds: new Set(LANDING_TILE_IDS),
  };
}

/** Read one arrangement back out of `app_settings`. A corrupt row reads as unset. */
function readArrangement(key: string): ArrangementOverride | undefined {
  const stored = readSetting(key);
  if (!stored) return undefined;
  try {
    return JSON.parse(stored) as ArrangementOverride;
  } catch {
    return undefined;
  }
}

/** The current live configuration, in the same shape a blueprint carries. */
export function currentConfiguration(): {
  formulas: AviloBlueprint["formulas"];
  mappings: AviloBlueprint["mappings"];
  prompts: AviloBlueprint["prompts"];
  layout?: LayoutOverride;
  views?: CustomView[];
  dashboard?: ArrangementOverride;
  clientsTable?: ArrangementOverride;
  landingTiles?: ArrangementOverride;
  accountLabels?: AviloBlueprint["accountLabels"];
} {
  const db = getDb();
  const formulas = db.select().from(schema.formulas).all().map((f) => ({
    id: f.id,
    expression: f.expression,
    label: f.label,
    ...(f.description ? { description: f.description } : {}),
    unit: f.unit,
    sortOrder: f.sortOrder,
    active: f.active,
    // Stored as a JSON string; a corrupt band reads as absent rather than blocking a diff.
    ...(f.benchmark
      ? (() => {
          try {
            return { benchmark: JSON.parse(f.benchmark) as { min?: number; max?: number; note?: string } };
          } catch {
            return {};
          }
        })()
      : {}),
  }));

  /*
    Only accounts whose label or description DIFFERS from the shipped definition.

    Carrying all sixty would make every blueprint noisy and every diff meaningless; the
    interesting state is "what has this installation renamed". An account back at its
    shipped label drops out of the set, which is also what makes renaming one back a
    real, diffable change.
  */
  const shipped = new Map(CANONICAL_ACCOUNTS.map((a) => [a.id, a]));
  const accountLabels = db
    .select()
    .from(schema.accounts)
    .all()
    .flatMap((a) => {
      const base = shipped.get(a.id);
      if (!base) return [];
      const labelChanged = a.label !== base.label;
      const descChanged = (a.description ?? "") !== (base.description ?? "");
      if (!labelChanged && !descChanged) return [];
      return [{
        id: a.id,
        ...(labelChanged ? { label: a.label } : {}),
        ...(descChanged ? { description: a.description ?? "" } : {}),
      }];
    });
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

  const dashboard = readArrangement(DASHBOARD_LAYOUT_KEY);
  const clientsTable = readArrangement(CLIENTS_TABLE_KEY);
  const landingTiles = readArrangement(LANDING_TILES_KEY);

  return {
    formulas,
    mappings,
    prompts,
    ...(layout ? { layout } : {}),
    ...(views ? { views } : {}),
    ...(dashboard ? { dashboard } : {}),
    ...(clientsTable ? { clientsTable } : {}),
    ...(landingTiles ? { landingTiles } : {}),
    ...(accountLabels.length > 0 ? { accountLabels } : {}),
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

/* ------------------------------------------------- summary rich text (ADR-047) */

/**
 * Where a summary hyperlink may point, composed from what this installation actually has.
 *
 * Views come from the live custom-view set rather than a constant, so a link can reach a
 * screen the assistant built last week. Everything here is a place inside the app; there is
 * no entry, and no shape, that can express an external address.
 */
export function summaryLinkRegistry(): SummaryLinkRegistry {
  const views = currentConfiguration().views ?? [];
  return {
    reportSections: new Set(LAYOUT_SECTION_IDS),
    dashboardPanels: new Set(DASHBOARD_SECTION_IDS),
    viewIds: new Set(views.map((v) => v.id)),
  };
}

/** The registry as the flat list of destination strings the prompt shows the model. */
export function summaryDestinations(registry: SummaryLinkRegistry): string[] {
  return [
    "raw",
    ...[...registry.reportSections].map((id) => `report:${id}`),
    ...[...registry.dashboardPanels].map((id) => `dashboard:${id}`),
    ...[...registry.viewIds].map((id) => `view:${id}`),
  ];
}

/**
 * A model reply as a `SummaryDoc`, or `null` if it is not one.
 *
 * Tolerates the two things models reliably do to JSON: wrap it in a fenced code block, and
 * put a sentence in front of it. Returns `null` rather than throwing — the caller treats an
 * unparseable reply as plain prose, which is the pre-existing behaviour and still correct.
 */
export function parseSummaryOutput(
  output: string,
  registry: SummaryLinkRegistry,
): SummaryDoc | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(output);
  const body = fenced ? fenced[1]! : output;

  /*
    Models emit ONE OBJECT PER PARAGRAPH about as often as they emit one object with several
    blocks — observed on the first real run against llama-3.3-70b. Taking the first `{` to
    the last `}` therefore produced a string containing two concatenated objects, which is
    not JSON, and the whole rich summary was lost to a formatting habit. Each top-level
    object is parsed on its own and their blocks are concatenated.
  */
  const collect = (text: string) =>
    topLevelObjects(text)
      .map((chunk) => {
        try {
          return validateSummaryDoc(JSON.parse(chunk), registry).doc;
        } catch {
          return null;
        }
      })
      .filter((d): d is SummaryDoc => d !== null);

  /*
    Repair is a SECOND pass over the whole body, not a per-chunk retry, because the
    malformation breaks the brace scanner before any chunk exists: `{"text=", a margin of "}`
    leaves an unbalanced quote, so the scanner reads the following `}` and `{` as being
    inside a string and never closes the object. Splitting has to happen on repaired text.
    Well-formed output never reaches the second pass.
  */
  const docs = ((): SummaryDoc[] => {
    const first = collect(body);
    return first.length > 0 ? first : collect(repairKeys(body));
  })();

  if (docs.length === 0) return null;
  return {
    mode: docs[0]!.mode,
    blocks: docs.flatMap((d) => d.blocks),
  };
}

/**
 * One narrow repair for a malformation the model actually produces.
 *
 * Observed repeatedly on llama-3.3-70b: `{"text=", a margin of "}` where `{"text": "..."}`
 * was meant — a quoted key followed by `=` instead of `":`. Adding a line to the prompt did
 * not stop it, and each occurrence cost the entire rich summary.
 *
 * Anchored to a key POSITION — immediately after `{` or `,` — and only ever applied to
 * input that already failed to parse. Without the anchor it would corrupt a legitimate
 * value: in `{"note":"a=b"}` an unanchored rule rewrites `"a=` and destroys the string.
 * That anchor is the difference between a targeted fix for a known defect and owning a
 * general-purpose JSON repairer.
 */
function repairKeys(text: string): string {
  return text.replace(/([{,]\s*)"(\w+)=/g, '$1"$2":');
}

/** Every balanced top-level `{...}` in a string, ignoring braces inside JSON strings. */
function topLevelObjects(body: string): string[] {
  const found: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        found.push(body.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return found;
}

/**
 * The prose inside a reply that failed to parse.
 *
 * This exists because of a specific, ugly failure: when parsing failed, the raw model
 * output was handed to `fabricatedFigures` as if it were prose. That output is JSON
 * containing colour codes, so `#15803d` was read as the figure `15803`, and a completely
 * faithful summary was discarded for containing numbers "not in your books". The check was
 * right; it was being shown the wrong text.
 *
 * So a reply that looks like JSON never reaches that check as JSON. Its `text` runs are
 * pulled out and joined, which both salvages a readable summary and gives the figure check
 * exactly the words the advisor would see. Tolerates the `"text=` malformation models
 * occasionally produce, since the point here is rescue rather than strictness.
 */
export function salvageSummaryText(output: string): string {
  const looksLikeJson = /^\s*[{[]/.test(output) || /"blocks"\s*:/.test(output);
  if (!looksLikeJson) return output;

  const runs = [...output.matchAll(/"text"\s*[:=]\s*"((?:[^"\\]|\\.)*)"/g)].map((m) =>
    m[1]!.replace(/\\(.)/g, "$1"),
  );
  return runs.length > 0 ? runs.join("") : output;
}
