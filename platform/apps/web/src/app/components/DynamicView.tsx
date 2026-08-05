/**
 * Generative UI: a view the assistant composed, rendered from approved components.
 *
 * The registry below is the entire vocabulary. `validateBlueprint` has already checked
 * every binding in the spec against the live registry before it could be stored, so by the
 * time a `CustomView` reaches this file every metric resolves, every series resolves, every
 * table names a real detail set and every button names a real action. That is why this
 * renderer has no defensive branches for unknown ids: an unknown id never becomes a stored
 * view, because the whole document is refused at validation.
 *
 * The load-bearing property is that a component spec carries BINDINGS, NEVER VALUES. A
 * metric names an account or formula and the figure is looked up from the same
 * `PeriodReport` the report view renders; a chart names series ids and the points come from
 * `report.series`. There is no field in `ViewComponent` a model could put a number in, so
 * CLAUDE.md's "never fabricate a figure" survives a generated interface intact — a figure
 * on a generated dashboard traces to an imported fact, an override or a formula exactly as
 * one on the built-in report does.
 *
 * `text` is the single exception, and it is prose rather than figures: rendered as text,
 * never as HTML, so there is no path from a model's output to markup on the page.
 */
import type { ReactNode } from "react";
import { BarChart3 } from "lucide-react";
import type { CustomView, ViewComponent } from "@avilo/core";
import type { DetailByKind, FormulaRow, PeriodReport, SeriesPoint } from "../types.js";
import { Block, Button, EmptyState, StatTile } from "./ui.js";
import { ChartBlock } from "./ChartBlock.js";
import { money, moneyFull, percent, days, count } from "../../lib/format.js";

export interface DynamicViewActions {
  "export-pdf": () => void;
  upload: () => void;
  "open-report": () => void;
  "open-raw-data": () => void;
  "open-dashboard": () => void;
  "open-standard": () => void;
}

const ACTION_LABELS: Record<keyof DynamicViewActions, string> = {
  "export-pdf": "Download PDF",
  upload: "Upload",
  "open-report": "Report view",
  "open-raw-data": "Raw data",
  "open-dashboard": "Interactive dashboard",
  "open-standard": "Standard view",
};

/**
 * Format by the unit the registry declares, not by guessing from magnitude.
 *
 * A metric binds to an id; that id's unit is already known to the report, so a percentage
 * renders as a percentage and a day count as days without the spec having to say so. A
 * model choosing the wrong format is therefore not a failure mode that exists.
 */
function formatByUnit(value: number | null, unit: string | undefined): string {
  if (value === null || value === undefined) return "Unknown";
  switch (unit) {
    case "percent":
      return percent(value);
    case "days":
      return days(value);
    case "count":
      return count(value);
    default:
      return money(value);
  }
}

/*
  A metric result carries no unit of its own — the unit lives on the formula row — so the
  registry is consulted for it rather than inferred from the number. That is what lets a
  margin render as a percentage and DSO as days without the view spec saying so, and it is
  why a model cannot pick the wrong format: it never picks one.
*/
function resolveValue(
  valueId: string,
  report: PeriodReport | null,
  formulas: FormulaRow[],
): { value: number | null; unit?: string; label: string } {
  const metric = report?.metrics.find((m) => m.id === valueId);
  if (metric) {
    const spec = formulas.find((f) => f.id === valueId);
    return {
      value: metric.value,
      ...(spec?.unit ? { unit: spec.unit } : {}),
      label: metric.label ?? valueId,
    };
  }
  const account = report?.accounts.find((a) => a.accountId === valueId);
  if (account) return { value: account.value, unit: account.unit, label: account.label };
  // Reachable only if a formula or account was deleted after the view was built.
  return { value: null, label: valueId };
}

function ComponentBody({
  spec,
  report,
  series,
  detail,
  formulas,
  actions,
}: {
  spec: ViewComponent;
  report: PeriodReport | null;
  series: SeriesPoint[];
  detail: DetailByKind;
  formulas: FormulaRow[];
  actions: DynamicViewActions;
}): ReactNode {
  switch (spec.type) {
    case "metric": {
      const resolved = resolveValue(spec.valueId, report, formulas);
      return (
        <StatTile
          icon={<BarChart3 size={15} />}
          label={spec.label || resolved.label}
          value={formatByUnit(resolved.value, resolved.unit)}
        />
      );
    }

    case "chart":
      return (
        <ChartBlock
          title={spec.label}
          subtitle="Every period imported for this client"
          points={series.map((p) => ({
            label: p.periodLabel,
            period: p.period,
            values: p.values,
          }))}
          series={spec.series.map((s: { id: string; label?: string; kind?: "bar" | "line" }, i: number) => ({
            id: s.id,
            label: s.label ?? resolveValue(s.id, report, formulas).label,
            unit: resolveValue(s.id, report, formulas).unit ?? "currency",
            type: s.kind ?? (i === 0 ? "bar" : "line"),
            color: ["#b2ddff", "#1570ef", "#12b76a", "#f79009", "#f04438"][i % 5]!,
          }))}
        />
      );

    case "table": {
      const rows = detail[spec.source] ?? [];
      return (
        <Block title={spec.label}>
          {rows.length === 0 ? (
            <EmptyState
              title="Nothing imported for this period"
              body="This table shows figures from the import once they are there."
            />
          ) : (
            <table className="w-full text-[12.5px]">
              <tbody>
                {rows.slice(0, 15).map((row, i) => (
                  <tr key={i} className="border-b border-line-soft last:border-0">
                    <td className="py-1.5 pr-3 text-ink">{row.label}</td>
                    <td className="num py-1.5 text-right text-ink">{moneyFull(row.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Block>
      );
    }

    case "text":
      return (
        <Block title={spec.label ?? "Note"}>
          {/* Plain text, deliberately — never dangerouslySetInnerHTML. */}
          <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink-muted">
            {spec.body}
          </p>
        </Block>
      );

    case "actions":
      return (
        <Block title={spec.label ?? "Actions"}>
          <div className="flex flex-wrap gap-2">
            {spec.buttons.map((id: string) => (
              <Button key={id} size="sm" onClick={actions[id as keyof DynamicViewActions]}>
                {ACTION_LABELS[id as keyof DynamicViewActions] ?? id}
              </Button>
            ))}
          </div>
        </Block>
      );
  }
}

export function DynamicView({
  view,
  report,
  series,
  detail,
  formulas,
  actions,
}: {
  view: CustomView;
  report: PeriodReport | null;
  series: SeriesPoint[];
  detail: DetailByKind;
  formulas: FormulaRow[];
  actions: DynamicViewActions;
}) {
  if (view.components.length === 0) {
    return (
      <EmptyState
        title={`"${view.label}" has no components yet`}
        body="Ask the assistant to add a chart, a metric or a table to it."
      />
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-[19px] font-semibold tracking-tight text-ink">{view.label}</h1>
      <div
        className={
          view.layout === "stack"
            ? "space-y-4"
            : "grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
        }
      >
        {view.components.map((spec: ViewComponent) => (
          // A chart earns the full width of a grid row; the small tiles do not.
          <div
            key={spec.id}
            className={view.layout === "grid" && spec.type === "chart" ? "md:col-span-2" : ""}
          >
            <ComponentBody
              spec={spec}
              report={report}
              series={series}
              detail={detail}
              formulas={formulas}
              actions={actions}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
