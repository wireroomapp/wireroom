// Entry point. In server.mjs add just two lines:
//   import { registerTracking } from "./tracking/index.mjs";
//   registerTracking(app);

import WebSocket from "ws";
import { loadConfig } from "./config.mjs";
import { checkLicense, PROVIDER_INFO } from "./license.mjs";
import { createAircraftProvider } from "./aircraft.mjs";
import { createAisStreamProvider } from "./ships.mjs";
import { parseBbox, inBbox, bboxToCircle, quantizeCircle, createCache } from "./util.mjs";

function createShipsProvider(config, WebSocketImpl) {
  switch (config.shipsProvider) {
    case "aisstream":
      return createAisStreamProvider(config.ais, { WebSocketImpl });
    default:
      return null;
  }
}

export function registerTracking(app, opts = {}) {
  const config = opts.config || loadConfig();
  const fetchImpl = opts.fetchImpl || fetch;
  const cache = createCache();

  const aircraftLicense = checkLicense(config.aircraftProvider, config);
  const shipsLicense = checkLicense(config.shipsProvider, config);

  const aircraft = aircraftLicense.allowed ? createAircraftProvider(config, fetchImpl) : null;
  const ships = shipsLicense.allowed ? createShipsProvider(config, opts.WebSocketImpl || WebSocket) : null;
  if (ships) ships.start();

  // server.mjs sets "max-age=60" on every response. Live positions should refresh faster,
  // so the tracking routes override it.
  app.use(["/api/aircraft", "/api/ships", "/api/tracking"], (_req, res, next) => {
    res.set("Cache-Control", "public, max-age=10");
    next();
  });

  const envelope = (provider, license, status, items, extra = {}) => ({
    ok: status === "ok" || status === "warming",
    provider: provider || null,
    status, // ok | stale | unavailable | license_blocked | not-configured | disabled
    count: items.length,
    items,
    meta: {
      fetchedAt: new Date().toISOString(),
      attribution: PROVIDER_INFO[provider]?.attribution || "",
      mode: config.mode,
      ...extra,
    },
  });

  // ---- Aircraft -------------------------------------------------------------
  app.get("/api/aircraft", async (req, res) => {
    const bbox = parseBbox(String(req.query.bbox || ""));
    const militaryOnly = req.query.mil === "1";
    if (!bbox) return res.status(400).json({ ok: false, status: "bad-request", error: "bbox=south,west,north,east required" });

    const key = config.aircraftProvider;
    if (!aircraftLicense.allowed) {
      return res.json(envelope(key, aircraftLicense, "license_blocked", [], { message: aircraftLicense.reason }));
    }
    if (!aircraft) {
      return res.json(envelope(key, aircraftLicense, "not-configured", [], { message: "Aircraft provider is not configured." }));
    }

    let cacheKey;
    let call;
    let truncated = false;
    if (militaryOnly) {
      cacheKey = `${key}:mil`;
      call = () => aircraft.fetchMilitary();
    } else {
      const circle = quantizeCircle(bboxToCircle(bbox, config.maxRadiusNm));
      truncated = circle.truncated;
      cacheKey = `${key}:${circle.lat},${circle.lon},${circle.radiusNm}`;
      call = () => aircraft.fetchArea(circle);
    }

    try {
      let items = cache.get(cacheKey, config.aircraftCacheMs);
      let status = "ok";
      if (!items) {
        items = await call();
        cache.set(cacheKey, items);
      }
      const visible = items.filter((a) => inBbox(a.lat, a.lon, bbox)).slice(0, config.maxResults);
      return res.json(envelope(key, aircraftLicense, status, visible, { truncated }));
    } catch (e) {
      const stale = cache.getStale(cacheKey);
      if (stale) {
        const visible = stale.value.filter((a) => inBbox(a.lat, a.lon, bbox)).slice(0, config.maxResults);
        return res.json(envelope(key, aircraftLicense, "stale", visible, { truncated, message: `Showing saved data (${e.message}).`, dataAt: new Date(stale.at).toISOString() }));
      }
      return res.json(envelope(key, aircraftLicense, "unavailable", [], { message: `Aircraft feed unavailable (${e.message}).` }));
    }
  });

  // ---- Ships ----------------------------------------------------------------
  app.get("/api/ships", (req, res) => {
    const bbox = parseBbox(String(req.query.bbox || ""));
    if (!bbox) return res.status(400).json({ ok: false, status: "bad-request", error: "bbox=south,west,north,east required" });

    const key = config.shipsProvider;
    if (key === "none") return res.json(envelope(key, null, "disabled", []));
    if (!shipsLicense.allowed) {
      return res.json(envelope(key, shipsLicense, "license_blocked", [], { message: shipsLicense.reason }));
    }
    if (!ships) return res.json(envelope(key, shipsLicense, "not-configured", [], { message: "Ships provider is not configured." }));

    const s = ships.status();
    const items = ships.query(bbox, config.maxResults);
    const message =
      s.state === "not-configured" ? "AISSTREAM_API_KEY is not set on the server."
      : s.state === "unavailable" ? "Ship feed is connecting or unavailable."
      : s.state === "stale" ? "Ship feed has gone quiet; positions may be old."
      : s.state === "warming" ? "Ship feed just restarted; more vessels will appear over the next few minutes."
      : "";
    return res.json(envelope(key, shipsLicense, s.state, items, { message, coverage: config.ais.boxes === "global" ? "global" : "chokepoints", zones: ships.zones ? ships.zones() : [], feed: s }));
  });

  // ---- Health for the admin / the investor "feed health" view ------------------
  app.get("/api/tracking/status", (_req, res) => {
    res.json({
      mode: config.mode,
      aircraft: { provider: config.aircraftProvider, allowed: aircraftLicense.allowed, reason: aircraftLicense.reason, license: PROVIDER_INFO[config.aircraftProvider]?.commercial || null },
      ships: { provider: config.shipsProvider, allowed: shipsLicense.allowed, reason: shipsLicense.reason, license: PROVIDER_INFO[config.shipsProvider]?.commercial || null, feed: ships ? ships.status() : null, coverage: ships?.coverage ? ships.coverage() : null },
    });
  });

  return { aircraft, ships, config };
}
