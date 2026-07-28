import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import {
  AlertTriangle,
  Activity,
  ArrowUpDown,
  Download,
  Layers,
  ListFilter,
  MoreVertical,
  Plus,
  Search,
  Settings2,
  Table2,
  TrendingUp,
  Upload,
} from "lucide-react";
import { applyView, defaultViewConfig, type ColumnSpec, type ViewConfig } from "@avilo/tables";
import { formatPeriod } from "@avilo/module";

import { api } from "../../lib/trpc.js";
import { money, percent } from "../../lib/format.js";
import { Block, Button, EmptyState, Spinner, StatTile } from "../components/ui.js";
import { DataTable, type ColumnRender } from "../components/DataTable.js";
import { UploadDialog } from "../components/UploadDialog.js";

type ClientRow = Awaited<ReturnType<typeof api.clients.list.query>>[number];

/** Columns are data, per the @bridge/tables contract — not hardcoded UI branches. */
const COLUMNS: ColumnSpec[] = [
  { id: "name", label: "Client", kind: "text", editable: true, width: 240 },
  { id: "stage", label: "Stage", kind: "select", editable: true, options: ["Active", "Onboarding", "Review", "Dormant"], width: 130 },
  { id: "health", label: "R/Y/G", kind: "text", width: 80 },
  { id: "latestPeriod", label: "Latest period", kind: "text", width: 130 },
  { id: "revenue", label: "Revenue", kind: "number", format: "currency", width: 120 },
  { id: "netOperatingIncome", label: "Net Op. Income", kind: "number", format: "currency", width: 140 },
  { id: "grossMarginPct", label: "Gross margin", kind: "number", format: "percent", width: 130 },
  { id: "noiMarginPct", label: "NOI margin", kind: "number", format: "percent", width: 120 },
  { id: "daysCashOnHand", label: "Days cash", kind: "number", width: 110 },
  { id: "owner", label: "Owner", kind: "text", editable: true, width: 140 },
  { id: "data", label: "Data", kind: "text", width: 150 },
];

/**
 * Health is domain data the advisor reads off the numbers, not system feedback — so it
 * legitimately uses green and amber. System feedback (missing data, formula errors)
 * stays red-only, per the platform's red-flag rule.
 */
function health(row: ClientRow): "green" | "amber" | "red" | "none" {
  if (row.latestPeriod === null) return "none";
  if (row.noiMarginPct === null) return "red";
  if (row.noiMarginPct >= 10) return "green";
  if (row.noiMarginPct >= 0) return "amber";
  return "red";
}

const HEALTH_COLOR: Record<string, string> = {
  green: "bg-[#17b26a]",
  amber: "bg-[#f79009]",
  red: "bg-flag",
  none: "bg-line",
};

