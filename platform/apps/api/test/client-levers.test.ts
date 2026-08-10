/**
 * The client-scoped levers, and the boundary that keeps them out of an external agent's reach.
 *
 * These write rows belonging to one client — sticky notes, action assignments, the client
 * record, that client's report layout. Every assertion here is about a property that would be
 * invisible in a type check: that the open client is the only client reachable, that an
 * undeclared lever writes nothing at all, and that a closed value set is actually closed.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import * as dbModule from "../src/db.js";
import { configurePaths } from "../src/paths.js";
import * as levers from "../src/services/client-levers.js";

let dir: string;

/** Same shape as `blueprint.test.ts`'s helper: close the cached connection, then repoint. */
function freshApi() {
  dbModule.closeConnection();
  dir = mkdtempSync(join(tmpdir(), "avilo-client-levers-"));
  configurePaths({ filesRoot: dir, dbPath: join(dir, "test.sqlite") });
  dbModule.seedReferenceData(dbModule.getDb());
  return { db: dbModule, levers };
}

/** A client to act on. Created directly — these tests are about the levers, not onboarding. */
function seedClient(db: typeof dbModule, id = "c1", name = "Phoenix Restoration Co.") {
  db.getDb().insert(db.schema.clients).values({ id, name }).run();
  return id;
}

beforeEach(() => {
  dir = "";
});

afterEach(() => {
  dbModule.closeConnection();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("client-scoped levers", () => {

  it("adds a sticky note to the open client", async () => {
    const { db, levers } = freshApi();
    const clientId = seedClient(db);

    const result = levers.applyClientLevers(
      clientId,
      { notes: { upsert: [{ body: "Chase the Q3 invoice", pinned: true }] } },
      ["notes"],
    );

    expect(result.errors).toEqual([]);
    expect(result.changes).toHaveLength(1);

    const rows = db.getDb().select().from(db.schema.stickyNotes).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.body).toBe("Chase the Q3 invoice");
    expect(rows[0]!.clientId).toBe(clientId);
    expect(rows[0]!.pinned).toBe(true);
  });

  /*
    The declaration gate, which is the whole of ADR-045 applied to these levers. A document
    that quietly changes something it never declared is refused WHOLE — the failure being
    prevented is a request about a note also rewriting the client's stage.
  */
  it("refuses an undeclared lever and writes nothing", async () => {
    const { db, levers } = freshApi();
    const clientId = seedClient(db);

    const result = levers.applyClientLevers(
      clientId,
      { notes: { upsert: [{ body: "fine" }] }, clientMeta: { stage: "Dormant" } },
      ["notes"], // clientMeta deliberately not declared
    );

    expect(result.changes).toEqual([]);
    expect(result.errors.some((e) => e.path === "clientMeta")).toBe(true);

    // Neither half landed — not the declared one either.
    expect(db.getDb().select().from(db.schema.stickyNotes).all()).toHaveLength(0);
    const client = db.getDb().select().from(db.schema.clients).where(eq(db.schema.clients.id, clientId)).get();
    expect(client!.stage).toBe("Onboarding");
  });

  /*
    The property that makes "no client id in the document" safe rather than merely tidy: a
    note id belonging to a different client is simply not found, so there is no phrasing that
    reaches another client's row.
  */
  it("cannot edit a note belonging to a different client", async () => {
    const { db, levers } = freshApi();
    const mine = seedClient(db, "c1", "Mine");
    const theirs = seedClient(db, "c2", "Theirs");

    levers.applyClientLevers(theirs, { notes: { upsert: [{ body: "theirs" }] } }, ["notes"]);
    const theirNote = db.getDb().select().from(db.schema.stickyNotes).all()[0]!;

    const result = levers.applyClientLevers(
      mine,
      { notes: { upsert: [{ id: theirNote.id, body: "hijacked" }] } },
      ["notes"],
    );

    expect(result.errors).toHaveLength(1);
    const unchanged = db
      .getDb()
      .select()
      .from(db.schema.stickyNotes)
      .where(eq(db.schema.stickyNotes.id, theirNote.id))
      .get();
    expect(unchanged!.body).toBe("theirs");
  });

  it("refuses a stage outside the closed set", async () => {
    const { db, levers } = freshApi();
    const clientId = seedClient(db);

    const result = levers.applyClientLevers(clientId, { clientMeta: { stage: "Invented" } }, ["clientMeta"]);

    expect(result.changes).toEqual([]);
    expect(result.errors[0]!.path).toBe("clientMeta.stage");
    const client = db.getDb().select().from(db.schema.clients).where(eq(db.schema.clients.id, clientId)).get();
    expect(client!.stage).toBe("Onboarding");
  });

  it("records an action assignment against its period", async () => {
    const { db, levers } = freshApi();
    const clientId = seedClient(db);

    const result = levers.applyClientLevers(
      clientId,
      { actionAssignments: [{ actionId: "collect", period: "2024-10", owner: "Sam", status: "in_progress" }] },
      ["actionAssignments"],
    );

    expect(result.errors).toEqual([]);
    const rows = db.getDb().select().from(db.schema.actionStates).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actionId: "collect", period: "2024-10", owner: "Sam", status: "in_progress" });
  });

  it("requires a period on an assignment — October's work is not November's", async () => {
    const { db, levers } = freshApi();
    const clientId = seedClient(db);

    const result = levers.applyClientLevers(
      clientId,
      { actionAssignments: [{ actionId: "collect", owner: "Sam" }] },
      ["actionAssignments"],
    );

    expect(result.errors[0]!.path).toBe("actionAssignments[0].period");
    expect(db.getDb().select().from(db.schema.actionStates).all()).toHaveLength(0);
  });

  it("writes a per-client report layout the client page will read", async () => {
    const { db, levers } = freshApi();
    const clientId = seedClient(db);

    const result = levers.applyClientLevers(clientId, { clientLayout: { hidden: ["referrals"] } }, ["clientLayout"]);

    expect(result.errors).toEqual([]);
    const row = db.getDb().select().from(db.schema.savedViews).all()[0]!;
    // The shape and row-naming ClientDetailPage's loadLayout() looks for.
    expect(row.tableId).toBe("report.layout");
    expect(row.name).toBe(clientId);
    expect(JSON.parse(row.config)).toEqual({ hidden: ["referrals"] });
  });

  it("reports which levers a document touches", async () => {
    const { levers } = freshApi();
    expect(levers.mentionsClientLever({ notes: {} })).toBe(true);
    expect(levers.mentionsClientLever({ formulas: [] })).toBe(false);
  });
});
