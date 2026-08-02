import { useEffect, useRef, useState } from "react";
import { InlineEditor } from "./DataTable.js";
import { BarChart3, Table2 } from "lucide-react";
import Chart from "chart.js/auto";

import { Block } from "./ui.js";
import { byUnit } from "../../lib/format.js";

export interface Series {
  id: string;
  label: string;
  unit: string;
  /** Draw on the right-hand axis — used for margin lines against currency bars. */
  secondaryAxis?: boolean;
  type?: "bar" | "line";
  color: string;
}

export interface ChartPoint {
  /** Display label, e.g. "Oct 2024". */
  label: string;
  /** ISO period, e.g. "2024-10". An edit has to know which month it writes to, and the
   *  display label is a formatting choice that must never be parsed back into one. */
  period: string;
  values: Record<string, number | null>;
}

/** Write a value for one series in one period. Absent ⇒ the table is read-only. */
export type ChartCellEdit = (
  period: string,
  seriesId: string,
  raw: string,
) => Promise<void>;

/**
 * A chart with a graph/table toggle.
 *
 * The toggle carries `chart-toggle`, which the print stylesheet hides — the requirement
 * is that it must not appear in the exported PDF. The chart itself always renders for
 * print; switching to the table view is a screen-only affordance.
 */
export function ChartBlock({
  title,
  subtitle,
  series,
  points,
  height = 260,
  onEditCell,
  printTable = false,
}: {
  title: string;
  subtitle?: string;
  series: Series[];
  points: ChartPoint[];
  height?: number;
  onEditCell?: ChartCellEdit;
  /** Emit the underlying figures beneath the chart in the exported PDF. */
  printTable?: boolean;
}) {
  const [mode, setMode] = useState<"graph" | "table">("graph");

  return (
    <Block
      title={title}
      subtitle={subtitle}
      printHideIfEmpty={points.length === 0}
      actions={
        <div className="chart-toggle no-print inline-flex rounded-lg border border-line p-0.5">
          <ToggleButton
            active={mode === "graph"}
            onClick={() => setMode("graph")}
            icon={<BarChart3 size={13} />}
            label="Graph"
          />
          <ToggleButton
            active={mode === "table"}
            onClick={() => setMode("table")}
            icon={<Table2 size={13} />}
            label="Table"
          />
        </div>
      }
    >
      {points.length === 0 ? (
        <p className="px-5 py-10 text-center text-[12.5px] text-ink-muted">
          No periods imported yet.
        </p>
      ) : mode === "graph" ? (
        <div className="px-4 py-4">
          <ChartCanvas series={series} points={points} height={height} />
        </div>
      ) : (
        <UnderlyingTable series={series} points={points} onEditCell={onEditCell} />
      )}

      {/*
        The numbers behind the graph, for print only, and only when the report layout asks
        for them — see `includeChartTables`. Emitting them unconditionally doubled the
        length of the exported PDF and pushed every later section down a page.
      */}
      {printTable ? (
        <div className="print-only">
          <UnderlyingTable series={series} points={points} />
        </div>
      ) : null}
    </Block>
  );
}

function ToggleButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex h-6.5 items-center gap-1 rounded-md px-2 py-1 text-[12px] font-medium transition-colors ${
        active ? "bg-ink text-white" : "text-ink-muted hover:text-ink"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function ChartCanvas({
  series,
  points,
  height,
}: {
  series: Series[];
  points: ChartPoint[];
  height: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    const hasSecondary = series.some((s) => s.secondaryAxis);

    chartRef.current = new Chart(canvas, {
      data: {
        labels: points.map((p) => p.label),
        datasets: series.map((s) => ({
          type: s.type ?? "bar",
          label: s.label,
          data: points.map((p) => p.values[s.id] ?? null),
          backgroundColor: s.type === "line" ? "transparent" : s.color,
          borderColor: s.color,
          borderWidth: s.type === "line" ? 2 : 0,
          borderRadius: s.type === "line" ? 0 : 3,
          pointRadius: s.type === "line" ? 2.5 : 0,
          tension: 0.3,
          yAxisID: s.secondaryAxis ? "y1" : "y",
          spanGaps: true,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        layout: {
          // The v9 review found the margin line clipping the bottom of the canvas when
          // it went negative. Explicit padding keeps labels inside the printed chart.
          padding: { top: 8, bottom: 28, left: 4, right: 4 },
        },
        plugins: {
          legend: {
            position: "bottom",
            labels: { boxWidth: 10, boxHeight: 10, font: { size: 11 }, padding: 14 },
          },
          tooltip: {
            callbacks: {
              label: (context) => {
                const s = series[context.datasetIndex];
                return `${s?.label ?? ""}: ${byUnit(context.parsed.y, s?.unit)}`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { size: 10.5 }, color: "#667085" },
          },
          y: {
            // Scaled from the actual data range, including negatives, rather than
            // assuming a zero floor.
            grace: "12%",
            grid: { color: "#f2f4f7" },
            border: { display: false },
            ticks: {
              font: { size: 10.5 },
              color: "#667085",
              callback: (value) =>
                typeof value === "number" && Math.abs(value) >= 1000
                  ? `${Math.round(value / 1000)}K`
                  : String(value),
            },
          },
          ...(hasSecondary
            ? {
                y1: {
                  position: "right" as const,
                  grace: "20%",
                  grid: { display: false },
                  border: { display: false },
                  ticks: {
                    font: { size: 10.5 },
                    color: "#667085",
                    callback: (value: unknown) => `${value}%`,
                  },
                },
              }
            : {}),
        },
      },
    });

    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [series, points]);

  return (
    /*
      `chart-frame` lets the print stylesheet drop the fixed height. Chart.js needs a
      sized box on screen, but on paper the canvas is scaled down to the page width and
      the reserved height became a block of empty space beneath every chart.
    */
    <div className="chart-frame" style={{ height }}>
      <canvas ref={ref} />
    </div>
  );
}

function UnderlyingTable({
  series,
  points,
  onEditCell,
}: {
  series: Series[];
  points: ChartPoint[];
  onEditCell?: ChartCellEdit;
}) {
  const [editing, setEditing] = useState<{ period: string; id: string } | null>(null);

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12.5px]">
        <thead>
          <tr className="border-b border-line bg-line-soft/60">
            <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-faint">
              Period
            </th>
            {series.map((s) => (
              <th
                key={s.id}
                className="px-4 py-2 text-right text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-faint"
              >
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.period} className="border-b border-line-soft last:border-b-0">
              <td className="px-4 py-2 text-ink-muted">{point.label}</td>
              {series.map((s) => {
                const active =
                  editing?.period === point.period && editing?.id === s.id;
                const value = point.values[s.id] ?? null;
                return (
                  <td
                    key={s.id}
                    className={`num px-4 py-2 text-right text-ink ${
                      onEditCell ? "cursor-pointer hover:bg-line-soft/60" : ""
                    }`}
                    onDoubleClick={
                      onEditCell
                        ? () => setEditing({ period: point.period, id: s.id })
                        : undefined
                    }
                  >
                    {active && onEditCell ? (
                      <InlineEditor
                        initial={value === null ? "" : String(Number(value.toFixed(4)))}
                        align="right"
                        onCancel={() => setEditing(null)}
                        onCommit={async (next) => {
                          setEditing(null);
                          await onEditCell(point.period, s.id, next);
                        }}
                      />
                    ) : (
                      byUnit(value, s.unit)
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {onEditCell ? (
        <p className="no-print px-4 pb-3 pt-1 text-[11px] text-ink-faint">
          Double-click any figure to correct it for that month. Edits here are the same
          overrides as on the report, so both views stay in step.
        </p>
      ) : null}
    </div>
  );
}
