import type { ReactNode } from "react";
import type { ColumnRender } from "./DataTable.js";

export interface CardField {
  id: string;
  label: string;
}

/**
 * The same rows as a grid of cards instead of a table.
 *
 * Deliberately reuses each column's own `renderers` entry rather than re-implementing
 * formatting for the card body. The alternative — a second render path with its own
 * money/percent formatting — is exactly the kind of duplication that let the table and
 * the report disagree on a figure earlier in this build. A card can only ever show what
 * the table would show for the same cell, because it is the same function.
 */
export function ClientCardView<Row>({
  rows,
  renderers,
  rowKey,
  onRowClick,
  headerField,
  badgeField,
  fields,
  rowActions,
  emptyState,
  onAddRow,
  addRowLabel = "New",
}: {
  rows: Row[];
  renderers: Record<string, ColumnRender<Row>>;
  rowKey: (row: Row) => string;
  onRowClick?: (row: Row) => void;
  /** Rendered large at the top of the card. */
  headerField: string;
  /** Rendered as a badge beside the header. */
  badgeField?: string;
  /** The metric grid body, in display order. */
  fields: CardField[];
  rowActions?: (row: Row) => ReactNode;
  emptyState: ReactNode;
  onAddRow?: () => void;
  addRowLabel?: string;
}) {
  const cell = (id: string, row: Row): ReactNode => {
    const renderer = renderers[id];
    if (!renderer) return null;
    return renderer.render?.(row) ?? String(renderer.value?.(row) ?? "—");
  };

  if (rows.length === 0) {
    return <div className="px-5 py-10">{emptyState}</div>;
  }

  return (
    <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
      {rows.map((row) => (
        <div
          key={rowKey(row)}
          onClick={onRowClick ? () => onRowClick(row) : undefined}
          className={`flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition-colors hover:border-accent/40 hover:shadow-[0_2px_8px_rgba(16,24,40,0.06)] ${
            onRowClick ? "cursor-pointer" : ""
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 truncate text-[14px] font-semibold text-ink">
              {cell(headerField, row)}
            </div>
            {badgeField ? <div className="shrink-0">{cell(badgeField, row)}</div> : null}
          </div>

          <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
            {fields.map((field) => (
              <div key={field.id} className="min-w-0">
                <p className="text-[10px] font-medium uppercase tracking-[0.06em] text-ink-faint">
                  {field.label}
                </p>
                <div className="mt-0.5 truncate text-[13px]">{cell(field.id, row)}</div>
              </div>
            ))}
          </div>

          {rowActions ? (
            <div
              className="mt-1 flex items-center gap-2 border-t border-line-soft pt-3"
              onClick={(event) => event.stopPropagation()}
            >
              {rowActions(row)}
            </div>
          ) : null}
        </div>
      ))}

      {onAddRow ? (
        <button
          onClick={onAddRow}
          className="flex min-h-[168px] flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-line text-[13px] font-medium text-ink-faint transition-colors hover:border-accent hover:text-accent"
        >
          + {addRowLabel}
        </button>
      ) : null}
    </div>
  );
}
