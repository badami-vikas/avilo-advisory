/**
 * The tool sections.
 *
 * Everything else on the dashboard reports. These three let the advisor ask a question
 * the data does not answer on its own — what would it take, what if we collected these,
 * where does the concentration risk actually sit — and get an arithmetic answer they can
 * repeat out loud. The thirteen-week forecast was the first of them; these follow its
 * shape: a stated assumption, a visible calculation, no smoothing.
 */

import { useMemo, useState } from "react";
import { Check } from "lucide-react";

import { moneyFull } from "../../lib/format.js";
import { Tip } from "../components/Tooltip.js";
import type { DetailByKind, PeriodReport, SeriesPoint } from "../types.js";
import {
  collectionPriority,
  growthQuality,
  money,
  trailingMean,
  type GrowthQualityPoint,
} from "./insights.js";
import { BubbleMatrix } from "./charts.js";
import { Finding, NeedsData, Panel } from "./parts.js";

/* ------------------------------------------------------- growth quality */

const RISK_COLOR = { low: "#12b76a", medium: "#f79009", high: "#d92d20" } as const;

/**
 * Every customer positioned by how they are moving and how much of the business they are.
 *
 * The reference version of this chart plots growth against gross margin per customer. The
 * source exports do not carry that — a Sales by Customer report has revenue and nothing
 * about the cost of serving it — so the vertical axis is share of revenue instead, which
 * answers the question the quadrants actually ask: does this movement matter? Colour is
 * payment risk, which *is* in the data, from the ageing report.
 */
export function GrowthQualitySection({
  detail,
  priorDetail,
}: {
  detail: DetailByKind;
  priorDetail: DetailByKind;
}) {
  const { points, comparable } = useMemo(
    () => growthQuality(detail, priorDetail),
    [detail, priorDetail],
  );

  if (points.length === 0) {
    return (
      <Panel
        id="quality"
        title="Growth quality"
        subtitle="Which customers are growing, and whether that growth is worth having"
      >
        <NeedsData what="No customer revenue imported" upload="a Sales by Customer export" />
      </Panel>
    );
  }

  if (!comparable) {
    return (
      <Panel
        id="quality"
        title="Growth quality"
        subtitle="Which customers are growing, and whether that growth is worth having"
        summary="Needs a second month of customer data before growth can be measured."
      >
        <NeedsData
          what="Only one month of customer data"
          upload="a Sales by Customer export for the previous month too — growth is a comparison"
        />
      </Panel>
    );
  }

  const plotted = points.filter((p) => p.growthPct !== null).slice(0, 12);
  const winners = plotted.filter((p) => (p.growthPct ?? 0) > 2 && p.share >= 10);
  const risky = plotted.filter((p) => p.risk === "high" && p.share >= 10);

  return (
    <Panel
      id="quality"
      title="Growth quality"
      subtitle="Which customers are growing, whether it matters, and whether they pay"
      summary={
        risky.length > 0
          ? `${risky.length} material customer${risky.length === 1 ? " is" : "s are"} growing on balances that are already overdue.`
          : winners.length > 0
            ? `${winners.length} of the material accounts ${winners.length === 1 ? "is" : "are"} growing.`
            : "No material account is growing this month."
      }
    >
      <div className="relative">
        <BubbleMatrix
          points={plotted.map((point) => ({
            label: point.label,
            x: Math.max(-40, Math.min(60, point.growthPct ?? 0)),
            y: point.share,
            r: Math.max(6, Math.min(26, Math.sqrt(point.revenue) / 11)),
            color: RISK_COLOR[point.risk],
          }))}
          xLabel="Revenue growth"
          yLabel="Share of revenue"
          xIsPercent
          height={310}
        />
        {/*
          Quadrant labels as overlaid text rather than chart annotations: the plugin that
          would draw them inside the canvas is a dependency, and these never move.
        */}
        <div className="pointer-events-none absolute inset-0">
          <span className="absolute left-[14%] top-[8%] rounded-md bg-[#eff8ff] px-1.5 py-0.5 text-[10.5px] font-medium text-accent">
            Shrinking, and it matters
          </span>
          <span className="absolute right-[6%] top-[8%] rounded-md bg-[#ecfdf3] px-1.5 py-0.5 text-[10.5px] font-medium text-positive">
            Growing, and it matters
          </span>
          <span className="absolute bottom-[22%] left-[14%] rounded-md bg-line-soft px-1.5 py-0.5 text-[10.5px] font-medium text-ink-faint">
            Shrinking, small
          </span>
          <span className="absolute bottom-[22%] right-[6%] rounded-md bg-line-soft px-1.5 py-0.5 text-[10.5px] font-medium text-ink-faint">
            Growing, small
          </span>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-faint">
        <span>Bubble size = annual revenue</span>
        <span className="inline-flex items-center gap-1.5">
          Payment risk
          {(["low", "medium", "high"] as const).map((risk) => (
            <Tip
              key={risk}
              content={
                risk === "low"
                  ? "Nothing outstanding, or current."
                  : risk === "medium"
                    ? "Most of their balance is 31–60 days old."
                    : "Most of their balance is more than sixty days old."
              }
            >
              <span className="inline-flex items-center gap-1">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: RISK_COLOR[risk] }}
                />
                {risk}
              </span>
            </Tip>
          ))}
        </span>
        <Tip content="A Sales by Customer export carries revenue but not the cost of serving each customer, so a true margin axis is not available. Share of revenue answers the same question the quadrants ask: does this movement matter?">
          <span className="cursor-help underline decoration-dotted underline-offset-2">
            Why share of revenue, not margin?
          </span>
        </Tip>
      </div>

      <Finding>
        {describeQuality(plotted)}
      </Finding>
    </Panel>
  );
}

