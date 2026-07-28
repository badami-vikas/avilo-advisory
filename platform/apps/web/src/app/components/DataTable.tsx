import clsx from "clsx";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import type { ColumnSpec, ViewConfig } from "@avilo/tables";

/**
 * Table renderer.
 *
 * Bound to the ported @bridge/tables contract: it consumes a ColumnSpec[] and a
 * ViewConfig (the stored overlay of column order/visibility, filters and sorts) rather
 * than hardcoding its columns. That contract is the integration surface.
 *
 * Renderer note: relationship-os draws this contract with @glideapps/glide-data-grid
 * (canvas). This build renders it as DOM instead. The columns in the reference design —
 * status pills, rating dots, evidence bars — are custom cell renderers either way, and
 * DOM keeps Phase 1 focused on proving the data model. Swapping in glide behind the same
 * ColumnSpec/ViewConfig props is a contained change, because no caller of this component
 * knows how a cell is painted.
 */

export interface ColumnRender<Row> {
  /** Custom cell content. Falls back to the raw value when omitted. */
  render?: (row: Row) => ReactNode;
  /** Value used for sorting and filtering when `render` is a component. */
  value?: (row: Row) => string | number | null;
  align?: "left" | "right" | "center";
  /** Called on double-click to begin editing. Omit to make a column read-only. */
  onEdit?: (row: Row, next: string) => void | Promise<void>;
  editValue?: (row: Row) => string;
}

export interface DataTableProps<Row> {
  columns: ColumnSpec[];
  renderers: Record<string, ColumnRender<Row>>;
  rows: Row[];
  view: ViewConfig;
  rowKey: (row: Row) => string;
  onRowClick?: (row: Row) => void;
  onSort?: (columnId: string) => void;
  rowActions?: (row: Row) => ReactNode;
  emptyState: ReactNode;
  /** Always-visible add affordance; the table body is never replaced by a message. */
  onAddRow?: () => void;
  addRowLabel?: string;
}

export function DataTable<Row>({
  columns,
  renderers,
  rows,
  view,
  rowKey,
  onRowClick,
  onSort,
  rowActions,
  emptyState,
  onAddRow,
  addRowLabel = "New",
}: DataTableProps<Row>) {
  const [editing, setEditing] = useState<{ key: string; col: string } | null>(null);

  const sortFor = (id: string) => view.sorts.find((s) => s.id === id);

  return (
    <div className="overflow-x-auto">
      {/*
        A min-width makes the container scroll rather than squeezing columns until the
        row actions are clipped — the table has more columns than a laptop viewport.
      */}
      <table className="w-full min-w-[1180px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-line bg-line-soft/60">
            {columns.map((column) => {
              const renderer = renderers[column.id];
              const sort = sortFor(column.id);
              return (
                <th
                  key={column.id}
                  style={column.width ? { width: column.width } : undefined}
                  className={clsx(
                    "whitespace-nowrap px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-faint",
                    renderer?.align === "right" ? "text-right" : "text-left",
                    onSort && "cursor-pointer select-none hover:text-ink-muted",
                  )}
                  onClick={onSort ? () => onSort(column.id) : undefined}
                  scope="col"
                >
                  <span className="inline-flex items-center gap-1">
                    {column.label}
                    {sort ? (
                      <ChevronDown
                        size={11}
                        className={clsx(
                          "text-ink-muted transition-transform",
                          sort.dir === "asc" && "rotate-180",
                        )}
                      />
                    ) : null}
                  </span>
                </th>
              );
            })}
            {rowActions ? (
              // Pinned right: Upload and Download are the primary row actions and must
              // stay reachable however many metric columns the view shows.
              <th
                scope="col"
                className="sticky right-0 z-10 w-px whitespace-nowrap border-l border-line bg-line-soft px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-faint"
              >
                Actions
              </th>
            ) : null}
          </tr>
        </thead>

        <tbody>
          {rows.map((row) => {
            const key = rowKey(row);
            return (
              <tr
                key={key}
                className="group border-b border-line-soft last:border-b-0 hover:bg-accent-soft/40"
              >
                {columns.map((column) => {
                  const renderer = renderers[column.id] ?? {};
                  const isEditing =
                    editing?.key === key && editing.col === column.id;
                  const editable = Boolean(renderer.onEdit);

                  return (
                    <td
                      key={column.id}
                      className={clsx(
                        "whitespace-nowrap px-4 py-2.5 align-middle",
                        renderer.align === "right" && "text-right",
                        renderer.align === "center" && "text-center",
                        onRowClick && !isEditing && "cursor-pointer",
                      )}
                      onClick={
                        onRowClick && !isEditing
                          ? (event) => {
                              if ((event.target as HTMLElement).closest("[data-stop]"))
                                return;
                              onRowClick(row);
                            }
                          : undefined
                      }
                      onDoubleClick={
                        editable
                          ? (event) => {
                              event.stopPropagation();
                              setEditing({ key, col: column.id });
                            }
                          : undefined
                      }
                      title={editable && !isEditing ? "Double-click to edit" : undefined}
                    >
                      {isEditing ? (
                        <InlineEditor
                          initial={renderer.editValue?.(row) ?? ""}
                          align={renderer.align}
                          onCancel={() => setEditing(null)}
                          onCommit={async (next) => {
                            setEditing(null);
                            await renderer.onEdit?.(row, next);
                          }}
                        />
                      ) : (
                        (renderer.render?.(row) ?? (
                          <span className="text-ink">
                            {String(renderer.value?.(row) ?? "")}
                          </span>
                        ))
                      )}
                    </td>
                  );
                })}

                {rowActions ? (
                  <td
                    className="sticky right-0 z-10 whitespace-nowrap border-l border-line bg-surface px-4 py-2 text-right"
                    data-stop
                  >
                    <div className="flex items-center justify-end gap-1 opacity-60 transition-opacity group-hover:opacity-100">
                      {rowActions(row)}
                    </div>
                  </td>
                ) : null}
              </tr>
            );
          })}

          {/*
            The table keeps its header and its add-row affordance at zero rows. It is
            never replaced by a message box — an empty state renders inside the body.
          */}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length + (rowActions ? 1 : 0)}>{emptyState}</td>
            </tr>
          ) : null}

          {onAddRow ? (
            <tr className="border-t border-line-soft">
              <td
                colSpan={columns.length + (rowActions ? 1 : 0)}
                className="px-2 py-1.5"
              >
                <button
                  onClick={onAddRow}
                  className="w-full rounded-md px-2 py-1.5 text-left text-[12.5px] text-ink-faint transition-colors hover:bg-line-soft hover:text-ink-muted"
                >
                  + {addRowLabel}
                </button>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function InlineEditor({
  initial,
  align,
  onCommit,
  onCancel,
}: {
  initial: string;
  align?: "left" | "right" | "center";
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initial);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  return (
    <input
      ref={ref}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => (value === initial ? onCancel() : onCommit(value))}
      onKeyDown={(event) => {
        if (event.key === "Enter") onCommit(value);
        if (event.key === "Escape") onCancel();
      }}
      className={clsx(
        "w-full rounded-md border border-accent bg-surface px-2 py-1 text-[13px] outline-none ring-2 ring-accent/15",
        align === "right" && "text-right",
      )}
    />
  );
}
