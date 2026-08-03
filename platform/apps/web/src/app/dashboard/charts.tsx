/**
 * Chart primitives for the dashboard.
 *
 * Each of these is a shape the report view did not need: a distribution, a bridge between
 * two totals, a five-axis comparison, a position on a scale. They are thin wrappers over
 * Chart.js with the house style applied once, so a section asks for a donut rather than
 * assembling forty lines of options.
 *
 * All of them accept an explicit height and fill their container's width, because the
 * print stylesheet scales canvases to the page and a fixed pixel width would run off it.
 */

import { useEffect, useRef, useState } from "react";
import Chart, { type ChartConfiguration, type ChartType } from "chart.js/auto";
import { ChartColumn, Table as TableIcon } from "lucide-react";

import { moneyFull } from "../../lib/format.js";
import { Tip } from "../components/Tooltip.js";

const AXIS = { font: { size: 10.5 }, color: "#667085" } as const;
const GRID = "#f2f4f7";

/**
 * One canvas, one chart, destroyed on unmount.
 *
 * Generic over the chart type on purpose: Chart.js only exposes `cutout`, `circumference`
 * and their kin once the configuration is narrowed to the type that has them. A plain
 * `ChartConfiguration` widens to every chart type at once and loses all of it.
 */
function useChart<T extends ChartType>(config: ChartConfiguration<T>) {
  const ref = useRef<HTMLCanvasElement>(null);
  const chart = useRef<Chart<T> | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    chart.current = new Chart(canvas, config);
    return () => {
      chart.current?.destroy();
      chart.current = null;
    };
    // The config is rebuilt on every render by design: these charts are small and the
    // data behind them changes whenever a slider moves. Chart.js's own update path would
    // need per-chart diffing for no gain at this size.
  });

  return ref;
}

/**
 * The numbers behind a chart.
 *
 * Every visual can hand over its own source rows, so "show me the figures" is answered in
 * place rather than by hunting for the raw-data view and matching a series by eye.
 */
export interface ChartTable {
  columns: string[];
  rows: (string | number | null)[][];
  /** Which columns hold money, so the table formats them the way the axis did. */
  money?: boolean[];
}

