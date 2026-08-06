/**
 * The client half of the three arrangement levers (`dashboard`, `clientsTable`,
 * `landingTiles`) — order and visibility over a closed set of ids the app already builds.
 *
 * Why a hook rather than three bespoke loaders: the levers differ only in which
 * `app_settings` row they read and what the default is. Sharing the resolution means the
 * ordering rules — and the rule that matters, below — are stated once.
 *
 * **An unknown id is dropped, never rendered.** A stored arrangement can outlive the build
 * that wrote it: an advisor restores a version from an older installation, or imports a
 * blueprint from a colleague running a build with a panel this one does not have. The
 * server refuses an unknown id at propose time, but a *stored* row has already passed that
 * check against a different registry. So `resolve` intersects with the ids this build
 * actually has, and anything it does not recognise simply does not appear. The alternative
 * — rendering a placeholder for a panel that does not exist — puts something on screen that
 * traces to nothing, which is the one thing this app does not do.
 *
 * Ids the arrangement omits entirely are appended in their canonical order, so a new panel
 * shipped in a later build shows up for someone whose stored arrangement predates it rather
 * than silently vanishing.
 */
import { useCallback, useEffect, useState } from "react";
import type React from "react";
import { api } from "./trpc.js";

export interface Arrangement {
  order?: string[];
  hidden?: string[];
}

/** The visible ids, in order, for a build whose registry is `known`. */
export function resolve(
  arrangement: Arrangement | null,
  known: readonly string[],
  defaultHidden: readonly string[] = [],
): string[] {
  const valid = new Set(known);
  const ordered = (arrangement?.order ?? []).filter((id) => valid.has(id));
  const seen = new Set(ordered);
  // Anything the stored order never mentions keeps its canonical position at the end.
  const full = [...ordered, ...known.filter((id) => !seen.has(id))];
  const hidden = new Set(arrangement ? (arrangement.hidden ?? []) : defaultHidden);
  return full.filter((id) => !hidden.has(id));
}

/**
 * Read one arrangement, and re-read it when the assistant changes something.
 *
 * Returns `null` until the row has been read, so a caller can tell "not loaded yet" from
 * "loaded, and there is no override" — the difference between rendering nothing for a beat
 * and rendering the defaults.
 */
export function useArrangement(key: string): { value: Arrangement | null; loaded: boolean } {
  const [value, setValue] = useState<Arrangement | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const row = await api.settings.get.query({ key });
      setValue(row ? (JSON.parse(row.value) as Arrangement) : null);
    } catch {
      // A malformed or unreachable row falls back to the built-in defaults rather than
      // taking the page down. The same rule the custom-views loader follows.
      setValue(null);
    } finally {
      setLoaded(true);
    }
  }, [key]);

  useEffect(() => {
    void load();
    const reload = () => void load();
    window.addEventListener("avilo:configuration-changed", reload);
    window.addEventListener("focus", reload);
    return () => {
      window.removeEventListener("avilo:configuration-changed", reload);
      window.removeEventListener("focus", reload);
    };
  }, [load]);

  return { value, loaded };
}

/**
 * Where an id sits in the arrangement, as a CSS `order` value.
 *
 * Unmentioned ids get a large value so they fall to the end rather than jumping to the
 * front — a panel added in a later build appears after the arranged ones instead of
 * displacing them.
 */
export function orderOf(arrangement: Arrangement | null, id: string): number {
  const index = arrangement?.order?.indexOf(id) ?? -1;
  return index === -1 ? 999 : index;
}

export function isHidden(arrangement: Arrangement | null, id: string): boolean {
  return (arrangement?.hidden ?? []).includes(id);
}

/**
 * One arranged panel.
 *
 * Renders nothing when the arrangement hides it, and carries its position as CSS `order`
 * so the surrounding file can keep its panels written in reading order. `inGrid` omits the
 * wrapper's own layout classes for a panel that is already a grid cell.
 */
export function Slot({
  id,
  arrangement,
  children,
  inGrid,
}: {
  id: string;
  arrangement: Arrangement | null;
  children: React.ReactNode;
  inGrid?: boolean;
}) {
  if (isHidden(arrangement, id)) return null;
  return (
    <div style={{ order: orderOf(arrangement, id) }} className={inGrid ? undefined : "min-w-0"}>
      {children}
    </div>
  );
}