function describeQuality(points: GrowthQualityPoint[]): string {
  const material = points.filter((p) => p.share >= 10);
  const growing = material.filter((p) => (p.growthPct ?? 0) > 2);
  const shrinking = material.filter((p) => (p.growthPct ?? 0) < -2);
  const risky = material.filter((p) => p.risk === "high");

  const parts: string[] = [];
  if (growing.length > 0) {
    parts.push(
      `${growing.map((p) => p.label).join(", ")} ${growing.length === 1 ? "is" : "are"} growing and material.`,
    );
  }
  if (shrinking.length > 0) {
    parts.push(
      `${shrinking.map((p) => p.label).join(", ")} ${shrinking.length === 1 ? "is" : "are"} shrinking from a position that matters — worth a conversation before it becomes a trend.`,
    );
  }
  if (risky.length > 0) {
    parts.push(
      `${risky.map((p) => p.label).join(", ")} ${risky.length === 1 ? "carries" : "carry"} a balance more than sixty days old, so their revenue is not yet cash.`,
    );
  }
  if (parts.length === 0) {
    parts.push("No customer above 10% of revenue moved materially this month.");
  }
  return parts.join(" ");
}

/* ---------------------------------------------------- collections planner */

/**
 * Tick the accounts you expect to collect, and see what it is worth.
 *
 * The A/R section says who to chase. This says what chasing them is worth, which is the
 * number that decides whether it is worth an afternoon: the cash it releases, what it
 * does to the ageing profile, and where it leaves collection days.
 */
