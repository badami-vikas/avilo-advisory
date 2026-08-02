import { ArrowDown, ArrowUp, Eye, EyeOff, RotateCcw } from "lucide-react";

import { Block } from "./ui.js";
import { Tip } from "./Tooltip.js";
import {
  defaultLayout,
  isExcluded,
  moveSection,
  sectionMeta,
  toggleExcluded,
  type ReportLayout,
  type ReportSectionId,
} from "../report/layout.js";

/**
 * The shape of the exported report, edited where the data is edited.
 *
 * Two separate decisions, kept visibly separate because conflating them is the mistake
 * this panel exists to prevent:
 *
 *   - **Order** applies to both the page and the PDF. Changing it is an editorial
 *     decision about the report, and a screen that disagreed with the paper about what
 *     follows what would make the working view useless as a preview.
 *   - **Include in report** applies to the PDF only. A section dropped from the export
 *     stays on the element page, marked — the advisor still reads it and still edits the
 *     figures in it. That is the difference between tailoring what a client sees and
 *     losing your own working copy of it.
 *
 * Nothing here deletes anything, so every change is reversible from this same list.
 */
export function ReportFormatPanel({
  layout,
  onChange,
}: {
  layout: ReportLayout;
  onChange: (next: ReportLayout) => void;
}) {
  const excludedCount = layout.excludedFromPrint.length;

  const move = (id: ReportSectionId, direction: -1 | 1) =>
    onChange(moveSection(layout, id, direction));

  return (
    <Block
      title="Report format"
      subtitle="What the exported PDF contains, and in what order"
      actions={
        <button
          onClick={() => onChange(defaultLayout())}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium text-ink-muted transition-colors hover:bg-line-soft hover:text-ink"
        >
          <RotateCcw size={12} />
          Reset to default
        </button>
      }
    >
      <div className="border-b border-line-soft px-5 py-2.5 text-[11.5px] text-ink-muted">
        {excludedCount === 0
          ? "Every section is included in the export."
          : `${excludedCount} section${excludedCount === 1 ? "" : "s"} hidden from the export — still shown on this client's page, and restorable here.`}
      </div>

      <label className="flex cursor-pointer items-start gap-2.5 border-b border-line-soft px-5 py-3 hover:bg-line-soft/40">
        <input
          type="checkbox"
          checked={layout.includeChartTables}
          onChange={(event) =>
            onChange({ ...layout, includeChartTables: event.target.checked })
          }
          className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[#1570ef]"
        />
        <span className="min-w-0">
          <span className="block text-[12.5px] font-medium text-ink">
            Print the figures behind each chart
          </span>
          <span className="block text-[11px] text-ink-faint">
            Adds a table of the underlying months beneath every graph. Off by default —
            it roughly doubles the length of the report.
          </span>
        </span>
      </label>

      <ol className="divide-y divide-line-soft">
        {layout.order.map((id, index) => {
          const meta = sectionMeta(id);
          const hidden = isExcluded(layout, id);
          return (
            <li key={id} className="flex items-center gap-3 px-5 py-2.5">
              <span className="num w-5 shrink-0 text-[11px] text-ink-faint">
                {index + 1}
              </span>

              <span className="min-w-0 flex-1">
                <span
                  className={`block truncate text-[12.5px] font-medium ${
                    hidden ? "text-ink-faint line-through" : "text-ink"
                  }`}
                >
                  {meta.label}
                </span>
                <span className="block truncate text-[11px] text-ink-faint">
                  {meta.hint}
                </span>
              </span>

              <span className="flex shrink-0 items-center gap-0.5">
                <Tip content="Move up">
                  <button
                    onClick={() => move(id, -1)}
                    disabled={index === 0}
                    aria-label={`Move ${meta.label} up`}
                    className="grid h-7 w-7 place-items-center rounded-md text-ink-faint transition-colors hover:bg-line-soft hover:text-ink disabled:pointer-events-none disabled:opacity-30"
                  >
                    <ArrowUp size={13} />
                  </button>
                </Tip>
                <Tip content="Move down">
                  <button
                    onClick={() => move(id, 1)}
                    disabled={index === layout.order.length - 1}
                    aria-label={`Move ${meta.label} down`}
                    className="grid h-7 w-7 place-items-center rounded-md text-ink-faint transition-colors hover:bg-line-soft hover:text-ink disabled:pointer-events-none disabled:opacity-30"
                  >
                    <ArrowDown size={13} />
                  </button>
                </Tip>
                <Tip
                  content={
                    hidden
                      ? "Hidden from the exported PDF. Click to put it back."
                      : "Included in the exported PDF. Click to leave it out — it stays on this page."
                  }
                >
                  <button
                    onClick={() => onChange(toggleExcluded(layout, id))}
                    aria-label={`${hidden ? "Include" : "Exclude"} ${meta.label}`}
                    aria-pressed={!hidden}
                    className="ml-1 grid h-7 w-7 place-items-center rounded-md transition-colors hover:bg-line-soft"
                  >
                    {hidden ? (
                      <EyeOff size={14} className="text-ink-faint" />
                    ) : (
                      <Eye size={14} className="text-accent" />
                    )}
                  </button>
                </Tip>
              </span>
            </li>
          );
        })}
      </ol>
    </Block>
  );
}
