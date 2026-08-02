import { useCallback, useEffect, useRef, useState } from "react";
import { Pin, Plus, Trash2 } from "lucide-react";

import { api } from "../../lib/trpc.js";
import { Tip } from "./Tooltip.js";

/**
 * The advisor's sticky-note board for one client.
 *
 * This replaces the single `notes` line that used to sit among the header chips. The
 * distinction worth keeping in mind: Key Insights is written *for the client*, belongs to
 * one month, and prints. A sticky note is working memory — it belongs to the relationship,
 * there are many, and none of them reach the PDF. Hence `no-print` on the whole board.
 */

export type StickyColor = "yellow" | "blue" | "green" | "pink";

interface Note {
  id: string;
  body: string;
  color: string;
  pinned: boolean;
  updatedAt: string;
}

/**
 * Paper colours, not status colours.
 *
 * Red is reserved application-wide for missing data and formula errors, so it is
 * deliberately absent here — a note must never be mistakable for a flag.
 */
const PALETTE: Record<StickyColor, { swatch: string; card: string }> = {
  yellow: { swatch: "#fde68a", card: "border-[#f2d675] bg-[#fef6d8]" },
  blue: { swatch: "#bfdbfe", card: "border-[#a8caf5] bg-[#e8f1fe]" },
  green: { swatch: "#bbf7d0", card: "border-[#a3e3bd] bg-[#e6f8ed]" },
  pink: { swatch: "#fbcfe8", card: "border-[#f0bcda] bg-[#fdeef6]" },
};

const COLORS = Object.keys(PALETTE) as StickyColor[];

function paletteFor(color: string) {
  return PALETTE[(color as StickyColor) in PALETTE ? (color as StickyColor) : "yellow"];
}

