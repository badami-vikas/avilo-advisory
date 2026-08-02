import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { Download, Upload, X } from "lucide-react";
import { formatPeriod } from "@avilo/module";

import { api } from "../../lib/trpc.js";
import { parseFigure } from "../../lib/format.js";
import { exportReportPdf } from "../../lib/desktop.js";
import { Block, Button, EmptyState, Spinner } from "../components/ui.js";
import { ClientHeader } from "../components/ClientHeader.js";
import {
  defaultLayout,
  normalizeLayout,
  type ReportLayout,
} from "../report/layout.js";
import { ReportView } from "../components/ReportView.js";
import { RawDataView } from "../components/RawDataView.js";
import { StickyNotes } from "../components/StickyNotes.js";
import { Dashboard } from "../dashboard/Dashboard.js";
import { UploadDialog } from "../components/UploadDialog.js";
import type {
  ClientRecord,
  DetailByKind,
  FormulaRow,
  PeriodReport,
  SeriesPoint,
} from "../types.js";

// Every id any chart draws. Fetched in one series call rather than per chart, because
// each id costs nothing extra but each call rebuilds the whole period report.
//
// The dashboard added the balance-sheet and ageing totals: a working-capital line, a
// profit-to-cash bridge and a thirteen-week projection all need a *history* of cash and
// of what is owed both ways, not just this month's figure.
const CHART_IDS = [
  "pl.revenue",
  "pl.cogs",
  "pl.overhead",
  "gross_profit",
  "gross_margin_pct",
  "net_operating_income",
  "noi_margin_pct",
  "bs.cash",
  "ar.total",
  "ap.total",
  "days_cash_on_hand",
  "dso",
  "dpo",
];

/**
 * How the same month is presented.
 *
 * Standard is the working surface — cards, editable figures, the Raw data tables behind
 * them. Report is the document that will be exported, shown on an actual A4 sheet.
 * Dashboard is the analysis: the same numbers, asked what they mean.
 */
type ViewMode = "standard" | "report" | "raw" | "dashboard";

const VIEWS: { id: ViewMode; label: string; hint: string }[] = [
  { id: "standard", label: "Standard view", hint: "Working surface — every figure editable" },
  { id: "report", label: "Report view", hint: "The document, exactly as it will export" },
  { id: "raw", label: "Raw data", hint: "Every account and formula, in tables" },
  { id: "dashboard", label: "Interactive dashboard", hint: "What the numbers mean, and what to do" },
];

