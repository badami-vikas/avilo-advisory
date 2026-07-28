# Runtime stand-ins

Per `relationship-os` CLAUDE.md: runtime surfaces use real connected data or honest empty
states. Any unavoidable runtime or test dummy is tracked here with reason, represented
element, and removal condition.

## Current entries

_None._ The application ships with an empty database and honest empty states.

The demo dataset (Phoenix Restoration Co., the sample company carried in the v9 prototype)
is **not** seeded into the running app. It exists only behind the explicit opt-in command
`pnpm seed:demo`, which is never invoked by `pnpm dev`, by migrations, or by tests of
production code paths.

| Item | Reason | Represents | Removal condition |
| --- | --- | --- | --- |
| `platform/apps/api/src/scripts/seed-demo.ts` | Lets a reviewer see a populated dashboard without owning real QuickBooks exports | A fully imported client-month | Delete once a real client file set is available for demos |

## Test fixtures

Fixtures under `platform/modules/avilo/test/fixtures/` are synthetic QuickBooks-shaped
exports used to prove parser behaviour. They are test-only, never reachable from the
running application, and are therefore not runtime dummies.
