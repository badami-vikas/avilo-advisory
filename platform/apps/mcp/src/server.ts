#!/usr/bin/env -S npx tsx
/**
 * Avilo's Model Context Protocol server: the door an external agent — Claude Code, or any
 * other MCP client — uses to build and change this app's configuration.
 *
 * ## What this changes about the product, stated plainly
 *
 * Until now "no account, no cloud, no network required" was true of every path in the
 * application. This adds an inbound door, and honesty demands it be described as one. It is
 * not a network listener: the transport is stdio, so the only thing that can talk to it is a
 * process the user launched on their own machine, and nothing is opened, bound or exposed.
 * The app itself still makes no outbound request without a button press. But an external
 * program can now read and change configuration, and that is new (ADR-043).
 *
 * ## The guarantee, and its honest limit
 *
 * GUARANTEE: no tool here can read a client, a period, a fact, an override, an import or a
 * figure. This is enforced by the module graph rather than by a check inside each tool —
 * `tools.ts` imports only the configuration services, and `test/mcp-isolation.test.ts` walks
 * every file reachable from this entry point and fails if any of them so much as names a
 * client-data table. Adding a fact query to a reachable file breaks the build.
 *
 * LIMIT: this process opens the same SQLite file the application does, because that is where
 * configuration lives. The boundary is therefore at the level of code, verified by a test,
 * not at the level of the operating system. A future build that wanted a stronger claim
 * would have to put configuration in its own file or put the server behind the running app's
 * loopback API. That is worth doing if this ever runs unattended; it is not done here, and
 * pretending otherwise would be the kind of claim CLAUDE.md exists to prevent.
 *
 * ## Why an agent may restore but not activate
 *
 * `propose_change` records; it does not apply. A person activates. `restore_version` DOES
 * apply — but only to a state that was already live and therefore already accepted by a
 * person, and history is append-only, so the restore is itself just another entry that can
 * be walked back. Introducing a new state is a human decision; returning to an old one is
 * not. See `tools.ts` for the full reasoning.
 */
import { runMcpStdio } from "./stdio-entry.js";

runMcpStdio().catch((cause: unknown) => {
  process.stderr.write(`avilo-mcp: failed to start — ${(cause as Error).message}\n`);
  process.exit(1);
});
