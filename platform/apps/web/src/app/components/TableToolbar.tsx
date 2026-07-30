import { useCallback, useEffect, useRef, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Popover from "@radix-ui/react-popover";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronDown,
  Layers,
  ListFilter,
  MoreVertical,
  Plus,
  Search,
  Settings2,
  Table2,
  Trash2,
  X,
} from "lucide-react";
import type { ColumnSpec, FilterOp, RowFilter, ViewConfig } from "@avilo/tables";

import { api } from "../../lib/trpc.js";
import { atMost, useToolbarDensity } from "../../lib/useToolbarDensity.js";
import { Button } from "./ui.js";

const FILTER_OPS: { value: FilterOp; label: string; needsValue: boolean }[] = [
  { value: "contains", label: "contains", needsValue: true },
  { value: "is", label: "is", needsValue: true },
  { value: "is_not", label: "is not", needsValue: true },
  { value: "starts_with", label: "starts with", needsValue: true },
  { value: "is_empty", label: "is empty", needsValue: false },
  { value: "is_not_empty", label: "is not empty", needsValue: false },
];

export interface SavedList {
  id: string;
  name: string;
  config: string;
}

export function TableToolbar({
  tableId,
  columns,
  view,
  onViewChange,
  search,
  onSearchChange,
  searchPlaceholder,
  onAdd,
  addLabel,
  filterOpen,
  onFilterOpenChange,
}: {
  tableId: string;
  columns: ColumnSpec[];
  view: ViewConfig;
  onViewChange: (next: ViewConfig) => void;
  search: string;
  onSearchChange: (next: string) => void;
  searchPlaceholder: string;
  onAdd: () => void;
  addLabel: string;
  /** Controlled, so a column's context menu can open the builder it just added to. */
  filterOpen?: boolean;
  onFilterOpenChange?: (open: boolean) => void;
}) {
  const [lists, setLists] = useState<SavedList[]>([]);
  const [activeList, setActiveList] = useState<string | null>(null);
  const [namingList, setNamingList] = useState(false);
  const [listName, setListName] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  const loadLists = useCallback(async () => {
    setLists(await api.views.list.query({ tableId }));
  }, [tableId]);

  useEffect(() => {
    void loadLists();
  }, [loadLists]);

  useEffect(() => {
    if (namingList) nameRef.current?.focus();
  }, [namingList]);

  const applyList = useCallback(
    (list: SavedList | null) => {
      setActiveList(list?.id ?? null);
      if (!list) {
        onViewChange({ ...view, rowFilters: [], filterMatch: "all" });
        return;
      }
      try {
        const parsed = JSON.parse(list.config) as Partial<ViewConfig>;
        onViewChange({ ...view, ...parsed, id: view.id, kind: view.kind });
      } catch {
        /* a corrupt list is ignored rather than crashing the table */
      }
    },
    [onViewChange, view],
  );

  const saveList = useCallback(async () => {
    const name = listName.trim();
    if (!name) return;
    const { id } = await api.views.save.mutate({
      tableId,
      name,
      config: JSON.stringify({
        rowFilters: view.rowFilters,
        filterMatch: view.filterMatch,
        sorts: view.sorts,
        hiddenColumns: view.hiddenColumns ?? [],
      }),
    });
    setListName("");
    setNamingList(false);
    setActiveList(id);
    await loadLists();
  }, [listName, loadLists, tableId, view]);

  const removeList = useCallback(
    async (id: string) => {
      await api.views.remove.mutate({ id });
      if (activeList === id) setActiveList(null);
      await loadLists();
    },
    [activeList, loadLists],
  );

  const setFilters = (rowFilters: RowFilter[]) => onViewChange({ ...view, rowFilters });

  const toggleSort = (columnId: string) => {
    const existing = view.sorts.find((s) => s.id === columnId);
    const next =
      !existing
        ? [{ id: columnId, dir: "asc" as const }]
        : existing.dir === "asc"
          ? [{ id: columnId, dir: "desc" as const }]
          : [];
    onViewChange({ ...view, sorts: next });
  };

  const activeName = lists.find((l) => l.id === activeList)?.name ?? "All";
  const filterCount = view.rowFilters.length;

  const { ref: toolbarRef, density } = useToolbarDensity<HTMLDivElement>();
  // Labels go first, then the search gives up its flexible width, then whole buttons
  // move into the overflow. Nothing ever wraps.
  const hideLabels = atMost(density, "icons");
  const shrinkSearch = atMost(density, "narrow");
  const collapseButtons = atMost(density, "compact");

  // At the narrowest width the Columns panel is opened from the overflow menu instead
  // of its own button, so its open state has to be controllable from outside.
  const [columnsOpen, setColumnsOpen] = useState(false);

  const hidden = view.hiddenColumns ?? [];
  const hiddenCount = hidden.length;

  const toggleColumn = (columnId: string) =>
    onViewChange({
      ...view,
      hiddenColumns: hidden.includes(columnId)
        ? hidden.filter((id) => id !== columnId)
        : [...hidden, columnId],
    });

  return (
    <div ref={toolbarRef} className="no-print flex flex-nowrap items-center gap-2 overflow-hidden">
      {/* ------------------------------------------------------ lists ("All") */}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-[13px] font-medium text-ink hover:bg-line-soft">
            <Layers size={14} className="text-ink-muted" />
            {hideLabels ? null : activeName}
            <ChevronDown size={13} className="text-ink-faint" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            sideOffset={4}
            className="z-50 min-w-[230px] rounded-lg border border-line bg-surface p-1 shadow-lg"
          >
            <DropdownMenu.Item
              onSelect={() => applyList(null)}
              className="flex cursor-pointer items-center justify-between rounded-md px-2 py-1.5 text-[12.5px] text-ink outline-none data-[highlighted]:bg-line-soft"
            >
              All
              {activeList === null ? <Check size={12} className="text-accent" /> : null}
            </DropdownMenu.Item>

            {lists.length > 0 ? (
              <DropdownMenu.Separator className="my-1 h-px bg-line-soft" />
            ) : null}

            {lists.map((list) => (
              <DropdownMenu.Item
                key={list.id}
                onSelect={() => applyList(list)}
                className="group/list flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-[12.5px] text-ink outline-none data-[highlighted]:bg-line-soft"
              >
                <span className="truncate">{list.name}</span>
                <span className="flex items-center gap-1.5">
                  {activeList === list.id ? (
                    <Check size={12} className="text-accent" />
                  ) : null}
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={`Delete list ${list.name}`}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      void removeList(list.id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void removeList(list.id);
                    }}
                    className="opacity-0 transition-opacity group-hover/list:opacity-100"
                  >
                    <Trash2 size={12} className="text-ink-faint hover:text-flag" />
                  </span>
                </span>
              </DropdownMenu.Item>
            ))}

            <DropdownMenu.Separator className="my-1 h-px bg-line-soft" />

            {namingList ? (
              <div
                className="flex items-center gap-1 px-1.5 py-1"
                onKeyDown={(event) => event.stopPropagation()}
              >
                <input
                  ref={nameRef}
                  value={listName}
                  onChange={(event) => setListName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void saveList();
                    if (event.key === "Escape") {
                      setNamingList(false);
                      setListName("");
                    }
                  }}
                  placeholder="List name"
                  className="h-7 min-w-0 flex-1 rounded-md border border-accent px-2 text-[12.5px] outline-none"
                />
                <button
                  onClick={() => void saveList()}
                  className="rounded-md p-1 text-accent hover:bg-accent-soft"
                  aria-label="Save list"
                >
                  <Check size={13} />
                </button>
              </div>
            ) : (
              <DropdownMenu.Item
                onSelect={(event) => {
                  event.preventDefault();
                  setNamingList(true);
                }}
                className="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-[12.5px] text-ink-muted outline-none data-[highlighted]:bg-line-soft"
              >
                <Plus size={12} />
                Add list from current filters
              </DropdownMenu.Item>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      {collapseButtons ? null : (
        <button className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-[13px] font-medium text-ink hover:bg-line-soft">
          <Table2 size={14} className="text-ink-muted" />
          {hideLabels ? null : "Table View"}
        </button>
      )}

      {/* ---------------------------------------------------------- search */}
      <div className={`relative flex-1 ${shrinkSearch ? "min-w-[44px]" : "min-w-[160px] sm:max-w-md"}`}>
        <Search
          size={14}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
        />
        <input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder}
          className="h-9 w-full rounded-lg border border-line bg-surface pl-9 pr-3 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-accent focus:ring-2 focus:ring-accent/15"
        />
      </div>

      <div className="ml-auto flex items-center gap-2">
        {/* -------------------------------------------------------- filter */}
        <Popover.Root open={filterOpen} onOpenChange={onFilterOpenChange}>
          <Popover.Trigger asChild>
            <Button className={filterCount > 0 ? "border-accent text-accent" : undefined}>
              <ListFilter size={14} className={filterCount > 0 ? "" : "text-ink-muted"} />
              {hideLabels ? null : "Filter"}
              {filterCount > 0 ? (
                <span className="ml-0.5 rounded bg-accent px-1.5 text-[11px] font-semibold text-white">
                  {filterCount}
                </span>
              ) : null}
            </Button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              align="end"
              sideOffset={6}
              className="z-50 w-[440px] rounded-xl border border-line bg-surface p-3 shadow-xl"
            >
              {view.rowFilters.length === 0 ? (
                <p className="px-1 pb-2 text-[12px] text-ink-muted">
                  No filters. Add one to narrow the table.
                </p>
              ) : (
                <div className="space-y-2 pb-2">
                  {view.rowFilters.map((filter, index) => {
                    const op = FILTER_OPS.find((o) => o.value === filter.op);
                    return (
                      <div key={index} className="flex items-center gap-1.5">
                        <span className="w-10 shrink-0 text-[11.5px] text-ink-faint">
                          {index === 0 ? (
                            "Where"
                          ) : (
                            <select
                              value={view.filterMatch}
                              onChange={(event) =>
                                onViewChange({
                                  ...view,
                                  filterMatch: event.target.value as "all" | "any",
                                })
                              }
                              className="w-full rounded border border-line bg-surface px-1 py-0.5 text-[11px] outline-none"
                            >
                              <option value="all">and</option>
                              <option value="any">or</option>
                            </select>
                          )}
                        </span>

                        <select
                          value={filter.field}
                          onChange={(event) =>
                            setFilters(
                              view.rowFilters.map((f, i) =>
                                i === index ? { ...f, field: event.target.value } : f,
                              ),
                            )
                          }
                          className="h-8 min-w-0 flex-1 rounded-md border border-line bg-surface px-2 text-[12.5px] outline-none focus:border-accent"
                        >
                          {columns.map((column) => (
                            <option key={column.id} value={column.id}>
                              {column.label}
                            </option>
                          ))}
                        </select>

                        <select
                          value={filter.op}
                          onChange={(event) =>
                            setFilters(
                              view.rowFilters.map((f, i) =>
                                i === index
                                  ? { ...f, op: event.target.value as FilterOp }
                                  : f,
                              ),
                            )
                          }
                          className="h-8 w-28 shrink-0 rounded-md border border-line bg-surface px-2 text-[12.5px] outline-none focus:border-accent"
                        >
                          {FILTER_OPS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>

                        {op?.needsValue ? (
                          <input
                            value={filter.value}
                            onChange={(event) =>
                              setFilters(
                                view.rowFilters.map((f, i) =>
                                  i === index ? { ...f, value: event.target.value } : f,
                                ),
                              )
                            }
                            placeholder="value"
                            className="h-8 w-28 shrink-0 rounded-md border border-line px-2 text-[12.5px] outline-none focus:border-accent"
                          />
                        ) : (
                          <span className="w-28 shrink-0" />
                        )}

                        <button
                          onClick={() =>
                            setFilters(view.rowFilters.filter((_, i) => i !== index))
                          }
                          aria-label="Remove filter"
                          className="rounded-md p-1 text-ink-faint hover:bg-line-soft hover:text-flag"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="flex items-center justify-between border-t border-line-soft pt-2">
                <button
                  onClick={() =>
                    setFilters([
                      ...view.rowFilters,
                      {
                        field: columns[0]?.id ?? "",
                        op: "contains",
                        value: "",
                      },
                    ])
                  }
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12.5px] font-medium text-accent hover:bg-accent-soft"
                >
                  <Plus size={13} />
                  Add filter
                </button>
                {view.rowFilters.length > 0 ? (
                  <button
                    onClick={() => setFilters([])}
                    className="rounded-md px-2 py-1 text-[12.5px] text-ink-muted hover:bg-line-soft"
                  >
                    Clear all
                  </button>
                ) : null}
              </div>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>

        {/*
          Column visibility. This is the only way back from "Hide column" in a header's
          context menu, so it lists every column — including the hidden ones, which is
          the whole point — rather than only what is currently on screen.
        */}
        <Popover.Root
          open={collapseButtons ? columnsOpen : undefined}
          onOpenChange={collapseButtons ? setColumnsOpen : undefined}
        >
          {/*
            When collapsed, the trigger is not rendered at all — relying on a `hidden`
            class loses to the button's own `inline-flex`, since both are display
            utilities and source order decides. Radix still needs something to position
            against, so a zero-size anchor stays in the flow.
          */}
          {collapseButtons ? <Popover.Anchor className="h-0 w-0" /> : null}
          <Popover.Trigger asChild style={collapseButtons ? { display: "none" } : undefined}>
            <Button aria-label="Columns">
              <Settings2 size={14} className="text-ink-muted" />
              {hiddenCount > 0 ? (
                <span className="rounded-full bg-accent px-1.5 text-[10.5px] font-semibold text-white">
                  {hiddenCount}
                </span>
              ) : null}
            </Button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              align="end"
              sideOffset={6}
              className="z-50 max-h-[340px] w-[220px] overflow-y-auto rounded-xl border border-line bg-surface p-1.5 shadow-lg"
            >
              <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-faint">
                Columns
              </p>
              {columns.map((column) => {
                const shown = !hidden.includes(column.id);
                return (
                  <button
                    key={column.id}
                    onClick={() => toggleColumn(column.id)}
                    className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[12.5px] text-ink hover:bg-line-soft"
                  >
                    <span className={shown ? "" : "text-ink-faint"}>{column.label}</span>
                    {shown ? <Check size={12} className="text-accent" /> : null}
                  </button>
                );
              })}
              {hiddenCount > 0 ? (
                <button
                  onClick={() => onViewChange({ ...view, hiddenColumns: [] })}
                  className="mt-1 w-full rounded-md px-2 py-1.5 text-left text-[12.5px] text-accent hover:bg-accent-soft"
                >
                  Show all columns
                </button>
              ) : null}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>

        <Button variant="primary" onClick={onAdd} aria-label={addLabel}>
          <Plus size={15} />
          {hideLabels ? null : addLabel}
        </Button>

        {/* ------------------------------------------------ overflow (3 dots) */}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <Button variant="ghost" aria-label="More options">
              <MoreVertical size={16} />
            </Button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={4}
              className="z-50 min-w-[220px] rounded-lg border border-line bg-surface p-1 shadow-lg"
            >
              {/*
                Sort lives here rather than in the toolbar: every column header is
                already click-to-sort, so a top-level button was a second path to the
                same thing.
              */}
              {collapseButtons ? (
                <>
                  <DropdownMenu.Item
                    onSelect={() => setColumnsOpen(true)}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] text-ink outline-none data-[highlighted]:bg-line-soft"
                  >
                    <Settings2 size={13} className="text-ink-muted" />
                    Columns
                    {hiddenCount > 0 ? (
                      <span className="ml-auto text-[11.5px] text-ink-faint">
                        {hiddenCount} hidden
                      </span>
                    ) : null}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] text-ink outline-none data-[highlighted]:bg-line-soft"
                  >
                    <Table2 size={13} className="text-ink-muted" />
                    Table View
                  </DropdownMenu.Item>
                  <DropdownMenu.Separator className="my-1 h-px bg-line-soft" />
                </>
              ) : null}

              <DropdownMenu.Sub>
                <DropdownMenu.SubTrigger className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] text-ink outline-none data-[highlighted]:bg-line-soft">
                  <ArrowUpDown size={13} className="text-ink-muted" />
                  Sort by
                  {view.sorts[0] ? (
                    <span className="ml-auto text-[11.5px] text-ink-faint">
                      {columns.find((c) => c.id === view.sorts[0]!.id)?.label}
                    </span>
                  ) : null}
                </DropdownMenu.SubTrigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.SubContent
                    sideOffset={2}
                    className="z-50 max-h-[320px] min-w-[200px] overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-lg"
                  >
                    {columns.map((column) => {
                      const sort = view.sorts.find((s) => s.id === column.id);
                      return (
                        <DropdownMenu.Item
                          key={column.id}
                          onSelect={(event) => {
                            event.preventDefault();
                            toggleSort(column.id);
                          }}
                          className="flex cursor-pointer items-center justify-between rounded-md px-2 py-1.5 text-[12.5px] text-ink outline-none data-[highlighted]:bg-line-soft"
                        >
                          {column.label}
                          {sort ? (
                            sort.dir === "asc" ? (
                              <ArrowUp size={12} className="text-accent" />
                            ) : (
                              <ArrowDown size={12} className="text-accent" />
                            )
                          ) : null}
                        </DropdownMenu.Item>
                      );
                    })}
                    {view.sorts.length > 0 ? (
                      <>
                        <DropdownMenu.Separator className="my-1 h-px bg-line-soft" />
                        <DropdownMenu.Item
                          onSelect={() => onViewChange({ ...view, sorts: [] })}
                          className="cursor-pointer rounded-md px-2 py-1.5 text-[12.5px] text-ink-muted outline-none data-[highlighted]:bg-line-soft"
                        >
                          Clear sort
                        </DropdownMenu.Item>
                      </>
                    ) : null}
                  </DropdownMenu.SubContent>
                </DropdownMenu.Portal>
              </DropdownMenu.Sub>

              <DropdownMenu.Item
                onSelect={() => onViewChange({ ...view, rowFilters: [], sorts: [] })}
                className="cursor-pointer rounded-md px-2 py-1.5 text-[12.5px] text-ink-muted outline-none data-[highlighted]:bg-line-soft"
              >
                Reset view
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </div>
  );
}
