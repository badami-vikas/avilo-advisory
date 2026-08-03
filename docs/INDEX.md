<!-- Nav map: "where does X live". Keep ≤50 lines. -->

# Repo Navigation Map

One codebase: `platform/` — pnpm workspace monorepo. Apps are thin; the domain lives in `modules/avilo`.

| Thing | Lives in | Key file |
|---|---|---|
| Drizzle schema (all tables) | `platform/modules/avilo` | `src/schema.ts` |
| Canonical chart of accounts + label dialects | `platform/modules/avilo` | `src/accounts.ts` |
| Formula registry (seed metrics) | `platform/modules/avilo` | `src/formulas/registry.ts` |
| Formula engine (expression eval, cycles) | `platform/modules/avilo` | `src/formulas/engine.ts` |
| Override history | `platform/modules/avilo` | `src/overrides.ts` |
| Cross-report integrity checks | `platform/modules/avilo` | `src/integrity.ts` |
| File classification (deterministic) | `platform/modules/avilo` | `src/import/classify.ts` |
| AI row mapping (prompt + guard) | `platform/modules/avilo` | `src/import/suggest.ts` |
| AI narrative + fabrication guard + fingerprint | `platform/modules/avilo` | `src/import/narrative.ts` |
| Parsers (P&L, balance sheet, ageing, entities) | `platform/modules/avilo` | `src/import/parsers/` |
| Cell coercion (money shapes, negatives) | `platform/modules/avilo` | `src/import/cells.ts` |
| PDF reading (Node-only, not in web bundle) | `platform/modules/avilo` | `src/import/pdf.ts` |
| tRPC API (sole API surface) | `platform/apps/api` | `src/router.ts` |
| Groq access — the only network seam | `platform/apps/api` | `src/services/ai.ts` |
| Import staging + commit | `platform/apps/api` | `src/services/import.ts` |
| Label resolver + learning | `platform/apps/api` | `src/services/labels.ts` |
| Report assembly | `platform/apps/api` | `src/services/report.ts` |
| DB open + migrate + seed | `platform/apps/api` | `src/db.ts` |
| Paths (data dir, migrations dir) | `platform/apps/api` | `src/paths.ts` |
| Migrations + journal | `platform/apps/api` | `migrations/`, `migrations/meta/_journal.json` |
| Insight engine (pure functions) | `platform/apps/web` | `src/app/dashboard/insights.ts` |
| Dashboard shell + executive summary | `platform/apps/web` | `src/app/dashboard/Dashboard.tsx` |
| Chart primitives + shared Legend + data toggle | `platform/apps/web` | `src/app/dashboard/charts.tsx` |
| Dashboard sections | `platform/apps/web` | `src/app/dashboard/sections.tsx` |
| Upload dialog + AI Suggest | `platform/apps/web` | `src/app/components/UploadDialog.tsx` |
| Model settings dialog | `platform/apps/web` | `src/app/components/ModelSettingsDialog.tsx` |
| Table toolbar (⋯ menu, Add column) | `platform/apps/web` | `src/app/components/TableToolbar.tsx` |
| Client list | `platform/apps/web` | `src/app/pages/ClientsPage.tsx` |
| Client detail (4 views) | `platform/apps/web` | `src/app/pages/ClientDetailPage.tsx` |
| Report view / raw data view | `platform/apps/web` | `src/app/components/{ReportView,RawDataView}.tsx` |
| Generic table engine (view config, filters) | `platform/packages/tables` | `src/engine.ts` |
| Electron main + packaging | `platform/apps/desktop` | `build.mjs`, `electron-builder.yml` |

**Data on disk:** `~/Documents/Bridge/Avilo Advisory/` — `.data/avilo.sqlite` plus imported source files per client.

**Docs:** [decisions.md](decisions.md) · [bugs.md](bugs.md) · [wiki/](wiki/) (terse) · [raw/](raw/) (depth)
