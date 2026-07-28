# Avilo Advisory — Monthly Business Snapshot (v9)

Single-file HTML dashboard. No build step, no dependencies to install — everything (Chart.js, SheetJS) loads from CDN when the page opens.

## Fastest option: just open it
Double-click `index.html`. It works directly in any modern browser (Chrome, Edge, Safari). Import (API-based PDF reading) and Excel parsing both work fine when opened this way — no server required.

## To host it properly (recommended if sharing a link)
Any static file host works since there's no backend:

**Option A — Simplest local server (for testing on a LAN):**
```
cd avilo-dashboard-v9
python3 -m http.server 8000
```
Then visit `http://localhost:8000` (or `http://<your-machine-IP>:8000` from another device on the same network).

**Option B — Free static hosting (for a real shareable link):**
- Netlify Drop (netlify.com/drop) — drag the folder in, get a live URL in seconds
- Vercel, GitHub Pages, or Cloudflare Pages — also work, slightly more setup

## Notes
- Requires an internet connection (pulls Chart.js and SheetJS from cdnjs at runtime).
- The Anthropic API key field in the Import panel is never stored — it's used only in-browser for that session.
- All data lives in the browser tab until you click "Save as JSON" — nothing persists across reloads unless exported.