export function CollectionsPlanner({
  report,
  detail,
}: {
  report: PeriodReport;
  detail: DetailByKind;
}) {
  const rows = useMemo(
    () => collectionPriority(detail["ar_customer"] ?? [], 12),
    [detail],
  );
  const [picked, setPicked] = useState<string[]>([]);

  if (rows.length === 0) {
    return (
      <Panel id="collections" title="Collections planner" subtitle="What chasing is worth">
        <NeedsData what="No receivables imported" upload="an A/R Ageing Summary" />
      </Panel>
    );
  }

  const outstanding = rows.reduce((sum, row) => sum + row.value, 0);
  const collected = rows
    .filter((row) => picked.includes(row.label))
    .reduce((sum, row) => sum + row.value, 0);

  const cash = report.accounts.find((a) => a.accountId === "bs.cash")?.value ?? null;
  const revenue = report.accounts.find((a) => a.accountId === "pl.revenue")?.value ?? null;
  const dso = report.metrics.find((m) => m.id === "dso");
  const dsoNow = dso?.status === "ok" ? dso.value : null;
  /*
    DSO is receivables over one month's revenue, times thirty. Collecting reduces the
    numerator and touches nothing else, so the new figure is exact rather than modelled —
    which is why this planner can state it rather than estimate it.
  */
  const dsoAfter =
    revenue && revenue !== 0 ? ((outstanding - collected) / revenue) * 30 : null;

  const overdue = rows
    .filter((row) => row.bucket === "61_90" || row.bucket === "91_plus")
    .filter((row) => !picked.includes(row.label));

  return (
    <Panel
      id="collections"
      title="Collections planner"
      subtitle="Tick what you expect to collect. Everything below updates."
      summary={
        picked.length === 0
          ? `${money(outstanding)} outstanding across ${rows.length} account${rows.length === 1 ? "" : "s"}.`
          : `Collecting ${picked.length} account${picked.length === 1 ? "" : "s"} would release ${money(collected)}.`
      }
    >
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="divide-y divide-line-soft">
          {rows.map((row) => {
            const on = picked.includes(row.label);
            return (
              <button
                key={row.label}
                onClick={() =>
                  setPicked((current) =>
                    on ? current.filter((x) => x !== row.label) : [...current, row.label],
                  )
                }
                className="flex w-full items-center gap-3 py-2 text-left transition-colors hover:bg-line-soft/50"
              >
                <span
                  className={`grid h-4 w-4 shrink-0 place-items-center rounded border transition-colors ${
                    on ? "border-accent bg-accent text-white" : "border-line bg-surface"
                  }`}
                >
                  {on ? <Check size={11} strokeWidth={3} /> : null}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">
                  {row.label}
                </span>
                <Tip content={row.reason}>
                  <span className="shrink-0 text-[11px] text-ink-faint">
                    {row.bucket === "91_plus"
                      ? "91+ days"
                      : row.bucket === "61_90"
                        ? "61–90 days"
                        : row.bucket === "31_60"
                          ? "31–60 days"
                          : "current"}
                  </span>
                </Tip>
                <span className="num w-24 shrink-0 text-right text-[12.5px] font-medium text-ink">
                  {moneyFull(row.value)}
                </span>
              </button>
            );
          })}
        </div>

        <div className="space-y-2.5">
          <Outcome
            label="Cash released"
            value={money(collected)}
            note={picked.length === 0 ? "Nothing selected yet" : `${picked.length} account${picked.length === 1 ? "" : "s"}`}
            tone={collected > 0 ? "positive" : "neutral"}
          />
          <Outcome
            label="Cash after collection"
            value={cash === null ? "—" : money(cash + collected)}
            note={cash === null ? "Needs a balance sheet" : `from ${money(cash)}`}
            tone="neutral"
          />
          <Outcome
            label="Collection days after"
            value={dsoAfter === null ? "—" : `${Math.round(dsoAfter)} days`}
            note={
              dsoNow === null
                ? "Needs revenue and an ageing report"
                : `from ${Math.round(dsoNow)} days`
            }
            tone={dsoAfter !== null && dsoNow !== null && dsoAfter < dsoNow ? "positive" : "neutral"}
          />
          <Outcome
            label="Still overdue"
            value={money(overdue.reduce((sum, row) => sum + row.value, 0))}
            note={`${overdue.length} account${overdue.length === 1 ? "" : "s"} past sixty days`}
            tone={overdue.length > 0 ? "negative" : "positive"}
          />
        </div>
      </div>

      <Finding>
        {picked.length === 0 ? (
          <>
            {money(outstanding)} is outstanding.{" "}
            {overdue.length > 0
              ? `${money(overdue.reduce((sum, row) => sum + row.value, 0))} of it is more than sixty days old, which is the part that stops arriving on its own.`
              : "None of it is more than sixty days old."}
          </>
        ) : (
          <>
            Collecting these {picked.length} would put {money(collected)} in the bank and
            take collection from {dsoNow === null ? "—" : `${Math.round(dsoNow)}`} to{" "}
            {dsoAfter === null ? "—" : `${Math.round(dsoAfter)}`} days.
          </>
        )}
      </Finding>
    </Panel>
  );
}

