import { useState } from "react";
import { Link, Outlet, useLocation } from "react-router";

import { TooltipProvider } from "./components/Tooltip.js";
import { AgentPanelBody, AgentPanelHeader } from "./components/shared/AgentPanel.js";

/**
 * Application shell.
 *
 * The landing screen is deliberately spare: the wordmark at top-left of the header, and
 * below it one section only — the client table. No sidebar yet; the left nav arrives
 * with the platform shell on integration.
 *
 * The assistant's collapse state lives here, not inside `AgentPanel`: `AgentPanelHeader`
 * (title + collapse toggle) renders in this same top `<header>`, beside "Avilo Advisory",
 * and `AgentPanelBody` (the conversation) renders below it, beside `<Outlet>` — one
 * header row for both, rather than the panel carrying its own second one.
 */
export function Shell() {
  const location = useLocation();
  const isDetail = location.pathname.startsWith("/client/");
  const [assistantCollapsed, setAssistantCollapsed] = useState(false);

  return (
    <TooltipProvider>
    <div className="flex min-h-full flex-col">
      <header className="no-print sticky top-0 z-30 flex h-14 items-stretch border-b border-line bg-surface/95 backdrop-blur">
        <div className="flex min-w-0 flex-1 items-center gap-3 px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-ink text-[13px] font-semibold text-white">
              A
            </span>
            <span className="text-[15px] font-semibold tracking-tight text-ink">
              Avilo Advisory
            </span>
          </Link>
          {isDetail ? (
            <>
              <span className="text-ink-faint">/</span>
              <Link
                to="/"
                className="text-[13px] text-ink-muted hover:text-ink"
              >
                Clients
              </Link>
            </>
          ) : null}
        </div>
        <AgentPanelHeader
          collapsed={assistantCollapsed}
          onToggle={() => setAssistantCollapsed((c) => !c)}
        />
      </header>

      {/*
        Header above, everything else below in one row: the main content and the
        assistant sit side by side, both starting where the header ends — the panel
        never floats over the header the way a `fixed` overlay would, and `<main>`
        shrinks to make room for it instead of running underneath.
      */}
      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1 overflow-y-auto px-6 py-6">
          <div className="mx-auto max-w-[1600px]">
            <Outlet />
          </div>
        </main>

        <AgentPanelBody collapsed={assistantCollapsed} />
      </div>
    </div>
    </TooltipProvider>
  );
}
