import clsx from "clsx";
import { forwardRef, type ReactNode } from "react";

/**
 * A visible block. The page is deliberately composed of separated, titled cards rather
 * than one continuous scroll, so each section can be read on its own.
 */
export function Block({
  title,
  subtitle,
  actions,
  children,
  className,
  printHideIfEmpty,
}: {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /**
   * Drop this block from print output when the section has nothing in it. See the
   * `[data-print-empty]` rule in app.css — the block still renders normally on screen,
   * where the empty state tells the advisor what to upload.
   */
  printHideIfEmpty?: boolean;
}) {
  return (
    <section
      data-print-empty={printHideIfEmpty ? "true" : undefined}
      className={clsx(
        "block-card rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgba(16,24,40,0.04)]",
        className,
      )}
    >
      {title ? (
        <div className="flex items-start justify-between gap-4 border-b border-line-soft px-5 py-3.5">
          <div>
            <h2 className="text-[13px] font-semibold tracking-tight text-ink">
              {title}
            </h2>
            {subtitle ? (
              <p className="mt-0.5 text-[11.5px] text-ink-muted">{subtitle}</p>
            ) : null}
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/**
 * Ref-forwarding is not optional here.
 *
 * Radix anchors a popover or menu to the DOM node its trigger hands back through a ref.
 * A plain function component swallows that ref, so Radix has nothing to measure and
 * parks the panel offscreen at translate(0, -200%) — open, focusable, and invisible.
 * Every `<Popover.Trigger asChild><Button/>` in the app depends on this.
 */
export const Button = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "primary" | "secondary" | "ghost" | "danger";
    size?: "sm" | "md";
  }
>(function Button({ variant = "secondary", size = "md", className, ...props }, ref) {
  return (
    <button
      ref={ref}
      {...props}
      className={clsx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-7 px-2.5 text-[12px]" : "h-9 px-3.5 text-[13px]",
        variant === "primary" &&
          "bg-accent text-white hover:bg-[#1160d4] shadow-[0_1px_2px_rgba(16,24,40,0.08)]",
        variant === "secondary" &&
          "border border-line bg-surface text-ink hover:bg-line-soft",
        variant === "ghost" && "text-ink-muted hover:bg-line-soft hover:text-ink",
        variant === "danger" &&
          "border border-flag/30 bg-flag-soft text-flag hover:bg-flag/10",
        className,
      )}
    />
  );
});

/** A stat tile, as in the reference table screenshot. */
export function StatTile({
  icon,
  label,
  value,
  tone = "neutral",
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tone?: "neutral" | "flag";
}) {
  return (
    <div className="flex min-w-[150px] items-center gap-3 rounded-xl border border-line bg-surface px-3.5 py-2.5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <span
        className={clsx(
          "grid h-8 w-8 shrink-0 place-items-center rounded-lg",
          tone === "flag" ? "bg-flag-soft text-flag" : "bg-line-soft text-ink-muted",
        )}
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[9.5px] font-semibold uppercase tracking-[0.07em] text-ink-faint">
          {label}
        </span>
        <span
          className={clsx(
            "num block text-[17px] font-semibold leading-tight tracking-tight",
            tone === "flag" ? "text-flag" : "text-ink",
          )}
        >
          {value}
        </span>
      </span>
    </div>
  );
}

/** Empty state: honest and metadata-generated, never dummy rows. */
export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="px-5 py-12 text-center">
      <p className="text-[13px] font-medium text-ink">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-[12.5px] leading-relaxed text-ink-muted">
        {body}
      </p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 px-5 py-10 text-[12.5px] text-ink-muted">
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-line border-t-ink-muted" />
      {label ?? "Loading…"}
    </div>
  );
}
