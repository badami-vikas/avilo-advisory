import clsx from "clsx";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown } from "lucide-react";
import type { ColumnSpec, ViewConfig } from "@avilo/tables";

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
  rowActions?: (row: Row) => ReactNode;
  emptyState: ReactNode;
  onAddRow?: () => void;
  addRowLabel?: string;
  /** Show the aggregate footer. */
  showFooter?: boolean;
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
  showFooter = true,
}: DataTableProps<Row>) {
  const [editing, setEditing] = useState<{ key: string; col: string } | null>(null);
  const [aggregates, setAggregates] = useState<Record<string, AggregateKind>>({});

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
