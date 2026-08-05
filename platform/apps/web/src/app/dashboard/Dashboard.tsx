/**
 * The interactive dashboard.
 *
 * Same numbers as the report, asked a different question. The report answers "what should
 * I send the client this month"; this answers "what is going on, and what should we do".
 * It is built in layers — strip, summary, analysis, tools, actions — so it can be read in
 * thirty seconds or in twenty minutes without a different page for each.
 *
 * Nothing here is a second source of truth. Every figure comes from the same period
 * report, series and detail rows the report view renders, and every judgement about them
 * is made in `insights.ts` rather than in a component.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, Info, Pencil, Sparkles } from "lucide-react";

import { summaryFingerprint } from "@avilo/module";

import { api } from "../../lib/trpc.js";
import { moneyFull, percent } from "../../lib/format.js";
import { Tip } from "../components/Tooltip.js";
import type {
  DetailByKind,
  FormulaRow,
  PeriodReport,
  SeriesPoint,
} from "../types.js";
import {
  actions as buildActions,
  agingDistribution,
  concentration,
  dimensionDirection,
  dimensionStory,
  forecast,
  healthScore,
  money,
  movement,
  narrative,
  periodEnd,
  trailingMean,
  trendPct,
  valueAt,
  warnings as buildWarnings,
  type Beat,
  type HealthDimension,
} from "./insights.js";
import { Radar, Sparkline, type RadarAxis } from "./charts.js";
import { Drill, DrillRow, SeverityChip } from "./parts.js";
import {
  AgingSection,
  CashSection,
  CustomersSection,
  ForecastSection,
  GrowthSection,
  ProfitabilitySection,
  ReferralsSection,
  WarningsSection,
} from "./sections.js";
import { CollectionsPlanner, GoalSeek, GrowthQualitySection } from "./tools.js";
import { ActionsTable } from "./ActionsTable.js";

const NAV = [
  { id: "summary", label: "Executive summary" },
  { id: "growth", label: "Growth" },
  { id: "quality", label: "Growth quality" },
  { id: "profitability", label: "Profitability" },
  { id: "cash", label: "Profit into cash" },
  { id: "customers", label: "Customers" },
  { id: "receivables", label: "Money owed to you" },
  { id: "payables", label: "Money you owe" },
  { id: "referrals", label: "Referrals" },
  { id: "forecast", label: "Thirteen weeks ahead" },
  { id: "goal", label: "What would it take?" },
  { id: "warnings", label: "Early warnings" },
  { id: "actions", label: "Actions" },
];

/** Score bands, used for the radar's label colours and the header dial alike. */
function scoreColor(score: number | null): string {
  if (score === null) return "#98a2b3";
  if (score >= 66) return "#067647";
  if (score >= 40) return "#b54708";
  return "#d92d20";
}

