import clsx from "clsx";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as ContextMenu from "@radix-ui/react-context-menu";
import { Check, ChevronDown } from "lucide-react";
import { visibleColumns, type ColumnSpec, type ViewConfig } from "@avilo/tables";

import {
  AGGREGATE_LABELS,
  availableAggregates,
  computeAggregate,
  defaultAggregate,
  type AggregateKind,
} from "../../lib/aggregate.js";
import { Tip } from "./Tooltip.js";

/**
 * Table renderer bound to the ported @bridge/tables contract: it consumes a
 * ColumnSpec[] and a ViewConfig (the stored overlay of column order/visibility,
 * filters and sorts) rather than hardcoding its columns.
 *
 * Editing is inline throughout — double-click a cell, type, Enter. No modal.
 */

export interface ColumnRender<Row> {
  render?: (row: Row) => ReactNode;
  /** Value used for sorting, filtering and column aggregates. */
  value?: (row: Row) => string | number | null;
  align?: "left" | "right" | "center";
  /** Present ⇒ the cell is inline-editable on double-click. */
  onEdit?: (row: Row, next: string) => void | Promise<void>;
  editValue?: (row: Row) => string;
  /** Fixed choices render a select rather than a text input. */
  options?: string[];
  /** Hover explanation for the cell. */
  tip?: (row: Row) => ReactNode;
  /** Fired on double-click when the cell is not editable. */
  onDoubleClick?: (row: Row) => void;
  /** Formats an aggregate result for this column. */
  formatAggregate?: (value: number) => string;
  numeric?: boolean;
}

export interface DataTableProps<Row> {
  columns: ColumnSpec[];
  renderers: Record<string, ColumnRender<Row>>;
  rows: Row[];
  view: ViewConfig;
  rowKey: (row: Row) => string;
  onRowClick?: (row: Row) => void;
  onSort?: (columnId: string) => void;
  /** Set a column's sort direction outright, rather than cycling it. */
  onSortDir?: (columnId: string, dir: "asc" | "desc") => void;
  /** Remove a column from the view. */
  onHideColumn?: (columnId: string) => void;
  /** Start a filter on a column. */
  onFilterColumn?: (columnId: string) => void;
  rowActions?: (row: Row) => ReactNode;
  emptyState: ReactNode;
  onAddRow?: () => void;
  addRowLabel?: string;
  /** Show the aggregate footer. */
  showFooter?: boolean;
}

