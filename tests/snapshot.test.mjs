// Hourly ship snapshot: collector -> data/ships.json -> snapshot provider -> /api/ships.
import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSnapshotShipsProvider } from "../tracking/shipsSnapshot.mjs";
import { collectAisSnapshot } from "../tracking/collect.mjs";
import { loadConfig } from "../tracking/config.mjs";
import { registerTracking } from "../tracking/index.mjs";

const dir = mkdtempSync(join(tmpdir(), "wr-ships-"));
const HOUR = 3600 * 1000;
const snap = (over = {}) => ({
  version: 1, source: "aisstream", generatedAt: new Date().toISOString(), collectedForSeconds: 150, coverage: "chokepoints",
  zones: [{ name: "Strait of Hormuz", box: [[24, 54.5], [27.8, 58.5]], count: 0 }, { name: "English Channel", box: [[49.5, -2], [51.5, 2.5]], count: 2 }],
  vessels: [
    { mmsi: 1, name: "A", lat: 50.5, lon: 1.0, category: "cargo", updatedAt: 2 },
    { mmsi: 2, name: "B", lat: 50.6, lon: 1.1, category: "tanker", updatedAt: 3 },
  ],
  ...over,
});
let n = 0;
const fileWith = (data) => { const f = join(dir, `ships-${n++}.json`); writeFileSync(f, typeof data === "string" ? data : JSON.stringify(data)); return f; };

test("no snapshot file yet -> not-configured, empty", () => {
  const p = createSnapshotShipsProvider({ file: join(dir, "missing.json"), staleAfterMs: 3 * HOUR });
  assert.equal(p.status().state, "not-configured");
  assert.match(p.status().lastError, /No ship snapshot/);
  assert.deepEqual(p.query({ south: -90, west: -180, north: 90, east: 180 }), []);
  assert.deepEqual(p.zones(), []);
});

test("fresh snapshot -> ok, area query, zones and coverage", () => {
  const p = createSnapshotShipsProvider({ file: fileWith(snap()), staleAfterMs: 3 * HOUR });
  const s = p.status();
  assert.equal(s.state, "ok");
  assert.equal(s.vessels, 2);
  const channel = p.query({ south: 49, west: -3, north: 52, east: 3 });
  assert.deepEqual(channel.map((v) => v.mmsi), [2, 1]); // newest first
  assert.equal(p.query({ south: 0, west: 0, north: 1, east: 1 }).length, 0);
  assert.equal(p.coverage()["Strait of Hormuz"], 0);
  assert.equal(p.coverage()["English Channel"], 2);
});

test("old snapshot -> stale", () => {
  const p = createSnapshotShipsProvider({ file: fileWith(snap({ generatedAt: new Date(Date.now() - 4 * HOUR).toISOString() })), staleAfterMs: 3 * HOUR });
  assert.equal(p.status().state, "stale");
});

test("a broken newer file keeps the last good snapshot", () => {
  const f = fileWith(snap());
  const p = createSnapshotShipsProvider({ file: f, staleAfterMs: 3 * HOUR });
  assert.equal(p.status().vessels, 2);
  writeFileSync(f, "{ not json");
  const later = new Date(Date.now() + 5000);
  utimesSync(f, later, later);
  assert.equal(p.status().vessels, 2);
  assert.ok(p.status().lastError);
});