export function ClientDetailPage() {
  const { clientId = "" } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [client, setClient] = useState<ClientRecord | null>(null);
  const [periods, setPeriods] = useState<string[] | null>(null);
  const [period, setPeriod] = useState<string | null>(null);
  const [report, setReport] = useState<PeriodReport | null>(null);
  const [series, setSeries] = useState<SeriesPoint[]>([]);
  const [detail, setDetail] = useState<DetailByKind>({});
  /** The month before the one on screen — what the movement bridges compare against. */
  const [priorDetail, setPriorDetail] = useState<DetailByKind>({});
  const [printRange, setPrintRange] = useState<{ start: string; end: string } | null>(
    null,
  );
  const [formulas, setFormulas] = useState<FormulaRow[]>([]);
  const [note, setNote] = useState("");
  /**
   * The view lives in the URL.
   *
   * Every surface in this application is a routable URL, and this is a surface: an
   * advisor sending a colleague "look at the dashboard for October" should be able to
   * send a link rather than three instructions. It also gives the PDF probe and any
   * future automation a way to ask for the document without driving a dropdown.
   */
  const view = ((): ViewMode => {
    const requested = searchParams.get("view");
    return VIEWS.some((entry) => entry.id === requested)
      ? (requested as ViewMode)
      : "standard";
  })();

  const setView = useCallback(
    (next: ViewMode) => {
      const params = new URLSearchParams(searchParams);
      // "standard" is the default, so it stays out of the URL rather than decorating it.
      if (next === "standard") params.delete("view");
      else params.set("view", next);
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );
  const [uploading, setUploading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [layout, setLayout] = useState<ReportLayout>(defaultLayout);
  /** The saved_views row backing this client's layout, once one exists. */
  const [layoutRowId, setLayoutRowId] = useState<string | null>(null);

  /* ------------------------------------------------------------ loading */

  const loadShell = useCallback(async () => {
    try {
      const [record, available, formulaRows] = await Promise.all([
        api.clients.get.query({ id: clientId }),
        api.report.periods.query({ clientId }),
        api.formulas.list.query(),
      ]);
      setClient(record);
      setPeriods(available);
      setFormulas(formulaRows);
      setPeriod((current) => current ?? available[0] ?? null);
      setLoadError(null);
    } catch (cause) {
      // A deleted or mistyped client id must say so. Leaving the spinner up forever
      // is the one outcome that tells the user nothing.
      setLoadError((cause as Error).message);
      setPeriods([]);
    }
  }, [clientId]);

  const loadReport = useCallback(async () => {
    if (!period) {
      setReport(null);
      setSeries([]);
      setDetail({});
      setPriorDetail({});
      setNote("");
      return;
    }
    const [periodReport, allPeriods, detailRows, noteRow] = await Promise.all([
      api.report.period.query({ clientId, period }),
      api.report.periods.query({ clientId }),
      api.report.detail.query({ clientId, period }),
      api.report.note.query({ clientId, period }),
    ]);
    setReport(periodReport);
    setDetail(detailRows);
    setNote(noteRow.body);

    /*
      Last month's detail, for the movement bridges on the dashboard: which service line
      moved revenue, which customer went quiet. `availablePeriods` is newest-first, so the
      previous month is the entry after this one — and it may not exist, in which case the
      bridges say so rather than comparing against nothing.
    */
    const prior = allPeriods[allPeriods.indexOf(period) + 1];
    setPriorDetail(
      prior ? await api.report.detail.query({ clientId, period: prior }) : {},
    );

    // The chart covers the export range when one is chosen, otherwise everything.
    const sorted = [...allPeriods].sort();
    if (sorted.length > 0) {
      const start = printRange?.start ?? sorted[0]!;
      const end = printRange?.end ?? sorted[sorted.length - 1]!;
      setSeries(
        await api.report.series.query({ clientId, start, end, ids: CHART_IDS }),
      );
    }
  }, [clientId, period, printRange]);

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

  /**
   * Export only once the chosen range has actually been applied to the charts.
   *
   * Exporting immediately would capture whatever range happened to be on screen. The
   * timer restarts whenever `series` changes, so it fires after the data settles rather
   * than after a fixed guess.
   */
  useEffect(() => {
    if (!printRange) return;
    /*
      Export the document, from wherever the user was.

      The Report view carries the `.paper` root the document stylesheet keys off, so the
      PDF is literally the sheet on screen rather than a second rendering of it. Switching
      first also means the advisor sees what they are about to send.
    */
    setView("report");
    const timer = setTimeout(() => {
      // In the desktop shell this is a native save dialog; in a browser it falls back to
      // the print sheet. Either way the same print stylesheets decide the pagination.
      void exportReportPdf();
      setPrintRange(null);
    }, 400);
    return () => clearTimeout(timer);
  }, [printRange, series]);

  const refresh = useCallback(async () => {
    await Promise.all([loadShell(), loadReport()]);
  }, [loadReport, loadShell]);

  /* ------------------------------------------------------------- editing */

  /** A value override: this client, this period, permanent, formula untouched. */
  /**
   * Override a value in an explicitly named period.
   *
   * The chart's underlying table edits months other than the one selected, so the period
   * cannot be taken from component state — doing so would silently write October's
   * correction onto whichever month happened to be on screen.
   */
  const setOverrideIn = useCallback(
    async (
      targetPeriod: string,
      targetKind: "account" | "metric",
      targetId: string,
      raw: string,
    ) => {
      await api.overrides.set.mutate({
        clientId,
        period: targetPeriod,
        targetKind,
        targetId,
        value: parseFigure(raw),
        previousValue: null,
      });
      await refresh();
    },
    [clientId, refresh],
  );

  const setOverride = useCallback(
    async (targetKind: "account" | "metric", targetId: string, raw: string) => {
      if (!period) return;
      const current =
        targetKind === "account"
          ? (report?.accounts.find((a) => a.accountId === targetId)?.value ?? null)
          : (report?.metrics.find((m) => m.id === targetId)?.value ?? null);

      await api.overrides.set.mutate({
        clientId,
        period,
        targetKind,
        targetId,
        value: parseFigure(raw),
        previousValue: current,
      });
      await refresh();
    },
    [clientId, period, refresh, report],
  );

  /**
   * The report layout, stored per client in the same saved_views table the tables use.
   *
   * Per client rather than global: two clients rarely want the same report. A client with
   * no stored layout gets the default, and `normalizeLayout` reconciles whatever is
   * stored against the sections this build actually has — so a layout written by an older
   * version neither loses a section nor hides a new one.
   */
  const LAYOUT_TABLE_ID = "report.layout";

  const loadLayout = useCallback(async () => {
    try {
      const rows = await api.views.list.query({ tableId: LAYOUT_TABLE_ID });
      const mine = rows.find((row) => row.name === clientId);
      setLayoutRowId(mine?.id ?? null);
      setLayout(normalizeLayout(mine ? JSON.parse(mine.config) : null));
    } catch {
      // A malformed or unreachable layout must never block the report. The default is
      // always correct enough to render, and the format panel can save over it.
      setLayout(defaultLayout());
    }
  }, [clientId]);

  const saveLayout = useCallback(
    async (next: ReportLayout) => {
      // Optimistic: this is a direct manipulation of a list the user is looking at, and
      // waiting for a round-trip to reorder a row would feel broken.
      setLayout(next);
      const saved = await api.views.save.mutate({
        ...(layoutRowId ? { id: layoutRowId } : {}),
        tableId: LAYOUT_TABLE_ID,
        name: clientId,
        config: JSON.stringify(next),
      });
      setLayoutRowId(saved.id);
    },
    [clientId, layoutRowId],
  );

  useEffect(() => {
    void loadLayout();
  }, [loadLayout]);

  /** The client's own record — name, stage, industry, fiscal year, notes. */
  const patchClient = useCallback(
    async (field: string, value: string | number | null) => {
      await api.clients.update.mutate({ id: clientId, patch: { [field]: value } });
      await loadShell();
    },
    [clientId, loadShell],
  );

  /** A formula edit: global, versioned, retroactive, refused if invalid. */
  const setFormula = useCallback(
    async (formulaId: string, expression: string) => {
      await api.formulas.update.mutate({ id: formulaId, expression: expression.trim() });
      await refresh();
    },
    [refresh],
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

  if (loadError) {
    return (
      <Block>
        <EmptyState
          title="This client could not be loaded"
          body={`${loadError} It may have been deleted, or the link may be out of date.`}
          action={
            <Button variant="primary" onClick={() => navigate("/")}>
              Back to clients
            </Button>
          }
        />
      </Block>
    );
  }

  if (!client || periods === null) return <Spinner label="Loading client…" />;

  /**
   * The report, as cards or as the document.
   *
   * One call site's worth of props, two call sites. Writing it twice is how the Standard
   * view and the Report view drift apart, which is the one thing the Report view exists
   * to prevent.
   */
  const renderReport = (paper: boolean) =>
    report ? (
      <ReportView
        clientName={client.name}
        legalName={client.legalName}
        report={report}
        series={series}
        detail={detail}
        formulas={formulas}
        note={note}
        onSetNote={async (body) => {
          // Optimistic: the note is free text the user just typed, and re-fetching the
          // whole report to echo it back would blank the field mid-edit.
          setNote(body);
          if (period) await api.report.setNote.mutate({ clientId, period, body });
        }}
        rangeLabel={
          printRange
            ? `${formatPeriod(printRange.start)} – ${formatPeriod(printRange.end)}`
            : null
        }
        onSetMetricValue={(id, raw) => setOverride("metric", id, raw)}
        onSetAccountValue={(id, raw) => setOverride("account", id, raw)}
        onSetFormula={setFormula}
        onSetSeriesValue={setOverrideIn}
        layout={layout}
        onLayoutChange={(next) => void saveLayout(next)}
        paper={paper}
      />
    ) : null;

  return (
    <div className="space-y-4">
      {/* ------------------------------------------------------ page header */}
      {/* Line one: who this is. */}
      <div className="no-print flex flex-wrap items-center gap-3">
        <ClientHeader
          client={client}
          subtitle={
            periods.length === 0
              ? "No source files imported yet"
              : `${periods.length} period${periods.length === 1 ? "" : "s"} imported`
          }
          onPatch={patchClient}
        />
      </div>

      {/* Line two: the advisor's own working memory about them. */}
      <StickyNotes
        clientId={clientId}
        legacyNote={client.notes}
        onClearLegacy={() => patchClient("notes", null)}
      />

      {/*
        Line three: what to do with the month, and how to look at it.

        Left-indented and grouped: the four things that act on the data sit together, and
        the choice of presentation sits apart from them on the right, because changing how
        you are looking at something is a different kind of act from changing it.
      */}
      <div className="no-print flex flex-wrap items-center gap-2 pl-1">
        {periods.length > 0 ? (
          <select
            value={period ?? ""}
            onChange={(event) => setPeriod(event.target.value)}
            aria-label="Period"
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
        <Button variant="primary" onClick={() => setExporting(true)} disabled={!report}>
          <Download size={14} />
          Download PDF
        </Button>

        <div className="ml-auto flex items-center gap-2">
          <label htmlFor="view-mode" className="text-[12px] text-ink-faint">
            View
          </label>
          <select
            id="view-mode"
            value={view}
            onChange={(event) => setView(event.target.value as ViewMode)}
            title={VIEWS.find((entry) => entry.id === view)?.hint}
            className="h-9 rounded-lg border border-line bg-surface px-2.5 text-[13px] font-medium text-ink outline-none focus:border-accent"
          >
            {VIEWS.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </div>
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
      ) : view === "dashboard" ? (
        <Dashboard
          clientId={clientId}
          clientName={client.name}
          report={report}
          series={series}
          detail={detail}
          priorDetail={priorDetail}
          formulas={formulas}
        />
      ) : view === "report" ? (
        // The same component as the Standard view's report, on an A4 sheet. Not a second
        // rendering — one component, one stylesheet, wearing the `.paper` root.
        <div className="paper-frame">
          {renderReport(true)}
        </div>
      ) : view === "raw" ? (
        <RawDataView
          report={report}
          formulas={formulas}
          onSetAccountValue={(id, raw) => setOverride("account", id, raw)}
          onSetMetricValue={(id, raw) => setOverride("metric", id, raw)}
          onSetFormula={setFormula}
          onClearOverride={clearOverride}
        />
      ) : (
        renderReport(false)
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

      {exporting ? (
        <ExportDialog
          clientId={clientId}
          onClose={() => setExporting(false)}
          onPrint={(range) => {
            // Apply the range to the charts first, then print, then restore — so the
            // exported PDF shows exactly the period the user asked for.
            setExporting(false);
            setPrintRange(range);
          }}
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
  onPrint,
}: {
  clientId: string;
  onClose: () => void;
  onPrint: (range: { start: string; end: string }) => void;
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
            disabled={!start || !end || start > end}
            onClick={() => onPrint({ start, end })}
          >
            <Download size={14} />
            Print to PDF
          </Button>
        </footer>
      </div>
    </div>
  );
}
