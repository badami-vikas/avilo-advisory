/**
 * Shared furniture for the dashboard.
 *
 * The report view is a document: static blocks, read top to bottom. The dashboard is a
 * place to ask questions of the same numbers, so its parts all behave the same way —
 * hover explains, click opens, sections collapse. Keeping that behaviour in one file is
 * what stops twelve sections from each inventing their own idea of a card.
 */

import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, Info, Minus, TrendingDown, TrendingUp, Upload, X } from "lucide-react";

import { Tip } from "../components/Tooltip.js";
import { useUpload } from "../components/upload-context.js";
import type { Movement, Severity } from "./insights.js";

/* ----------------------------------------------------------------- panel */

/**
 * A collapsible dashboard section.
 *
 * Open by default and collapsible rather than closed by default and expandable: the
 * advisor scrolling the page wants to see the analysis, and someone who has read a
 * section wants it out of the way. Collapse state lives here rather than in the parent
 * because nothing else needs to know.
 */
export function Panel({
  id,
  title,
  subtitle,
  summary,
  actions,
  children,
  defaultOpen = true,
  lead,
  basis,
  /** Shown in the header when the section has a finding worth surfacing collapsed. */
  badge,
}: {
  id: string;
  title: string;
  /** What the section measures. Shown while it is open. */
  subtitle?: string;
  /**
   * What the section *found*, in one line. Shown when it is collapsed.
   *
   * A collapsed section repeating its own definition tells the reader nothing they did
   * not know from the title. The finding is the reason to open it — or the reason not to.
   */
  summary?: string;
  actions?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  /** A small visual immediately left of the badge — a gauge, a swatch. */
  lead?: ReactNode;
  /**
   * What period these figures cover, when it is not the selected month.
   *
   * The month picker moves the profit & loss. It does not move a balance, which is a
   * date, or a customer ranking, which is a year. Sections whose basis differs say so in
   * their own header rather than leaving the reader to infer it from the toolbar.
   */
  basis?: string;
  badge?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section
      id={id}
      // Anchored navigation lands the heading below the sticky toolbar rather than
      // underneath it.
      className="scroll-mt-24 rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgba(16,24,40,0.04)]"
    >
      <header className="flex items-start gap-3 border-b border-line-soft px-5 py-3.5">
        <button
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="mt-0.5 shrink-0 rounded text-ink-faint transition-transform hover:text-ink"
          style={{ transform: open ? "rotate(0deg)" : "rotate(-90deg)" }}
          aria-label={open ? `Collapse ${title}` : `Expand ${title}`}
        >
          <ChevronDown size={15} />
        </button>
        <button
          onClick={() => setOpen((value) => !value)}
          className="min-w-0 flex-1 text-left"
        >
          <h2 className="text-[13.5px] font-semibold tracking-tight text-ink">{title}</h2>
          {open ? (
            subtitle ? (
              <p className="mt-0.5 text-[11.5px] text-ink-muted">{subtitle}</p>
            ) : null
          ) : summary ? (
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-muted">
              {summary}
            </p>
          ) : subtitle ? (
            <p className="mt-0.5 text-[11.5px] text-ink-muted">{subtitle}</p>
          ) : null}
        </button>
        {basis ? (
          <span className="shrink-0 rounded-md border border-line bg-line-soft px-1.5 py-[2px] text-[10.5px] font-medium text-ink-muted">
            {basis}
          </span>
        ) : null}
        {lead ? <div className="shrink-0">{lead}</div> : null}
        {badge ? <div className="shrink-0">{badge}</div> : null}
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </header>
      {open ? <div className="px-5 py-4">{children}</div> : null}
    </section>
  );
}

/* -------------------------------------------------------------- kpi card */

const TONE: Record<"positive" | "negative" | "neutral", string> = {
  positive: "text-positive",
  negative: "text-flag",
  neutral: "text-ink-muted",
};

/**
 * One headline figure, its movement, and what it means.
 *
 * Three layers, as specified: the number at rest, the explanation on hover, the working
 * on click. The hover text says what the figure *is* rather than repeating it — a tooltip
 * that reads "Revenue: $482,000" over a card that reads "$482,000" is noise.
 */