export function DataTable<Row>({
  columns: allColumns,
  renderers,
  rows,
  view,
  rowKey,
  onRowClick,
  onSort,
  onSortDir,
  onHideColumn,
  onFilterColumn,
  rowActions,
  emptyState,
  onAddRow,
  addRowLabel = "New",
  showFooter = true,
}: DataTableProps<Row>) {
  const [editing, setEditing] = useState<{ key: string; col: string } | null>(null);
  const [aggregates, setAggregates] = useState<Record<string, AggregateKind>>({});

  // Hidden and reordered columns are part of the view, not of this component's state —
  // which is what lets a saved list restore a layout. Resolved through the shared engine
  // so the table and a stored view can never disagree about what "visible" means.
  const columns = useMemo(
    () => visibleColumns({ id: view.id, columns: allColumns }, view),
    [allColumns, view],
  );

  const sortFor = (id: string) => view.sorts.find((s) => s.id === id);

  return (
    <div className="overflow-x-auto">
      {/*
        A min-width makes the container scroll rather than squeezing columns until the
        row actions are clipped — the table has more columns than a laptop viewport.
      */}
      <table className="w-full min-w-[1080px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-line bg-line-soft/60">
            {columns.map((column) => {
              const renderer = renderers[column.id];
              const sort = sortFor(column.id);
              const numeric = renderer?.numeric ?? column.kind === "number";
              return (
                <ColumnHeader
                  key={column.id}
                  columnId={column.id}
                  label={column.label}
                  width={column.width}
                  align={renderer?.align}
                  sortDir={sort?.dir ?? null}
                  numeric={numeric}
                  aggregate={aggregates[column.id] ?? defaultAggregate(numeric)}
                  onAggregateChange={(kind) =>
                    setAggregates((current) => ({ ...current, [column.id]: kind }))
                  }
                  onSort={onSort}
                  onSortDir={onSortDir}
                  onHideColumn={onHideColumn}
                  onFilterColumn={onFilterColumn}
                  showAggregate={showFooter}
                />
              );
            })}
            {rowActions ? (
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
                  const isEditing = editing?.key === key && editing.col === column.id;
                  const editable = Boolean(renderer.onEdit);

                  const cell = (
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
                      onDoubleClick={(event) => {
                        event.stopPropagation();
                        if (editable) setEditing({ key, col: column.id });
                        else renderer.onDoubleClick?.(row);
                      }}
                    >
                      {isEditing ? (
                        <InlineEditor
                          initial={renderer.editValue?.(row) ?? ""}
                          align={renderer.align}
                          options={renderer.options}
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

                  const tip = renderer.tip?.(row);
                  if (!tip || isEditing) return cell;
                  return (
                    <Tip key={column.id} content={tip}>
                      {cell}
                    </Tip>
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
            The table keeps its header, footer and add-row affordance at zero rows. It is
            never replaced by a message box — an empty state renders inside the body.
          */}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length + (rowActions ? 1 : 0)}>{emptyState}</td>
            </tr>
          ) : null}

          {onAddRow ? (
            <tr className="border-t border-line-soft">
              <td colSpan={columns.length + (rowActions ? 1 : 0)} className="px-2 py-1.5">
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

        {showFooter && rows.length > 0 ? (
          <tfoot>
            <tr className="border-t-2 border-line bg-line-soft/40">
              {columns.map((column) => {
                const renderer = renderers[column.id] ?? {};
                const numeric = renderer.numeric ?? column.kind === "number";
                const kind =
                  aggregates[column.id] ?? defaultAggregate(numeric);
                return (
                  <AggregateCell
                    key={column.id}
                    kind={kind}
                    numeric={numeric}
                    align={renderer.align}
                    values={rows.map((row) => renderer.value?.(row) ?? null)}
                    format={renderer.formatAggregate}
                    onChange={(next) =>
                      setAggregates((current) => ({ ...current, [column.id]: next }))
                    }
                  />
                );
              })}
              {rowActions ? (
                <td className="sticky right-0 z-10 border-l border-line bg-line-soft/40 px-4 py-2" />
              ) : null}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

/**
 * A column header, with a right-click menu.
 *
 * Left-click still cycles the sort, because that is the gesture people reach for first.
 * The context menu exists for everything a header click cannot express — a direction
 * chosen outright rather than cycled to, hiding the column, filtering on it, or changing
 * what its footer computes. Nothing here is exclusive to the menu: every item has an
 * equivalent in the toolbar, so the feature stays discoverable for anyone who never
 * thinks to right-click, and on touch, where there is no right-click at all.
 */
function ColumnHeader({
  columnId,
  label,
  width,
  align,
  sortDir,
  numeric,
  aggregate,
  onAggregateChange,
  onSort,
  onSortDir,
  onHideColumn,
  onFilterColumn,
  showAggregate,
}: {
  columnId: string;
  label: string;
  width?: number;
  align?: "left" | "right" | "center";
  sortDir: "asc" | "desc" | null;
  numeric: boolean;
  aggregate: AggregateKind;
  onAggregateChange: (kind: AggregateKind) => void;
  onSort?: (columnId: string) => void;
  onSortDir?: (columnId: string, dir: "asc" | "desc") => void;
  onHideColumn?: (columnId: string) => void;
  onFilterColumn?: (columnId: string) => void;
  showAggregate: boolean;
}) {
  const hasMenu = Boolean(onSortDir || onHideColumn || onFilterColumn || showAggregate);

  const header = (
    <th
      style={width ? { width } : undefined}
      className={clsx(
        "whitespace-nowrap px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-faint",
        align === "right" ? "text-right" : "text-left",
        onSort && "cursor-pointer select-none hover:text-ink-muted",
      )}
      onClick={onSort ? () => onSort(columnId) : undefined}
      scope="col"
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sortDir ? (
          <ChevronDown
            size={11}
            className={clsx(
              "text-ink-muted transition-transform",
              sortDir === "asc" && "rotate-180",
            )}
          />
        ) : null}
      </span>
    </th>
  );

  if (!hasMenu) return header;

  const itemClass =
    "flex cursor-pointer items-center justify-between gap-6 rounded-md px-2 py-1.5 " +
    "text-[12.5px] text-ink outline-none data-[highlighted]:bg-line-soft " +
    "data-[disabled]:cursor-default data-[disabled]:text-ink-faint";

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{header}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="no-print z-50 min-w-[190px] rounded-lg border border-line bg-surface p-1 shadow-lg">
          <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-faint">
            {label}
          </div>

          {onSortDir ? (
            <>
              <ContextMenu.Item
                className={itemClass}
                onSelect={() => onSortDir(columnId, "asc")}
              >
                Sort ascending
                {sortDir === "asc" ? <Check size={12} className="text-accent" /> : null}
              </ContextMenu.Item>
              <ContextMenu.Item
                className={itemClass}
                onSelect={() => onSortDir(columnId, "desc")}
              >
                Sort descending
                {sortDir === "desc" ? <Check size={12} className="text-accent" /> : null}
              </ContextMenu.Item>
            </>
          ) : null}

          {onFilterColumn ? (
            <>
              <ContextMenu.Separator className="my-1 h-px bg-line-soft" />
              <ContextMenu.Item
                className={itemClass}
                onSelect={() => onFilterColumn(columnId)}
              >
                Filter on this column
              </ContextMenu.Item>
            </>
          ) : null}

          {showAggregate ? (
            <>
              <ContextMenu.Separator className="my-1 h-px bg-line-soft" />
              <ContextMenu.Sub>
                <ContextMenu.SubTrigger className={itemClass}>
                  Summarise
                  <span className="text-[11px] text-ink-faint">
                    {AGGREGATE_LABELS[aggregate]}
                  </span>
                </ContextMenu.SubTrigger>
                <ContextMenu.Portal>
                  <ContextMenu.SubContent
                    sideOffset={2}
                    className="no-print z-50 min-w-[150px] rounded-lg border border-line bg-surface p-1 shadow-lg"
                  >
                    {availableAggregates(numeric).map((option) => (
                      <ContextMenu.Item
                        key={option}
                        className={itemClass}
                        onSelect={() => onAggregateChange(option)}
                      >
                        {AGGREGATE_LABELS[option]}
                        {option === aggregate ? (
                          <Check size={12} className="text-accent" />
                        ) : null}
                      </ContextMenu.Item>
                    ))}
                  </ContextMenu.SubContent>
                </ContextMenu.Portal>
              </ContextMenu.Sub>
            </>
          ) : null}

          {onHideColumn ? (
            <>
              <ContextMenu.Separator className="my-1 h-px bg-line-soft" />
              <ContextMenu.Item
                className={itemClass}
                onSelect={() => onHideColumn(columnId)}
              >
                Hide column
              </ContextMenu.Item>
            </>
          ) : null}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

function AggregateCell({
  kind,
  numeric,
  align,
  values,
  format,
  onChange,
}: {
  kind: AggregateKind;
  numeric: boolean;
  align?: "left" | "right" | "center";
  values: (string | number | null)[];
  format?: (value: number) => string;
  onChange: (kind: AggregateKind) => void;
}) {
  const result = useMemo(() => computeAggregate(values, kind), [values, kind]);
  const options = availableAggregates(numeric);

  const display =
    result.value === null
      ? "—"
      : result.isCount
        ? String(result.value)
        : (format?.(result.value) ?? String(Math.round(result.value * 100) / 100));

  return (
    <td
      className={clsx(
        "whitespace-nowrap px-4 py-2",
        align === "right" && "text-right",
        align === "center" && "text-center",
      )}
    >
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button className="group/agg inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-[12px] transition-colors hover:bg-line-soft">
            <span className="text-[10px] uppercase tracking-[0.06em] text-ink-faint">
              {AGGREGATE_LABELS[kind]}
            </span>
            <span className="num font-semibold text-ink">{display}</span>
            <ChevronDown
              size={10}
              className="text-ink-faint opacity-0 transition-opacity group-hover/agg:opacity-100"
            />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={4}
            className="no-print z-50 min-w-[150px] rounded-lg border border-line bg-surface p-1 shadow-lg"
          >
            {options.map((option) => (
              <DropdownMenu.Item
                key={option}
                onSelect={() => onChange(option)}
                className="flex cursor-pointer items-center justify-between rounded-md px-2 py-1.5 text-[12.5px] text-ink outline-none data-[highlighted]:bg-line-soft"
              >
                {AGGREGATE_LABELS[option]}
                {option === kind ? <Check size={12} className="text-accent" /> : null}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </td>
  );
}

export function InlineEditor({
  initial,
  align,
  options,
  onCommit,
  onCancel,
}: {
  initial: string;
  align?: "left" | "right" | "center";
  options?: string[];
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const [value, setValue] = useState(initial);

  useEffect(() => {
    if (options) selectRef.current?.focus();
    else {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [options]);

  if (options) {
    return (
      <select
        ref={selectRef}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          onCommit(event.target.value);
        }}
        onBlur={onCancel}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
        }}
        className="w-full rounded-md border border-accent bg-surface px-2 py-1 text-[13px] outline-none ring-2 ring-accent/15"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => (value === initial ? onCancel() : onCommit(value))}
      onKeyDown={(event) => {
        if (event.key === "Enter") onCommit(value);
        if (event.key === "Escape") onCancel();
      }}
      className={clsx(
        "w-full min-w-[80px] rounded-md border border-accent bg-surface px-2 py-1 text-[13px] outline-none ring-2 ring-accent/15",
        align === "right" && "text-right",
      )}
    />
  );
}
