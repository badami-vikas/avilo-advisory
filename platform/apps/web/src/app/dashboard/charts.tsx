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

import { useEffect, useRef } from "react";
import Chart, { type ChartConfiguration, type ChartType } from "chart.js/auto";

import { moneyFull } from "../../lib/format.js";

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

function Frame({
  height,
  children,
}: {
  height: number;
  children: React.ReactNode;
}) {
  return (
    <div className="chart-frame relative w-full" style={{ height }}>
      {children}
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
  const ref = useChart({
    type: "doughnut",
    data: {
      labels: slices.map((s) => s.label),
      datasets: [
        {
          data: slices.map((s) => s.value),
          backgroundColor: slices.map((s) => s.color),
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
        legend: {
          position: "right",
          labels: { boxWidth: 9, boxHeight: 9, font: { size: 11 }, padding: 10 },
        },
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

  return (
    <Frame height={height}>
      <canvas ref={ref} />
      {/*
        The total sits in the hole rather than beside the chart. A ring with a number in
        it answers both "how much" and "how is it split" without moving the eye.
      */}
      <div className="pointer-events-none absolute inset-y-0 left-0 flex w-[62%] flex-col items-center justify-center">
        <span className="text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-faint">
          {centerLabel}
        </span>
        <span className="num text-[17px] font-semibold tracking-tight text-ink">
          {centerValue}
        </span>
      </div>
    </Frame>
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
  /** 0–100. Null draws at zero and is greyed. */
  score: number | null;
  /** Second line under the label — the measured value and its movement. */
  caption: string;
  /** Label colour, which is how the score is banded at a glance. */
  color: string;
}

export function Radar({
  axes,
  height = 300,
  onHover,
  active,
}: {
  axes: RadarAxis[];
  height?: number;
  /** Fires with the axis index under the pointer, or null on leave. */
  onHover?: (index: number | null) => void;
  /** Index to draw enlarged, so the panel beside the chart and the chart agree. */
  active?: number | null;
}) {
  const ref = useChart({
    type: "radar",
    data: {
      // Two lines per point: the dimension, then its reading. Chart.js renders an array
      // of strings as stacked lines, which is what puts the score under the label
      // without a second layer of absolutely-positioned HTML over the canvas.
      labels: axes.map((axis) => [axis.label, axis.caption]),
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
      plugins: {
        legend: { display: false },
        // The panel beside the chart says everything a tooltip would, in more detail
        // and without covering the shape being read.
        tooltip: { enabled: false },
      },
      onHover: (_event, elements) => {
        onHover?.(elements.length > 0 ? (elements[0]?.index ?? null) : null);
      },
      scales: {
        r: {
          min: 0,
          max: 100,
          angleLines: { color: GRID },
          grid: { color: GRID },
          pointLabels: {
            font: (context) =>
              // The caption is the second line of each label; it gets the smaller size.
              context.index === undefined
                ? { size: 11 }
                : { size: 11, weight: 500 },
            color: (context) => axes[context.index]?.color ?? "#475467",
            padding: 8,
          },
          ticks: { display: false, stepSize: 25 },
        },
      },
    },
  });

  return (
    <div
      className="chart-frame relative w-full"
      style={{ height }}
      onMouseLeave={() => onHover?.(null)}
    >
      <canvas ref={ref} />
    </div>
  );
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
}: {
  labels: string[];
  datasets: { label: string; values: (number | null)[]; color: string }[];
  height?: number;
  currency?: boolean;
}) {
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
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          display: datasets.length > 1,
          position: "bottom",
          labels: { boxWidth: 10, boxHeight: 10, font: { size: 11 }, padding: 12 },
        },
        tooltip: {
          // Every selected series for that month in one card, plus each one's share of
          // the group — reading a grouped bar chart by eye is exactly what this saves.
          callbacks: {
            label: (context) => {
              const value = context.parsed.y;
              if (value === null) return `${context.dataset.label}: —`;
              const total = context.chart.data.datasets.reduce((sum, set) => {
                const point = (set.data as (number | null)[])[context.dataIndex];
                return sum + Math.abs(point ?? 0);
              }, 0);
              const share = total === 0 ? 0 : (Math.abs(value) / total) * 100;
              return `${context.dataset.label}: ${
                currency ? moneyFull(value) : `${value.toFixed(1)}%`
              }${datasets.length > 1 ? `  (${share.toFixed(0)}% of selection)` : ""}`;
            },
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: AXIS },
        y: {
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
    <Frame height={height}>
      <canvas ref={ref} />
    </Frame>
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
    <Frame height={height}>
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
}) {
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
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          display: datasets.length > 1,
          position: "bottom",
          labels: { boxWidth: 10, boxHeight: 10, font: { size: 11 }, padding: 12 },
        },
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
    <Frame height={height}>
      <canvas ref={ref} />
    </Frame>
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
    <Frame height={height}>
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
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          position: "bottom",
          labels: { boxWidth: 10, boxHeight: 10, font: { size: 11 }, padding: 12 },
        },
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
    <Frame height={height}>
      <canvas ref={ref} />
    </Frame>
  );
}
