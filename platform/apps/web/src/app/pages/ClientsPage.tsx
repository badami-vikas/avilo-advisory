import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Activity, AlertTriangle, Download, Layers, TrendingUp, Upload } from "lucide-react";
import { applyView, defaultViewConfig, type ColumnSpec, type ViewConfig } from "@avilo/tables";
import { formatPeriod } from "@avilo/module";

import { api } from "../../lib/trpc.js";
import { money, percent } from "../../lib/format.js";
import { Block, Button, EmptyState, Spinner, StatTile } from "../components/ui.js";
import { DataTable, type ColumnRender } from "../components/DataTable.js";
import { TableToolbar } from "../components/TableToolbar.js";
import { UploadDialog } from "../components/UploadDialog.js";

type ClientRow = Awaited<ReturnType<typeof api.clients.list.query>>[number];

const TABLE_ID = "clients.table";

const STAGES = ["Onboarding", "Active", "Review", "Dormant"];

/** Columns are data, per the @bridge/tables contract — not hardcoded UI branches. */
const COLUMNS: ColumnSpec[] = [
  { id: "name", label: "Client", kind: "text", editable: true, width: 230 },
  { id: "stage", label: "Stage", kind: "select", editable: true, options: STAGES, width: 130 },
  { id: "latestPeriod", label: "Latest period", kind: "text", width: 140 },
  { id: "revenue", label: "Revenue", kind: "number", format: "currency", width: 120 },
  { id: "netOperatingIncome", label: "Net Op. Income", kind: "number", format: "currency", width: 140 },
  { id: "grossMarginPct", label: "Gross margin", kind: "number", format: "percent", width: 130 },
  { id: "noiMarginPct", label: "NOI margin", kind: "number", format: "percent", width: 120 },
  { id: "daysCashOnHand", label: "Days cash", kind: "number", width: 110 },
  { id: "owner", label: "Owner", kind: "text", editable: true, width: 140 },
  { id: "data", label: "Data", kind: "text", width: 140 },
];

export function ClientsPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<ClientRow[] | null>(null);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<ViewConfig>(() => ({
    ...defaultViewConfig(TABLE_ID),
    sorts: [{ id: "name", dir: "asc" }],
  }));
  const [uploadFor, setUploadFor] = useState<ClientRow | null>(null);
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

  /**
   * Metric columns are computed from imported facts, so there is no single value to
   * edit here — a figure belongs to a period. Double-clicking one opens that client's
   * element page, where the value is editable against the period it belongs to.
   */
  const openDetail = useCallback(
    (row: ClientRow) => navigate(`/client/${row.id}`),
    [navigate],
  );

  const metricTip = useCallback(
    (row: ClientRow, what: string) =>
      !row.latestPeriod
        ? "No data imported yet. Use Upload to add a QuickBooks export."
        : `${what} for ${formatPeriod(row.latestPeriod)}, computed from imported data. Double-click to open the element page and edit it there.`,
    [],
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
        align: "right",
        numeric: true,
        value: (row) => row.revenue,
        formatAggregate: money,
        tip: (row) => metricTip(row, "Total revenue"),
        onDoubleClick: openDetail,
        render: (row) => (
          <span className="num font-medium text-ink">{money(row.revenue)}</span>
        ),
      },
      netOperatingIncome: {
        align: "right",
        numeric: true,
        value: (row) => row.netOperatingIncome,
        formatAggregate: money,
        tip: (row) => metricTip(row, "Net Operating Income"),
        onDoubleClick: openDetail,
        render: (row) => (
          <span className="num text-ink">{money(row.netOperatingIncome)}</span>
        ),
      },
      grossMarginPct: {
        align: "right",
        numeric: true,
        value: (row) => row.grossMarginPct,
        formatAggregate: (v) => percent(v),
        tip: (row) => metricTip(row, "Gross margin"),
        onDoubleClick: openDetail,
        render: (row) => (
          <span className="num text-ink-muted">{percent(row.grossMarginPct)}</span>
        ),
      },
      noiMarginPct: {
        align: "right",
        numeric: true,
        value: (row) => row.noiMarginPct,
        formatAggregate: (v) => percent(v),
        tip: (row) => metricTip(row, "Net Operating Income margin"),
        onDoubleClick: openDetail,
        render: (row) => (
          <span className="num text-ink-muted">{percent(row.noiMarginPct)}</span>
        ),
      },
      daysCashOnHand: {
        align: "right",
        numeric: true,
        value: (row) => row.daysCashOnHand,
        formatAggregate: (v) => String(Math.round(v)),
        tip: (row) =>
          row.daysCashOnHand === null
            ? "Needs a Balance Sheet import — cash in bank accounts is missing"
            : metricTip(row, "Days cash on hand"),
        onDoubleClick: openDetail,
        render: (row) =>
          row.daysCashOnHand === null ? (
            <span className="text-ink-faint">—</span>
          ) : (
            <span className="num text-ink-muted">{Math.round(row.daysCashOnHand)}</span>
          ),
      },
      owner: {
        value: (row) => row.owner ?? "",
        editValue: (row) => row.owner ?? "",
        onEdit: (row, next) => patch(row, "owner", next),
        tip: () => "Double-click to assign an owner",
        render: (row) =>
          row.owner ? (
            <span className="text-ink-muted">{row.owner}</span>
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
    [metricTip, openDetail, patch],
  );

  const visible = useMemo(() => {
    if (!rows) return [];
    const searched = search.trim()
      ? rows.filter((row) =>
          [row.name, row.stage, row.owner ?? ""]
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

  // Tiles summarise what is on screen. Computing them from the unfiltered set while
  // "Showing" counts the filtered set put two contradictory numbers side by side.
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

  return (
    <div className="space-y-4">
      <TableToolbar
        tableId={TABLE_ID}
        columns={COLUMNS}
        view={view}
        onViewChange={setView}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search clients…"
        onAdd={addClient}
        addLabel="Add Client"
      />

      <div className="flex flex-wrap gap-2.5">
        <StatTile icon={<Layers size={15} />} label="Showing" value={String(visible.length)} />
        <StatTile
          icon={<TrendingUp size={15} />}
          label="Total revenue"
          value={money(totals.revenue)}
        />
        <StatTile
          icon={<AlertTriangle size={15} />}
          label="Missing inputs"
          value={String(totals.flags)}
          tone={totals.flags > 0 ? "flag" : "neutral"}
        />
        <StatTile
          icon={<Activity size={15} />}
          label="Avg NOI margin"
          value={percent(totals.avgMargin)}
        />
      </div>

      {error ? (
        <div className="rounded-xl border border-flag/25 bg-flag-soft px-4 py-3 text-[12.5px] text-flag">
          {error}
        </div>
      ) : null}

      <Block>
        {rows === null ? (
          <Spinner label="Loading clients…" />
        ) : (
          <DataTable<ClientRow>
            columns={COLUMNS}
            renderers={renderers}
            rows={visible}
            view={view}
            rowKey={(row) => row.id}
            onSort={toggleSort}
            onRowClick={openDetail}
            onAddRow={addClient}
            addRowLabel="New client"
            emptyState={
              <EmptyState
                title={
                  view.rowFilters.length > 0 || search
                    ? "No clients match"
                    : "No clients yet"
                }
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
            }
            rowActions={(row) => (
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
            )}
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
