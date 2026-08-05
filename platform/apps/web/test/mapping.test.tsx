/**
 * Row mapping — multi-select, undo, and the promise that a mapping is permanent.
 *
 * All three come from the first beta. Mapping thirty rows one dropdown at a time was the
 * most-repeated complaint; mapping the wrong one was unreversible, because the row you
 * needed to fix was the one that had just vanished from the list; and nobody could tell
 * that a mapping survived to the next upload, so people re-did the same work every month
 * and reported it as the app forgetting.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { StagedFileCard } from "../src/app/components/UploadDialog.js";

afterEach(cleanup);

const ACCOUNTS = [
  { id: "pl.revenue", label: "Revenue", statement: "pl" },
  { id: "pl.overhead", label: "Overhead", statement: "pl" },
  { id: "bs.cash", label: "Cash", statement: "balance_sheet" },
] as never[];

function stagedFile() {
  return {
    sourceFileId: "sf_1",
    filename: "Profit and Loss.xlsx",
    error: null,
    classification: { reportType: "profit_and_loss", needsConfirmation: false, evidence: [] },
    preview: {
      periods: ["2025-08"],
      facts: [],
      ignoredColumns: [],
      warnings: [],
      unmatched: [
        { rawLabel: "Mitigation Supplies", normalizedLabel: "mitigation supplies", sampleValues: [{ period: "2025-08", value: 5_077.6 }] },
        { rawLabel: "Rebuild supplies", normalizedLabel: "rebuild supplies", sampleValues: [{ period: "2025-08", value: 5_324.62 }] },
        { rawLabel: "Uniforms", normalizedLabel: "uniforms", sampleValues: [{ period: "2025-08", value: 179.72 }] },
      ],
    },
  } as never;
}

function renderCard() {
  const onMapLabel = vi.fn();
  const onUnmapLabel = vi.fn();
  render(
    <StagedFileCard
      file={stagedFile()}
      accounts={ACCOUNTS}
      onMapLabel={onMapLabel}
      onUnmapLabel={onUnmapLabel}
      onChangeType={() => {}}
    />,
  );
  return { onMapLabel, onUnmapLabel };
}

describe("row mapping", () => {
  it("maps several selected rows to one account in a single action", async () => {
    const user = userEvent.setup();
    const { onMapLabel } = renderCard();

    await user.click(screen.getByLabelText("Select Mitigation Supplies"));
    await user.click(screen.getByLabelText("Select Rebuild supplies"));

    // The bulk control appears only once something is selected.
    await user.selectOptions(
      screen.getByLabelText("Account for selected rows"),
      "pl.overhead",
    );
    await user.click(screen.getByRole("button", { name: /Map 2/ }));

    expect(onMapLabel).toHaveBeenCalledTimes(2);
    expect(onMapLabel).toHaveBeenCalledWith("Mitigation Supplies", "pl.overhead");
    expect(onMapLabel).toHaveBeenCalledWith("Rebuild supplies", "pl.overhead");
    // The row that was not ticked is untouched.
    expect(onMapLabel).not.toHaveBeenCalledWith("Uniforms", expect.anything());
  });

  it("keeps a mapped row on screen and lets it be undone", async () => {
    const user = userEvent.setup();
    const { onMapLabel, onUnmapLabel } = renderCard();

    await user.selectOptions(
      screen.getByLabelText("Account for Mitigation Supplies"),
      "pl.overhead",
    );
    expect(onMapLabel).toHaveBeenCalledWith("Mitigation Supplies", "pl.overhead");

    // The defect: the row disappeared here, taking the only way to correct it.
    expect(screen.getByText("Mitigation Supplies")).toBeDefined();
    const undo = screen.getAllByRole("button", { name: "Undo" });
    expect(undo).toHaveLength(1);

    await user.click(undo[0]!);
    expect(onUnmapLabel).toHaveBeenCalledWith("Mitigation Supplies");
    // Back to a dropdown, so a different account can be chosen.
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("says a mapping applies to future uploads, not just this one", () => {
    renderCard();
    expect(
      screen.getByText(/applied automatically to next month's upload/i),
    ).toBeDefined();
  });

  it("counts down the rows still needing an account as they are mapped", async () => {
    const user = userEvent.setup();
    renderCard();

    expect(screen.getByText(/3 rows have no matching account/)).toBeDefined();
    await user.selectOptions(
      screen.getByLabelText("Account for Mitigation Supplies"),
      "pl.revenue",
    );
    expect(screen.getByText(/2 rows have no matching account/)).toBeDefined();
    expect(screen.getByText(/1 mapped/)).toBeDefined();
  });
});
