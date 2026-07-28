import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { Download, FileText, Table2, Upload, X } from "lucide-react";
import { formatPeriod } from "@avilo/module";

import { api } from "../../lib/trpc.js";
import { Block, Button, EmptyState, Spinner } from "../components/ui.js";
import { ReportView } from "../components/ReportView.js";
import { RawDataView } from "../components/RawDataView.js";
import { UploadDialog } from "../components/UploadDialog.js";
import { EditValueDialog, type EditTarget } from "../components/EditValueDialog.js";
import type { ClientRecord, FormulaRow, PeriodReport, SeriesPoint } from "../types.js";

const CHART_IDS = ["pl.revenue", "net_operating_income", "noi_margin_pct"];

export function ClientDetailPage() {
  const { clientId = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();

  const [client, setClient] = useState<ClientRecord | null>(null);
  const [periods, setPeriods] = useState<string[] | null>(null);
  const [period, setPeriod] = useState<string | null>(null);
  const [report, setReport] = useState<PeriodReport | null>(null);
  const [series, setSeries] = useState<SeriesPoint[]>([]);
  const [formulas, setFormulas] = useState<FormulaRow[]>([]);
  const [mode, setMode] = useState<"report" | "raw">("report");
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [exporting, setExporting] = useState(false);

  /* ------------------------------------------------------------ loading */

  const loadShell = useCallback(async () => {
    const [record, available, formulaRows] = await Promise.all([
      api.clients.get.query({ id: clientId }),
      api.report.periods.query({ clientId }),
      api.formulas.list.query(),
    ]);
    setClient(record);
    setPeriods(available);
    setFormulas(formulaRows);
    setPeriod((current) => current ?? available[0] ?? null);
  }, [clientId]);

  const loadReport = useCallback(async () => {
    if (!period) {
      setReport(null);
      setSeries([]);
      return;
    }
    const [periodReport, allPeriods] = await Promise.all([
      api.report.period.query({ clientId, period }),
      api.report.periods.query({ clientId }),
    ]);
    setReport(periodReport);
    const sorted = [...allPeriods].sort();
    if (sorted.length > 0) {
      setSeries(
        await api.report.series.query({
          clientId,
          start: sorted[0]!,
          end: sorted[sorted.length - 1]!,
          ids: CHART_IDS,
        }),
      );
    }
  }, [clientId, period]);

  useEffect(() => {
    void loadShell();
  }, [loadShell]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  // Deep link from the landing table's Download action.
  useEffect(() => {
    if (searchParams.get("export") === "1" && report) {
      setExporting(true);
      searchParams.delete("export");
      setSearchParams(searchParams, { replace: true });
    }
  }, [report, searchParams, setSearchParams]);

  const refresh = useCallback(async () => {
    await Promise.all([loadShell(), loadReport()]);
  }, [loadReport, loadShell]);

  /* ------------------------------------------------------------- editing */

  const openAccountEditor = useCallback(
    (accountId: string) => {
      const account = report?.accounts.find((a) => a.accountId === accountId);
      if (!account) return;
      setEditing({
        kind: "account",
        id: accountId,
        label: account.label,
        unit: account.unit,
        currentValue: account.value,
      });
    },
    [report],
  );

  const openMetricEditor = useCallback(
    (metricId: string) => {
      const formula = formulas.find((f) => f.id === metricId);
      const metric = report?.metrics.find((m) => m.id === metricId);
      if (!formula) return;
      setEditing({
        kind: "metric",
        id: metricId,
        label: formula.label,
        unit: formula.unit,
        currentValue: metric?.value ?? null,
        expression: formula.expression,
        formulaVersion: formula.version,
      });
    },
    [formulas, report],
  );

  const clearOverride = useCallback(
    async (accountId: string) => {
      if (!period) return;
      const list = await api.overrides.list.query({ clientId, period });
      const active = list.find(
        (o) => o.status === "active" && o.targetId === accountId,
      );
      if (active) await api.overrides.clear.mutate({ id: active.id });
      await refresh();
    },
    [clientId, period, refresh],
  );

  const title = client?.name ?? "…";

  /* -------------------------------------------------------------- render */

  if (!client || periods === null) return <Spinner label="Loading client…" />;

  return (
    <div className="space-y-4">
      {/* ------------------------------------------------------ page header */}
      <div className="no-print flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-[19px] font-semibold tracking-tight text-ink">{title}</h1>
          <p className="mt-0.5 text-[12.5px] text-ink-muted">
            {periods.length === 0
              ? "No source files imported yet"
              : `${periods.length} period${periods.length === 1 ? "" : "s"} imported`}
          </p>
        </div>

        {/* Report / Raw data toggle, at the top as specified. */}
        <div className="inline-flex rounded-lg border border-line bg-surface p-0.5">
          <button
            onClick={() => setMode("report")}
            aria-pressed={mode === "report"}
            className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-colors ${
              mode === "report" ? "bg-ink text-white" : "text-ink-muted hover:text-ink"
            }`}
          >
            <FileText size={14} />
            Report
          </button>
          <button
            onClick={() => setMode("raw")}
            aria-pressed={mode === "raw"}
            className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-colors ${
              mode === "raw" ? "bg-ink text-white" : "text-ink-muted hover:text-ink"
            }`}
          >
            <Table2 size={14} />
            Raw data
          </button>
        </div>

        {periods.length > 0 ? (
          <select
            value={period ?? ""}
            onChange={(event) => setPeriod(event.target.value)}
            className="h-9 rounded-lg border border-line bg-surface px-2.5 text-[13px] text-ink outline-none focus:border-accent"
          >
            {periods.map((p) => (
              <option key={p} value={p}>
                {formatPeriod(p)}
              </option>
            ))}
          </select>
        ) : null}

        <Button onClick={() => setUploading(true)}>
          <Upload size={14} />
          Upload
        </Button>
        <Button
          variant="primary"
          onClick={() => setExporting(true)}
          disabled={!report}
        >
          <Download size={14} />
          Download PDF
        </Button>
      </div>

      {/* ------------------------------------------------------------ body */}
      {periods.length === 0 ? (
        <Block>
          <EmptyState
            title="Nothing imported for this client yet"
            body="Upload a QuickBooks Profit & Loss export to populate the dashboard. Every figure shown will be traceable back to the file it came from."
            action={
              <Button variant="primary" onClick={() => setUploading(true)}>
                <Upload size={15} />
                Upload source files
              </Button>
            }
          />
        </Block>
      ) : !report ? (
        <Spinner label="Building report…" />
      ) : mode === "report" ? (
        <ReportView
          clientName={client.name}
          report={report}
          series={series}
          onEditMetric={openMetricEditor}
        />
      ) : (
        <RawDataView
          report={report}
          formulas={formulas}
          onEditAccount={openAccountEditor}
          onEditMetric={openMetricEditor}
          onClearOverride={clearOverride}
        />
      )}

      {/* ---------------------------------------------------------- dialogs */}
      {uploading ? (
        <UploadDialog
          clientId={clientId}
          clientName={client.name}
          onClose={() => setUploading(false)}
          onImported={() => {
            setUploading(false);
            void refresh();
          }}
        />
      ) : null}

      {editing && period ? (
        <EditValueDialog
          clientId={clientId}
          period={period}
          target={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void refresh();
          }}
        />
      ) : null}

      {exporting ? (
        <ExportDialog
          clientId={clientId}
          onClose={() => setExporting(false)}
        />
      ) : null}
    </div>
  );
}

