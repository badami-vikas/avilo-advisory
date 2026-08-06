/**
 * The portfolio aggregates that may appear as tiles above the clients list.
 *
 * This is the `landingTiles` lever's half of the closed-registry contract. The assistant
 * chooses *which* of these to show and in what order; it never supplies a value. Every
 * entry below reduces the rows already on screen, so a tile the assistant asked for reads
 * the same books the table does — "never fabricate a figure" holds through the tile row for
 * the same structural reason it holds through a generated view (ADR-041).
 *
 * `null` is a real answer. An average over clients that have no data yet is unknown, not
 * zero, and `percent`/`money` render it as such rather than inventing a floor.
 *
 * Ids are mirrored in `LANDING_TILE_IDS` (apps/api/src/services/configuration.ts), which is
 * what a blueprint is validated against. Drift costs a rejected blueprint, never a wrong
 * tile — an id this file does not have is dropped by `resolve` before it reaches render.
 */
import type { ReactNode } from "react";
import {
  Activity, AlertTriangle, Banknote, Clock, Layers, Percent, TrendingUp, Wallet,
} from "lucide-react";
import { money, percent } from "../../lib/format.js";

/** The row shape these aggregates read. Structural, so ClientsPage's own type satisfies it. */
export interface TileRow {
  latestPeriod?: string | null;
  missingCount?: number | null;
  revenue?: number | null;
  netOperatingIncome?: number | null;
  grossProfit?: number | null;
  cogs?: number | null;
  overhead?: number | null;
  cash?: number | null;
  ar?: number | null;
  ap?: number | null;
  totalAssets?: number | null;
  grossMarginPct?: number | null;
  noiMarginPct?: number | null;
  daysCashOnHand?: number | null;
  dso?: number | null;
  dpo?: number | null;
}

export interface TileSpec {
  id: string;
  label: string;
  icon: ReactNode;
  value: (rows: TileRow[]) => string;
  /** Drives the warning styling. Only "missing inputs" uses it today. */
  tone?: (rows: TileRow[]) => "flag" | "neutral";
}

const sum = (rows: TileRow[], pick: (r: TileRow) => number | null | undefined) =>
  rows.reduce((total, r) => total + (pick(r) ?? 0), 0);

/**
 * Mean over the rows that actually have the figure — not over every row.
 *
 * Dividing by the full count would quietly treat a client with no data as a zero and drag
 * every average toward it. With nothing to average, the answer is unknown.
 */
const mean = (rows: TileRow[], pick: (r: TileRow) => number | null | undefined) => {
  const values = rows.map(pick).filter((v): v is number => typeof v === "number");
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
};

const days = (value: number | null) => (value === null ? "Unknown" : Math.round(value).toString());

export const TILES: TileSpec[] = [
  { id: "client-count", label: "Showing", icon: <Layers size={15} />,
    value: (rows) => String(rows.length) },
  { id: "clients-with-data", label: "With data", icon: <Layers size={15} />,
    value: (rows) => String(rows.filter((r) => Boolean(r.latestPeriod)).length) },
  { id: "missing-inputs", label: "Missing inputs", icon: <AlertTriangle size={15} />,
    value: (rows) => String(sum(rows, (r) => r.missingCount)),
    tone: (rows) => (sum(rows, (r) => r.missingCount) > 0 ? "flag" : "neutral") },

  { id: "total-revenue", label: "Total revenue", icon: <TrendingUp size={15} />,
    value: (rows) => money(sum(rows, (r) => r.revenue)) },
  { id: "total-net-operating-income", label: "Total net op. income", icon: <TrendingUp size={15} />,
    value: (rows) => money(sum(rows, (r) => r.netOperatingIncome)) },
  { id: "total-gross-profit", label: "Total gross profit", icon: <TrendingUp size={15} />,
    value: (rows) => money(sum(rows, (r) => r.grossProfit)) },
  { id: "total-cogs", label: "Total cost of sales", icon: <Banknote size={15} />,
    value: (rows) => money(sum(rows, (r) => r.cogs)) },
  { id: "total-overhead", label: "Total overhead", icon: <Banknote size={15} />,
    value: (rows) => money(sum(rows, (r) => r.overhead)) },
  { id: "total-cash", label: "Total cash", icon: <Wallet size={15} />,
    value: (rows) => money(sum(rows, (r) => r.cash)) },
  { id: "total-ar", label: "Total receivable", icon: <Wallet size={15} />,
    value: (rows) => money(sum(rows, (r) => r.ar)) },
  { id: "total-ap", label: "Total payable", icon: <Wallet size={15} />,
    value: (rows) => money(sum(rows, (r) => r.ap)) },
  { id: "total-assets", label: "Total assets", icon: <Wallet size={15} />,
    value: (rows) => money(sum(rows, (r) => r.totalAssets)) },

  { id: "avg-gross-margin", label: "Avg gross margin", icon: <Percent size={15} />,
    value: (rows) => percent(mean(rows, (r) => r.grossMarginPct)) },
  { id: "avg-noi-margin", label: "Avg NOI margin", icon: <Activity size={15} />,
    value: (rows) => percent(mean(rows, (r) => r.noiMarginPct)) },
  { id: "avg-days-cash", label: "Avg days cash", icon: <Clock size={15} />,
    value: (rows) => days(mean(rows, (r) => r.daysCashOnHand)) },
  { id: "avg-dso", label: "Avg collection days", icon: <Clock size={15} />,
    value: (rows) => days(mean(rows, (r) => r.dso)) },
  { id: "avg-dpo", label: "Avg payment days", icon: <Clock size={15} />,
    value: (rows) => days(mean(rows, (r) => r.dpo)) },
];

export const TILE_IDS = TILES.map((t) => t.id);

/** The four the clients page has always shown. Mirrored in `DEFAULT_LANDING_TILES`. */
export const DEFAULT_TILES = [
  "client-count", "total-revenue", "missing-inputs", "avg-noi-margin",
];