function TableView({ table }: { table: ChartTable }) {
  const format = (value: string | number | null, column: number) => {
    if (value === null || value === undefined || value === "") return "—";
    if (typeof value === "number") {
      return table.money?.[column] ? moneyFull(value) : value.toLocaleString();
    }
    return value;
  };

  return (
    // Scrolls inside its own box: a wide series must never push the page sideways.
    <div className="h-full overflow-auto rounded-lg border border-line-soft">
      <table className="w-full border-collapse text-[11.5px]">
        <thead className="sticky top-0 bg-canvas">
          <tr>
            {table.columns.map((column, index) => (
              <th
                key={column}
                className={`border-b border-line px-2 py-1.5 font-semibold text-ink-muted ${
                  index === 0 ? "text-left" : "text-right"
                }`}
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, r) => (
            <tr key={r} className="even:bg-canvas/60">
              {row.map((cell, c) => (
                <td
                  key={c}
                  className={`border-b border-line-soft px-2 py-1 ${
                    c === 0 ? "text-left text-ink" : "num text-right text-ink-muted"
                  }`}
                >
                  {format(cell, c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Frame({
  height,
  children,
  table,
}: {
  height: number;
  children: React.ReactNode;
  /** When present, a control appears to swap the drawing for its own figures. */
  table?: ChartTable;
}) {
  const [showTable, setShowTable] = useState(false);

  return (
    <div className="chart-frame relative w-full" style={{ height }}>
      {table ? (
        <Tip content={showTable ? "Back to the chart" : "Show the figures behind this chart"}>
          <button
            onClick={() => setShowTable((value) => !value)}
            aria-label={showTable ? "Show chart" : "Show data table"}
            // Sits above the canvas rather than beside it: the frame is a fixed height and
            // a control on its own row would shorten every chart on the page.
            className="no-print absolute right-0 top-0 z-10 inline-flex items-center gap-1 rounded-md border border-line bg-surface/90 px-1.5 py-[3px] text-[10.5px] font-medium text-ink-muted backdrop-blur-[1px] transition-colors hover:border-accent hover:text-accent"
          >
            {showTable ? <ChartColumn size={11} /> : <TableIcon size={11} />}
            {showTable ? "Chart" : "Data"}
          </button>
        </Tip>
      ) : null}
      {showTable && table ? <TableView table={table} /> : children}
    </div>
  );
}

/* ----------------------------------------------------------------- donut */

export interface Slice {
  label: string;
  value: number;
  color: string;
}

/**
 * A distribution, with the total in the middle.
 *
 * Used for ageing rather than a stacked bar: the question an ageing chart answers is
 * "how much of what I am owed is late", which is a share of one whole — and a share of
 * one whole is what a ring reads as at a glance.
 */
export function Donut({
  slices,
  centerLabel,
  centerValue,
  height = 210,
}: {
  slices: Slice[];
  centerLabel: string;
  centerValue: string;
  height?: number;
}) {
  const selection = useLegendSelection();

  const ref = useChart({
    type: "doughnut",
    data: {
      labels: slices.map((s) => s.label),
      datasets: [
        {
          data: slices.map((s) => s.value),
          // A ring is one whole, so a picked bucket is drawn out of the others rather
          // than drawn alone — remove a slice and the remaining ring stops being a share
          // of anything.
          backgroundColor: slices.map((s) =>
            selection.isDrawn(s.label) ? s.color : `${s.color}2e`,
          ),
          borderColor: "#fff",
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "68%",
      plugins: {
        // Never the canvas legend — see `Legend`.
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (context) => {
              const total = slices.reduce((sum, s) => sum + s.value, 0);
              const share = total === 0 ? 0 : (context.parsed / total) * 100;
              return `${context.label}: ${moneyFull(context.parsed)} (${share.toFixed(1)}%)`;
            },
          },
        },
      },
    },
  });

  const total = slices.reduce((sum, slice) => sum + slice.value, 0);

  return (
    <div>
    <Frame
      height={height}
      table={{
        columns: ["Bucket", "Amount", "Share"],
        money: [false, true, false],
        rows: slices.map((slice) => [
          slice.label,
          slice.value,
          total > 0 ? `${((slice.value / total) * 100).toFixed(1)}%` : "—",
        ]),
      }}
    >
      <canvas ref={ref} />
      {/*
        The total sits in the hole rather than beside the chart. A ring with a number in
        it answers both "how much" and "how is it split" without moving the eye.
      */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-faint">
          {centerLabel}
        </span>
        <span className="num text-[17px] font-semibold tracking-tight text-ink">
          {centerValue}
        </span>
      </div>
    </Frame>
      <Legend
        items={slices.map((slice) => ({
          label: slice.label,
          color: slice.color,
          tip: `Pick ${slice.label.toLowerCase()} out of the ring.`,
        }))}
        selected={selection.selected}
        onToggle={selection.toggle}
        onClear={selection.clear}
      />
    </div>
  );
}

/* --------------------------------------------------------------- sparkline */

/**
 * A twelve-month shape, in the space of a word.
 *
 * Hand-drawn SVG rather than a Chart.js instance: there are seven of these in the header
 * strip alone, and seven canvases with their own animation loops to draw seven polylines
 * is a waste of a frame budget that the rest of the page needs.
 */
export function Sparkline({
  values,
  tone = "#1570ef",
  width = 92,
  height = 26,
}: {
  values: (number | null)[];
  tone?: string;
  width?: number;
  height?: number;
}) {
  const points = values.filter((v): v is number => v !== null && v !== undefined);
  if (points.length < 2) {
    return <div style={{ width, height }} aria-hidden />;
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  // A flat series has no range to scale against; draw it down the middle rather than
  // dividing by zero and sending every point to NaN.
  const span = max - min || 1;
  const step = width / (points.length - 1);

  const path = points
    .map((value, index) => {
      const x = index * step;
      const y = height - ((value - min) / span) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      // Decorative: every sparkline sits beside the number and the delta it summarises.
      aria-hidden
      style={{ overflow: "visible" }}
    >
      <path
        d={`${path} L${width},${height} L0,${height} Z`}
        fill={tone}
        opacity={0.08}
        stroke="none"
      />
      <path d={path} fill="none" stroke={tone} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

/* ----------------------------------------------------------------- radar */

export interface RadarAxis {
  label: string;
  /** 0–100. Null draws at zero and is greyed. Not printed — it belongs to the panel. */
  score: number | null;
  /** The measured value and its movement, shown under the name on the plot label. */
  caption: string;
  /** Label colour, which is how the score is banded at a glance. */
  color: string;
}

/**
 * The five dimensions as a shape, with a live reading on each of its own labels.
 *
 * The labels are HTML positioned over the canvas rather than text drawn inside it. A
 * canvas point label cannot take a hover handler, a focus ring, two type sizes or a
 * colour per line, and this one has to do all four — it carries the name, the reading and
 * the quarterly movement, and hovering it is what swaps the panel beside the chart. The
 * positions come from the radial scale itself, so they sit exactly where Chart.js would
 * have drawn its own labels and follow the shape when the panel resizes.
 */
export function Radar({
  axes,
  height = 320,
  onHover,
  active,
}: {
  axes: RadarAxis[];
  height?: number;
  /** Fires with the axis index under the pointer, or null on leave. */
  onHover?: (index: number | null) => void;
  /** Index to draw enlarged, so the label and the shape agree about what is being read. */
  active?: number | null;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [points, setPoints] = useState<{ x: number; y: number }[]>([]);

  // Serialised rather than by reference: `axes` is rebuilt on every render of the page
  // above, and an effect keyed on the array itself would tear the chart down and put it
  // back up sixty times a second.
  const signature = JSON.stringify(axes);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;

    const chart = new Chart(element, {
      type: "radar",
      data: {
        labels: axes.map((axis) => axis.label),
        datasets: [
          {
            data: axes.map((axis) => axis.score ?? 0),
            backgroundColor: "rgba(21,112,239,0.14)",
            borderColor: "#1570ef",
            borderWidth: 2,
            pointBackgroundColor: axes.map((axis) =>
              axis.score === null ? "#d0d5dd" : axis.color,
            ),
            pointBorderColor: "#fff",
            pointBorderWidth: 1.5,
            pointRadius: axes.map((_, index) => (index === active ? 7 : 4)),
            pointHoverRadius: 8,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        // Room for the labels that are about to be placed around the shape.
        layout: { padding: { top: 30, bottom: 30, left: 74, right: 74 } },
        plugins: {
          legend: { display: false },
          // The labels and the panel beside the chart say everything a tooltip would,
          // without covering the shape being read.
          tooltip: { enabled: false },
        },
        scales: {
          r: {
            min: 0,
            max: 100,
            angleLines: { color: GRID },
            grid: { color: GRID },
            // Drawn as HTML instead — see the note on this component.
            pointLabels: { display: false },
            ticks: { display: false, stepSize: 25 },
          },
        },
      },
    });

    const place = () => {
      const scale = chart.scales["r"] as unknown as
        | { drawingArea: number; getPointPosition: (i: number, d: number) => { x: number; y: number } }
        | undefined;
      if (!scale?.getPointPosition) return;
      const next = axes.map((_, index) => {
        const position = scale.getPointPosition(index, scale.drawingArea + 16);
        return { x: Math.round(position.x), y: Math.round(position.y) };
      });
      setPoints((current) =>
        current.length === next.length &&
        current.every((point, i) => point.x === next[i]!.x && point.y === next[i]!.y)
          ? current
          : next,
      );
    };

    place();
    const frame = element.parentElement;
    const observer = frame
      ? new ResizeObserver(() => {
          chart.resize();
          place();
        })
      : null;
    if (frame && observer) observer.observe(frame);

    return () => {
      observer?.disconnect();
      chart.destroy();
    };
  }, [signature, height, active]);

  return (
    <div
      className="chart-frame relative w-full"
      style={{ height }}
      onMouseLeave={() => onHover?.(null)}
    >
      <canvas ref={canvas} />

      {points.map((point, index) => {
        const axis = axes[index];
        if (!axis) return null;
        return (
          <button
            key={axis.label}
            type="button"
            onMouseEnter={() => onHover?.(index)}
            onFocus={() => onHover?.(index)}
            onClick={() => onHover?.(index)}
            aria-pressed={index === active}
            style={{ left: point.x, top: point.y }}
            className={`absolute w-[124px] -translate-x-1/2 -translate-y-1/2 rounded-lg px-1 py-0.5 text-center transition-colors ${
              index === active ? "bg-line-soft" : "hover:bg-line-soft/70"
            }`}
          >
            <span className="block truncate text-[11px] font-medium text-ink">
              {axis.label}
            </span>
            <span
              className="num block text-[11px] font-semibold"
              style={{ color: axis.score === null ? "#98a2b3" : axis.color }}
            >
              {axis.caption}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * A lighter step of a colour, for the segments of one measure.
 *
 * Segments of a single total are not five unrelated things — they are parts of one — so
 * they are drawn as steps of that measure's own colour rather than pulled from a
 * categorical palette. Mixing towards white keeps the hue and reads as one family.
 */
export function tint(hex: string, ratio: number): string {
  const value = hex.replace("#", "");
  const channel = (index: number) => parseInt(value.slice(index, index + 2), 16);
  const mix = (component: number) => Math.round(component + (255 - component) * ratio);
  return `rgb(${mix(channel(0))}, ${mix(channel(2))}, ${mix(channel(4))})`;
}

/* ---------------------------------------------------------------- legend */

export interface LegendItem {
  label: string;
  color: string;
  /** Explains the measure. Shown on hover, like every other term on the page. */
  tip?: string;
  /** False where a measure has no imported data — listed, but not selectable. */
  present?: boolean;
}

/**
 * One legend for every chart on the dashboard, and clicking it selects.
 *
 * Chart.js's own legend hides a series and strikes its label through. That is a fine
 * default for a chart in isolation and the wrong verb here: on a page whose whole idiom
 * is "show me this one", a click that crosses something out reads as switching it off.
 * Two charts side by side, one selecting and one hiding, is worse than either.
 *
 * So no chart on this page draws its own legend. This is drawn in HTML below the canvas,
 * it says what it does on hover, it is reachable by keyboard, and it means the same thing
 * everywhere: nothing picked shows everything; picking isolates; picking again puts it
 * back.
 */
export function Legend({
  items,
  selected,
  onToggle,
  onClear,
}: {
  items: LegendItem[];
  selected: string[];
  onToggle: (label: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5">
      {items.map((item) => {
        const on = selected.includes(item.label);
        const available = item.present ?? true;
        return (
          <Tip
            key={item.label}
            content={
              !available
                ? `${item.label} has not been imported.`
                : on
                  ? `Showing ${item.label.toLowerCase()} on its own. Click to put the rest back.`
                  : (item.tip ?? `Show ${item.label.toLowerCase()} on its own.`)
            }
          >
            <button
              type="button"
              onClick={() => available && onToggle(item.label)}
              disabled={!available}
              aria-pressed={on}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-all disabled:opacity-40 ${
                on
                  ? "border-ink/15 bg-line-soft text-ink"
                  : "border-transparent text-ink-muted hover:bg-line-soft/70 hover:text-ink"
              }`}
            >
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: item.color, opacity: on || selected.length === 0 ? 1 : 0.4 }}
              />
              {item.label}
            </button>
          </Tip>
        );
      })}
      {selected.length > 0 ? (
        <button
          type="button"
          onClick={onClear}
          className="ml-1 text-[11.5px] text-ink-faint underline-offset-2 hover:text-ink hover:underline"
        >
          Show all
        </button>
      ) : null}
    </div>
  );
}

/**
 * The selection behind a legend.
 *
 * Held per chart rather than per page: two charts on the same screen answer different
 * questions, and a selection that leapt between them would be a filter nobody asked for.
 */
export function useLegendSelection() {
  const [selected, setSelected] = useState<string[]>([]);
  const toggle = (label: string) =>
    setSelected((current) =>
      current.includes(label) ? current.filter((x) => x !== label) : [...current, label],
    );
  const clear = () => setSelected([]);
  // Nothing selected means everything is drawn — an empty selection is the resting
  // state, never a filter that has removed all of them.
  const isDrawn = (label: string) => selected.length === 0 || selected.includes(label);
  return { selected, toggle, clear, isDrawn };
}

/* ------------------------------------------------------------ grouped bars */

/**
 * Selected series as bars, month by month.
 *
 * The counterpart to `TrendLine`: lines are for shape over time, bars are for reading a
 * value off a specific month and comparing two of them side by side. Which one the
 * section shows is driven by whether the advisor has selected anything.
 */
export function GroupedBars({
  labels,
  datasets,
  height = 260,
  currency = true,
  stacked = false,
  showLegend,
}: {
  labels: string[];
  datasets: {
    label: string;
    values: (number | null)[];
    color: string;
    /**
     * Kept in the legend but off the plot.
     *
     * This is how a selection isolates: the measure that was not picked stops being drawn
     * rather than being drawn faintly, so the axis rescales to what is actually being
     * read. Its legend entry stays — struck through, in Chart.js's own idiom — which is
     * what keeps it one click away and keeps multi-select reachable.
     */
    hidden?: boolean;
  }[];
  height?: number;
  currency?: boolean;
  /** Segments of one total, stacked into a single bar per period. */
  stacked?: boolean;
  /** Defaults to showing a legend for more than one dataset. */
  showLegend?: boolean;
}) {
  const selection = useLegendSelection();
  // The caller drives it when it passes explicit visibility — the growth explorer, whose
  // selection also decides what the bars are broken into.
  const driven = datasets.some((set) => set.hidden !== undefined) || showLegend === false;
  const withLegend = !driven && datasets.length > 1;

  const ref = useChart({
    type: "bar",
    data: {
      labels,
      datasets: datasets.map((set) => ({
        label: set.label,
        data: set.values,
        backgroundColor: set.color,
        borderRadius: 3,
        borderSkipped: false as const,
        hidden: set.hidden ?? (withLegend ? !selection.isDrawn(set.label) : false),
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        // Never the canvas legend — see `Legend`.
        legend: { display: false },
        tooltip: {
          // Every selected series for that month in one card, plus each one's share of
          // the group — reading a grouped bar chart by eye is exactly what this saves.
          callbacks: {
            label: (context) => {
              const value = context.parsed.y;
              if (value === null) return `${context.dataset.label}: —`;
              // Only what is actually plotted counts towards the share — a hidden
              // measure is not part of the comparison the reader is looking at.
              const total = context.chart.data.datasets.reduce((sum, set, index) => {
                if (!context.chart.isDatasetVisible(index)) return sum;
                const point = (set.data as (number | null)[])[context.dataIndex];
                return sum + Math.abs(point ?? 0);
              }, 0);
              const share = total === 0 ? 0 : (Math.abs(value) / total) * 100;
              return `${context.dataset.label}: ${
                currency ? moneyFull(value) : `${value.toFixed(1)}%`
              }${
                datasets.length > 1
                  ? `  (${share.toFixed(0)}% of ${stacked ? "the month" : "selection"})`
                  : ""
              }`;
            },
          },
        },
      },
      scales: {
        x: { stacked, grid: { display: false }, ticks: AXIS },
        y: {
          stacked,
          grace: "8%",
          grid: { color: GRID },
          border: { display: false },
          ticks: {
            ...AXIS,
            callback: (value) => {
              if (typeof value !== "number") return String(value);
              if (!currency) return `${value}%`;
              return Math.abs(value) >= 1000 ? `${Math.round(value / 1000)}K` : String(value);
            },
          },
        },
      },
    },
  });

  return (
    <div>
      <Frame
        height={height}
        table={{
          columns: ["Period", ...datasets.map((d) => d.label)],
          money: [false, ...datasets.map(() => currency)],
          rows: labels.map((label, i) => [label, ...datasets.map((d) => d.values[i] ?? null)]),
        }}
      >
        <canvas ref={ref} />
      </Frame>
      {withLegend ? (
        <Legend
          items={datasets.map((set) => ({ label: set.label, color: set.color }))}
          selected={selection.selected}
          onToggle={selection.toggle}
          onClear={selection.clear}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------- waterfall */

export interface BridgeStep {
  label: string;
  /** Signed contribution. The opening and closing totals are added by the component. */
  change: number;
}

/**
 * A bridge between two totals.
 *
 * Built from a floating bar — each bar is drawn as `[base, base + change]` — which is the
 * only way to get a waterfall out of Chart.js without a plugin. The running base is
 * carried through the map, so the bars physically stack from the opening figure to the
 * closing one and the chart cannot disagree with the arithmetic.
 */
export function Waterfall({
  opening,
  openingLabel,
  steps,
  closingLabel,
  height = 260,
}: {
  opening: number;
  openingLabel: string;
  steps: BridgeStep[];
  closingLabel: string;
  height?: number;
}) {
  const bars: { label: string; range: [number, number]; color: string }[] = [];
  bars.push({ label: openingLabel, range: [0, opening], color: "#98a2b3" });

  let base = opening;
  for (const step of steps) {
    const next = base + step.change;
    bars.push({
      label: step.label,
      range: [base, next],
      color: step.change >= 0 ? "#12b76a" : "#d92d20",
    });
    base = next;
  }
  bars.push({ label: closingLabel, range: [0, base], color: "#1570ef" });

  const ref = useChart({
    type: "bar",
    data: {
      labels: bars.map((b) => b.label),
      datasets: [
        {
          data: bars.map((b) => b.range),
          backgroundColor: bars.map((b) => b.color),
          borderRadius: 3,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (context) => {
              const range = context.raw as [number, number];
              return `${moneyFull(range[1] - range[0])} → ${moneyFull(range[1])}`;
            },
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { ...AXIS, maxRotation: 40, minRotation: 0 } },
        y: {
          grid: { color: GRID },
          border: { display: false },
          ticks: {
            ...AXIS,
            callback: (value) =>
              typeof value === "number" && Math.abs(value) >= 1000
                ? `${Math.round(value / 1000)}K`
                : String(value),
          },
        },
      },
    },
  });

  return (
    <Frame
      height={height}
      table={{
        columns: ["Step", "Change", "Running total"],
        money: [false, true, true],
        rows: [
          [openingLabel, null, opening],
          ...steps.map((step, i) => [
            step.label,
            step.change,
            opening + steps.slice(0, i + 1).reduce((sum, s) => sum + s.change, 0),
          ]),
          [closingLabel, null, opening + steps.reduce((sum, s) => sum + s.change, 0)],
        ],
      }}
    >
      <canvas ref={ref} />
    </Frame>
  );
}

/* ------------------------------------------------------------ line/area */

export function TrendLine({
  labels,
  datasets,
  height = 230,
  currency = true,
  showLegend,
}: {
  labels: string[];
  datasets: {
    label: string;
    values: (number | null)[];
    color: string;
    fill?: boolean;
    dashed?: boolean;
  }[];
  height?: number;
  currency?: boolean;
  /**
   * Defaults to a legend for more than one series.
   *
   * Set false where the section carries its own — the growth explorer drives its
   * selection from outside because a breakdown depends on it.
   */
  showLegend?: boolean;
}) {
  const selection = useLegendSelection();
  const withLegend = (showLegend ?? datasets.length > 1) && datasets.length > 1;
  const ref = useChart({
    type: "line",
    data: {
      labels,
      datasets: datasets.map((set) => ({
        label: set.label,
        data: set.values,
        borderColor: set.color,
        backgroundColor: set.fill ? `${set.color}22` : "transparent",
        fill: set.fill ?? false,
        borderWidth: 2,
        borderDash: set.dashed ? [4, 3] : undefined,
        pointRadius: 2.5,
        tension: 0.3,
        spanGaps: true,
        // Selection isolates: an unpicked series stops being drawn so the axis rescales
        // to what is being read, and its legend entry stays one click away.
        hidden: withLegend ? !selection.isDrawn(set.label) : false,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        // Never the canvas legend — see `Legend`.
        legend: { display: false },
      },
      scales: {
        x: { grid: { display: false }, ticks: AXIS },
        y: {
          grace: "10%",
          grid: { color: GRID },
          border: { display: false },
          ticks: {
            ...AXIS,
            callback: (value) => {
              if (typeof value !== "number") return String(value);
              if (!currency) return `${value}%`;
              return Math.abs(value) >= 1000 ? `${Math.round(value / 1000)}K` : String(value);
            },
          },
        },
      },
    },
  });

  return (
    <div>
      <Frame
        height={height}
        table={{
          columns: ["Period", ...datasets.map((d) => d.label)],
          money: [false, ...datasets.map(() => currency)],
          rows: labels.map((label, i) => [label, ...datasets.map((d) => d.values[i] ?? null)]),
        }}
      >
        <canvas ref={ref} />
      </Frame>
      {withLegend ? (
        <Legend
          items={datasets.map((set) => ({ label: set.label, color: set.color }))}
          selected={selection.selected}
          onToggle={selection.toggle}
          onClear={selection.clear}
        />
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------- scatter */

export interface ScatterPoint {
  label: string;
  x: number;
  y: number;
  /** Bubble size in points, derived by the caller from a third measure. */
  r: number;
  color: string;
}

export function BubbleMatrix({
  points,
  xLabel,
  yLabel,
  height = 280,
  xIsPercent = false,
}: {
  points: ScatterPoint[];
  xLabel: string;
  yLabel: string;
  height?: number;
  xIsPercent?: boolean;
}) {
  const ref = useChart({
    type: "bubble",
    data: {
      datasets: points.map((point) => ({
        label: point.label,
        data: [{ x: point.x, y: point.y, r: point.r }],
        backgroundColor: `${point.color}bb`,
        borderColor: point.color,
        borderWidth: 1,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (context) => {
              const raw = context.raw as { x: number; y: number };
              return `${context.dataset.label}: ${xLabel} ${
                xIsPercent ? `${raw.x.toFixed(1)}%` : moneyFull(raw.x)
              }, ${yLabel} ${raw.y.toFixed(0)}`;
            },
          },
        },
      },
      scales: {
        x: {
          title: { display: true, text: xLabel, font: { size: 10.5 }, color: "#98a2b3" },
          grid: { color: GRID },
          border: { display: false },
          ticks: {
            ...AXIS,
            callback: (value) =>
              typeof value !== "number"
                ? String(value)
                : xIsPercent
                  ? `${value}%`
                  : Math.abs(value) >= 1000
                    ? `${Math.round(value / 1000)}K`
                    : String(value),
          },
        },
        y: {
          title: { display: true, text: yLabel, font: { size: 10.5 }, color: "#98a2b3" },
          grid: { color: GRID },
          border: { display: false },
          ticks: AXIS,
        },
      },
    },
  });

  return (
    <Frame
      height={height}
      table={{
        columns: ["Client", xLabel, yLabel, "Size"],
        money: [false, !xIsPercent, true, true],
        rows: points.map((point) => [
          point.label,
          xIsPercent ? `${point.x.toFixed(1)}%` : point.x,
          point.y,
          point.r,
        ]),
      }}
    >
      <canvas ref={ref} />
    </Frame>
  );
}

/* ----------------------------------------------------------------- gauge */

/**
 * A position on a scale, drawn as a half-ring.
 *
 * For single bounded figures — a health score, a conversion rate — where the useful
 * information is not the number but where it sits between bad and good. A bar chart of
 * one bar cannot say that; a dial can.
 */
export function Gauge({
  value,
  max = 100,
  label,
  display,
  tone = "#1570ef",
  height = 150,
}: {
  value: number;
  max?: number;
  label: string;
  display: string;
  tone?: string;
  height?: number;
}) {
  const clamped = Math.max(0, Math.min(max, value));
  const ref = useChart({
    type: "doughnut",
    data: {
      labels: [label, "remaining"],
      datasets: [
        {
          data: [clamped, max - clamped],
          backgroundColor: [tone, "#eef1f4"],
          borderWidth: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      circumference: 180,
      rotation: 270,
      cutout: "76%",
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
    },
  });

  return (
    <div className="chart-frame relative w-full" style={{ height }}>
      <canvas ref={ref} />
      <div className="pointer-events-none absolute inset-x-0 bottom-1 flex flex-col items-center">
        <span className="num text-[22px] font-semibold tracking-tight text-ink">
          {display}
        </span>
        <span className="text-[10.5px] font-medium uppercase tracking-[0.07em] text-ink-faint">
          {label}
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ pareto bar */

/**
 * Bars against a cumulative line — the shape that shows concentration.
 *
 * The bars alone say who is biggest. The line is what says "four customers are 80% of
 * this business", which is the finding an advisor acts on.
 */
export function Pareto({
  labels,
  values,
  cumulative,
  height = 260,
}: {
  labels: string[];
  values: number[];
  cumulative: number[];
  height?: number;
}) {
  const selection = useLegendSelection();

  const ref = useChart({
    // A mixed chart still needs a base type; the per-dataset `type` overrides it.
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          type: "bar" as const,
          label: "Revenue",
          data: values,
          backgroundColor: "#b2ddff",
          borderRadius: 3,
          yAxisID: "y",
          order: 2,
          hidden: !selection.isDrawn("Revenue"),
        },
        {
          type: "line" as const,
          label: "Cumulative share",
          data: cumulative,
          borderColor: "#1570ef",
          backgroundColor: "transparent",
          borderWidth: 2,
          pointRadius: 2.5,
          tension: 0.25,
          yAxisID: "y1",
          order: 1,
          hidden: !selection.isDrawn("Cumulative share"),
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        // Never the canvas legend — see `Legend`.
        legend: { display: false },
      },
      scales: {
        x: { grid: { display: false }, ticks: { ...AXIS, maxRotation: 40 } },
        y: {
          grid: { color: GRID },
          border: { display: false },
          ticks: {
            ...AXIS,
            callback: (value) =>
              typeof value === "number" && Math.abs(value) >= 1000
                ? `${Math.round(value / 1000)}K`
                : String(value),
          },
        },
        y1: {
          position: "right",
          min: 0,
          max: 100,
          grid: { display: false },
          border: { display: false },
          ticks: { ...AXIS, callback: (value) => `${value}%` },
        },
      },
    },
  });

  return (
    <div>
      <Frame
        height={height}
        table={{
          columns: ["Customer", "Revenue", "Cumulative share"],
          money: [false, true, false],
          rows: labels.map((label, i) => [
            label,
            values[i] ?? null,
            cumulative[i] === undefined ? null : `${cumulative[i]!.toFixed(1)}%`,
          ]),
        }}
      >
        <canvas ref={ref} />
      </Frame>
      <Legend
        items={[
          { label: "Revenue", color: "#b2ddff", tip: "Show the bars on their own." },
          {
            label: "Cumulative share",
            color: "#1570ef",
            tip: "Show the concentration line on its own.",
          },
        ]}
        selected={selection.selected}
        onToggle={selection.toggle}
        onClear={selection.clear}
      />
    </div>
  );
}