export function KpiCard({
  label,
  value,
  movement,
  unit,
  hint,
  onOpen,
  tone,
}: {
  label: string;
  value: string;
  movement?: Movement;
  unit?: string;
  hint: string;
  onOpen?: () => void;
  /** Overrides the direction-derived colour, for figures where up is not good. */
  tone?: "positive" | "negative" | "neutral";
}) {
  const direction = movement?.direction ?? "unknown";
  const derived =
    direction === "up" ? "positive" : direction === "down" ? "negative" : "neutral";
  const resolved = tone ?? derived;

  const Icon =
    direction === "up" ? TrendingUp : direction === "down" ? TrendingDown : Minus;

  return (
    <Tip content={hint}>
      <button
        onClick={onOpen}
        disabled={!onOpen}
        className="group flex w-full flex-col items-start rounded-xl border border-line bg-surface px-4 py-3.5 text-left transition-all hover:border-ink-faint hover:shadow-[0_2px_8px_rgba(16,24,40,0.07)] disabled:cursor-default disabled:hover:border-line disabled:hover:shadow-none"
      >
        <span className="flex w-full items-center gap-1.5">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-ink-faint">
            {label}
          </span>
          <Info
            size={11}
            className="text-ink-faint opacity-0 transition-opacity group-hover:opacity-100"
          />
        </span>
        <span className="num mt-1 text-[22px] font-semibold tracking-tight text-ink">
          {value}
        </span>
        {movement && movement.direction !== "unknown" ? (
          <span
            className={`mt-0.5 inline-flex items-center gap-1 text-[11.5px] font-medium ${TONE[resolved]}`}
          >
            <Icon size={12} />
            {movement.changePct === null
              ? "no comparable month"
              : `${movement.changePct >= 0 ? "+" : ""}${movement.changePct.toFixed(1)}%${
                  unit === "percent" && movement.change !== null
                    ? ` (${movement.change >= 0 ? "+" : ""}${movement.change.toFixed(1)} pts)`
                    : ""
                }`}
            <span className="font-normal text-ink-faint">vs last month</span>
          </span>
        ) : (
          <span className="mt-0.5 text-[11.5px] text-ink-faint">
            No prior month to compare
          </span>
        )}
      </button>
    </Tip>
  );
}

/* ---------------------------------------------------------------- drill */

/**
 * The working behind a figure.
 *
 * Opened from a KPI card. This is the layer that makes the dashboard trustworthy rather
 * than merely attractive: a client asking "where does that come from" gets the inputs,
 * the arithmetic and the source file, not an assurance.
 */
export function Drill({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  // Escape closes. A modal that can only be dismissed by finding the button is a modal
  // people learn to avoid opening.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
      className="no-print fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-6 backdrop-blur-[2px]"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="max-h-[82vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-surface shadow-xl"
      >
        <header className="sticky top-0 flex items-start justify-between gap-4 border-b border-line bg-surface px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h2>
            {subtitle ? (
              <p className="mt-0.5 text-[12px] text-ink-muted">{subtitle}</p>
            ) : null}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-lg p-1 text-ink-muted hover:bg-line-soft hover:text-ink"
          >
            <X size={17} />
          </button>
        </header>
        <div className="space-y-4 px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

/** A labelled line inside a drill-down — the inputs to an arithmetic. */
export function DrillRow({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line-soft py-2 last:border-b-0">
      <span className="min-w-0 text-[12.5px] text-ink-muted">
        {label}
        {note ? <span className="ml-1.5 text-[11px] text-ink-faint">{note}</span> : null}
      </span>
      <span className="num shrink-0 text-[13px] font-medium text-ink">{value}</span>
    </div>
  );
}

/* ------------------------------------------------------------- severity */

const SEVERITY_STYLE: Record<Severity, { dot: string; chip: string; word: string }> = {
  critical: { dot: "bg-flag", chip: "border-flag/25 bg-flag-soft text-flag", word: "Critical" },
  warning: { dot: "bg-warn", chip: "border-warn/25 bg-[#fffaeb] text-warn", word: "Warning" },
  watch: { dot: "bg-ink-faint", chip: "border-line bg-line-soft text-ink-muted", word: "Watch" },
};

export function SeverityChip({ severity }: { severity: Severity }) {
  const style = SEVERITY_STYLE[severity];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-[3px] text-[10.5px] font-semibold uppercase tracking-[0.05em] ${style.chip}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
      {style.word}
    </span>
  );
}

/* --------------------------------------------------------------- misc */

/**
 * What is missing, and what would fix it.
 *
 * Every section can be empty, because every section depends on a file the advisor may not
 * have imported yet. Saying which file turns a dead panel into a task.
 */
export function NeedsData({ what, upload }: { what: string; upload: string }) {
  const openImporter = useUpload();

  const body = (
    <>
      <p className="text-[12.5px] font-medium text-ink">{what}</p>
      <p className="mt-1 text-[12px] text-ink-muted">
        Import {upload} to fill this in.
      </p>
    </>
  );

  if (!openImporter) {
    return (
      <div className="rounded-lg border border-dashed border-line bg-canvas px-4 py-6 text-center">
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={openImporter}
      className="group flex w-full flex-col items-center rounded-lg border border-dashed border-line bg-canvas px-4 py-6 text-center transition-colors hover:border-accent hover:bg-accent-soft/40"
    >
      {body}
      <span className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1 text-[11.5px] font-medium text-ink-muted transition-colors group-hover:border-accent group-hover:text-accent">
        <Upload size={12} />
        Choose files
      </span>
    </button>
  );
}

/** A small statement of what a chart is saying, under the chart. */
export function Finding({ children }: { children: ReactNode }) {
  return (
    <p className="mt-3 border-l-2 border-accent/40 bg-accent-soft/40 py-2 pl-3 pr-2 text-[12.5px] leading-relaxed text-ink">
      {children}
    </p>
  );
}
