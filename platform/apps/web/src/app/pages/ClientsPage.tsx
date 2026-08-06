import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Activity, AlertTriangle, Download, Layers, TrendingUp, Upload } from "lucide-react";
import { applyView, defaultViewConfig, type ColumnSpec, type ViewConfig } from "@avilo/tables";
import { formatPeriod } from "@avilo/module";

import { api } from "../../lib/trpc.js";
import { useArrangement } from "../../lib/arrangement.jsx";
import { DEFAULT_TILES, TILES } from "./landing-tiles.js";
import { money, parseFigure, percent } from "../../lib/format.js";
import { Block, Button, EmptyState, Spinner, StatTile } from "../components/ui.js";
import { DataTable, type ColumnRender } from "../components/DataTable.js";
import { ClientCardView } from "../components/ClientCardView.js";
import { TableToolbar } from "../components/TableToolbar.js";
import { UploadDialog } from "../components/UploadDialog.js";
import { ModelSettingsDialog } from "../components/ModelSettingsDialog.js";

type ClientRow = Awaited<ReturnType<typeof api.clients.list.query>>[number];

const TABLE_ID = "clients.table";

const STAGES = ["Onboarding", "Active", "Review", "Dormant"];

/**
 * Full column catalog. Core columns are visible by default; financial detail columns
 * start hidden and appear when the user picks them from "Add column" in the ⋯ menu.
 */
const COLUMNS: ColumnSpec[] = [
  { id: "name", label: "Client", kind: "text", editable: true, width: 230 },
  { id: "stage", label: "Stage", kind: "select", editable: true, options: STAGES, width: 130 },
  { id: "latestPeriod", label: "Latest period", kind: "text", width: 140 },
  { id: "revenue", label: "Revenue", kind: "number", format: "currency", editable: true, width: 120 },
  { id: "netOperatingIncome", label: "Net Op. Income", kind: "number", format: "currency", editable: true, width: 140 },
  { id: "grossMarginPct", label: "Gross margin %", kind: "number", format: "percent", editable: true, width: 130 },
  { id: "noiMarginPct", label: "NOI margin %", kind: "number", format: "percent", editable: true, width: 120 },
  { id: "daysCashOnHand", label: "Days cash", kind: "number", editable: true, width: 110 },
  // Financial detail — hidden by default, available via Add column
  { id: "grossProfit", label: "Gross profit", kind: "number", format: "currency", editable: true, width: 130 },
  { id: "cogs", label: "Cost of sales", kind: "number", format: "currency", editable: true, width: 130 },
  { id: "overhead", label: "Overhead", kind: "number", format: "currency", editable: true, width: 120 },
  { id: "cash", label: "Cash in bank", kind: "number", format: "currency", editable: true, width: 120 },
  { id: "ar", label: "Accounts receivable", kind: "number", format: "currency", editable: true, width: 160 },
  { id: "ap", label: "Accounts payable", kind: "number", format: "currency", editable: true, width: 150 },
  { id: "totalAssets", label: "Total assets", kind: "number", format: "currency", editable: true, width: 130 },
  { id: "dso", label: "Collection days (DSO)", kind: "number", editable: true, width: 160 },
  { id: "dpo", label: "Payment days (DPO)", kind: "number", editable: true, width: 150 },
  // Client profile fields
  { id: "legalName", label: "Legal name", kind: "text", editable: true, width: 180 },
  { id: "industry", label: "Industry", kind: "text", editable: true, width: 170 },
  { id: "data", label: "Data", kind: "text", width: 140 },
];

/** Columns hidden by default — available to add via the ⋯ menu. */
const DEFAULT_HIDDEN = [
  "grossProfit", "cogs", "overhead", "cash", "ar", "ap", "totalAssets", "dso", "dpo",
  "legalName", "industry",
];

/**
 * Which stored value each metric column is showing.
 *
 * The figures in this table are the client's *latest period*, so an edit here is an
 * override on that period — the same write the element page makes, against the same
 * target. Routing it anywhere else would put the correction on a month the user was not
 * looking at.
 */
