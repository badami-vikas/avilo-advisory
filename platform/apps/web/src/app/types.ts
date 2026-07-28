import type { api } from "../lib/trpc.js";

export type PeriodReport = Awaited<ReturnType<typeof api.report.period.query>>;
export type SeriesPoint = Awaited<ReturnType<typeof api.report.series.query>>[number];
export type FormulaRow = Awaited<ReturnType<typeof api.formulas.list.query>>[number];
export type ClientRecord = Awaited<ReturnType<typeof api.clients.get.query>>;
export type AccountCell = PeriodReport["accounts"][number];
export type MetricCell = PeriodReport["metrics"][number];
