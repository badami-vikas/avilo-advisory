# Packaging

```bash
pnpm --filter @avilo/web build   # ALWAYS first
pnpm app:mac   # or app:win
```

**`build.mjs` does not build the web bundle.** It copies `apps/web/dist` and errors only if missing — a stale bundle ships silently (BUG-010).

## Verify before claiming a release

```bash
# web bundle — grep the assets directly
grep -rF "some new string" release/mac-arm64/*.app/Contents/Resources/web/assets/*.js

# server bundle — EXTRACT, never grep the asar directly (BUG-011)
npx asar extract-file app.asar dist/main.mjs && grep -c "someServerString" main.mjs

# no credentials in the installer
LC_ALL=C grep -c "gsk_" "Avilo Advisory Setup X.Y.Z.exe"   # must be 0

# exe matches its manifest
openssl dgst -sha512 -binary "…exe" | openssl base64 -A   # compare to latest.yml
```

## Migrations

Adding one means **two** files: the `.sql` **and** an entry in `migrations/meta/_journal.json` whose `when` is **greater than the previous entry's**. Drizzle picks pending migrations by comparing that timestamp. A fresh DB runs everything in order and hides both mistakes — test against a copy of a real database (BUG-001).

## Windows

Cross-built on macOS, **unsigned** — SmartScreen warns. Has never been launched on Windows.
