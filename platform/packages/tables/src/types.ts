// Schema-driven table contract.
//
// PORTED VERBATIM (structurally) from relationship-os `platform/packages/tables/src/types.ts`
// so that integration is an import swap rather than a rewrite. Do not diverge from the
// upstream shape without recording the reason here.
//
// "Views as data": a table's columns and its views are values, not hardcoded UI branches,
// so every consumer shares one engine.

export type ColumnKind =
  | "text"
  | "number"
  | "select"
  | "multiselect"
  | "date"
  | "checkbox"
  | "url"
  | "relation"
  | "formula"
  | "skill"
  | "location";

export type ViewKind =
  | "table"
  | "board"
  | "gallery"
  | "form"
  | "calendar"
  | "map"
  | "graph"
  | "tree";

export type GraphScope = "single_database" | "multi_database" | "full";

export const VIEW_KINDS: readonly ViewKind[] = [
  "table",
  "board",
  "gallery",
  "form",
  "calendar",
  "map",
  "graph",
  "tree",
] as const;

export interface ColumnSpec {
  id: string;
  label: string;
  kind: ColumnKind;
  editable?: boolean;
  locked?: boolean;
  width?: number;
  /** select / multiselect */
  options?: string[];
  skillId?: string;
  required?: boolean;
  defaultValue?: unknown;
  relationTarget?: string;
  relationParent?: boolean;
  hiddenInForm?: boolean;
  sensitive?: boolean;
  /** Avilo addition: right-aligned numeric presentation hint for currency columns. */
  format?: "currency" | "percent" | "integer" | "ratio";
}

export interface TableSpec {
  id: string;
  columns: ColumnSpec[];
}

export type FilterOp =
  | "contains"
  | "is"
  | "is_not"
  | "is_empty"
  | "is_not_empty"
  | "starts_with";

export interface RowFilter {
  field: string;
  op: FilterOp;
  value: string;
}

export interface SortSpec {
  id: string;
  dir: "asc" | "desc";
}

/** A view is data: persisted, swappable, never a hardcoded branch of a component. */
export interface ViewConfig {
  id: string;
  kind: ViewKind;
  sorts: SortSpec[];
  rowFilters: RowFilter[];
  filterMatch: "all" | "any";
  groupBy: string | null;
  dateBy?: string;
  locationBy?: string;
  relationBy?: string;
  parentBy?: string;
  graphScope?: GraphScope;
  graphDatabaseIds?: string[];
  formDefaults?: Record<string, unknown>;
  /** Stored overlay: column visibility + order, the Baserow-precedent model. */
  hiddenColumns?: string[];
  columnOrder?: string[];
}

export function normalizeViewKind(kind: unknown): ViewKind | null {
  if (kind === "kanban") return "board";
  if (kind === "network") return "graph";
  return VIEW_KINDS.includes(kind as ViewKind) ? (kind as ViewKind) : null;
}

export const defaultViewConfig = (
  id: string,
  kind: ViewKind = "table",
): ViewConfig => ({
  id,
  kind,
  sorts: [],
  rowFilters: [],
  filterMatch: "all",
  groupBy: null,
  hiddenColumns: [],
  columnOrder: [],
});
