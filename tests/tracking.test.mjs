// Offline tests (no internet needed): node --test tracking.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { parseBbox, inBbox, bboxToCircle, quantizeCircle } from "../tracking/util.mjs";
import { normalizeAircraft } from "../tracking/aircraft.mjs";
import { checkLicense } from "../tracking/license.mjs";
import { loadConfig } from "../tracking/config.mjs";
import { createAisStreamProvider, shipCategory } from "../tracking/ships.mjs";
import { registerTracking } from "../tracking/index.mjs";

// ---- helpers ---------------------------------------------------------------
function mockApp() {
  const routes = {};
  return { get: (p, h) => (routes[p] = h), use: () => {}, routes };
}
async function call(app, path, query = {}) {
  let body, code = 200;
  const res = { status(c) { code = c; return this; }, json(b) { body = b; return this; } };
  await app.routes[path]({ query }, res);
  return { code, body };
}
const VIEW = "33,-120,35,-117"; // around Los Angeles
const AC = (hex, lat, lon, extra = {}) => ({ hex, flight: "TEST1  ", lat, lon, alt_baro: 35000, gs: 450.2, track: 270, t: "B738", r: "N123", ...extra });

// ---- util ------------------------------------------------------------------
test("parseBbox accepts valid and rejects bad input", () => {
  assert.deepEqual(parseBbox("1,2,3,4"), { south: 1, west: 2, north: 3, east: 4 });
  assert.equal(parseBbox("nope"), null);
  assert.equal(parseBbox("5,0,1,10"), null); // south >= north
  assert.equal(parseBbox("1,2,3"), null);
  assert.equal(parseBbox(undefined), null);
});

test("inBbox handles antimeridian", () => {
  const wrap = { south: -10, north: 10, west: 170, east: -170 };
  assert.ok(inBbox(0, 175, wrap));
  assert.ok(inBbox(0, -175, wrap));
  assert.ok(!inBbox(0, 0, wrap));
});

test("bboxToCircle caps radius and flags truncation", () => {
  const small = bboxToCircle({ south: 33, west: -118.5, north: 34, east: -117.5 });
  assert.ok(small.radiusNm >= 10 && small.radiusNm < 250 && !small.truncated);
  const big = bboxToCircle({ south: -60, west: -180, north: 70, east: 180 });
  assert.equal(big.radiusNm, 250);
  assert.ok(big.truncated);
  const q = quantizeCircle(small);
  assert.ok(q.radiusNm % 25 === 0);
});

// ---- aircraft normalizer -----------------------------------------------------
test("normalizeAircraft maps fields, ground, military flag, junk", () => {
  const a = normalizeAircraft(AC("ABC123", 34, -118, { dbFlags: 1 }));
  assert.equal(a.id, "abc123");
  assert.equal(a.callsign, "TEST1");
  assert.equal(a.military, true);
  assert.equal(a.altFt, 35000);
  assert.equal(a.speedKt, 450);
  const g = normalizeAircraft(AC("g1", 34, -118, { alt_baro: "ground" }));
  assert.equal(g.onGround, true);
  assert.equal(g.altFt, 0);
  assert.equal(normalizeAircraft({ hex: "x" }), null); // no position
});

// ---- license guard -----------------------------------------------------------
test("license guard: mvp allows, commercial blocks until cleared", () => {
  const mvp = loadConfig({});
  assert.ok(checkLicense("adsblol", mvp).allowed);
  assert.ok(checkLicense("airplaneslive", mvp).allowed);

  const com = loadConfig({ TRACKING_MODE: "commercial" });
  assert.equal(checkLicense("adsblol", com).allowed, false);
  assert.equal(checkLicense("airplaneslive", com).allowed, false);
  assert.equal(checkLicense("aisstream", com).allowed, false);
  assert.match(checkLicense("adsblol", com).reason, /LICENSE_CLEARED_ADSBLOL/);

  const cleared = loadConfig({ TRACKING_MODE: "commercial", LICENSE_CLEARED_ADSBLOL: "true" });
  assert.ok(checkLicense("adsblol", cleared).allowed);
  assert.equal(checkLicense("bogus", mvp).allowed, false);
});

// ---- AIS ---------------------------------------------------------------------
const aisCfg = { apiKey: "k", boxes: "chokepoints", staleAfterMs: 600000, keepMs: 1800000, maxVessels: 3 };
const pos = (mmsi, lat, lon, extra = {}) =>
  JSON.stringify({ MessageType: "PositionReport", MetaData: { MMSI: mmsi, ShipName: "EVER TEST  " }, Message: { PositionReport: { UserID: mmsi, Latitude: lat, Longitude: lon, Sog: 12.34, Cog: 90, TrueHeading: 511, ...extra } } });

