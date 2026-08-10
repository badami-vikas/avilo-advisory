/**
 * The assistant's client-scoped levers: sticky notes, action assignments, client metadata,
 * and one client's own report layout.
 *
 * ## Why this is a separate file from `blueprint.ts`
 *
 * Not organisation — enforcement. `blueprint.ts` is reachable from the MCP server's module
 * graph, and `test/mcp-isolation.test.ts` fails the build if anything in that graph so much
 * as names a client-data table. `clients` and `sticky_notes` are on that list. Putting these
 * writes in `blueprint.ts` would not merely be untidy; it would silently hand an external
 * agent the ability to read and write a client's record, and the isolation test exists
 * precisely because a code review is not the thing that catches that months later.
 *
 * So the boundary is drawn where the guarantee is: configuration is global, portable and
 * reachable over MCP; a client's own working data is none of those things, and only the
 * in-app assistant — which already has a client open on screen — can touch it.
 *
 * ## Why these levers are low-risk despite writing client rows
 *
 * None of them can put a figure anywhere. A sticky note is prose the advisor already writes
 * by hand and which never prints; an action assignment is an owner and a date against an id
 * the app derived; client metadata is a stage and an industry. The one thing conspicuously
 * absent is `periodNotes` — Key Insights — because that prose DOES reach the client PDF and
 * has no computed findings to be checked against, unlike the executive summary. A model
 * writing there could put an unsourced claim in front of a paying client, which is the exact
 * failure "never fabricate a figure" exists to prevent.
 *
 * ## Undo
 *
 * These do NOT go through the blueprint snapshot Undo, and the panel says so rather than
 * implying otherwise. Every one of them is a row the advisor can already edit or delete in
 * the UI they are looking at — a sticky note has a delete button, a stage is a dropdown.
 * Building a second reversal mechanism for changes that are one click from reversible is
 * machinery nobody would use.
 */

import { and, eq } from "drizzle-orm";

import { getDb, newId, schema } from "../db.js";

/** Stage values `ClientsPage.tsx` offers. Closed, so a typo cannot invent a pipeline stage. */
const STAGES = ["Onboarding", "Active", "Review", "Dormant"] as const;
/** Colours the sticky-note UI can actually render. */
const NOTE_COLORS = ["yellow", "blue", "green", "pink"] as const;
/** Statuses the actions panel understands. */
const ACTION_STATUSES = ["not_started", "in_progress", "done", "dropped"] as const;

/** The report layout is stored as a `saved_views` row named for the client (ClientDetailPage). */
const LAYOUT_TABLE_ID = "report.layout";

export type ClientLever = "notes" | "actionAssignments" | "clientMeta" | "clientLayout";

export const CLIENT_LEVERS: readonly ClientLever[] = [
  "notes", "actionAssignments", "clientMeta", "clientLayout",
];

export interface ClientLeverResult {
  changes: string[];
  errors: { path: string; message: string }[];
}

