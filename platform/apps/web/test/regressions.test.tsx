/**
 * Regression tests for the three UI defects found by hand during the build.
 *
 * Each of these shipped, and each was caught only because someone happened to click the
 * right thing. That is the argument for this file: they are all cheap to assert once the
 * component is rendered, and none of them would have survived a single run.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createRef } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Button } from "../src/app/components/ui.js";
import { DataTable } from "../src/app/components/DataTable.js";
import { parseFigure } from "../src/lib/format.js";
import {
  DEFAULT_ORDER,
  defaultLayout,
  isHidden,
  moveSection,
  normalizeLayout,
  reorderSection,
  toggleHidden,
} from "../src/app/report/layout.js";
import { visibleColumns, defaultViewConfig, type ColumnSpec } from "@avilo/tables";

// `globals: false` keeps the vitest API explicit, which also means testing-library's
// automatic teardown is never registered — without this each render stacks on the last
// and a getByRole finds two buttons.
afterEach(cleanup);

describe("Button forwards its ref", () => {
  /**
   * The defect: Button was a plain function component, so Radix's `asChild` received no
   * element to anchor to. Popovers opened, took focus, and rendered offscreen at
   * translate(0, -200%) — invisible, with no error anywhere.
   */
  it("hands the underlying <button> back through a ref", () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>Columns</Button>);

    expect(ref.current).not.toBeNull();
    expect(ref.current?.tagName).toBe("BUTTON");
    // Radix measures the anchor to place a panel; an element with no box cannot be
    // positioned, which is the shape the original bug took.
    expect(typeof ref.current?.getBoundingClientRect).toBe("function");
  });

  it("still renders its children and forwards handlers", () => {
    render(<Button aria-label="Columns">Columns</Button>);
    expect(screen.getByRole("button", { name: "Columns" })).toBeDefined();
  });
});

describe("hidden columns are applied, not merely stored", () => {
  /**
   * The defect: `view.hiddenColumns` was persisted in saved views and read by the
   * toolbar, but the table rendered its `columns` prop directly. Hiding a column
   * appeared to do nothing, and the setting survived a reload while never taking effect.
   */
  const columns: ColumnSpec[] = [
    { id: "name", label: "Client", kind: "text" },
    { id: "revenue", label: "Revenue", kind: "number" },
    { id: "owner", label: "Owner", kind: "text" },
  ];

  it("drops a hidden column from the rendered set", () => {
    const view = { ...defaultViewConfig("t"), hiddenColumns: ["revenue"] };
    expect(visibleColumns({ id: "t", columns }, view).map((c) => c.id)).toEqual([
      "name",
      "owner",
    ]);
  });

  it("returns every column when none is hidden", () => {
    const view = defaultViewConfig("t");
    expect(visibleColumns({ id: "t", columns }, view)).toHaveLength(3);
  });

  it("honours an explicit column order", () => {
    const view = {
      ...defaultViewConfig("t"),
      columnOrder: ["owner", "name", "revenue"],
    };
    expect(visibleColumns({ id: "t", columns }, view).map((c) => c.id)).toEqual([
      "owner",
      "name",
      "revenue",
    ]);
  });

  it("survives a hidden id that no longer exists", () => {
    // A saved list outlives the column it was hiding; it must not throw or blank the
    // table when the schema moves on.
    const view = { ...defaultViewConfig("t"), hiddenColumns: ["deleted_column"] };
    expect(visibleColumns({ id: "t", columns }, view)).toHaveLength(3);
  });
});