/**
 * PDF export.
 *
 * Asks for a time range, defaulting to the current financial year to date per the
 * client's own fiscal-year start. Output is the browser's own print-to-PDF, which is
 * vector — the v9 session established that the html2canvas raster pipeline produced
 * unacceptably soft text.
 */
function ExportDialog({
  clientId,
  onClose,
}: {
  clientId: string;
  onClose: () => void;
}) {
  const [range, setRange] = useState<{ label: string; start: string; end: string } | null>(
    null,
  );
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  useEffect(() => {
    void api.report.defaultExportRange.query({ clientId }).then((value) => {
      setRange(value);
      if (value) {
        setStart(value.start);
        setEnd(value.end);
      }
    });
  }, [clientId]);

  const summary = useMemo(
    () => (start && end ? `${formatPeriod(start)} – ${formatPeriod(end)}` : "—"),
    [start, end],
  );

  return (
    <div
      className="no-print fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-6 backdrop-blur-[2px]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-md rounded-2xl border border-line bg-surface shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-[15px] font-semibold tracking-tight text-ink">
            Download PDF
          </h2>
          <Button variant="ghost" onClick={onClose} aria-label="Close">
            <X size={17} />
          </Button>
        </header>

        <div className="space-y-4 p-5">
          <p className="text-[12.5px] leading-relaxed text-ink-muted">
            Defaults to the current financial year to date
            {range ? ` (${range.label})` : ""}. Toolbars, editors and the graph/table
            toggles are removed from the printed output.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1.5 block text-[12px] font-medium text-ink">From</span>
              <input
                type="month"
                value={start}
                onChange={(event) => setStart(event.target.value)}
                className="h-9 w-full rounded-lg border border-line px-2.5 text-[13px] outline-none focus:border-accent"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[12px] font-medium text-ink">To</span>
              <input
                type="month"
                value={end}
                onChange={(event) => setEnd(event.target.value)}
                className="h-9 w-full rounded-lg border border-line px-2.5 text-[13px] outline-none focus:border-accent"
              />
            </label>
          </div>

          <p className="rounded-lg bg-canvas px-3 py-2 text-[12px] text-ink-muted">
            Range: <span className="font-medium text-ink">{summary}</span>
          </p>
        </div>

        <footer className="flex justify-end gap-2 border-t border-line px-5 py-3.5">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              onClose();
              // Let the dialog unmount before the print stylesheet applies.
              setTimeout(() => window.print(), 80);
            }}
          >
            <Download size={14} />
            Print to PDF
          </Button>
        </footer>
      </div>
    </div>
  );
}
