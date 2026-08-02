/**
 * The interactive dashboard.
 *
 * Same numbers as the report, asked a different question. The report answers "what should
 * I send the client this month"; this answers "what is going on, and what should we do".
 * It is built in layers — headline, story, analysis, forecast, actions — so it can be read
 * in thirty seconds or in twenty minutes without a different page for each.
 *
 * Nothing here is a second source of truth. Every figure comes from the same period
 * report, series and detail rows the report view renders, and every judgement about them
 * is made in `insights.ts` rather than in a component.
 */

import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight } from "lucide-react";

import { moneyFull, percent } from "../../lib/format.js";
import type {
  DetailByKind,
  FormulaRow,
  PeriodReport,
  SeriesPoint,
} from "../types.js";
import {
  actions as buildActions,
  concentration,
  forecast,
  healthScore,
  money,
  movement,
  narrative,
  trailingMean,
  warnings as buildWarnings,
  type Beat,
} from "./insights.js";
import { Drill, DrillRow, KpiCard, SeverityChip } from "./parts.js";
import {
  ActionsSection,
  AgingSection,
  CashSection,
  CustomersSection,
  ForecastSection,
  GrowthSection,
  HealthSection,
  ProfitabilitySection,
  ReferralsSection,
  WarningsSection,
} from "./sections.js";

const NAV = [
  { id: "summary", label: "Executive summary" },
  { id: "story", label: "The month in five parts" },
  { id: "health", label: "Financial health" },
  { id: "growth", label: "Growth" },
  { id: "profitability", label: "Profitability" },
  { id: "cash", label: "Profit into cash" },
  { id: "customers", label: "Customers" },
  { id: "receivables", label: "Money owed to you" },
  { id: "payables", label: "Money you owe" },
  { id: "referrals", label: "Referrals" },
  { id: "forecast", label: "Thirteen weeks ahead" },
  { id: "warnings", label: "Early warnings" },
  { id: "actions", label: "Actions" },
];

const BEAT_TONE: Record<Beat["tone"], string> = {
  positive: "border-l-positive",
  negative: "border-l-flag",
  neutral: "border-l-accent",
};

export function Dashboard({
  clientName,
  report,
  series,
  detail,
  priorDetail,
  formulas,
}: {
  clientName: string;
  report: PeriodReport;
  series: SeriesPoint[];
  detail: DetailByKind;
  /** Last month's entity detail, for the movement bridges. */
  priorDetail: DetailByKind;
  formulas: FormulaRow[];
}) {
  /** Which figure's working is open, if any. */
  const [drill, setDrill] = useState<string | null>(null);
  const [customer, setCustomer] = useState<string | null>(null);

  const health = useMemo(() => healthScore(report, series, detail), [report, series, detail]);

  /*
    The forecast is computed twice: once here on untouched assumptions, for the narrative
    and the warnings, and again inside the forecast section where the sliders live. The
    story must describe the business as it is, not as the reader last dragged it.
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

  const go = (section: string) => {
    document.getElementById(section)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const revenue = movement(series, "pl.revenue");
  const noi = movement(series, "net_operating_income");
  const marginMove = movement(series, "noi_margin_pct");
  const cashMove = movement(series, "bs.cash");

  return (
    <div className="no-print flex gap-6">
      {/* ------------------------------------------------------------- nav */}
      <nav className="sticky top-4 hidden h-fit w-[190px] shrink-0 lg:block">
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

      {/* ------------------------------------------------------------ body */}
      <div className="min-w-0 flex-1 space-y-4">
        {/* --- layer one: the headline */}
        <section id="summary" className="scroll-mt-24">
          <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-[17px] font-semibold tracking-tight text-ink">
              {clientName}
            </h1>
            <span className="text-[13px] text-ink-muted">{report.periodLabel}</span>
            {warnings[0] ? <SeverityChip severity={warnings[0].severity} /> : null}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Revenue"
              value={moneyFull(revenue.current)}
              movement={revenue}
              hint="Billed this month, before any cost. Click for the twelve-month shape and the run rate behind the forecast."
              onOpen={() => setDrill("revenue")}
            />
            <KpiCard
              label="Operating income"
              value={moneyFull(noi.current)}
              movement={noi}
              hint="What is left after cost of sales and overhead — the money the business actually made. Click for the arithmetic."
              onOpen={() => setDrill("noi")}
            />
            <KpiCard
              label="Operating margin"
              value={percent(marginMove.current)}
              movement={marginMove}
              unit="percent"
              hint="Operating income as a share of revenue. The number that says whether growth is worth having."
              onOpen={() => setDrill("margin")}
            />
            <KpiCard
              label="Cash"
              value={moneyFull(cashMove.current)}
              movement={cashMove}
              hint="Total across bank accounts at the period end. Click for days of runway and the thirteen-week projection."
              onOpen={() => setDrill("cash")}
            />
          </div>
        </section>

        {/* --- layer two: the story */}
        <section id="story" className="scroll-mt-24">
          <div className="rounded-xl border border-line bg-surface px-5 py-4 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
            <h2 className="text-[13.5px] font-semibold tracking-tight text-ink">
              The month in five parts
            </h2>
            <p className="mt-0.5 text-[11.5px] text-ink-muted">
              Assembled from what actually moved — no two clients read the same.
            </p>

            <div className="mt-4 space-y-3">
              {beats.map((beat) => (
                <article
                  key={beat.id}
                  className={`border-l-2 pl-3.5 ${BEAT_TONE[beat.tone]}`}
                >
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
                    {beat.kicker}
                  </p>
                  <p className="mt-0.5 text-[13.5px] font-medium tracking-tight text-ink">
                    {beat.headline}
                  </p>
                  {beat.body.map((paragraph, index) => (
                    <p
                      key={index}
                      className="mt-1 text-[12.5px] leading-relaxed text-ink-muted"
                    >
                      {paragraph}
                    </p>
                  ))}
                  {beat.links.length > 0 ? (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {beat.links.map((link) => (
                        <button
                          key={link.section}
                          onClick={() => go(link.section)}
                          className="inline-flex items-center gap-1 rounded-md border border-line bg-line-soft px-1.5 py-[2px] text-[11px] font-medium text-ink-muted transition-colors hover:border-accent hover:text-accent"
                        >
                          {link.phrase}
                          <ArrowRight size={10} />
                        </button>
                      ))}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* --- layer three: the analysis */}
        <HealthSection health={health} />

        <GrowthSection
          series={series}
          detail={detail}
          priorDetail={priorDetail}
          periodLabel={report.periodLabel}
        />

        <ProfitabilitySection report={report} series={series} detail={detail} />

        <CashSection report={report} series={series} />

        <CustomersSection detail={detail} onOpenCustomer={setCustomer} />

        <AgingSection
          id="receivables"
          title="Money owed to you"
          subtitle="Receivables by age, and who to chase first"
          report={report}
          prefix="ar"
          rows={detail["ar_customer"] ?? []}
          entityNoun="Customer"
          reportName="A/R Ageing Summary"
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
        />

        <ReferralsSection detail={detail} />

        {/* --- layer four: what happens next */}
        <ForecastSection report={report} series={series} detail={detail} />

        {/* --- layer five: what to do */}
        <WarningsSection warnings={warnings} onGo={go} />
        <ActionsSection actions={actions} onGo={go} />
      </div>

      {/* ---------------------------------------------------------- drills */}
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