test("AIS handler stores positions, ignores invalid ones, merges static data", () => {
  const p = createAisStreamProvider(aisCfg, {});
  p.handleMessage(pos(111, 26.5, 56.2));
  p.handleMessage(pos(222, 91, 181)); // not available
  p.handleMessage("not json");
  p.handleMessage(JSON.stringify({ error: "Api Key Is Not Valid" }));
  p.handleMessage(JSON.stringify({ MessageType: "ShipStaticData", MetaData: { MMSI: 111 }, Message: { ShipStaticData: { UserID: 111, Type: 80, Destination: "FUJAIRAH  " } } }));

  const hormuz = { south: 24, west: 54, north: 28, east: 58 };
  const out = p.query(hormuz);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, "EVER TEST");
  assert.equal(out[0].category, "tanker");
  assert.equal(out[0].destination, "FUJAIRAH");
  assert.equal(out[0].heading, null); // 511 = n/a
  assert.equal(out[0].speedKt, 12.3);
  assert.equal(p.query({ south: 0, west: 0, north: 1, east: 1 }).length, 0);
  assert.equal(p.status().lastError, "Api Key Is Not Valid");
});

test("AIS vessel cap and categories", () => {
  const p = createAisStreamProvider(aisCfg, {});
  for (let i = 1; i <= 5; i++) p.handleMessage(pos(i, 26, 56));
  assert.equal(p.status().vessels, 3);
  assert.equal(shipCategory(35), "military");
  assert.equal(shipCategory(72), "cargo");
  assert.equal(shipCategory(0), "unknown");
});

test("AIS provider subscribes over a (mock) websocket and reports status", async () => {
  let sent;
  class MockWS extends EventEmitter {
    constructor() { super(); MockWS.last = this; setTimeout(() => this.emit("open"), 0); }
    send(s) { sent = JSON.parse(s); }
    close() { this.emit("close"); }
  }
  const p = createAisStreamProvider(aisCfg, { WebSocketImpl: MockWS });
  assert.equal(p.status().state, "unavailable");
  p.start();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(sent.APIKey, "k");
  assert.ok(Array.isArray(sent.BoundingBoxes) && sent.BoundingBoxes.length >= 5);
  assert.deepEqual(sent.FilterMessageTypes, ["PositionReport", "ShipStaticData"]);
  MockWS.last.emit("message", pos(9, 26.5, 56.2));
  assert.equal(p.status().state, "warming"); // just (re)started
  p.stop();
  const q = createAisStreamProvider({ ...aisCfg, warmupMs: 0 }, { WebSocketImpl: MockWS });
  q.start();
  await new Promise((r) => setTimeout(r, 10));
  MockWS.last.emit("message", pos(9, 26.5, 56.2));
  assert.equal(q.status().state, "ok");
  q.stop();
});

test("AIS provider without key reports not-configured", () => {
  const p = createAisStreamProvider({ ...aisCfg, apiKey: "" }, {});
  p.start();
  assert.equal(p.status().state, "not-configured");
});

// ---- routes ------------------------------------------------------------------
function setup(env, fetchImpl) {
  const app = mockApp();
  const config = { ...loadConfig(env), upstreamMinIntervalMs: 0 };
  const handle = registerTracking(app, { config, fetchImpl, WebSocketImpl: class extends EventEmitter { send() {} close() {} } });
  return { app, handle };
}

