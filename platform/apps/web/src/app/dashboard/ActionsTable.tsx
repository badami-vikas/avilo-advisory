/**
 * Recommended actions, as a worklist.
 *
 * The actions themselves are derived on every render and never stored — a saved
 * recommendation would outlive the condition that produced it, and an advisor would find
 * themselves chasing a problem the client fixed two months ago. What *is* stored is the
 * human half: who owns it, when it is due, whether it has been started. Those are keyed
 * by the action's stable id, so a recomputed action finds its own assignment again.
 */

import { forwardRef, useCallback, useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";

import { api } from "../../lib/trpc.js";
import { Tip } from "../components/Tooltip.js";
import { InlineEditor } from "../components/DataTable.js";
import type { Action } from "./insights.js";
import { Panel } from "./parts.js";

type Status = "not_started" | "in_progress" | "done" | "dropped";

interface AssignmentRow {
  actionId: string;
  owner: string | null;
  dueDate: string | null;
  status: string;
}

const STATUS: { id: Status; label: string; className: string }[] = [
  { id: "not_started", label: "Not started", className: "border-line bg-surface text-ink-muted" },
  { id: "in_progress", label: "In progress", className: "border-accent/30 bg-accent-soft text-accent" },
  { id: "done", label: "Done", className: "border-positive/30 bg-[#ecfdf3] text-positive" },
  { id: "dropped", label: "Dropped", className: "border-line bg-line-soft text-ink-faint" },
];

const URGENCY: Record<Action["urgency"], { label: string; className: string }> = {
  high: { label: "High", className: "border-flag/25 bg-flag-soft text-flag" },
  medium: { label: "Medium", className: "border-warn/25 bg-[#fffaeb] text-warn" },
  low: { label: "Low", className: "border-line bg-line-soft text-ink-muted" },
};

const EFFORT: Record<Action["effort"], { label: string; className: string }> = {
  low: { label: "Low", className: "border-positive/25 bg-[#ecfdf3] text-positive" },
  medium: { label: "Medium", className: "border-warn/25 bg-[#fffaeb] text-warn" },
  high: { label: "High", className: "border-line bg-line-soft text-ink-muted" },
};

/**
 * The default due date: the period end plus however long the action can safely wait.
 *
 * Shown greyed until someone accepts or changes it, so the difference between "nobody has
 * decided" and "we decided the fifteenth" is visible on the page.
 */
function defaultDue(period: string, days: number): string {
  const [year, month] = period.split("-").map(Number);
  // Day 0 of the next month is the last day of this one — the period end.
  const base = new Date(Date.UTC(year!, month!, 0));
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

function formatDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function ActionsTable({
  actions,
  clientId,
  period,
  onGo,
  asAt,
}: {
  actions: Action[];
  clientId: string;
  period: string;
  onGo: (section: string) => void;
  asAt: string;
}) {
  const [assignments, setAssignments] = useState<Record<string, AssignmentRow>>({});
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(async () => {
    const rows = await api.actions.list.query({ clientId, period });
    setAssignments(Object.fromEntries(rows.map((row) => [row.actionId, row])));
  }, [clientId, period]);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = async (
    actionId: string,
    changes: { owner?: string | null; dueDate?: string | null; status?: Status },
  ) => {
    // Optimistic: these are one-click assignments on a list the user is looking at, and a
    // round-trip before the chip changes colour reads as a dead control.
    setAssignments((current) => ({
      ...current,
      [actionId]: {
        actionId,
        owner: null,
        dueDate: null,
        status: "not_started",
        ...current[actionId],
        ...changes,
      },
    }));
    await api.actions.set.mutate({ clientId, period, actionId, ...changes });
  };

  const open = actions.filter(
    (action) => (assignments[action.id]?.status ?? "not_started") !== "done",
  ).length;

  return (
    <Panel
      id="actions"
      title="Recommended actions"
      subtitle="Generated from this month's conditions. Assign an owner and a date to make them real."
      basis={`Month to ${asAt}`}
      summary={
        actions.length === 0
          ? "Nothing in this month's data calls for an intervention."
          : `${open} of ${actions.length} still open.`
      }
    >
      {actions.length === 0 ? (
        <p className="py-4 text-[12.5px] text-ink-muted">
          No condition in this month's data calls for an intervention. The useful work is
          keeping the imports current so a change is visible the month it happens.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[840px] border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-line">
                {[
                  ["Action", "left"],
                  ["Impact", "left"],
                  ["Urgency", "center"],
                  ["Effort", "center"],
                  ["Owner", "left"],
                  ["Due", "left"],
                  ["Status", "left"],
                ].map(([label, align]) => (
                  <th
                    key={label}
                    className={`px-2.5 py-2 text-[10px] font-semibold uppercase tracking-[0.07em] text-ink-faint text-${align}`}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {actions.map((action, index) => {
                const row = assignments[action.id];
                const status = (row?.status ?? "not_started") as Status;
                const due = row?.dueDate ?? defaultDue(period, action.dueInDays);
                const dueIsDefault = !row?.dueDate;

                return (
                  <tr
                    key={action.id}
                    className={`border-b border-line-soft last:border-b-0 ${
                      status === "done" || status === "dropped" ? "opacity-55" : ""
                    }`}
                  >
                    <td className="px-2.5 py-2.5 align-top">
                      <Tip content={action.why}>
                        <button
                          onClick={() => onGo(action.section)}
                          className="group flex items-start gap-2 text-left"
                        >
                          <span className="num mt-0.5 shrink-0 text-[11px] text-ink-faint">
                            {index + 1}.
                          </span>
                          <span
                            className={`font-medium text-ink group-hover:text-accent ${
                              status === "done" ? "line-through" : ""
                            }`}
                          >
                            {action.title}
                          </span>
                          <ArrowRight
                            size={12}
                            className="mt-1 shrink-0 text-ink-faint opacity-0 transition-opacity group-hover:opacity-100"
                          />
                        </button>
                      </Tip>
                    </td>

                    <td className="px-2.5 py-2.5 align-top text-[12px] text-positive">
                      {action.impact ?? (
                        <span className="text-ink-faint">Not quantifiable</span>
                      )}
                    </td>

                    <td className="px-2.5 py-2.5 text-center align-top">
                      <Tip
                        content={
                          action.urgency === "high"
                            ? "Gets more expensive the longer it waits."
                            : action.urgency === "medium"
                              ? "Worth doing this quarter."
                              : "No deadline pressure — do it when there is room."
                        }
                      >
                        <Chip {...URGENCY[action.urgency]} />
                      </Tip>
                    </td>

                    <td className="px-2.5 py-2.5 text-center align-top">
                      <Tip
                        content={
                          action.effort === "low"
                            ? "An afternoon."
                            : action.effort === "medium"
                              ? "A few days, and probably a conversation."
                              : "Structural — months, and a change in how the business runs."
                        }
                      >
                        <Chip {...EFFORT[action.effort]} />
                      </Tip>
                    </td>

                    <td className="px-2.5 py-2.5 align-top">
                      {editing === `${action.id}:owner` ? (
                        <InlineEditor
                          initial={row?.owner ?? ""}
                          onCancel={() => setEditing(null)}
                          onCommit={async (next) => {
                            setEditing(null);
                            await patch(action.id, { owner: next.trim() || null });
                          }}
                        />
                      ) : (
                        <Tip content="Double-click to assign">
                          <span
                            onDoubleClick={() => setEditing(`${action.id}:owner`)}
                            className="cursor-text rounded px-1 py-0.5 hover:bg-line-soft"
                          >
                            {row?.owner ?? (
                              <span className="italic text-ink-faint">Unassigned</span>
                            )}
                          </span>
                        </Tip>
                      )}
                    </td>

                    <td className="px-2.5 py-2.5 align-top">
                      <Tip
                        content={
                          dueIsDefault
                            ? "Suggested from how long this can safely wait. Pick a date to commit to it."
                            : "Double-click to change."
                        }
                      >
                        <input
                          type="date"
                          value={due}
                          onChange={(event) =>
                            void patch(action.id, { dueDate: event.target.value || null })
                          }
                          className={`num rounded border border-transparent bg-transparent px-1 py-0.5 text-[12px] outline-none hover:border-line focus:border-accent ${
                            dueIsDefault ? "text-ink-faint" : "text-ink"
                          }`}
                          aria-label={`Due date for ${action.title}`}
                        />
                      </Tip>
                      {!dueIsDefault ? (
                        <span className="sr-only">{formatDate(due)}</span>
                      ) : null}
                    </td>

                    <td className="px-2.5 py-2.5 align-top">
                      <select
                        value={status}
                        onChange={(event) =>
                          void patch(action.id, { status: event.target.value as Status })
                        }
                        aria-label={`Status of ${action.title}`}
                        className={`rounded-md border px-1.5 py-[3px] text-[11px] font-medium outline-none ${
                          STATUS.find((entry) => entry.id === status)?.className ?? ""
                        }`}
                      >
                        {STATUS.map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.label}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/**
 * Ref-forwarding, and not optionally.
 *
 * Every one of these is wrapped in a `Tip`, and Radix anchors a tooltip to the node its
 * trigger hands back through a ref. A plain function component swallows it, and the
 * tooltip either never positions or lands offscreen — the same defect the shared `Button`
 * was fixed for. Props are spread so Radix's own handlers reach the element.
 */
const Chip = forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement> & { label: string; className: string }
>(function Chip({ label, className, ...props }, ref) {
  return (
    <span
      ref={ref}
      {...props}
      className={`inline-flex rounded-md border px-1.5 py-[2px] text-[10.5px] font-semibold ${className}`}
    >
      {label}
    </span>
  );
});
