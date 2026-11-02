// Ships from a saved snapshot file instead of a live connection.
//
// Why: AISStream allows 3 connections per internet address, counted before your key is
// checked. Render's free servers share their addresses with other customers, so a live
// connection from Render is usually refused (HTTP 429). Instead, a collector
// (scripts/collect-ships.mjs, run hourly by GitHub Actions) listens for a couple of
// minutes and saves what it heard to data/ships.json. This provider serves that file.
//
// Interchangeable: anything that writes a file in this format can feed the map
// (AISStream today; a paid satellite AIS API later), and this provider has the same
// interface as the live one (status/query/zones/coverage), so routes and UI don't change.
//
// File format (version 1):
// { version: 1, source: "aisstream", generatedAt: ISO time, collectedForSeconds: n,
//   coverage: "chokepoints" | "global", zones: [{ name, box, count }],
//   vessels: [{ mmsi, name, lat, lon, speedKt, course, heading, type, category, destination, updatedAt }] }

import { readFileSync, statSync } from "node:fs";
import { inBbox } from "./util.mjs";

export const SNAPSHOT_VERSION = 1;

export function createSnapshotShipsProvider({ file, staleAfterMs }, { now = () => Date.now(), fs = { readFileSync, statSync } } = {}) {
  let memo = { mtimeMs: -1, data: null, error: "" };

  // Re-read only when the file changes (it's replaced when a new snapshot is deployed).
  function load() {
    try {
      const { mtimeMs } = fs.statSync(file);
      if (mtimeMs !== memo.mtimeMs) {
        const data = JSON.parse(fs.readFileSync(file, "utf-8"));
        if (!data || !Array.isArray(data.vessels)) throw new Error("Ship snapshot file is not in the expected format");
        memo = { mtimeMs, data, error: "" };
      }
    } catch (e) {
      // Keep serving the last good snapshot if a newer file is unreadable.
      memo = { ...memo, error: e && e.code === "ENOENT" ? "No ship snapshot has been collected yet" : String((e && e.message) || e) };
    }
    return memo.data;
  }

  return {
    key: "snapshot",
    start() {},
    stop() {},
    status() {
      const d = load();
      if (!d) return { state: "not-configured", snapshotAt: null, vessels: 0, source: null, lastError: memo.error };
      const at = Date.parse(d.generatedAt) || 0;
      return {
        state: now() - at > staleAfterMs ? "stale" : "ok",
        snapshotAt: d.generatedAt || null,
        collectedForSeconds: d.collectedForSeconds ?? null,
        vessels: d.vessels.length,
        source: d.source || null,
        lastError: memo.error,
      };
    },
    zones() {
      const d = load();
      return d && Array.isArray(d.zones) ? d.zones : [];
    },
    coverage() {
      const out = {};
      for (const z of this.zones()) out[z.name] = z.count;
      return out;
    },
    query(bbox, max = 1500) {
      const d = load();
      if (!d) return [];
      const out = d.vessels.filter((v) => Number.isFinite(v.lat) && Number.isFinite(v.lon) && inBbox(v.lat, v.lon, bbox));
      out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      return out.slice(0, max);
    },
  };
}