/* --------------------------------------------------------- what would it take */

type Goal = "margin" | "runway" | "collection";

const GOALS: { id: Goal; label: string; unit: string; min: number; max: number; step: number }[] = [
  { id: "margin", label: "Operating margin", unit: "%", min: 0, max: 40, step: 1 },
  { id: "runway", label: "Days of cash", unit: " days", min: 0, max: 180, step: 5 },
  { id: "collection", label: "Collection days", unit: " days", min: 5, max: 90, step: 1 },
];

/**
 * Goal-seek: name a target, get the arithmetic that reaches it.
 *
 * The forecast answers "what happens if nothing changes". This answers the question an
 * advisor is actually asked in the meeting — "what would it take to get to 20%?" — and
 * answers it in the units the owner can act on: revenue, cost, days.
 */
export function GoalSeek({
  report,
  series,
}: {
  report: PeriodReport;
  series: SeriesPoint[];
}) {
  const account = (id: string) =>
    report.accounts.find((a) => a.accountId === id)?.value ?? null;
  const metric = (id: string) => {
    const m = report.metrics.find((x) => x.id === id);
    return m && m.status === "ok" ? m.value : null;
  };

  const revenue = account("pl.revenue");
  const cogs = account("pl.cogs");
  const overhead = account("pl.overhead");
  const cash = account("bs.cash");

  const [goal, setGoal] = useState<Goal>("margin");
  const spec = GOALS.find((entry) => entry.id === goal)!;

  const current =
    goal === "margin"
      ? metric("noi_margin_pct")
      : goal === "runway"
        ? metric("days_cash_on_hand")
        : metric("dso");

  const [target, setTarget] = useState<number | null>(null);
  const chosen = target ?? (current === null ? null : roundTo(current, spec.step, goal));

  if (current === null || chosen === null) {
    return (
      <Panel id="goal" title="What would it take?" subtitle="Name a target, see the arithmetic">
        <NeedsData
          what="Not enough imported to work backwards from a target"
          upload="a Profit & Loss and a Balance Sheet"
        />
      </Panel>
    );
  }

  const answers = (() => {
    if (goal === "margin" && revenue !== null && cogs !== null && overhead !== null) {
      const spend = cogs + overhead;
      // Margin = (R − S) / R. Solve for each side in turn, holding the other still.
      const revenueNeeded = spend / (1 - chosen / 100);
      const spendAllowed = revenue * (1 - chosen / 100);
      return [
        {
          label: "Sell more, change nothing else",
          value: `${money(revenueNeeded)} of revenue`,
          note: `${revenueNeeded > revenue ? "+" : ""}${money(revenueNeeded - revenue)} on this month`,
        },
        {
          label: "Spend less, change nothing else",
          value: `${money(spendAllowed)} of operating spend`,
          note: `${money(Math.abs(spend - spendAllowed))} ${spendAllowed < spend ? "to cut" : "of headroom"}`,
        },
        {
          label: "Split it evenly",
          value: `${money((revenueNeeded - revenue) / 2)} more revenue`,
          note: `and ${money((spend - spendAllowed) / 2)} less spend`,
        },
      ];
    }

    if (goal === "runway" && cash !== null && cogs !== null && overhead !== null) {
      const daily = (cogs + overhead) / 365;
      const cashNeeded = chosen * daily;
      const spendAllowed = chosen === 0 ? 0 : (cash / chosen) * 365;
      return [
        {
          label: "Hold more cash",
          value: money(cashNeeded),
          note: `${cashNeeded > cash ? "+" : ""}${money(cashNeeded - cash)} on today`,
        },
        {
          label: "Or spend less each month",
          value: `${money(spendAllowed / 12)} a month`,
          note: `from ${money(cogs + overhead)} — ${money(Math.abs(cogs + overhead - spendAllowed / 12))} ${spendAllowed / 12 < cogs + overhead ? "to cut" : "of headroom"}`,
        },
      ];
    }

    if (goal === "collection" && revenue !== null) {
      const outstandingNow = account("ar.total");
      const allowed = (chosen / 30) * revenue;
      return [
        {
          label: "Receivables would need to be",
          value: money(allowed),
          note:
            outstandingNow === null
              ? "no ageing report imported"
              : `from ${money(outstandingNow)} — ${money(Math.abs(outstandingNow - allowed))} ${allowed < outstandingNow ? "to collect" : "of headroom"}`,
        },
        {
          label: "One-off cash effect",
          value:
            outstandingNow === null ? "—" : money(Math.max(0, outstandingNow - allowed)),
          note: "released once, not repeating",
        },
      ];
    }

    return [];
  })();

  return (
    <Panel
      id="goal"
      title="What would it take?"
      subtitle="Name a target and the arithmetic runs backwards from it"
      summary={`${spec.label} is ${formatGoal(current, spec.unit)} today.`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {GOALS.map((entry) => (
          <button
            key={entry.id}
            onClick={() => {
              setGoal(entry.id);
              setTarget(null);
            }}
            aria-pressed={goal === entry.id}
            className={`rounded-lg border px-2.5 py-1 text-[12px] font-medium transition-colors ${
              goal === entry.id
                ? "border-ink bg-ink text-white"
                : "border-line bg-surface text-ink-muted hover:text-ink"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="mt-4">
        <div className="flex items-baseline justify-between">
          <span className="text-[12px] text-ink-muted">
            Target {spec.label.toLowerCase()}
          </span>
          <span className="num text-[15px] font-semibold text-ink">
            {formatGoal(chosen, spec.unit)}
            <span className="ml-2 text-[11.5px] font-normal text-ink-faint">
              today {formatGoal(current, spec.unit)}
            </span>
          </span>
        </div>
        <input
          type="range"
          min={spec.min}
          max={spec.max}
          step={spec.step}
          value={chosen}
          onChange={(event) => setTarget(Number(event.target.value))}
          className="mt-2 w-full accent-[#1570ef]"
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {answers.map((answer) => (
          <div key={answer.label} className="rounded-xl border border-line px-3.5 py-3">
            <p className="text-[11px] font-medium uppercase tracking-[0.05em] text-ink-faint">
              {answer.label}
            </p>
            <p className="num mt-1 text-[16px] font-semibold tracking-tight text-ink">
              {answer.value}
            </p>
            <p className="mt-0.5 text-[11.5px] text-ink-muted">{answer.note}</p>
          </div>
        ))}
      </div>

      <Finding>
        Each column holds everything else still. In practice the answer is a mix, which is
        why the split is shown — but the two extremes are the honest boundaries of what
        this month's numbers can reach.
      </Finding>
    </Panel>
  );
}

function roundTo(value: number, step: number, goal: Goal): number {
  // Start the slider on a round number a little better than today, so the tool opens on a
  // question rather than on the status quo.
  const nudged = goal === "collection" ? value * 0.8 : value * 1.15;
  return Math.max(0, Math.round(nudged / step) * step);
}

function formatGoal(value: number, unit: string): string {
  return `${unit === "%" ? value.toFixed(1) : Math.round(value)}${unit}`;
}

function Outcome({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone: "positive" | "negative" | "neutral";
}) {
  return (
    <div className="rounded-xl border border-line px-3.5 py-2.5">
      <p className="text-[11px] font-medium uppercase tracking-[0.05em] text-ink-faint">
        {label}
      </p>
      <p
        className={`num mt-0.5 text-[17px] font-semibold tracking-tight ${
          tone === "positive" ? "text-positive" : tone === "negative" ? "text-flag" : "text-ink"
        }`}
      >
        {value}
      </p>
      <p className="text-[11px] text-ink-faint">{note}</p>
    </div>
  );
}

/** Re-exported so the shell can build its summary strip from the same helper. */
export { trailingMean };
