# Live layers: military aircraft + ships

Two map layers, both **off by default**. Users turn them on with the **LIVE** box at the bottom-left of the map.

- **MIL AIR:** military-flagged aircraft worldwide that broadcast ADS-B (many military aircraft don't).
- **SHIPS:** vessels in 15 watched areas: 10 strategic chokepoints (Hormuz, Bab el-Mandeb, Suez, Malacca, Taiwan Strait, Black Sea, Gibraltar, Panama, English Channel, Danish straits) and 5 Indian Ocean ports and passages (Mumbai/JNPT, Colombo/Hambantota, Gwadar, Chittagong, Six Degree Channel).

The browser only ever talks to **our** backend. Switching from free to commercial data sources is done with
environment variables on Render. No frontend change, no code change.

## Files

| File | What it does |
|---|---|
| `tracking/config.mjs` | Reads every switch (environment variables) |
| `tracking/license.mjs` | License guard: in commercial mode, blocks any source you haven't cleared |
| `tracking/aircraft.mjs` | adsb.lol, airplanes.live, or a paid ADS-B Exchange-style API (same JSON format) |
| `tracking/ships.mjs` | AISStream.io websocket, chokepoint boxes, ship types |
| `tracking/ships-template.mjs` | Blank template for a future paid AIS provider |
| `tracking/index.mjs` | Routes: `/api/aircraft`, `/api/ships`, `/api/tracking/status` |
| `src/useTracking.js` | Frontend polling, timeouts, pause when the tab is hidden |
| `src/trackingGeo.js` | Map math: projection, icon drawing, tap detection |
| `src/LiveLayers.jsx` | The LIVE box, the icons, the details card |
| `tests/tracking.test.mjs` | Offline tests: `npm test` |

## Render: backend service -> Environment

What to use now (MVP):

```
AISSTREAM_API_KEY=<free key from aisstream.io>
```

That's the only required one. Defaults: `TRACKING_MODE=mvp`, `AIRCRAFT_PROVIDER=adsblol`, `SHIPS_PROVIDER=aisstream`.
Without the key, the ships layer says "not available yet" and everything else keeps working.

## Switching to commercial sources later

| Want | Set |
|---|---|
| Turn on the license guard | `TRACKING_MODE=commercial` |
| Paid ADS-B provider | `AIRCRAFT_PROVIDER=adsbx`, `ADSBX_BASE_URL`, `ADSBX_API_KEY`, `ADSBX_KEY_HEADER` (default `api-auth`), then `LICENSE_CLEARED_ADSBX=true` |
| Keep adsb.lol after written permission | `LICENSE_CLEARED_ADSBLOL=true` |
| Keep AISStream after reading their commercial terms | `LICENSE_CLEARED_AISSTREAM=true` |
| Paid AIS provider | Build one from `ships-template.mjs`, add a case in `createShipsProvider()` in `index.mjs`, set `SHIPS_PROVIDER` |
| Turn ships off | `SHIPS_PROVIDER=none` |
| Different ship areas | `SHIPS_BBOXES` = JSON list of `[[lat1,lon1],[lat2,lon2]]` boxes, or `global` (heavy, not for the free server) |

In commercial mode, an uncleared source returns status `license_blocked` and is never called.
Setting `LICENSE_CLEARED_*=true` means you hold the right to use that source. Only set it once that's true.

## How it behaves

- Every response is `{ ok, provider, status, count, items, meta }`. Status is one of
  `ok`, `warming`, `stale`, `unavailable`, `license_blocked`, `not-configured`, `disabled`.
  The map shows a plain message for anything that isn't `ok`.
- Aircraft: one worldwide military request, cached 15 seconds on the server, so traffic to adsb.lol
  stays the same no matter how many people are viewing.
- Ships: one websocket from the server to AISStream (the key never reaches the browser). The browser asks
  only for the area on screen once zoomed in.
- If a feed fails, the last positions stay on screen with a warning.
- Taps on country dots and annotations win over taps on ships/planes. On a phone, zoom in first.

## Known limits (say these to investors)

- **Hourly restart:** every hourly news-cache commit redeploys the backend and empties the ship list.
  Ships refill over a few minutes. The map says "just restarted" during that time.
- Free AIS coverage depends on volunteer receivers. Some areas will be thin.
- AISStream is a free beta service with no uptime promise.
- Watched-area boxes are approximate; edit `CHOKEPOINT_BOXES` and `CHOKEPOINT_NAMES` in `ships.mjs` (same order).
- Licensing status of each source is in `license.mjs`. Re-check the providers' terms before charging money.