export function ClientsPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<ClientRow[] | null>(null);
  const [search, setSearch] = useState("");
  const [view, setView] = useState<ViewConfig>(() => ({
    ...defaultViewConfig("clients.table"),
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

  const addClient = useCallback(async () => {
    const name = window.prompt("Client name");
    if (!name?.trim()) return;
    await api.clients.create.mutate({ name: name.trim() });
    await reload();
  }, [reload]);

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

  const renderers = useMemo<Record<string, ColumnRender<ClientRow>>>(
    () => ({
      name: {
        value: (row) => row.name,
        editValue: (row) => row.name,
        onEdit: (row, next) => patch(row, "name", next),
        render: (row) => (
          <span className="font-medium text-ink">{row.name}</span>
        ),
      },
      stage: {
        value: (row) => row.stage,
        editValue: (row) => row.stage,
        onEdit: (row, next) => patch(row, "stage", next),
        render: (row) => (
          <span className="inline-flex items-center rounded-md border border-line bg-line-soft px-2 py-[3px] text-[11px] font-medium text-ink-muted">
            {row.stage}
          </span>
        ),
      },
      health: {
        align: "center",
        value: (row) => health(row),
        render: (row) => (
          <span
            className={`inline-block h-2.5 w-2.5 rounded-full ${HEALTH_COLOR[health(row)]}`}
            title={
              row.latestPeriod === null
                ? "No data imported yet"
                : `NOI margin ${percent(row.noiMarginPct)}`
            }
          />
        ),
      },
      latestPeriod: {
        value: (row) => row.latestPeriod ?? "",
        render: (row) =>
          row.latestPeriod ? (
            <span className="text-ink-muted">
              {formatPeriod(row.latestPeriod)}
              {row.periodCount > 1 ? (
                <span className="ml-1.5 text-ink-faint">
                  +{row.periodCount - 1}
                </span>
              ) : null}
            </span>
          ) : (
            <span className="text-ink-faint">No data</span>
          ),
      },
      revenue: {
        align: "right",
        value: (row) => row.revenue,
        render: (row) => (
          <span className="num font-medium text-ink">{money(row.revenue)}</span>
        ),
      },
      netOperatingIncome: {
        align: "right",
        value: (row) => row.netOperatingIncome,
        render: (row) => (
          <span className="num text-ink">{money(row.netOperatingIncome)}</span>
        ),
      },
      grossMarginPct: {
        align: "right",
        value: (row) => row.grossMarginPct,
        render: (row) => (
          <span className="num text-ink-muted">{percent(row.grossMarginPct)}</span>
        ),
      },
      noiMarginPct: {
        align: "right",
        value: (row) => row.noiMarginPct,
        render: (row) => (
          <span className="num text-ink-muted">{percent(row.noiMarginPct)}</span>
        ),
      },
      daysCashOnHand: {
        align: "right",
        value: (row) => row.daysCashOnHand,
        render: (row) =>
          row.daysCashOnHand === null ? (
            <span className="text-ink-faint">—</span>
          ) : (
            <span className="num text-ink-muted">
              {Math.round(row.daysCashOnHand)}
            </span>
          ),
      },
      owner: {
        value: (row) => row.owner ?? "",
        editValue: (row) => row.owner ?? "",
        onEdit: (row, next) => patch(row, "owner", next),
        render: (row) =>
          row.owner ? (
            <span className="text-ink-muted">{row.owner}</span>
          ) : (
            <span className="text-ink-faint">—</span>
          ),
      },
      data: {
        value: (row) => row.missingCount ?? 99,
        render: (row) => {
          if (row.latestPeriod === null)
            return <span className="text-[12px] text-ink-faint">Not started</span>;
          if (row.complete)
            return (
              <span className="text-[12px] text-ink-muted">Complete</span>
            );
          return (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-flag-soft px-2 py-[3px] text-[11.5px] font-medium text-flag">
              <AlertTriangle size={11} />
              {row.missingCount} missing
            </span>
          );
        },
      },
    }),
    [patch],
  );

  const visible = useMemo(() => {
    if (!rows) return [];
    const filtered = search.trim()
      ? rows.filter((row) =>
          [row.name, row.stage, row.owner ?? ""]
            .join(" ")
            .toLowerCase()
            .includes(search.trim().toLowerCase()),
        )
      : rows;
    // Sorting flows through the shared view engine, not a bespoke comparator.
    return applyView(
      filtered.map((row) => ({ ...row, health: health(row), data: row.missingCount })),
      view,
    ) as unknown as ClientRow[];
  }, [rows, search, view]);

  const totals = useMemo(() => {
    const list = rows ?? [];
    const revenue = list.reduce((sum, r) => sum + (r.revenue ?? 0), 0);
    const flags = list.reduce((sum, r) => sum + (r.missingCount ?? 0), 0);
    const withData = list.filter((r) => r.latestPeriod !== null);
    const avgMargin =
      withData.length === 0
        ? null
        : withData.reduce((sum, r) => sum + (r.noiMarginPct ?? 0), 0) /
          withData.length;
    return { count: list.length, revenue, flags, avgMargin };
  }, [rows]);

  return (
    <div className="space-y-4">
      {/* ---------------------------------------------------------- toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <button className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-[13px] font-medium text-ink hover:bg-line-soft">
          <Layers size={14} className="text-ink-muted" />
          All
        </button>
        <button className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-[13px] font-medium text-ink hover:bg-line-soft">
          <Table2 size={14} className="text-ink-muted" />
          Table View
        </button>

        <div className="relative min-w-[220px] flex-1 sm:max-w-md">
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
          />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search clients…"
            className="h-9 w-full rounded-lg border border-line bg-surface pl-9 pr-3 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-accent focus:ring-2 focus:ring-accent/15"
          />
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Button>
            <ListFilter size={14} className="text-ink-muted" />
            Filter
          </Button>
          <Button onClick={() => toggleSort("name")}>
            <ArrowUpDown size={14} className="text-ink-muted" />
            Sort
          </Button>
          <Button aria-label="View options">
            <Settings2 size={14} className="text-ink-muted" />
          </Button>
          <Button variant="primary" onClick={addClient}>
            <Plus size={15} />
            Add Client
          </Button>
          <Button variant="ghost" aria-label="More">
            <MoreVertical size={16} />
          </Button>
        </div>
      </div>

      {/* ------------------------------------------------------- stat tiles */}
      <div className="flex flex-wrap gap-2.5">
        <StatTile
          icon={<Layers size={15} />}
          label="Showing"
          value={String(visible.length)}
        />
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

      {/* ------------------------------------------------------------ table */}
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
            onRowClick={(row) => navigate(`/client/${row.id}`)}
            onAddRow={addClient}
            addRowLabel="New client"
            emptyState={
              <EmptyState
                title="No clients yet"
                body="Add a client, then drag their QuickBooks exports in. Nothing is pre-filled — every figure you see will come from a file you uploaded."
                action={
                  <Button variant="primary" onClick={addClient}>
                    <Plus size={15} />
                    Add your first client
                  </Button>
                }
              />
            }
            rowActions={(row) => (
              <>
                <Button
                  size="sm"
                  onClick={() => setUploadFor(row)}
                  title="Upload source files"
                >
                  <Upload size={13} />
                  Upload
                </Button>
                <Button
                  size="sm"
                  onClick={() => navigate(`/client/${row.id}?export=1`)}
                  title="Download a PDF report"
                  disabled={row.latestPeriod === null}
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
