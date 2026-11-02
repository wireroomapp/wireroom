// Listen to AISStream for a fixed time and return a snapshot in the shipsSnapshot.mjs format.
// Used by scripts/collect-ships.mjs. A future paid provider only needs its own collect
// function that returns the same snapshot shape.

import { createAisStreamProvider } from "./ships.mjs";
import { SNAPSHOT_VERSION } from "./shipsSnapshot.mjs";

const WORLD = { south: -90, west: -180, north: 90, east: 180 };
const round = (n, d) => (Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : null);

function compact(v) {
  return {
    mmsi: v.mmsi,
    name: v.name || null,
    lat: round(v.lat, 5),
    lon: round(v.lon, 5),
    speedKt: v.speedKt ?? null,
    course: v.course ?? null,
    heading: v.heading ?? null,
    type: v.type ?? null,
    category: v.category || "unknown",
    destination: v.destination || null,
    updatedAt: v.updatedAt || null,
  };
}

export async function collectAisSnapshot(aisConfig, { WebSocketImpl, seconds = 150, now = () => Date.now(), maxVessels = 5000 } = {}) {
  const provider = createAisStreamProvider({ ...aisConfig, warmupMs: 0 }, { WebSocketImpl, now });
  provider.start();
  await new Promise((r) => setTimeout(r, seconds * 1000));
  const status = provider.status();
  const vessels = provider.query(WORLD, maxVessels).map(compact);
  const zones = provider.zones();
  provider.stop();
  return {
    status,
    snapshot: {
      version: SNAPSHOT_VERSION,
      source: "aisstream",
      generatedAt: new Date(now()).toISOString(),
      collectedForSeconds: seconds,
      coverage: aisConfig.boxes === "global" ? "global" : "chokepoints",
      zones,
      vessels,
    },
  };
}