describe("units come from the formula, not from the id", () => {
  /**
   * The defect: the metric card inferred its unit — "_pct" means percent, one specific
   * id means days, everything else is currency — so DSO rendered as "$8.82" the moment
   * it was added. Every new formula was a dollar sign until someone remembered to edit
   * a branch in the view.
   */
  const unitFor = (
    id: string,
    formulas: { id: string; unit: string }[],
  ): string =>
    formulas.find((f) => f.id === id)?.unit ??
    (id.endsWith("_pct") ? "percent" : "currency");

  const formulas = [
    { id: "dso", unit: "days" },
    { id: "dpo", unit: "days" },
    { id: "gross_margin_pct", unit: "percent" },
    { id: "gross_profit", unit: "currency" },
  ];

  it("reads days from the registry for an id that ends in neither _pct nor a known name", () => {
    expect(unitFor("dso", formulas)).toBe("days");
    expect(unitFor("dpo", formulas)).toBe("days");
  });

  it("still reads percent and currency correctly", () => {
    expect(unitFor("gross_margin_pct", formulas)).toBe("percent");
    expect(unitFor("gross_profit", formulas)).toBe("currency");
  });

  it("falls back sensibly for an account that has no formula", () => {
    expect(unitFor("pl.revenue", formulas)).toBe("currency");
    expect(unitFor("some_margin_pct", formulas)).toBe("percent");
  });
});

describe("double-click edits a cell instead of opening the row", () => {
  /**
   * The defect: every cell called `onRowClick` on click and `setEditing` on double-click.
   * The first click of a double-click therefore navigated, the row unmounted, and the
   * second click landed on a page that had replaced the table — so double-click-to-edit
   * looked like it was being treated as a single click. `stopPropagation` in the
   * double-click handler could not help: the navigation was already requested.
   *
   * The fix holds an editable cell's row-open back long enough for a second click to
   * cancel it. These tests pin both halves — the editor must open, and the row must NOT.
   */
  const columns: ColumnSpec[] = [
    { id: "name", label: "Client", kind: "text" },
    { id: "period", label: "Period", kind: "text" },
  ];

  interface Row {
    id: string;
    name: string;
    period: string;
  }

  const rows: Row[] = [{ id: "c1", name: "Phoenix", period: "Oct 2024" }];

  function setup() {
    const opened: Row[] = [];
    const edits: string[] = [];
    render(
      <DataTable<Row>
        columns={columns}
        renderers={{
          name: {
            value: (row) => row.name,
            editValue: (row) => row.name,
            onEdit: (_row, next) => void edits.push(next),
          },
          period: { value: (row) => row.period },
        }}
        rows={rows}
        view={defaultViewConfig("t")}
        rowKey={(row) => row.id}
        onRowClick={(row) => opened.push(row)}
        emptyState={<span>none</span>}
        showFooter={false}
      />,
    );
    return { opened, edits };
  }

  it("opens the editor on an editable cell and does not open the row", async () => {
    const { opened } = setup();

    await userEvent.dblClick(screen.getByText("Phoenix"));

    // Plain property rather than jest-dom's toHaveValue: this suite deliberately has no
    // custom matchers installed.
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("Phoenix");
    expect(opened).toEqual([]);
  });

  it("still opens the row from a cell that has nothing to edit", async () => {
    const { opened } = setup();

    await userEvent.click(screen.getByText("Oct 2024"));

    /**
     * The grace period is uniform across the table, including read-only cells.
     *
     * An earlier version exempted them, which opened the row instantly in some columns
     * and after a beat in others — that reads as lag rather than as a rule. It also made
     * the timing depend on whether a column happened to be editable, so making one
     * editable silently changed how every other cell in it behaved.
     */
    expect(opened).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(opened).toHaveLength(1);
    expect(opened[0]!.id).toBe("c1");
  });

  it("treats a cell as read-only when canEdit rejects the row", async () => {
    const opened: Row[] = [];
    render(
      <DataTable<Row>
        columns={columns}
        renderers={{
          name: {
            value: (row) => row.name,
            editValue: (row) => row.name,
            onEdit: () => {},
            // A period figure with no period to write to: the commit would be dropped,
            // so the editor must never appear in the first place.
            canEdit: () => false,
          },
          period: { value: (row) => row.period },
        }}
        rows={rows}
        view={defaultViewConfig("t")}
        rowKey={(row) => row.id}
        onRowClick={(row) => opened.push(row)}
        emptyState={<span>none</span>}
        showFooter={false}
      />,
    );

    await userEvent.dblClick(screen.getByText("Phoenix"));

    expect(screen.queryByRole("textbox")).toBeNull();
  });
});