const METRIC_TARGETS: Record<string, { kind: "account" | "metric"; id: string }> = {
  revenue:           { kind: "account", id: "pl.revenue" },
  cogs:              { kind: "account", id: "pl.cogs" },
  overhead:          { kind: "account", id: "pl.overhead" },
  cash:              { kind: "account", id: "bs.cash" },
  ar:                { kind: "account", id: "bs.ar" },
  ap:                { kind: "account", id: "bs.ap" },
  totalAssets:       { kind: "account", id: "bs.total_assets" },
  grossProfit:       { kind: "metric",  id: "gross_profit" },
  netOperatingIncome:{ kind: "metric",  id: "net_operating_income" },
  grossMarginPct:    { kind: "metric",  id: "gross_margin_pct" },
  noiMarginPct:      { kind: "metric",  id: "noi_margin_pct" },
  daysCashOnHand:    { kind: "metric",  id: "days_cash_on_hand" },
  dso:               { kind: "metric",  id: "dso" },
  dpo:               { kind: "metric",  id: "dpo" },
};

export function ClientsPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<ClientRow[] | null>(null);
  const [search, setSearch] = useState("");
  const [openFilter, setOpenFilter] = useState(false);
  const [view, setView] = useState<ViewConfig>(() => ({
    ...defaultViewConfig(TABLE_ID),
    sorts: [{ id: "name", dir: "asc" }],
    hiddenColumns: DEFAULT_HIDDEN,
  }));
  /*
    The two clients-page arrangements. Applying `clientsTable` seeds the view overlay the
    ⋯ menu also writes, so an assistant change and a manual change use one mechanism rather
    than competing — the advisor can always override afterwards, and the next assistant
    change overrides that in turn. Last writer wins, and both writers are visible.
  */
  const clientsTable = useArrangement("clients_table_layout");
  const landingTiles = useArrangement("landing_tiles");

  useEffect(() => {
    const a = clientsTable.value;
    if (!a) return;
    setView((prev) => ({
      ...prev,
      ...(a.order ? { columnOrder: a.order.filter((id) => COLUMNS.some((c) => c.id === id)) } : {}),
      ...(a.hidden ? { hiddenColumns: a.hidden } : {}),
    }));
  }, [clientsTable.value]);

  const [uploadFor, setUploadFor] = useState<ClientRow | null>(null);
  const [viewMode, setViewMode] = useState<"table" | "card">("table");
  const [modelSettings, setModelSettings] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setRows(await api.clients.list.query());
      setError(null);
    } catch (cause) {
      setError(
        `Could not reach the local API. Is it running? (${(cause as Error).message})`,
      );
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /**
   * A new client is inserted immediately with a placeholder name and the row goes
   * straight into inline edit — no prompt, no modal. The advisor types over it.
   */
  const addClient = useCallback(async () => {
    const existing = rows ?? [];
    let name = "New client";
    let suffix = 2;
    while (existing.some((row) => row.name === name)) {
      name = `New client ${suffix}`;
      suffix += 1;
    }
    await api.clients.create.mutate({ name });
    await reload();
  }, [reload, rows]);

  const patch = useCallback(
    async (row: ClientRow, field: string, value: string) => {
      await api.clients.update.mutate({ id: row.id, patch: { [field]: value } });
      await reload();
    },
    [reload],
  );

  const toggleSort = useCallback((columnId: string) => {
    setView((current) => {
      const existing = current.sorts.find((s) => s.id === columnId);
      if (!existing) return { ...current, sorts: [{ id: columnId, dir: "asc" }] };
      if (existing.dir === "asc")
        return { ...current, sorts: [{ id: columnId, dir: "desc" }] };
      return { ...current, sorts: [] };
    });
  }, []);

  const setSortDir = useCallback((columnId: string, dir: "asc" | "desc") => {
    setView((current) => ({ ...current, sorts: [{ id: columnId, dir }] }));
  }, []);

  const hideColumn = useCallback((columnId: string) => {
    setView((current) => {
      const hidden = current.hiddenColumns ?? [];
      return {
        ...current,
        hiddenColumns: hidden.includes(columnId) ? hidden : [...hidden, columnId],
      };
    });
  }, []);

  /**
   * Seed a filter on a column and open the builder, rather than applying one blind.
   * "contains ''" matches everything, so the row count does not move until the user
   * types — a filter that silently emptied the table would look like data loss.
   */
  const filterOnColumn = useCallback((columnId: string) => {
    setView((current) => ({
      ...current,
      rowFilters: [
        ...current.rowFilters,
        { field: columnId, op: "contains" as const, value: "" },
      ],
    }));
    setOpenFilter(true);
  }, []);

  /**
   * Metric columns are computed from imported facts, so there is no single value to
   * edit here — a figure belongs to a period. Double-clicking one opens that client's
   * element page, where the value is editable against the period it belongs to.
   */
  const openDetail = useCallback(
    (row: ClientRow) => navigate(`/client/${row.id}`),
    [navigate],
  );

  /**
   * Override a metric shown in this table.
   *
   * Refuses when the client has no period rather than inventing one: a figure has to
   * belong to a month, and guessing which month a correction applies to is the kind of
   * silent write that is only discovered when the numbers stop reconciling.
   */
  const overrideMetric = useCallback(
    async (row: ClientRow, columnId: string, raw: string) => {
      const target = METRIC_TARGETS[columnId];
      if (!target || !row.latestPeriod) return;
      const current = (row as unknown as Record<string, number | null>)[columnId] ?? null;
      await api.overrides.set.mutate({
        clientId: row.id,
        period: row.latestPeriod,
        targetKind: target.kind,
        targetId: target.id,
        value: parseFigure(raw),
        previousValue: current,
      });
      await reload();
    },
    [reload],
  );

  const metricTip = useCallback(
    (row: ClientRow, what: string) =>
      !row.latestPeriod
        ? "No data imported yet. Use Upload to add a QuickBooks export."
        : `${what} for ${formatPeriod(row.latestPeriod)}, computed from imported data. Double-click to correct it for that period.`,
    [],
  );

  /**
   * The shared parts of a metric column.
   *
   * `canEdit` gates it on the row having a period to write to, so a client with nothing
   * imported keeps the old behaviour — double-click opens the element page, where Upload
   * is — instead of offering an editor whose commit would be discarded.
   */
  const metricColumn = useCallback(
    (columnId: string, what: string): ColumnRender<ClientRow> => ({
      align: "right",
      numeric: true,
      tip: (row) => metricTip(row, what),
      onDoubleClick: openDetail,
      canEdit: (row) => Boolean(row.latestPeriod),
      editValue: (row) => {
        const value = (row as unknown as Record<string, number | null>)[columnId];
        return value === null || value === undefined ? "" : String(value);
      },
      onEdit: (row, next) => overrideMetric(row, columnId, next),
    }),
    [metricTip, openDetail, overrideMetric],
  );

  const renderers = useMemo<Record<string, ColumnRender<ClientRow>>>(
    () => ({
      name: {
        value: (row) => row.name,
        editValue: (row) => row.name,
        onEdit: (row, next) => patch(row, "name", next),
        tip: () => "Double-click to rename",
        render: (row) => <span className="font-medium text-ink">{row.name}</span>,
      },
      stage: {
        value: (row) => row.stage,
        editValue: (row) => row.stage,
        options: STAGES,
        onEdit: (row, next) => patch(row, "stage", next),
        tip: () => "Double-click to change stage",
        render: (row) => (
          <span className="inline-flex items-center rounded-md border border-line bg-line-soft px-2 py-[3px] text-[11px] font-medium text-ink-muted">
            {row.stage}
          </span>
        ),
      },
      latestPeriod: {
        value: (row) => row.latestPeriod ?? "",
        tip: (row) =>
          row.periodCount > 1
            ? `${row.periodCount} periods imported. Figures shown are for the most recent.`
            : row.latestPeriod
              ? "The only period imported so far"
              : "Nothing imported yet",
        onDoubleClick: openDetail,
        render: (row) =>
          row.latestPeriod ? (
            <span className="text-ink-muted">
              {formatPeriod(row.latestPeriod)}
              {row.periodCount > 1 ? (
                <span className="ml-1.5 text-ink-faint">+{row.periodCount - 1}</span>
              ) : null}
            </span>
          ) : (
            <span className="text-ink-faint">No data</span>
          ),
      },
      revenue: {
        ...metricColumn("revenue", "Total revenue"),
        value: (row) => row.revenue,
        formatAggregate: money,
        render: (row) => (
          <span className="num font-medium text-ink">{money(row.revenue)}</span>
        ),
      },
      netOperatingIncome: {
        ...metricColumn("netOperatingIncome", "Net Operating Income"),
        value: (row) => row.netOperatingIncome,
        formatAggregate: money,
        render: (row) => (
          <span className="num text-ink">{money(row.netOperatingIncome)}</span>
        ),
      },
      grossMarginPct: {
        ...metricColumn("grossMarginPct", "Gross margin"),
        value: (row) => row.grossMarginPct,
        formatAggregate: (v) => percent(v),
        render: (row) => (
          <span className="num text-ink-muted">{percent(row.grossMarginPct)}</span>
        ),
      },
      noiMarginPct: {
        ...metricColumn("noiMarginPct", "Net Operating Income margin"),
        value: (row) => row.noiMarginPct,
        formatAggregate: (v) => percent(v),
        render: (row) => (
          <span className="num text-ink-muted">{percent(row.noiMarginPct)}</span>
        ),
      },
      daysCashOnHand: {
        ...metricColumn("daysCashOnHand", "Days cash on hand"),
        value: (row) => row.daysCashOnHand,
        formatAggregate: (v) => String(Math.round(v)),
        tip: (row) =>
          row.daysCashOnHand === null && row.latestPeriod
            ? "Needs a Balance Sheet import — cash in bank accounts is missing"
            : metricTip(row, "Days cash on hand"),
        render: (row) =>
          row.daysCashOnHand === null ? (
            <span className="text-ink-faint">—</span>
          ) : (
            <span className="num text-ink-muted">{Math.round(row.daysCashOnHand)}</span>
          ),
      },
      grossProfit: {
        ...metricColumn("grossProfit", "Gross profit"),
        value: (row) => row.grossProfit,
        formatAggregate: money,
        render: (row) => <span className="num text-ink-muted">{money(row.grossProfit)}</span>,
      },
      cogs: {
        ...metricColumn("cogs", "Cost of sales"),
        value: (row) => row.cogs,
        formatAggregate: money,
        render: (row) => <span className="num text-ink-muted">{money(row.cogs)}</span>,
      },
      overhead: {
        ...metricColumn("overhead", "Overhead"),
        value: (row) => row.overhead,
        formatAggregate: money,
        render: (row) => <span className="num text-ink-muted">{money(row.overhead)}</span>,
      },
      cash: {
        ...metricColumn("cash", "Cash in bank accounts"),
        value: (row) => row.cash,
        formatAggregate: money,
        render: (row) => <span className="num text-ink-muted">{money(row.cash)}</span>,
      },
      ar: {
        ...metricColumn("ar", "Accounts receivable"),
        value: (row) => row.ar,
        formatAggregate: money,
        render: (row) => <span className="num text-ink-muted">{money(row.ar)}</span>,
      },
      ap: {
        ...metricColumn("ap", "Accounts payable"),
        value: (row) => row.ap,
        formatAggregate: money,
        render: (row) => <span className="num text-ink-muted">{money(row.ap)}</span>,
      },
      totalAssets: {
        ...metricColumn("totalAssets", "Total assets"),
        value: (row) => row.totalAssets,
        formatAggregate: money,
        render: (row) => <span className="num text-ink-muted">{money(row.totalAssets)}</span>,
      },
      dso: {
        ...metricColumn("dso", "Collection days (DSO)"),
        value: (row) => row.dso,
        formatAggregate: (v) => `${Math.round(v)}d`,
        render: (row) =>
          row.dso === null ? (
            <span className="text-ink-faint">—</span>
          ) : (
            <span className="num text-ink-muted">{Math.round(row.dso)}d</span>
          ),
      },
      dpo: {
        ...metricColumn("dpo", "Payment days (DPO)"),
        value: (row) => row.dpo,
        formatAggregate: (v) => `${Math.round(v)}d`,
        render: (row) =>
          row.dpo === null ? (
            <span className="text-ink-faint">—</span>
          ) : (
            <span className="num text-ink-muted">{Math.round(row.dpo)}d</span>
          ),
      },
      legalName: {
        value: (row) => row.legalName ?? "",
        editValue: (row) => row.legalName ?? "",
        onEdit: (row, next) => patch(row, "legalName", next),
        tip: () => "The registered entity name. Double-click to edit",
        render: (row) =>
          row.legalName ? (
            <span className="text-ink-muted">{row.legalName}</span>
          ) : (
            <span className="text-ink-faint">—</span>
          ),
      },
      industry: {
        value: (row) => row.industry ?? "",
        editValue: (row) => row.industry ?? "",
        onEdit: (row, next) => patch(row, "industry", next),
        tip: () => "Double-click to set the industry",
        render: (row) =>
          row.industry ? (
            <span className="text-ink-muted">{row.industry}</span>
          ) : (
            <span className="text-ink-faint">—</span>
          ),
      },
      data: {
        value: (row) =>
          !row.latestPeriod
            ? "Not started"
            : row.complete
              ? "Complete"
              : `${row.missingCount} missing`,
        tip: (row) =>
          !row.latestPeriod
            ? "Upload a QuickBooks export to begin"
            : row.complete
              ? "Every input the active formulas need is present"
              : "Inputs required by an active formula have no value for this period",
        onDoubleClick: openDetail,
        render: (row) => {
          if (!row.latestPeriod)
            return <span className="text-[12px] text-ink-faint">Not started</span>;
          if (row.complete)
            return <span className="text-[12px] text-ink-muted">Complete</span>;
          return (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-flag-soft px-2 py-[3px] text-[11.5px] font-medium text-flag">
              <AlertTriangle size={11} />
              {row.missingCount} missing
            </span>
          );
        },
      },
    }),
    [metricColumn, metricTip, openDetail, patch],
  );

  const visible = useMemo(() => {
    if (!rows) return [];
    const searched = search.trim()
      ? rows.filter((row) =>
          [row.name, row.stage]
            .join(" ")
            .toLowerCase()
            .includes(search.trim().toLowerCase()),
        )
      : rows;

    // Filtering and sorting both flow through the shared view engine. The projection
    // gives the engine the same values the cells display, so a filter on "Data" matches
    // what the user can see rather than an internal id.
    const projected = searched.map((row) => ({
      ...row,
      data:
        !row.latestPeriod
          ? "Not started"
          : row.complete
            ? "Complete"
            : `${row.missingCount} missing`,
      latestPeriod: row.latestPeriod ?? "",
    }));

    return applyView(projected, view) as unknown as ClientRow[];
  }, [rows, search, view]);

  /*
    Which tiles to show. Every tile still reduces `visible` — the filtered set — so the
    original rule holds: computing a tile from the unfiltered rows while "Showing" counts
    the filtered ones would put two contradictory numbers side by side.
  */
  const tiles = useMemo(() => {
    /*
      Tiles are the one arrangement where `order` is a SELECTION, not a permutation.
      Everywhere else an unmentioned id is appended, so a panel added in a later build does
      not vanish for someone with an older stored arrangement. Here that rule is wrong: ask
      for five tiles and appending the other twelve is not what anyone means. There are
      seventeen aggregates and four shown by default — the set was always a choice.
    */
    const a = landingTiles.value;
    const chosen = a?.order?.length ? a.order : a ? [] : DEFAULT_TILES;
    const hidden = new Set(a?.hidden ?? []);
    return chosen
      .filter((id) => !hidden.has(id))
      .map((id) => TILES.find((t) => t.id === id))
      .filter((t): t is (typeof TILES)[number] => Boolean(t));
  }, [landingTiles.value]);

  const totals = useMemo(() => {
    const list = visible;
    const revenue = list.reduce((sum, r) => sum + (r.revenue ?? 0), 0);
    const flags = list.reduce((sum, r) => sum + (r.missingCount ?? 0), 0);
    const withData = list.filter((r) => Boolean(r.latestPeriod));
    const avgMargin =
      withData.length === 0
        ? null
        : withData.reduce((sum, r) => sum + (r.noiMarginPct ?? 0), 0) / withData.length;
    return { revenue, flags, avgMargin };
  }, [visible]);

  /** Shared between the table and the card grid, so neither can drift from the other. */
  const emptyState = (
    <EmptyState
      title={view.rowFilters.length > 0 || search ? "No clients match" : "No clients yet"}
      body={
        view.rowFilters.length > 0 || search
          ? "Adjust or clear the filters to see more."
          : "Add a client, then drag their QuickBooks exports in. Nothing is pre-filled — every figure you see will come from a file you uploaded."
      }
      action={
        view.rowFilters.length === 0 && !search ? (
          <Button variant="primary" onClick={addClient}>
            Add your first client
          </Button>
        ) : null
      }
    />
  );

  const rowActions = (row: ClientRow) => (
    <>
      <Button size="sm" onClick={() => setUploadFor(row)} title="Upload source files">
        <Upload size={13} />
        Upload
      </Button>
      <Button
        size="sm"
        onClick={() => navigate(`/client/${row.id}?export=1`)}
        title="Download a PDF report"
        disabled={!row.latestPeriod}
      >
        <Download size={13} />
        Download
      </Button>
    </>
  );

  return (
    <div className="space-y-4">
      {modelSettings ? (
        <ModelSettingsDialog onClose={() => setModelSettings(false)} />
      ) : null}

      <TableToolbar
        tableId={TABLE_ID}
        columns={COLUMNS}
        view={view}
        onViewChange={setView}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search clients…"
        filterOpen={openFilter}
        onFilterOpenChange={setOpenFilter}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onModelSettings={() => setModelSettings(true)}
      />

      {/*
        Tiles are chosen by the `landingTiles` arrangement, computed here. The assistant
        picks which aggregate appears; the figure is always this page's own reduction over
        the rows on screen.
      */}
      <div className="flex flex-wrap gap-2.5">
        {tiles.map((tile) => (
          <StatTile
            key={tile.id}
            icon={tile.icon}
            label={tile.label}
            value={tile.value(visible)}
            {...(tile.tone ? { tone: tile.tone(visible) } : {})}
          />
        ))}
      </div>

      {error ? (
        <div className="rounded-xl border border-flag/25 bg-flag-soft px-4 py-3 text-[12.5px] text-flag">
          {error}
        </div>
      ) : null}

      <Block>
        {rows === null ? (
          <Spinner label="Loading clients…" />
        ) : viewMode === "card" ? (
          <ClientCardView<ClientRow>
            rows={visible}
            renderers={renderers}
            rowKey={(row) => row.id}
            onRowClick={openDetail}
            headerField="name"
            badgeField="stage"
            fields={[
              { id: "latestPeriod", label: "Latest period" },
              { id: "revenue", label: "Revenue" },
              { id: "netOperatingIncome", label: "Net Op. Income" },
              { id: "grossMarginPct", label: "Gross margin" },
              { id: "noiMarginPct", label: "NOI margin" },
              { id: "daysCashOnHand", label: "Days cash" },
              { id: "data", label: "Data" },
            ]}
            onAddRow={addClient}
            addRowLabel="New client"
            emptyState={emptyState}
            rowActions={rowActions}
          />
        ) : (
          <DataTable<ClientRow>
            columns={COLUMNS}
            renderers={renderers}
            rows={visible}
            view={view}
            rowKey={(row) => row.id}
            onSort={toggleSort}
            onSortDir={setSortDir}
            onHideColumn={hideColumn}
            onFilterColumn={filterOnColumn}
            onRowClick={openDetail}
            onAddRow={addClient}
            addRowLabel="New client"
            emptyState={emptyState}
            rowActions={rowActions}
          />
        )}
      </Block>

      {uploadFor ? (
        <UploadDialog
          clientId={uploadFor.id}
          clientName={uploadFor.name}
          onClose={() => setUploadFor(null)}
          onImported={() => {
            setUploadFor(null);
            void reload();
          }}
        />
      ) : null}
    </div>
  );
}