test("route /api/aircraft: ok, filters to viewport, caches, normalizes", async () => {
  let calls = 0;
  const fetchImpl = async (url) => {
    calls++;
    assert.match(url, /^https:\/\/api\.adsb\.lol\/v2\/point\//);
    return { ok: true, json: async () => ({ ac: [AC("aaa", 34, -118), AC("bbb", 10, 10)] }) };
  };
  const { app } = setup({}, fetchImpl);
  const r = await call(app, "/api/aircraft", { bbox: VIEW });
  assert.equal(r.body.status, "ok");
  assert.equal(r.body.count, 1); // the one at (10,10) is outside the viewport
  assert.equal(r.body.items[0].id, "aaa");
  assert.match(r.body.meta.attribution, /adsb\.lol/);
  await call(app, "/api/aircraft", { bbox: VIEW });
  assert.equal(calls, 1); // second request served from cache
});

test("route /api/aircraft: upstream failure -> stale, then unavailable", async () => {
  let fail = false;
  const fetchImpl = async () => {
    if (fail) return { ok: false, status: 503, json: async () => ({}) };
    return { ok: true, json: async () => ({ ac: [AC("aaa", 34, -118)] }) };
  };
  const cfgEnv = { AIRCRAFT_CACHE_MS: "1" };
  const { app } = setup(cfgEnv, fetchImpl);
  assert.equal((await call(app, "/api/aircraft", { bbox: VIEW })).body.status, "ok");
  fail = true;
  await new Promise((r) => setTimeout(r, 5));
  const stale = (await call(app, "/api/aircraft", { bbox: VIEW })).body;
  assert.equal(stale.status, "stale");
  assert.equal(stale.count, 1);
  assert.match(stale.meta.message, /503/);
  const fresh = setup(cfgEnv, fetchImpl);
  const un = (await call(fresh.app, "/api/aircraft", { bbox: "10,10,12,12" })).body;
  assert.equal(un.status, "unavailable");
  assert.equal(un.count, 0);
});

test("route /api/aircraft: military endpoint", async () => {
  const urls = [];
  const fetchImpl = async (url) => { urls.push(url); return { ok: true, json: async () => ({ ac: [AC("m1", 34, -118, { dbFlags: 1 })] }) }; };
  const { app } = setup({}, fetchImpl);
  const r = await call(app, "/api/aircraft", { bbox: VIEW, mil: "1" });
  assert.match(urls[0], /\/v2\/mil$/);
  assert.equal(r.body.items[0].military, true);
});

test("route: bad bbox -> 400", async () => {
  const { app } = setup({}, async () => ({ ok: true, json: async () => ({}) }));
  assert.equal((await call(app, "/api/aircraft", { bbox: "x" })).code, 400);
  assert.equal((await call(app, "/api/ships", {})).code, 400);
});

test("commercial mode blocks uncleared providers, never calls upstream", async () => {
  let calls = 0;
  const { app } = setup({ TRACKING_MODE: "commercial" }, async () => { calls++; return { ok: true, json: async () => ({}) }; });
  const a = (await call(app, "/api/aircraft", { bbox: VIEW })).body;
  assert.equal(a.status, "license_blocked");
  assert.match(a.meta.message, /LICENSE_CLEARED_ADSBLOL/);
  const s = (await call(app, "/api/ships", { bbox: VIEW })).body;
  assert.equal(s.status, "license_blocked");
  assert.equal(calls, 0);
  const st = (await call(app, "/api/tracking/status")).body;
  assert.equal(st.aircraft.allowed, false);
});

test("provider switch via env: airplanes.live and custom adsbx", async () => {
  const seen = [];
  const fetchImpl = async (url, opts) => { seen.push({ url, headers: opts.headers }); return { ok: true, json: async () => ({ ac: [] }) }; };
  let s = setup({ AIRCRAFT_PROVIDER: "airplaneslive" }, fetchImpl);
  await call(s.app, "/api/aircraft", { bbox: VIEW });
  assert.match(seen[0].url, /api\.airplanes\.live/);

  s = setup({ AIRCRAFT_PROVIDER: "adsbx", ADSBX_BASE_URL: "https://paid.example/v2/", ADSBX_API_KEY: "secret", TRACKING_MODE: "commercial", LICENSE_CLEARED_ADSBX: "true" }, fetchImpl);
  await call(s.app, "/api/aircraft", { bbox: VIEW });
  const last = seen.at(-1);
  assert.match(last.url, /^https:\/\/paid\.example\/v2\/point\//);
  assert.equal(last.headers["api-auth"], "secret");
});

test("route /api/ships: no key -> not-configured with message; key set -> ok after messages", async () => {
  let s = setup({}, async () => ({ ok: true, json: async () => ({}) }));
  let r = (await call(s.app, "/api/ships", { bbox: "24,54,28,58" })).body;
  assert.equal(r.status, "not-configured");
  assert.match(r.meta.message, /AISSTREAM_API_KEY/);

  s = setup({ AISSTREAM_API_KEY: "k" }, async () => ({ ok: true, json: async () => ({}) }));
  s.handle.ships.handleMessage(pos(5, 26.5, 56.2));
  r = (await call(s.app, "/api/ships", { bbox: "24,54,28,58" })).body;
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].mmsi, 5);
  assert.equal(r.meta.coverage, "chokepoints");
});

test("SHIPS_PROVIDER=none disables ships cleanly", async () => {
  const s = setup({ SHIPS_PROVIDER: "none" }, async () => ({ ok: true, json: async () => ({}) }));
  const r = (await call(s.app, "/api/ships", { bbox: VIEW })).body;
  assert.equal(r.status, "disabled");
});

test("coverage counts ships per chokepoint", () => {
  const p = createAisStreamProvider(aisCfg, {});
  p.handleMessage(pos(1, 26.5, 56.2)); // Hormuz
  p.handleMessage(pos(2, 50.5, 1.0)); // English Channel
  p.handleMessage(pos(3, 50.6, 1.1)); // English Channel
  const c = p.coverage();
  assert.equal(c["Strait of Hormuz"], 1);
  assert.equal(c["English Channel"], 2);
  assert.equal(c["Suez Canal"], 0);
});

test("/api/ships returns watched zones with counts", async () => {
  const s = setup({ AISSTREAM_API_KEY: "k" }, async () => ({ ok: true, json: async () => ({}) }));
  s.handle.ships.handleMessage(pos(5, 26.5, 56.2));
  const r = (await call(s.app, "/api/ships", { bbox: "-90,-180,90,180" })).body;
  assert.equal(r.meta.zones.length, 10);
  const hormuz = r.meta.zones.find((z) => z.name === "Strait of Hormuz");
  assert.equal(hormuz.count, 1);
  assert.deepEqual(hormuz.box, [[24.0, 54.5], [27.8, 58.5]]);
  assert.equal(r.meta.zones.find((z) => z.name === "Suez Canal").count, 0);
});