test("collector listens, then returns a snapshot with vessels and zone counts", async () => {
  class MockWS extends EventEmitter {
    constructor() {
      super();
      setTimeout(() => {
        this.emit("open");
        const pos = (mmsi, lat, lon) => JSON.stringify({ MessageType: "PositionReport", MetaData: { MMSI: mmsi, ShipName: "S" + mmsi }, Message: { PositionReport: { UserID: mmsi, Latitude: lat, Longitude: lon, Sog: 10, Cog: 90, TrueHeading: 511 } } });
        this.emit("message", pos(7, 50.5, 1.0));
        this.emit("message", pos(8, 26.5, 56.2));
        this.emit("message", JSON.stringify({ MessageType: "ShipStaticData", MetaData: { MMSI: 8 }, Message: { ShipStaticData: { UserID: 8, Type: 80, Destination: "FUJAIRAH" } } }));
      }, 0);
    }
    send(s) { this.sub = JSON.parse(s); }
    close() {}
  }
  const cfg = loadConfig({ AISSTREAM_API_KEY: "k" });
  const { snapshot, status } = await collectAisSnapshot(cfg.ais, { WebSocketImpl: MockWS, seconds: 0.05 });
  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.source, "aisstream");
  assert.equal(snapshot.vessels.length, 2);
  const tanker = snapshot.vessels.find((v) => v.mmsi === 8);
  assert.equal(tanker.category, "tanker");
  assert.equal(tanker.destination, "FUJAIRAH");
  assert.equal(snapshot.zones.find((z) => z.name === "Strait of Hormuz").count, 1);
  assert.equal(snapshot.zones.find((z) => z.name === "English Channel").count, 1);
  assert.equal(status.messages, 3);
  // The snapshot it produces is exactly what the provider reads.
  const p = createSnapshotShipsProvider({ file: fileWith(snapshot), staleAfterMs: 3 * HOUR });
  assert.equal(p.status().state, "ok");
  assert.equal(p.query({ south: 24, west: 54, north: 28, east: 59 })[0].mmsi, 8);
});

// ---- route behaviour with the snapshot provider ----
function mockApp() { const routes = {}; return { get: (p, h) => (routes[p] = h), use: () => {}, routes }; }
async function call(app, path, query = {}) { let body; const res = { status() { return this; }, json(b) { body = b; return this; } }; await app.routes[path]({ query }, res); return body; }

test("snapshot is the default ship provider; /api/ships serves it with the source's credit", async () => {
  const f = fileWith(snap());
  const app = mockApp();
  registerTracking(app, { config: loadConfig({ SHIPS_SNAPSHOT_FILE: f }), fetchImpl: async () => ({ ok: true, json: async () => ({}) }) });
  const r = await call(app, "/api/ships", { bbox: "-90,-180,90,180" });
  assert.equal(r.provider, "snapshot");
  assert.equal(r.status, "ok");
  assert.equal(r.count, 2);
  assert.match(r.meta.attribution, /AISStream/);
  assert.ok(r.meta.snapshotAt);
  assert.equal(r.meta.zones.length, 2);
  const st = await call(app, "/api/tracking/status");
  assert.equal(st.ships.source, "aisstream");
});

test("no snapshot yet: friendly message, no crash", async () => {
  const app = mockApp();
  registerTracking(app, { config: loadConfig({ SHIPS_SNAPSHOT_FILE: join(dir, "nope.json") }), fetchImpl: async () => ({ ok: true, json: async () => ({}) }) });
  const r = await call(app, "/api/ships", { bbox: "-90,-180,90,180" });
  assert.equal(r.status, "not-configured");
  assert.match(r.meta.message, /No ship snapshot/);
});

test("commercial mode: a snapshot of AISStream data is blocked until AISStream is cleared", async () => {
  const f = fileWith(snap());
  let app = mockApp();
  registerTracking(app, { config: loadConfig({ SHIPS_SNAPSHOT_FILE: f, TRACKING_MODE: "commercial" }), fetchImpl: async () => ({ ok: true, json: async () => ({}) }) });
  let r = await call(app, "/api/ships", { bbox: "-90,-180,90,180" });
  assert.equal(r.status, "license_blocked");
  assert.match(r.meta.message, /LICENSE_CLEARED_AISSTREAM/);
  app = mockApp();
  registerTracking(app, { config: loadConfig({ SHIPS_SNAPSHOT_FILE: f, TRACKING_MODE: "commercial", LICENSE_CLEARED_AISSTREAM: "true" }), fetchImpl: async () => ({ ok: true, json: async () => ({}) }) });
  r = await call(app, "/api/ships", { bbox: "-90,-180,90,180" });
  assert.equal(r.status, "ok");
});
