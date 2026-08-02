import { useState } from "react";

import { InlineEditor } from "./DataTable.js";
import { Tip } from "./Tooltip.js";
import type { ClientRecord } from "../types.js";

/**
 * The client's own record, at the top of its element page.
 *
 * Everything here was previously read-only: the name was an `<h1>` of plain text, and
 * legal name, industry, fiscal-year start and notes had no UI at all — they existed in
 * the schema and in the update mutation, and the only way to reach them was the list
 * table, which does not show them either. A field that can be stored and cannot be typed
 * is a field the user will assume was lost.
 *
 * Same gesture as everywhere else in the app: double-click, type, Enter.
 */

export const CLIENT_STAGES = ["Onboarding", "Active", "Review", "Dormant"];

type Field = {
  id: string;
  label: string;
  value: (client: ClientRecord) => string;
  /** What the editor starts with — differs from `value` wherever the display is prettied. */
  edit?: (client: ClientRecord) => string;
  options?: string[];
  /** Turn the typed string into the shape the mutation expects. */
  parse?: (raw: string) => string | number | null;
  placeholder: string;
};

const FIELDS: Field[] = [
  {
    id: "legalName",
    label: "Legal name",
    value: (c) => c.legalName ?? "",
    placeholder: "Add legal name",
  },
  {
    id: "stage",
    label: "Stage",
    value: (c) => c.stage,
    options: CLIENT_STAGES,
    placeholder: "Set stage",
  },
  {
    id: "industry",
    label: "Industry",
    value: (c) => c.industry ?? "",
    placeholder: "Add industry",
  },
  /*
    No `owner` or `fiscalYearStartMonth` here.

    Both were permanent chips for facts that are set once and then never looked at again,
    sitting on the line the eye crosses on the way to the numbers. Owner is a column on
    the client list, where it is actually used — to filter and sort. The financial-year
    start is still stored and still drives the export dialog's default range; it simply no
    longer occupies a slot in the header of every visit.
  */
  /*
    No `notes` field here.

    It was a single line in a row of metadata chips, which is the wrong shape for the
    thing it held: an advisor's running thoughts about a client are many, dated, and
    reordered. They live on the sticky-notes board below the header now — see
    StickyNotes.tsx. The column is still in the schema and still carries whatever was
    typed into it, so nothing written before this change was lost.
  */
];

export function ClientHeader({
  client,
  subtitle,
  onPatch,
}: {
  client: ClientRecord;
  subtitle: string;
  onPatch: (field: string, value: string | number | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState<string | null>(null);

  const commit = async (field: Field | null, raw: string) => {
    setEditing(null);
    if (field === null) {
      const name = raw.trim();
      // The name is the row's identity everywhere else in the app, and the mutation
      // rejects an empty one. Discard rather than surface a validation error for
      // something the user can simply retype.
      if (name !== "" && name !== client.name) await onPatch("name", name);
      return;
    }
    const next = field.parse ? field.parse(raw) : raw.trim() === "" ? null : raw.trim();
    await onPatch(field.id, next);
  };

  return (
    <div className="mr-auto min-w-0">
      {editing === "name" ? (
        <div className="max-w-[320px]">
          <InlineEditor
            initial={client.name}
            onCancel={() => setEditing(null)}
            onCommit={(next) => void commit(null, next)}
          />
        </div>
      ) : (
        <Tip content="Double-click to rename">
          <h1
            onDoubleClick={() => setEditing("name")}
            className="cursor-text truncate text-[19px] font-semibold tracking-tight text-ink"
          >
            {client.name}
          </h1>
        </Tip>
      )}

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-muted">
        <span>{subtitle}</span>
        {FIELDS.map((field) => {
          const current = field.value(client);
          if (editing === field.id) {
            return (
              <span key={field.id} className="inline-block min-w-[140px]">
                <InlineEditor
                  initial={field.edit?.(client) ?? current}
                  options={field.options}
                  onCancel={() => setEditing(null)}
                  onCommit={(next) => void commit(field, next)}
                />
              </span>
            );
          }
          return (
            <Tip key={field.id} content={`${field.label} — double-click to edit`}>
              <span
                onDoubleClick={() => setEditing(field.id)}
                className="cursor-text rounded-md px-1.5 py-0.5 transition-colors hover:bg-line-soft"
              >
                <span className="text-ink-faint">{field.label}: </span>
                {current === "" ? (
                  <span className="text-ink-faint italic">{field.placeholder}</span>
                ) : (
                  <span className="text-ink">{current}</span>
                )}
              </span>
            </Tip>
          );
        })}
      </div>
    </div>
  );
}