export function Dashboard({
  clientId,
  clientName,
  report,
  series,
  detail,
  priorDetail,
  formulas,
}: {
  clientId: string;
  clientName: string;
  report: PeriodReport;
  series: SeriesPoint[];
  detail: DetailByKind;
  /** Last month's entity detail, for the movement and growth comparisons. */
  priorDetail: DetailByKind;
  formulas: FormulaRow[];
}) {
  const [drill, setDrill] = useState<string | null>(null);
  const [customer, setCustomer] = useState<string | null>(null);
  /** Which radar axis the pointer is over — swaps the panel beside it. */
  const [axis, setAxis] = useState<number | null>(null);

  const health = useMemo(() => healthScore(report, series, detail), [report, series, detail]);

  /*
    The forecast is computed twice: once here on untouched assumptions, for the narrative,
    the warnings and the header strip, and again inside the forecast section where the
    sliders live. The story must describe the business as it is, not as the reader last
    dragged it.
  */
  const baseForecast = useMemo(
    () =>
      forecast(report, series, {
        revenueChangePct: 0,
        costChangePct: 0,
        collectionDays: Math.round(
          report.metrics.find((m) => m.id === "dso" && m.status === "ok")?.value ?? 30,
        ),
      }),
    [report, series],
  );

  const warnings = useMemo(
    () => buildWarnings(report, series, detail, formulas, baseForecast),
    [report, series, detail, formulas, baseForecast],
  );
  const actions = useMemo(
    () => buildActions(report, series, detail, warnings),
    [report, series, detail, warnings],
  );
  const beats = useMemo(
    () => narrative(report, series, detail, health, baseForecast, warnings, actions),
    [report, series, detail, health, baseForecast, warnings, actions],
  );

  /*
    The contents list, sized to what is actually on screen.

    `max-height: 100vh` is the right cap once the list has pinned itself to the top, and
    the wrong one before that: the list starts several hundred pixels down the page,
    under the client header and the toolbar, so a cap measured from the top of the window
    leaves it hanging off the bottom of the screen with no way to reach the last items.
    Its own contents fit inside the cap, so nothing scrolled — the list was clipped by the
    viewport rather than by itself.

    Measuring gives the honest number: whatever vertical space the list actually has from
    where it currently sits. It scrolls exactly when it runs out of that.
  */
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = navRef.current;
    if (!element) return;
    /*
      Measured straight out of the scroll handler rather than deferred to an animation
      frame. It is one read and one write on one element, which is cheap; and a frame
      callback does not run at all in a backgrounded window, which would leave the list
      sized for wherever the page happened to be when it was last visible.
    */
    const measure = () => {
      const top = element.getBoundingClientRect().top;
      element.style.maxHeight = `${Math.max(160, window.innerHeight - top - 12)}px`;
    };
    measure();
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, []);

  const go = (section: string) => {
    document.getElementById(section)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  /*
    One date for the whole page.

    Every panel's window ends here — the month's profit & loss, the balances taken on its
    last day, the year of customer billing behind it, the thirteen weeks after it. The
    month picker in the toolbar moves this date, and each panel says how far back it
    looks from it, which is what makes a single control legible across sections that
    cannot all cover the same span.
  */
  const asAt = periodEnd(report.period);

  const hovered: HealthDimension | null =
    axis === null ? null : (health.dimensions[axis] ?? null);
  const story = hovered ? dimensionStory(hovered, report, series, detail) : null;

  return (
    <div className="no-print flex gap-6">
      {/* ------------------------------------------------------------- nav */}
      {/*
        The contents list scrolls in its own right rather than scrolling the document
        behind it.

        `self-start` is the load-bearing part. This is a flex row, and a flex item stretches
        to the height of the row by default — which here is the height of the whole
        dashboard, capped by the max-height. Stretched, the element is always taller than
        its own contents, so it never has anything to scroll and the rule below did
        nothing. Sized to its content, it scrolls exactly when the list is longer than the
        window.
      */}
      <nav
        ref={navRef}
        className="avilo-scroll sticky top-4 hidden w-[180px] shrink-0 self-start overflow-y-auto pb-2 pr-1 lg:block"
      >
        <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
          On this page
        </p>
        <ul className="space-y-0.5">
          {NAV.map((item) => (
            <li key={item.id}>
              <button
                onClick={() => go(item.id)}
                className="w-full rounded-lg px-2 py-1.5 text-left text-[12.5px] text-ink-muted transition-colors hover:bg-line-soft hover:text-ink"
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
        {warnings.length > 0 ? (
          <button
            onClick={() => go("warnings")}
            className="mt-3 flex w-full items-center gap-2 rounded-lg border border-flag/25 bg-flag-soft px-2.5 py-2 text-left text-[11.5px] font-medium text-flag"
          >
            <AlertTriangle size={13} className="shrink-0" />
            {warnings.length} flagged
          </button>
        ) : null}
      </nav>

      <div className="min-w-0 flex-1 space-y-4">
        {/* --- the strip: everything that matters, on one line */}
        <KpiStrip
          report={report}
          series={series}
          forecastResult={baseForecast}
          onOpen={setDrill}
        />

        {/* --- executive summary: the shape on the left, the story on the right */}
        <section
          id="summary"
          className="scroll-mt-24 rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgba(16,24,40,0.04)]"
        >
          <header className="flex items-center gap-3 border-b border-line-soft px-5 py-3.5">
            <div className="min-w-0 flex-1">
              <h2 className="text-[13.5px] font-semibold tracking-tight text-ink">
                Executive summary
              </h2>
              <p className="mt-0.5 text-[11.5px] text-ink-muted">
                {clientName} · {report.periodLabel}
              </p>
            </div>
            {warnings[0] ? <SeverityChip severity={warnings[0].severity} /> : null}
            {/*
              The overall score, with its dial immediately to its left rather than parked
              under the radar — where it competed with the five axes it summarises.
            */}
            {health.overall !== null ? (
              <Tip
                content={`The mean of the ${health.scored} dimension${health.scored === 1 ? "" : "s"} that could be scored. A score built on fewer than five is worth proportionately less.`}
              >
                <span className="flex shrink-0 items-center gap-2">
                  <ScoreDial value={health.overall} />
                  <span className="num text-[15px] font-semibold text-ink">
                    {Math.round(health.overall)}
                    <span className="text-[11px] font-normal text-ink-faint">/100</span>
                  </span>
                </span>
              </Tip>
            ) : null}
          </header>

          <div className="grid grid-cols-1 gap-5 px-5 py-4 lg:grid-cols-2">
            <div>
              <Radar
                axes={health.dimensions.map(toAxis)}
                onHover={setAxis}
                active={axis}
              />
              <p className="text-center text-[11px] text-ink-faint">
                Hover a label for what happened on that dimension.
              </p>
            </div>

            <div className="min-w-0">
              {story && hovered ? (
                <DimensionPanel dimension={hovered} story={story} />
              ) : (
                <Brief
                  beats={beats}
                  onGo={go}
                  clientName={clientName}
                  periodLabel={report.periodLabel}
                  clientId={clientId}
                  period={report.period}
                />
              )}
            </div>
          </div>
        </section>

        {/* --- analysis */}
        <GrowthSection clientId={clientId} series={series} asAt={asAt} />
        <GrowthQualitySection detail={detail} priorDetail={priorDetail} asAt={asAt} />
        <ProfitabilitySection report={report} series={series} detail={detail} />
        <CashSection report={report} series={series} />
        <CustomersSection detail={detail} onOpenCustomer={setCustomer} asAt={asAt} />
        {/*
          The two sides of working capital, side by side. They are read against each other
          — what is owed to you against what you owe — and a page that puts one below the
          other makes the comparison a scroll rather than a glance.
        */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <AgingSection
            id="receivables"
            title="Money owed to you"
            subtitle="Receivables by age, and who to chase first"
            report={report}
            prefix="ar"
            rows={detail["ar_customer"] ?? []}
            entityNoun="Customer"
            reportName="A/R Ageing Summary"
            compact
          />
          <AgingSection
            id="payables"
            title="Money you owe"
            subtitle="Payables by age, and what is holding up supplier goodwill"
            report={report}
            prefix="ap"
            rows={detail["ap_vendor"] ?? []}
            entityNoun="Vendor"
            reportName="A/P Ageing Summary"
            compact
          />
        </div>
        <ReferralsSection detail={detail} asAt={asAt} />

        {/* --- tools: the sections that answer a question rather than report one */}
        <ForecastSection
          report={report}
          series={series}
          detail={detail}
          planner={(onCollected) => (
            <CollectionsPlanner
              report={report}
              detail={detail}
              embedded
              onCollected={onCollected}
            />
          )}
        />
        <GoalSeek report={report} series={series} asAt={asAt} />

        {/* --- what to do */}
        <WarningsSection warnings={warnings} onGo={go} asAt={asAt} />
        <ActionsTable
          actions={actions}
          clientId={clientId}
          period={report.period}
          onGo={go}
          asAt={asAt}
        />
      </div>

      {drill ? (
        <FigureDrill
          id={drill}
          report={report}
          series={series}
          forecastResult={baseForecast}
          onClose={() => setDrill(null)}
        />
      ) : null}

      {customer ? (
        <CustomerDrill
          label={customer}
          detail={detail}
          onClose={() => setCustomer(null)}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ brief */

/**
 * The month in five parts, written as prose rather than assembled as cards.
 *
 * The beats are the same five the engine produces — what happened, why, where the risk
 * is, what happens next, what to do — but a reader does not want five headed fragments
 * where a paragraph would do. They run together into two paragraphs: the month, then its
 * consequences. The only interruption is the link out to the section that carries the
 * working, and that sits at the end of the sentence it belongs to rather than in a row of
 * buttons underneath.
 */
function Brief({
  beats,
  onGo,
  clientName,
  periodLabel,
  clientId,
  period,
}: {
  beats: Beat[];
  onGo: (section: string) => void;
  clientName: string;
  periodLabel: string;
  clientId: string;
  period: string;
}) {
  /*
    The advisor's own wording, when they have written one and it still applies.

    `fingerprint` identifies the computed summary this edit was made against. It is sent
    with every read, so the server can decline an edit written against figures that have
    since moved: new data supersedes a custom edit, without exception. The alternative is
    a page showing confident hand-written prose above numbers it no longer describes.
  */
  const fingerprint = useMemo(
    () =>
      summaryFingerprint(
        beats.map((beat) => ({
          kicker: beat.kicker,
          headline: beat.headline,
          body: beat.body,
        })),
      ),
    [beats],
  );

  const [edit, setEdit] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [superseded, setSuperseded] = useState(false);

  useEffect(() => {
    let live = true;
    void api.report.summaryEdit
      .query({ clientId, period, fingerprint })
      .then((result) => {
        if (!live) return;
        setEdit(result.body);
        setSuperseded(result.superseded);
      });
    return () => {
      live = false;
    };
  }, [clientId, period, fingerprint]);

  const saveEdit = async (body: string) => {
    setEditing(false);
    const trimmed = body.trim();
    setEdit(trimmed === "" ? null : trimmed);
    setSuperseded(false);
    await api.report.setSummaryEdit.mutate({ clientId, period, body: trimmed, fingerprint });
  };
  /*
    The generated draft, when one has been asked for.

    Held here and never persisted: the computed summary remains what the section *is*, and
    the draft is a client-ready rewrite of it that the advisor copies out. Regenerating or
    dismissing returns to the calculated text, so there is no state in which the page shows
    prose whose provenance is unclear.
  */
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.report.generateSummary.mutate({
        clientName,
        periodLabel,
        beats: beats.map((beat) => ({
          kicker: beat.kicker,
          headline: beat.headline,
          body: beat.body,
        })),
      });
      if (result.ok) setDraft(result.text);
      else setError(result.message);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const paragraphs: Beat[][] = [
    beats.filter((beat) => beat.id === "what" || beat.id === "why"),
    beats.filter((beat) => beat.id === "risk" || beat.id === "next" || beat.id === "act"),
  ].filter((group) => group.length > 0);

  /* --- the advisor's own wording, being written */
  if (editing) {
    return (
      <SummaryEditor
        initial={edit ?? beats.map((beat) => beat.body.join(" ")).join("\n\n")}
        onCancel={() => setEditing(false)}
        onSave={(body) => void saveEdit(body)}
      />
    );
  }

  /* --- the advisor's own wording, saved and still valid */
  if (edit !== null && draft === null) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="rounded-md border border-line bg-line-soft px-1.5 py-[2px] text-[10.5px] font-medium text-ink-muted">
            Your wording
          </span>
          <button
            onClick={() => setEditing(true)}
            className="text-[11.5px] font-medium text-ink-muted hover:text-accent"
          >
            Edit
          </button>
          <button
            onClick={() => void saveEdit("")}
            className="text-[11.5px] font-medium text-ink-muted hover:text-accent"
          >
            Use calculated
          </button>
        </div>
        <div onDoubleClick={() => setEditing(true)} className="cursor-text">
          {edit.split(/\n{2,}/).map((paragraph, index) => (
            <p key={index} className="mb-3 text-[12.5px] leading-[1.65] text-ink last:mb-0">
              {paragraph}
            </p>
          ))}
        </div>
      </div>
    );
  }

  if (draft !== null) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-md border border-accent/30 bg-accent-soft/50 px-1.5 py-[2px] text-[10.5px] font-medium text-accent">
            <Sparkles size={10} />
            Drafted from the findings below
          </span>
          <button
            onClick={() => void generate()}
            disabled={busy}
            className="text-[11.5px] font-medium text-ink-muted hover:text-accent"
          >
            {busy ? "Writing…" : "Again"}
          </button>
          <button
            onClick={() => setDraft(null)}
            className="text-[11.5px] font-medium text-ink-muted hover:text-accent"
          >
            Dismiss
          </button>
        </div>
        {draft.split(/\n{2,}/).map((paragraph, index) => (
          <p key={index} className="text-[12.5px] leading-[1.65] text-ink">
            {paragraph}
          </p>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {superseded ? (
        <p className="rounded-md border border-warn/25 bg-[#fffaeb] px-2.5 py-1.5 text-[11px] leading-relaxed text-warn">
          Your earlier wording was written against different figures, so it has been set
          aside. This is the calculated summary for the numbers now imported.
        </p>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        {error ? (
          <span className="mr-auto text-[11px] leading-snug text-flag">{error}</span>
        ) : null}
        <Tip content="Write this summary in your own words. Double-click the text to start.">
          <button
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-[3px] text-[11px] font-medium text-ink-muted transition-colors hover:border-accent hover:text-accent"
          >
            <Pencil size={11} />
            Edit
          </button>
        </Tip>
        <Tip content="Rewrite these findings as a client-ready note. Uses only the figures already calculated — a draft containing anything else is discarded.">
          <button
            onClick={() => void generate()}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-[3px] text-[11px] font-medium text-ink-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
          >
            <Sparkles size={11} />
            {busy ? "Writing…" : "Generate"}
          </button>
        </Tip>
      </div>
      {paragraphs.map((group, index) => (
        <p
          key={index}
          onDoubleClick={() => setEditing(true)}
          className="cursor-text text-[12.5px] leading-[1.65] text-ink-muted"
        >
          {group.map((beat) => (
            <span key={beat.id}>
              {beat.body.join(" ")}{" "}
              {beat.links[0] ? (
                <button
                  onClick={() => onGo(beat.links[0]!.section)}
                  className="mr-1 inline-flex items-center gap-0.5 align-baseline text-[11.5px] font-medium text-accent hover:underline"
                >
                  {beat.links[0].phrase}
                  <ArrowRight size={10} />
                </button>
              ) : null}
            </span>
          ))}
        </p>
      ))}
    </div>
  );
}

/**
 * The summary, in the advisor's own words.
 *
 * Seeded with whatever is currently on screen — calculated text or a generated draft — so
 * rewriting starts from something rather than a blank box. Saving an empty body clears the
 * edit and returns the section to the calculated summary, which is the honest way to undo.
 */
function SummaryEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave: (body: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <div className="space-y-2">
      <textarea
        ref={ref}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
          // Enter inserts a paragraph break; the summary is prose, so saving is explicit.
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) onSave(text);
        }}
        rows={9}
        className="w-full resize-y rounded-lg border border-accent bg-surface px-3 py-2 text-[12.5px] leading-[1.65] text-ink outline-none"
      />
      <div className="flex items-center gap-2">
        <button
          onClick={() => onSave(text)}
          className="rounded-md bg-accent px-2.5 py-1 text-[11.5px] font-medium text-white hover:opacity-90"
        >
          Save
        </button>
        <button
          onClick={onCancel}
          className="rounded-md border border-line px-2.5 py-1 text-[11.5px] font-medium text-ink-muted hover:bg-line-soft"
        >
          Cancel
        </button>
        <span className="text-[11px] text-ink-faint">
          Clear the box and save to go back to the calculated summary. New figures always
          replace your wording.
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ radar */

/**
 * One health dimension as a radar axis: name, then its reading and quarterly movement.
 *
 * The 0–100 score is deliberately absent from the caption. It is a derived index, and
 * printing it beside the measurement it was derived from invites the reader to compare
 * two numbers that say the same thing. The score belongs with the explanation of how it
 * was arrived at, which is the panel that opens when the reading is hovered.
 */
function toAxis(dimension: HealthDimension): RadarAxis {
  const direction = dimensionDirection(dimension);
  const arrow = direction === "better" ? "▲" : direction === "worse" ? "▼" : "";
  const reading =
    dimension.value === null
      ? "—"
      : dimension.unit === "percent"
        ? `${dimension.value.toFixed(1)}%`
        : `${Math.round(dimension.value)}d`;

  const change =
    dimension.quarterChange === null
      ? ""
      : ` ${arrow}${Math.abs(dimension.quarterChange).toFixed(1)}`;

  return {
    label: dimension.label,
    score: dimension.score,
    caption: dimension.score === null ? "not scored" : `${reading}${change}`,
    color: scoreColor(dimension.score),
  };
}

/** The overall score as a ring, small enough to sit inside a section header. */
function ScoreDial({ value }: { value: number }) {
  const size = 26;
  const radius = 10;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="#eef1f4"
        strokeWidth={3}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={scoreColor(value)}
        strokeWidth={3}
        strokeLinecap="round"
        strokeDasharray={`${(value / 100) * circumference} ${circumference}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}

/**
 * One dimension, in the three questions an advisor is actually asked.
 *
 * Replaces the brief while the pointer is on that axis. Same space, different content —
 * which is what stops the page repeating the radar's own labels in prose beside it.
 */
function DimensionPanel({
  dimension,
  story,
}: {
  dimension: HealthDimension;
  story: { happened: string; weakened: string; attention: string };
}) {
  const direction = dimensionDirection(dimension);
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span
          className="h-2.5 w-2.5 rounded-full"
          style={{ background: scoreColor(dimension.score) }}
        />
        <h3 className="text-[13.5px] font-semibold tracking-tight text-ink">
          {dimension.label}
        </h3>
        <Tip content={dimension.basis}>
          <Info size={12} className="text-ink-faint" />
        </Tip>
        <span className="num ml-auto text-[13px] font-semibold text-ink">
          {dimension.score === null ? "—" : Math.round(dimension.score)}
          <span className="text-[10.5px] font-normal text-ink-faint">/100</span>
        </span>
      </div>

      <dl className="mt-3 space-y-2.5">
        {[
          ["What happened", story.happened],
          ["What weakened", story.weakened],
          ["What needs attention", story.attention],
        ].map(([label, body]) => (
          <div key={label}>
            <dt className="text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-faint">
              {label}
            </dt>
            <dd className="mt-0.5 text-[12.5px] leading-relaxed text-ink-muted">{body}</dd>
          </div>
        ))}
      </dl>

      {direction !== "unknown" ? (
        <p className="mt-3 text-[11.5px] text-ink-faint">
          Scored against a stated band — {dimension.basis.toLowerCase()}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ strip */

interface Kpi {
  id: string;
  label: string;
  value: string;
  /** Percentage change against the comparison point. */
  changePct: number | null;
  /** True when a rise is bad — collection days, overdue balances. */
  inverted?: boolean;
  spark: (number | null)[];
  verdict: string;
  hint: string;
  drill?: string;
}

/**
 * The one-line dashboard.
 *
 * Seven readings, each with its shape, its movement and a verdict — enough to know
 * whether to keep reading. The comparison is against the same month last year when there
 * are twelve months of history and against last month when there are not, and the strip
 * says which, because "up 14%" means very different things under those two.
 */
function KpiStrip({
  report,
  series,
  forecastResult,
  onOpen,
}: {
  report: PeriodReport;
  series: SeriesPoint[];
  forecastResult: ReturnType<typeof forecast>;
  onOpen: (id: string) => void;
}) {
  const account = (id: string) =>
    report.accounts.find((a) => a.accountId === id)?.value ?? null;
  const metric = (id: string) => {
    const m = report.metrics.find((x) => x.id === id);
    return m && m.status === "ok" ? m.value : null;
  };
  const spark = (id: string) => series.map((point) => point.values[id] ?? null);

  /** Twelve months back if the history reaches, otherwise last month. */
  const readings = (id: string) =>
    series.map((p) => p.values[id]).filter((v): v is number => v !== null && v !== undefined);
  const yearOnYear = readings("pl.revenue").length > 12;
  const back = yearOnYear ? 12 : 1;
  const comparison = yearOnYear ? "vs same month last year" : "vs last month";

  const changeOf = (id: string): number | null => {
    const now = series
      .map((p) => p.values[id])
      .filter((v): v is number => v !== null && v !== undefined)
      .at(-1);
    const then = valueAt(series, id, back);
    if (now === undefined || then === null || then === 0) return null;
    return ((now - then) / Math.abs(then)) * 100;
  };

  const ar = agingDistribution(report, "ar");
  const overdueAmount = ar.slices
    .filter((slice) => slice.id !== "current" && slice.id !== "1_30")
    .reduce((sum, slice) => sum + slice.value, 0);

  const marginSlope = trendPct(series, "gross_margin_pct", 6);
  const revenueSlope = trendPct(series, "pl.revenue", 6);
  const cashSlope = trendPct(series, "bs.cash", 6);
  const dsoChange = changeOf("dso");

  const kpis: Kpi[] = [
    {
      id: "revenue",
      label: "Revenue",
      value: money(account("pl.revenue")),
      changePct: changeOf("pl.revenue"),
      spark: spark("pl.revenue"),
      verdict:
        revenueSlope === null
          ? "Not enough history"
          : revenueSlope > 1
            ? "Growing well"
            : revenueSlope < -1
              ? "Softening"
              : "Holding steady",
      hint: "Billed this month, before any cost. Click for the run rate behind the forecast.",
      drill: "revenue",
    },
    {
      id: "gross-margin",
      label: "Gross margin",
      value: percent(metric("gross_margin_pct")),
      changePct: changeOf("gross_margin_pct"),
      spark: spark("gross_margin_pct"),
      verdict:
        marginSlope === null
          ? "Not enough history"
          : marginSlope < -1
            ? "Eroding"
            : marginSlope > 1
              ? "Improving"
              : "Steady",
      hint: "What is left after the direct cost of delivering the work, as a share of revenue.",
    },
    {
      id: "operating-profit",
      label: "Operating profit",
      value: money(metric("net_operating_income")),
      changePct: changeOf("net_operating_income"),
      spark: spark("net_operating_income"),
      verdict:
        (metric("noi_margin_pct") ?? 0) >= 10 ? "Comfortable" : "Thin",
      hint: "Revenue less cost of sales and overhead — the money the business actually made. Click for the arithmetic.",
      drill: "noi",
    },
    {
      id: "cash",
      label: "Cash balance",
      value: money(account("bs.cash")),
      changePct: changeOf("bs.cash"),
      spark: spark("bs.cash"),
      verdict:
        cashSlope === null
          ? "Not enough history"
          : cashSlope < -1
            ? "Cash has declined"
            : cashSlope > 1
              ? "Building"
              : "Level",
      hint: "Total across bank accounts at the period end. Click for days of runway.",
      drill: "cash",
    },
    {
      id: "dso",
      label: "Receivable days",
      value: metric("dso") === null ? "—" : `${Math.round(metric("dso")!)} days`,
      changePct: dsoChange,
      inverted: true,
      spark: spark("dso"),
      verdict:
        dsoChange === null
          ? "No comparison yet"
          : dsoChange > 5
            ? "Collections have slowed"
            : dsoChange < -5
              ? "Collecting faster"
              : "Unchanged",
      hint: "Average days from invoice to payment. Every day above thirty is a day's revenue sitting in someone else's account.",
    },
    {
      id: "overdue",
      label: "Overdue receivables",
      value: ar.total === 0 ? "—" : money(overdueAmount),
      changePct: changeOf("ar.total"),
      inverted: true,
      spark: spark("ar.total"),
      verdict:
        ar.overdueShare === null
          ? "No ageing imported"
          : ar.overdueShare > 30
            ? "High collection risk"
            : ar.overdueShare > 10
              ? "Watch the tail"
              : "Book is current",
      hint: "Balances more than thirty days past due — the part that stops arriving without being asked for.",
    },
    {
      id: "forecast-low",
      label: "Min. forecast cash",
      value: forecastResult.unavailable ? "—" : money(forecastResult.low),
      changePct: null,
      inverted: true,
      spark: forecastResult.weeks.map((week) => week.cash),
      verdict: forecastResult.unavailable
        ? "Needs a balance sheet"
        : forecastResult.breachWeek !== null
          ? `Runs out in week ${forecastResult.breachWeek}`
          : "Stays positive",
      hint: "The lowest point the projected balance reaches over the next thirteen weeks, on the current run rate.",
      drill: "cash",
    },
  ];

  return (
    <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
      {kpis.map((kpi) => {
        const rose = (kpi.changePct ?? 0) > 0;
        const good = kpi.changePct === null ? null : rose !== Boolean(kpi.inverted);
        const tone = good === null ? "#98a2b3" : good ? "#067647" : "#d92d20";

        return (
          <Tip key={kpi.id} content={`${kpi.hint} Comparison is ${comparison}.`}>
            <button
              onClick={() => kpi.drill && onOpen(kpi.drill)}
              disabled={!kpi.drill}
              className="flex min-w-[152px] flex-1 flex-col items-start rounded-xl border border-line bg-surface px-3 py-2.5 text-left transition-all hover:border-ink-faint hover:shadow-[0_2px_8px_rgba(16,24,40,0.07)] disabled:cursor-default disabled:hover:border-line disabled:hover:shadow-none"
            >
              <span className="flex w-full items-center gap-1">
                <span className="truncate text-[9.5px] font-semibold uppercase tracking-[0.07em] text-ink-faint">
                  {kpi.label}
                </span>
                <Info size={9.5} className="ml-auto shrink-0 text-ink-faint" />
              </span>

              <span className="num mt-0.5 text-[19px] font-semibold leading-tight tracking-tight text-ink">
                {kpi.value}
              </span>

              <span className="mt-0.5 flex items-center gap-1 text-[10.5px] font-medium">
                {kpi.changePct === null ? (
                  <span className="text-ink-faint">no comparison</span>
                ) : (
                  <>
                    <span style={{ color: tone }}>
                      {rose ? "▲" : "▼"} {Math.abs(kpi.changePct).toFixed(0)}%
                    </span>
                    <span className="text-ink-faint">
                      {yearOnYear ? "vs PY" : "vs PM"}
                    </span>
                  </>
                )}
              </span>

              <span className="mt-1.5 w-full">
                <Sparkline values={kpi.spark} tone={tone} width={128} height={22} />
              </span>

              <span className="mt-1 truncate text-[10.5px] text-ink-muted">
                {kpi.verdict}
              </span>
            </button>
          </Tip>
        );
      })}
    </div>
  );
}

/* ----------------------------------------------------------------- drills */

/**
 * The working behind a headline figure.
 *
 * Not a bigger version of the card — a different kind of answer. Where the card says
 * $482,000, this says which accounts were added, which were subtracted, what the trailing
 * mean is, and which source file the numbers arrived in.
 */
function FigureDrill({
  id,
  report,
  series,
  forecastResult,
  onClose,
}: {
  id: string;
  report: PeriodReport;
  series: SeriesPoint[];
  forecastResult: ReturnType<typeof forecast>;
  onClose: () => void;
}) {
  const account = (accountId: string) =>
    report.accounts.find((a) => a.accountId === accountId) ?? null;
  const metric = (metricId: string) => report.metrics.find((m) => m.id === metricId) ?? null;

  const revenue = account("pl.revenue");
  const cogs = account("pl.cogs");
  const overhead = account("pl.overhead");
  const cash = account("bs.cash");

  if (id === "revenue") {
    const mean3 = trailingMean(series, "pl.revenue", 3);
    const mean12 = trailingMean(series, "pl.revenue", 12);
    return (
      <Drill
        title="Revenue"
        subtitle={`${report.periodLabel} · ${revenue?.sourceFilename ?? "no source file recorded"}`}
        onClose={onClose}
      >
        <div>
          <DrillRow label="This period" value={moneyFull(revenue?.value ?? null)} />
          <DrillRow label="Three-month mean" value={moneyFull(mean3)} note="the forecast run rate" />
          <DrillRow label="Twelve-month mean" value={moneyFull(mean12)} />
          <DrillRow
            label="Months imported"
            value={String(series.filter((p) => p.values["pl.revenue"] !== null).length)}
          />
        </div>
        <p className="text-[12px] leading-relaxed text-ink-muted">
          {revenue?.sourceRowLabel
            ? `Read from the line “${revenue.sourceRowLabel}”${revenue.sourceColumnLabel ? ` in column “${revenue.sourceColumnLabel}”` : ""}.`
            : "This figure was entered by hand rather than imported."}
        </p>
      </Drill>
    );
  }

  if (id === "noi" || id === "margin") {
    const m = metric(id === "noi" ? "net_operating_income" : "noi_margin_pct");
    return (
      <Drill
        title={id === "noi" ? "Operating income" : "Operating margin"}
        subtitle={report.periodLabel}
        onClose={onClose}
      >
        <div>
          <DrillRow label="Revenue" value={moneyFull(revenue?.value ?? null)} />
          <DrillRow label="less Cost of sales" value={moneyFull(cogs?.value ?? null)} />
          <DrillRow label="less Overhead" value={moneyFull(overhead?.value ?? null)} />
          <DrillRow
            label="Operating income"
            value={moneyFull(metric("net_operating_income")?.value ?? null)}
          />
          {id === "margin" ? (
            <DrillRow
              label="÷ Revenue"
              value={percent(metric("noi_margin_pct")?.value ?? null)}
            />
          ) : null}
        </div>
        {m?.status !== "ok" ? (
          <p className="rounded-lg border border-flag/25 bg-flag-soft px-3 py-2 text-[12px] text-flag">
            {m?.status === "missing_inputs"
              ? `Cannot be computed: ${m.missing.join(", ")} missing for this period.`
              : (m?.error ?? "Could not be computed.")}
          </p>
        ) : (
          <p className="text-[12px] leading-relaxed text-ink-muted">
            Every input above is editable on the report view — double-click the figure. An
            edit is an override for this period; the formula is untouched.
          </p>
        )}
      </Drill>
    );
  }

  const days = metric("days_cash_on_hand");
  return (
    <Drill title="Cash" subtitle={report.periodLabel} onClose={onClose}>
      <div>
        <DrillRow label="In bank accounts" value={moneyFull(cash?.value ?? null)} />
        <DrillRow
          label="Days of runway"
          value={days?.status === "ok" ? `${Math.round(days.value ?? 0)} days` : "unavailable"}
          note="at current operating spend"
        />
        {forecastResult.unavailable ? null : (
          <>
            <DrillRow
              label="Projected in 13 weeks"
              value={moneyFull(forecastResult.weeks.at(-1)?.cash ?? null)}
            />
            <DrillRow label="Projected low point" value={moneyFull(forecastResult.low)} />
          </>
        )}
      </div>
      <p className="text-[12px] leading-relaxed text-ink-muted">
        {forecastResult.unavailable ??
          (forecastResult.breachWeek === null
            ? "The projection stays positive across the whole window on the current run rate."
            : `The projection turns negative in week ${forecastResult.breachWeek}.`)}
      </p>
    </Drill>
  );
}

/** One customer, from both sides: what they bill and what they owe. */
function CustomerDrill({
  label,
  detail,
  onClose,
}: {
  label: string;
  detail: DetailByKind;
  onClose: () => void;
}) {
  const sales = (detail["customer_sales"] ?? []).find((row) => row.label === label);
  const owed = (detail["ar_customer"] ?? []).find((row) => row.label === label);
  const conc = concentration(detail["customer_sales"] ?? []);
  const share = conc.rows.find((row) => row.label === label);

  return (
    <Drill title={label} subtitle="Last twelve months, and what is outstanding" onClose={onClose}>
      <div>
        <DrillRow label="Billed (12 months)" value={moneyFull(sales?.value ?? null)} />
        <DrillRow
          label="Share of revenue"
          value={share ? `${share.share.toFixed(1)}%` : "—"}
        />
        {sales?.count !== null && sales?.count !== undefined ? (
          <DrillRow
            label="Jobs"
            value={String(sales.count)}
            note={`averaging ${moneyFull(sales.value / sales.count)}`}
          />
        ) : null}
        <DrillRow label="Currently owed" value={moneyFull(owed?.value ?? 0)} />
      </div>
      <p className="text-[12px] leading-relaxed text-ink-muted">
        {owed
          ? `Most of the outstanding balance sits in the ${owed.bucket ?? "total"} bucket. ${
              owed.value > (sales?.value ?? 0) * 0.25
                ? "That is a large share of what they have billed all year — worth a call before it ages further."
                : "Proportionate to what they bill."
            }`
          : "Nothing outstanding — this customer is current."}
      </p>
      {share && share.share > 25 ? (
        <p className="rounded-lg border border-warn/25 bg-[#fffaeb] px-3 py-2 text-[12px] text-warn">
          {money(sales?.value ?? 0)} of annual billing sits with this one customer. Losing
          them would be a structural change rather than a bad quarter.
        </p>
      ) : null}
    </Drill>
  );
}