export function StickyNotes({
  clientId,
  /** Whatever was in the old single-line `notes` field, so it can be carried across. */
  legacyNote,
  onClearLegacy,
}: {
  clientId: string;
  legacyNote: string | null;
  onClearLegacy: () => Promise<void>;
}) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loaded, setLoaded] = useState(false);
  /** The note currently open for typing. */
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(async () => {
    const rows = await api.stickyNotes.list.query({ clientId });
    setNotes(rows);
    setLoaded(true);
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    const { id } = await api.stickyNotes.create.mutate({ clientId, body: "" });
    await load();
    // Open the new note straight away: a blank note nobody is typing into is litter.
    setEditing(id);
  };

  const save = async (id: string, body: string) => {
    // Optimistic. This is free text the user just typed; re-fetching to echo it back
    // makes the card flicker between what they wrote and what the server had.
    setNotes((current) => current.map((n) => (n.id === id ? { ...n, body } : n)));
    await api.stickyNotes.update.mutate({ id, body });
  };

  const patch = async (id: string, changes: { color?: StickyColor; pinned?: boolean }) => {
    await api.stickyNotes.update.mutate({ id, ...changes });
    await load();
  };

  const remove = async (id: string) => {
    setNotes((current) => current.filter((n) => n.id !== id));
    await api.stickyNotes.remove.mutate({ id });
  };

  /** Carry the old single note across, once, without losing it if the write fails. */
  const adoptLegacy = async () => {
    if (!legacyNote) return;
    await api.stickyNotes.create.mutate({ clientId, body: legacyNote });
    await onClearLegacy();
    await load();
  };

  return (
    <section className="no-print">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-faint">
          Sticky notes
        </h2>
        <span className="text-[11.5px] text-ink-faint">
          {notes.length === 0 ? "Nothing noted yet" : `${notes.length} on the board`}
        </span>
      </div>

      {legacyNote ? (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-canvas px-3 py-2 text-[12px] text-ink-muted">
          <span>
            This client has a note from the old single-line field:{" "}
            <span className="text-ink">“{legacyNote}”</span>
          </span>
          <button
            onClick={() => void adoptLegacy()}
            className="rounded-md border border-line bg-surface px-2 py-0.5 text-[11.5px] font-medium text-ink hover:bg-line-soft"
          >
            Move it to the board
          </button>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        {notes.map((note) => (
          <NoteCard
            key={note.id}
            note={note}
            editing={editing === note.id}
            onOpen={() => setEditing(note.id)}
            onClose={() => setEditing(null)}
            onSave={(body) => save(note.id, body)}
            onPatch={(changes) => patch(note.id, changes)}
            onRemove={() => remove(note.id)}
          />
        ))}

        {/*
          The only way to add a note, and it lives on the board rather than in the header.
          A button above the cards and an identical card below it were two controls for
          one action; the card is the one that belongs where the notes are, so it stays
          and stops being an empty state — it is now simply the last card.
        */}
        {loaded ? (
          <Tip content="Notes stay with the client and never appear in the exported report.">
            <button
              onClick={() => void add()}
              aria-label="Add sticky note"
              className="flex h-[132px] w-[210px] flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-line bg-surface/60 text-[12.5px] text-ink-faint transition-colors hover:border-ink-faint hover:text-ink-muted"
            >
              <Plus size={16} />
              {notes.length === 0 ? "Add the first note" : "Add a note"}
            </button>
          </Tip>
        ) : null}
      </div>
    </section>
  );
}

function NoteCard({
  note,
  editing,
  onOpen,
  onClose,
  onSave,
  onPatch,
  onRemove,
}: {
  note: Note;
  editing: boolean;
  onOpen: () => void;
  onClose: () => void;
  onSave: (body: string) => Promise<void>;
  onPatch: (changes: { color?: StickyColor; pinned?: boolean }) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(note.body);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setDraft(note.body);
  }, [note.body]);

  useEffect(() => {
    if (editing) areaRef.current?.focus();
  }, [editing]);

  const commit = async () => {
    onClose();
    if (draft !== note.body) await onSave(draft);
  };

  const tone = paletteFor(note.color);

  return (
    <div
      className={`group relative flex h-[132px] w-[210px] flex-col rounded-xl border px-3 py-2.5 shadow-[0_1px_2px_rgba(16,24,40,0.06)] ${tone.card}`}
    >
      {editing ? (
        <textarea
          ref={areaRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setDraft(note.body);
              onClose();
            }
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              void commit();
            }
          }}
          placeholder="What needs remembering?"
          className="h-full w-full resize-none bg-transparent text-[12.5px] leading-relaxed text-ink outline-none placeholder:text-ink-faint/70"
        />
      ) : (
        <p
          onClick={onOpen}
          className={`h-full cursor-text overflow-hidden whitespace-pre-wrap text-[12.5px] leading-relaxed ${
            note.body.trim() === "" ? "italic text-ink-faint" : "text-ink"
          }`}
        >
          {note.body.trim() === "" ? "Empty — click to write" : note.body}
        </p>
      )}

      {/*
        Controls appear on hover and while editing. Always-visible chrome on a 210px card
        costs more room than the note itself.
      */}
      <div
        className={`absolute inset-x-2 bottom-1.5 flex items-center gap-1 transition-opacity ${
          editing ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        }`}
      >
        {COLORS.map((color) => (
          <button
            key={color}
            aria-label={`Colour: ${color}`}
            // onMouseDown: the textarea commits on blur, and a plain click would land
            // after that blur had already re-rendered this row.
            onMouseDown={(event) => {
              event.preventDefault();
              void onPatch({ color });
            }}
            className={`h-3.5 w-3.5 rounded-full border transition-transform hover:scale-110 ${
              note.color === color ? "border-ink" : "border-black/10"
            }`}
            style={{ background: PALETTE[color].swatch }}
          />
        ))}

        <Tip content={note.pinned ? "Unpin" : "Pin to the front"}>
          <button
            onMouseDown={(event) => {
              event.preventDefault();
              void onPatch({ pinned: !note.pinned });
            }}
            aria-label={note.pinned ? "Unpin note" : "Pin note"}
            className={`ml-auto rounded p-0.5 ${
              note.pinned ? "text-ink" : "text-ink-faint hover:text-ink"
            }`}
          >
            <Pin size={12.5} fill={note.pinned ? "currentColor" : "none"} />
          </button>
        </Tip>

        <Tip content="Delete this note">
          <button
            onMouseDown={(event) => {
              event.preventDefault();
              void onRemove();
            }}
            aria-label="Delete note"
            className="rounded p-0.5 text-ink-faint hover:text-flag"
          >
            <Trash2 size={12.5} />
          </button>
        </Tip>
      </div>

      {note.pinned && !editing ? (
        <Pin
          size={11}
          fill="currentColor"
          className="absolute right-2 top-2 text-ink/40 group-hover:opacity-0"
        />
      ) : null}
    </div>
  );
}
