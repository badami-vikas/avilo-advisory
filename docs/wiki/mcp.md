# MCP: external agents

*Depth: [ADR-043, ADR-044](../decisions.md). Agent-facing reference: [AGENTS.md](../../AGENTS.md).*

`@avilo/mcp` is a stdio Model Context Protocol server that lets Claude Code — or any MCP
client — read and change Avilo's configuration. It is a second front door onto the blueprint
pipeline ([blueprint.md](blueprint.md)), not a second implementation of it.

## The six tools

| Tool | Reads | Writes |
|---|---|---|
| `avilo_describe_surface` | the registry: every legal id | — |
| `avilo_get_configuration` | the live configuration | — |
| `avilo_list_versions` | configuration history | — |
| `avilo_get_version` | one recorded state | — |
| `avilo_propose_change` | — | a **proposal**, not the live state |
| `avilo_restore_version` | — | the live state, but only to a version that already existed |

## Three properties, and why each holds

**It cannot see client data.** No fact, period, override, import or figure. Enforced by the
module graph rather than by a check inside each tool: `tools.ts` imports only configuration
services, and `test/mcp-isolation.test.ts` walks the transitive imports from `server.ts` and
fails if any reachable file names a client-data table. Adding one breaks the build.

*Honest limit:* the server opens the same SQLite file the app does, because configuration
lives there. The boundary is code-level and test-verified, not OS-enforced.

**It cannot activate.** There is no such tool. An agent records a proposal; a person
activates it in the app. Structurally absent beats policy-denied — there is nothing to
misuse.

**It can revert.** `restore_version` applies without a human, because it names a state that
was already live and therefore already approved, and history is append-only so the restore
is itself restorable. Returning to an old state is strictly weaker than choosing a new one.

## What this changes about the product

The application still makes no outbound request without a button press, and nothing is
bound, opened or listened on — stdio means only a process the user launched can talk to it.
But an external program can now reach configuration, which was not true before. That is a
real change to "no account, no cloud, no network", and it is stated rather than glossed.

## Connecting

```json
{
  "mcpServers": {
    "avilo": {
      "command": "npx",
      "args": ["tsx", "<repo>/platform/apps/mcp/src/server.ts"]
    }
  }
}
```

The app need not be running. If it is, changes appear without a reload. `AVILO_DB_PATH` and
`AVILO_FILES_ROOT` point it at a different installation.

## Configuration history

`configuration_versions` holds one row per state the configuration has been in, with the
full normalized document and the diff from its predecessor. `activateProposal` is the single
writer, so no path can change the configuration without leaving a state to return to.

- **Forward-only.** Restoring seq 3 appends a new version; it does not delete 4 and 5.
- **Normalized.** `layout` and `views` are spelled out, because an absent key means "leave
  alone" and a state captured before any view existed must still be able to remove one.
- **Baselined.** The first activation on an upgraded installation records the pre-change
  state first, so the very first change is undoable.

A person reaches the same history from **History**, at the foot of the assistant panel.
