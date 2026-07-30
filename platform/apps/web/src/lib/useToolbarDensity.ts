import { useEffect, useRef, useState } from "react";

/**
 * How much of the toolbar can be shown at the current width.
 *
 * The toolbar must never wrap to a second line — a control row that reflows moves every
 * button under the cursor and pushes the table down the page. So instead of wrapping it
 * degrades in a fixed order, shedding the least useful thing first:
 *
 *   full     everything: labelled buttons, full-width search
 *   icons    button labels drop; the icons carry the meaning
 *   narrow   the search box gives up its remaining flexible width
 *   compact  secondary buttons move into the overflow menu, one at a time
 *
 * Measured from the container rather than the viewport, because the same toolbar renders
 * inside panels of different widths and a viewport media query would be wrong in all but
 * one of them.
 */
export type ToolbarDensity = "full" | "icons" | "narrow" | "compact";

const BREAKPOINTS: { min: number; density: ToolbarDensity }[] = [
  { min: 880, density: "full" },
  { min: 700, density: "icons" },
  { min: 560, density: "narrow" },
  { min: 0, density: "compact" },
];

export function densityForWidth(width: number): ToolbarDensity {
  return BREAKPOINTS.find((b) => width >= b.min)?.density ?? "compact";
}

/** True once the toolbar is at or below the given density. */
export function atMost(density: ToolbarDensity, limit: ToolbarDensity): boolean {
  const order: ToolbarDensity[] = ["full", "icons", "narrow", "compact"];
  return order.indexOf(density) >= order.indexOf(limit);
}

export function useToolbarDensity<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [density, setDensity] = useState<ToolbarDensity>("full");

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    // ResizeObserver rather than a window listener: the toolbar can be resized by a
    // sidebar opening or a panel changing, with no window resize event at all.
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (typeof width === "number") setDensity(densityForWidth(width));
    });
    observer.observe(element);
    setDensity(densityForWidth(element.getBoundingClientRect().width));

    return () => observer.disconnect();
  }, []);

  return { ref, density };
}
