# Wire Room

An interactive world map that shows what governments say next to what independent outlets report, country by country. Draw on the map, add notes, and pin reports to markers.

**Status:** early access MVP.

## How it works

- **Frontend:** Vite + React (`src/App.jsx`), D3 for the map. Deployed on Render.
- **Backend:** small Express server (`server.mjs`) that serves a pre-built cache. It never fetches news live.
- **Data pipeline:** a GitHub Action (`.github/workflows/fetch-news.yml`) runs `scripts/fetch-feeds.mjs` every hour. It pulls official government sources and independent publishers per country (`lib/feeds.mjs`) and commits the result to `data/cache.json`.
- **Official-source status:** each country is marked verified, temporarily unavailable, or not yet verified. The UI shows this instead of implying "no news".
- **Saved maps:** annotations are stored in the browser's localStorage. There are no accounts yet.

## Run locally

```
npm install
node server.mjs        # backend on http://localhost:3001
npm run dev            # frontend, in a second terminal
```

Point the frontend at a local backend with `VITE_API_BASE=http://localhost:3001`.

## Optional environment variables (frontend)

| Variable | Purpose |
| --- | --- |
| `VITE_API_BASE` | Backend URL (defaults to the deployed Render backend) |
| `VITE_FEEDBACK_URL` | Feedback form or `mailto:` link. Shows a FEEDBACK button when set |
| `VITE_GOATCOUNTER` | GoatCounter site code for privacy-friendly analytics |

Backend: `PROXY_URL` (optional) routes official-source fetches through a proxy for sites that block datacenter IPs.

## Known gaps

- Nine countries have no verified official source yet (AE, EG, ID, IR, NG, PK, SA, TR, ZA).
- Independent article links go through Google News redirects to the publisher.
