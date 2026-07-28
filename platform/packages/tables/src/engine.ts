// View engine: applies a ViewConfig (a stored overlay) to rows.
//
// The Baserow precedent recorded in relationship-os docs/wiki/ui-architecture.md:
// "view = stored overlay (column show/order + filters + sorts) over the SAME table rows",
// so lists and toggles are one mechanism rather than two components.

import type { ColumnSpec, RowFilter, TableSpec, ViewConfig } from "./types.js";

export type Row = Record<string, unknown>;

function asText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).toLowerCase();
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

export function matchesFilter(row: Row, filter: RowFilter): boolean {
  const raw = row[filter.field];
  const value = asText(raw);
  const needle = filter.value.toLowerCase();

  switch (filter.op) {
    case "contains":
      return value.includes(needle);
    case "is":
      return value === needle;
    case "is_not":
      return value !== needle;
    case "is_empty":
      return isEmpty(raw);
    case "is_not_empty":
      return !isEmpty(raw);
    case "starts_with":
      return value.startsWith(needle);
    default:
      return true;
  }
}

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

export function applyView(rows: Row[], view: ViewConfig): Row[] {
  let out = rows;

  if (view.rowFilters.length > 0) {
    out = out.filter((row) => {
      const results = view.rowFilters.map((f) => matchesFilter(row, f));
      return view.filterMatch === "all"
        ? results.every(Boolean)
        : results.some(Boolean);
    });
  }

  if (view.sorts.length > 0) {
    out = [...out].sort((left, right) => {
      for (const sort of view.sorts) {
        const delta = compare(left[sort.id], right[sort.id]);
        if (delta !== 0) return sort.dir === "asc" ? delta : -delta;
      }
      return 0;
    });
  }

  return out;
}

/** Visible columns in view order — the "stored overlay" half of the Baserow model. */
export function visibleColumns(spec: TableSpec, view: ViewConfig): ColumnSpec[] {
  const hidden = new Set(view.hiddenColumns ?? []);
  const shown = spec.columns.filter((c) => !hidden.has(c.id));
  const order = view.columnOrder ?? [];
  if (order.length === 0) return shown;

  const rank = new Map(order.map((id, index) => [id, index]));
  return [...shown].sort(
    (a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  );
}

export function groupRows(rows: Row[], groupBy: string | null): Map<string, Row[]> {
  const groups = new Map<string, Row[]>();
  if (!groupBy) {
    groups.set("", rows);
    return groups;
  }
  for (const row of rows) {
    const key = row[groupBy] === null || row[groupBy] === undefined ? "" : String(row[groupBy]);
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}