/** Does this document mention any client-scoped lever at all? */
export function mentionsClientLever(doc: Record<string, unknown>): boolean {
  return CLIENT_LEVERS.some((lever) => doc[lever] !== undefined);
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/**
 * Apply whatever client-scoped sections the document carries, to the OPEN client.
 *
 * `clientId` comes from the panel's own context, never from the document. That is the whole
 * reason there is no `clientId` field in any of these sections: the assistant can only ever
 * write to the client the user is looking at, so a confused model cannot reach a different
 * client's record, and no validation rule has to be trusted to prevent it.
 *
 * Errors and changes are collected rather than thrown — a bad due date should not discard a
 * good sticky note, and the caller reports both.
 */
export function applyClientLevers(
  clientId: string,
  doc: Record<string, unknown>,
  declared: readonly string[],
): ClientLeverResult {
  const db = getDb();
  const changes: string[] = [];
  const errors: { path: string; message: string }[] = [];

  const client = db.select().from(schema.clients).where(eq(schema.clients.id, clientId)).get();
  if (!client) {
    return { changes: [], errors: [{ path: "$", message: `No client with id ${clientId}.` }] };
  }

  /*
    Undeclared levers are refused, exactly as `applyBlueprintDirectly` refuses them for
    configuration (ADR-045). A request about a sticky note that arrives also rewriting the
    client's stage is the same defect as one about a formula that rewrites the report layout,
    and it gets the same answer.
  */
  for (const lever of CLIENT_LEVERS) {
    if (doc[lever] !== undefined && !declared.includes(lever)) {
      errors.push({
        path: lever,
        message: `The document changes \`${lever}\` but never declared it. Nothing was written.`,
      });
    }
  }
  if (errors.length > 0) return { changes: [], errors };

  /* ------------------------------------------------------------- sticky notes */

  if (doc.notes !== undefined) {
    const patch = doc.notes as Record<string, unknown>;
    if (typeof patch !== "object" || patch === null) {
      errors.push({ path: "notes", message: "Not an object. Expected { upsert?, remove? }." });
    } else {
      const upserts = Array.isArray(patch.upsert) ? patch.upsert : [];
      upserts.forEach((raw, i) => {
        if (typeof raw !== "object" || raw === null) {
          errors.push({ path: `notes.upsert[${i}]`, message: "Not an object." });
          return;
        }
        const n = raw as Record<string, unknown>;
        const body = str(n.body);
        if (body === undefined || body.trim() === "") {
          errors.push({ path: `notes.upsert[${i}].body`, message: "A note needs a body." });
          return;
        }
        const color = str(n.color);
        if (color !== undefined && !NOTE_COLORS.includes(color as never)) {
          errors.push({
            path: `notes.upsert[${i}].color`,
            message: `Unknown colour "${color}". One of: ${NOTE_COLORS.join(", ")}.`,
          });
          return;
        }
        const pinned = typeof n.pinned === "boolean" ? n.pinned : undefined;
        const existingId = str(n.id);

        if (existingId) {
          // Scoped to this client: an id belonging to someone else's note is simply not found.
          const existing = db
            .select()
            .from(schema.stickyNotes)
            .where(and(eq(schema.stickyNotes.id, existingId), eq(schema.stickyNotes.clientId, clientId)))
            .get();
          if (!existing) {
            errors.push({ path: `notes.upsert[${i}].id`, message: `No note "${existingId}" for this client.` });
            return;
          }
          db.update(schema.stickyNotes)
            .set({
              body,
              ...(color ? { color } : {}),
              ...(pinned !== undefined ? { pinned } : {}),
              updatedAt: new Date().toISOString(),
            })
            .where(eq(schema.stickyNotes.id, existingId))
            .run();
          changes.push(`Updated a sticky note: "${body.slice(0, 60)}${body.length > 60 ? "…" : ""}"`);
          return;
        }

        const maxOrder = db
          .select({ sortOrder: schema.stickyNotes.sortOrder })
          .from(schema.stickyNotes)
          .where(eq(schema.stickyNotes.clientId, clientId))
          .all()
          .reduce((max, r) => Math.max(max, r.sortOrder ?? 0), 0);

        db.insert(schema.stickyNotes)
          .values({
            id: newId("note"),
            clientId,
            body,
            color: color ?? "yellow",
            pinned: pinned ?? false,
            sortOrder: maxOrder + 10,
          })
          .run();
        changes.push(`Added a sticky note: "${body.slice(0, 60)}${body.length > 60 ? "…" : ""}"`);
      });

      const removals = Array.isArray(patch.remove) ? patch.remove : [];
      removals.forEach((raw, i) => {
        const noteId = str(raw);
        if (!noteId) {
          errors.push({ path: `notes.remove[${i}]`, message: "Must be a note id string." });
          return;
        }
        const existing = db
          .select()
          .from(schema.stickyNotes)
          .where(and(eq(schema.stickyNotes.id, noteId), eq(schema.stickyNotes.clientId, clientId)))
          .get();
        if (!existing) {
          errors.push({ path: `notes.remove[${i}]`, message: `No note "${noteId}" for this client.` });
          return;
        }
        db.delete(schema.stickyNotes).where(eq(schema.stickyNotes.id, noteId)).run();
        changes.push(`Deleted a sticky note: "${existing.body.slice(0, 60)}"`);
      });
    }
  }

  /* ------------------------------------------------------ action assignments */

  if (doc.actionAssignments !== undefined) {
    const list = Array.isArray(doc.actionAssignments) ? doc.actionAssignments : null;
    if (!list) {
      errors.push({ path: "actionAssignments", message: "Not an array." });
    } else {
      list.forEach((raw, i) => {
        if (typeof raw !== "object" || raw === null) {
          errors.push({ path: `actionAssignments[${i}]`, message: "Not an object." });
          return;
        }
        const a = raw as Record<string, unknown>;
        const actionId = str(a.actionId);
        const period = str(a.period);
        if (!actionId) {
          errors.push({ path: `actionAssignments[${i}].actionId`, message: "Required." });
          return;
        }
        if (!period) {
          errors.push({
            path: `actionAssignments[${i}].period`,
            message: "Required — an action in October is different work from the same sentence in November.",
          });
          return;
        }
        const status = str(a.status);
        if (status !== undefined && !ACTION_STATUSES.includes(status as never)) {
          errors.push({
            path: `actionAssignments[${i}].status`,
            message: `Unknown status "${status}". One of: ${ACTION_STATUSES.join(", ")}.`,
          });
          return;
        }
        const dueDate = str(a.dueDate);
        if (dueDate !== undefined && dueDate !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
          errors.push({ path: `actionAssignments[${i}].dueDate`, message: "Must be an ISO date, YYYY-MM-DD." });
          return;
        }
        const owner = str(a.owner);

        db.insert(schema.actionStates)
          .values({
            clientId,
            period,
            actionId,
            ...(owner !== undefined ? { owner } : {}),
            ...(dueDate !== undefined ? { dueDate: dueDate === "" ? null : dueDate } : {}),
            ...(status !== undefined ? { status } : {}),
          })
          .onConflictDoUpdate({
            target: [schema.actionStates.clientId, schema.actionStates.period, schema.actionStates.actionId],
            set: {
              ...(owner !== undefined ? { owner } : {}),
              ...(dueDate !== undefined ? { dueDate: dueDate === "" ? null : dueDate } : {}),
              ...(status !== undefined ? { status } : {}),
              updatedAt: new Date().toISOString(),
            },
          })
          .run();

        const parts = [
          owner !== undefined ? `owner ${owner || "cleared"}` : null,
          dueDate !== undefined ? `due ${dueDate || "cleared"}` : null,
          status !== undefined ? `status ${status}` : null,
        ].filter(Boolean);
        changes.push(`Action "${actionId}" (${period}) — ${parts.join(", ") || "updated"}`);
      });
    }
  }

  /* ---------------------------------------------------------- client metadata */

  if (doc.clientMeta !== undefined) {
    const m = doc.clientMeta as Record<string, unknown>;
    if (typeof m !== "object" || m === null) {
      errors.push({ path: "clientMeta", message: "Not an object." });
    } else {
      const stage = str(m.stage);
      if (stage !== undefined && !STAGES.includes(stage as never)) {
        errors.push({
          path: "clientMeta.stage",
          message: `Unknown stage "${stage}". One of: ${STAGES.join(", ")}.`,
        });
      } else {
        const set: Record<string, string> = {};
        const described: string[] = [];
        if (stage !== undefined && stage !== client.stage) {
          set.stage = stage;
          described.push(`stage ${client.stage} → ${stage}`);
        }
        for (const field of ["industry", "owner", "legalName"] as const) {
          const value = str(m[field]);
          if (value === undefined || value === client[field]) continue;
          set[field] = value;
          described.push(`${field} set to "${value}"`);
        }
        /*
          `notes` is deliberately absent from that list even though the column exists. It is
          the single free-text field the sticky-notes table replaced precisely because one
          field could hold exactly one thought; writing to it now would resurrect the wall of
          undated text, and the assistant already has somewhere better to put a note.
        */
        if (Object.keys(set).length > 0) {
          db.update(schema.clients)
            .set({ ...set, updatedAt: new Date().toISOString() })
            .where(eq(schema.clients.id, clientId))
            .run();
          changes.push(`${client.name} — ${described.join("; ")}`);
        }
      }
    }
  }

  /* ------------------------------------------------------ this client's layout */

  if (doc.clientLayout !== undefined) {
    const l = doc.clientLayout as Record<string, unknown>;
    if (typeof l !== "object" || l === null) {
      errors.push({ path: "clientLayout", message: "Not an object. Expected { order?, hidden? }." });
    } else {
      const order = Array.isArray(l.order) ? l.order.filter((s): s is string => typeof s === "string") : undefined;
      const hidden = Array.isArray(l.hidden) ? l.hidden.filter((s): s is string => typeof s === "string") : undefined;
      if (!order && !hidden) {
        errors.push({ path: "clientLayout", message: "Needs `order`, `hidden`, or both." });
      } else {
        /*
          Written in the `{order, hidden}` shape ClientDetailPage reads, into a `saved_views`
          row named for the client — the same row its own format panel writes. A per-client
          layout beats the global default, which is what makes "hide that section for THIS
          client" a different, and much more common, request from changing the default.
        */
        const existing = db
          .select()
          .from(schema.savedViews)
          .where(and(eq(schema.savedViews.tableId, LAYOUT_TABLE_ID), eq(schema.savedViews.name, clientId)))
          .get();

        const merged = {
          ...(existing ? (JSON.parse(existing.config) as Record<string, unknown>) : {}),
          ...(order ? { order } : {}),
          ...(hidden ? { hidden } : {}),
        };
        const config = JSON.stringify(merged);

        if (existing) {
          db.update(schema.savedViews).set({ config }).where(eq(schema.savedViews.id, existing.id)).run();
        } else {
          db.insert(schema.savedViews)
            .values({ id: newId("view"), tableId: LAYOUT_TABLE_ID, name: clientId, config, isDefault: false })
            .run();
        }

        const parts: string[] = [];
        if (hidden) parts.push(hidden.length > 0 ? `hid ${hidden.join(", ")}` : "un-hid every section");
        if (order) parts.push("reordered the sections");
        changes.push(`${client.name}'s report — ${parts.join("; ")}`);
      }
    }
  }

  return { changes, errors };
}