describe("figures are parsed the way people type them", () => {
  it("accepts currency, thousands separators and accounting negatives", () => {
    expect(parseFigure("$1,234.56")).toBe(1234.56);
    expect(parseFigure("(1,250)")).toBe(-1250);
    expect(parseFigure("41.8%")).toBe(41.8);
  });

  /**
   * Throwing matters more than it looks: a silently-zeroed figure is the worst possible
   * outcome of a typo in an accounting application.
   */
  it("refuses what is not a number rather than yielding NaN or 0", () => {
    expect(() => parseFigure("abc")).toThrow();
    expect(() => parseFigure("")).toThrow();
  });
});

describe("report layout survives sections coming and going", () => {
  /**
   * A stored layout outlives the build that wrote it. Both directions have to be safe:
   * a section this build no longer has must not leave a hole, and one it has *gained*
   * must not be invisible just because an older layout never listed it. Either failure
   * is silent — the section simply is not on the page — which is the argument for
   * pinning it here.
   */
  it("appends sections a stored layout has never heard of, in default position", () => {
    const stored = { order: ["flags", "key-insights"], excludedFromPrint: [] };
    const layout = normalizeLayout(stored as never);

    expect(layout.order.slice(0, 2)).toEqual(["flags", "key-insights"]);
    expect([...layout.order].sort()).toEqual([...DEFAULT_ORDER].sort());
  });

  it("drops ids the registry no longer has, and de-duplicates", () => {
    const stored = {
      order: ["key-insights", "a-section-that-was-deleted", "key-insights", "flags"],
      hidden: ["gone-too", "flags", "flags"],
    };
    const layout = normalizeLayout(stored as never);

    expect(layout.order.filter((id) => id === "key-insights")).toHaveLength(1);
    expect(layout.order).not.toContain("a-section-that-was-deleted");
    expect(layout.hidden).toEqual(["flags"]);
  });

  /**
   * `hidden` was called `excludedFromPrint`. Every layout an advisor has already saved
   * uses the old key, and reading it as absent would silently restore every section they
   * had taken out — a client-facing document quietly growing sections back.
   */
  it("reads a layout written under the old key", () => {
    const layout = normalizeLayout({
      order: [...DEFAULT_ORDER],
      excludedFromPrint: ["top-customers"],
    } as never);

    expect(layout.hidden).toEqual(["top-customers"]);
  });

  it("round-trips hiding a section and restoring it", () => {
    const base = defaultLayout();
    const hidden = toggleHidden(base, "top-customers");

    expect(isHidden(hidden, "top-customers")).toBe(true);
    // Still in the order — hidden is not deleted, and restoring must put it back where
    // it was rather than at the end.
    expect(hidden.order).toContain("top-customers");
    expect(isHidden(toggleHidden(hidden, "top-customers"), "top-customers")).toBe(false);
  });

  /**
   * What a drag means. The forward case is the one that breaks: splice the section out
   * first and the target index shifts, so a naive insert lands one place short.
   */
  it("drops a section immediately before its target, in both directions", () => {
    const base = defaultLayout();
    const [first, second, third] = base.order as [string, string, string];

    const back = reorderSection(base, third as never, first as never);
    expect(back.order.slice(0, 3)).toEqual([third, first, second]);

    const forward = reorderSection(base, first as never, third as never);
    expect(forward.order.slice(0, 2)).toEqual([second, first]);

    // A null target means the end.
    expect(reorderSection(base, first as never, null).order.at(-1)).toBe(first);
    // Length is never allowed to change: nothing is deleted by moving it.
    expect(back.order).toHaveLength(base.order.length);
  });

  it("moves a section without losing it, and refuses to move past either end", () => {
    const base = defaultLayout();
    const first = base.order[0]!;

    const moved = moveSection(base, first, 1);
    expect(moved.order[1]).toBe(first);
    expect(moved.order).toHaveLength(base.order.length);

    // Already at the top: a no-op, not a wrap to the bottom.
    expect(moveSection(base, first, -1).order).toEqual(base.order);
  });
});
