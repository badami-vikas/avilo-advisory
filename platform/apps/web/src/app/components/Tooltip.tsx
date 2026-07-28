import * as RadixTooltip from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

/**
 * Explanatory text lives in tooltips, not in extra rows.
 *
 * The dashboard is dense; a description under every field doubled the vertical space
 * and pushed the numbers apart. The explanation is still one hover away, and still
 * present in the accessibility tree.
 */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <RadixTooltip.Provider delayDuration={250} skipDelayDuration={200}>
      {children}
    </RadixTooltip.Provider>
  );
}

export function Tip({
  content,
  children,
  side = "top",
  asChild = true,
}: {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  asChild?: boolean;
}) {
  if (!content) return <>{children}</>;

  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild={asChild}>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={6}
          collisionPadding={12}
          className="no-print z-[60] max-w-xs rounded-lg bg-ink px-2.5 py-1.5 text-[11.5px] leading-relaxed text-white shadow-lg"
        >
          {content}
          <RadixTooltip.Arrow className="fill-ink" />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
