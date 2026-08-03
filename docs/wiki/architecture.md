# Architecture

**Offline-first, local-first.** Electron shell → Fastify+tRPC on loopback → SQLite on disk. No account, no cloud. Groq is the only external call and is optional.

```
apps/web (React)  →  apps/api (tRPC)  →  modules/avilo (domain)  →  SQLite
apps/desktop (Electron) wraps web + api into one binary
packages/tables = generic view/filter/sort engine, module-agnostic
```

**Apps are thin. The domain is in `modules/avilo`.** Parsers, accounts, formulas, integrity checks and AI prompts all live there and are unit-tested without a server.

## The four inversions from v9

| v9 | Now |
|---|---|
| One client, one month, hard-coded column indices | `facts` keyed by (client, period, account) |
| Row labels matched by regex in code | `label_mappings` — persisted, correctable rows |
| Metrics computed inline in render | `formulas` — versioned expressions, runtime eval |
| Corrections silently overwrote | `overrides` with full history |

**House rule:** when about to encode knowledge in code, check whether it should be data.

## Trust properties

- Every figure traces to an imported fact, a stored override, or a formula.
- "Unknown" is a first-class result — never a zero standing in for missing data.
- Derived things (insights, warnings, recommendations) are recomputed, never stored.
- Only human input persists: owner, due date, status, notes, summary edits.
