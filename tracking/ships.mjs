// Ship tracking via AISStream.io (free WebSocket). The API key stays on the server.
//
// To move to a paid AIS source later, add another provider that returns the same
// object shape: { key, start(), stop(), status(), query(bbox, max) } and select it
// in index.mjs with SHIPS_PROVIDER. See ships-template.mjs.

import { inBbox } from "./util.mjs";

// Watched waters: strategic chokepoints and Indian Ocean ports (APPROXIMATE boxes: [[lat1,lon1],[lat2,lon2]]).
// Watching only these keeps the free stream light and fits a geopolitics product.
export const CHOKEPOINT_BOXES = [
  [[24.0, 54.5], [27.8, 58.5]], // Strait of Hormuz / Gulf of Oman
  [[11.0, 42.0], [14.8, 45.8]], // Bab el-Mandeb / Gulf of Aden mouth
  [[27.5, 32.0], [31.5, 34.0]], // Suez Canal / Gulf of Suez
  [[0.5, 100.0], [4.5, 104.5]], // Malacca / Singapore Strait
  [[22.0, 117.5], [26.5, 122.0]], // Taiwan Strait
  [[40.8, 27.5], [46.8, 41.8]], // Black Sea incl. Bosphorus
  [[35.5, -6.5], [36.5, -4.8]], // Strait of Gibraltar
  [[8.5, -80.2], [9.6, -79.3]], // Panama Canal
  [[49.5, -2.0], [51.5, 2.5]], // English Channel / Dover
  [[54.5, 9.5], [56.5, 13.5]], // Danish straits / Baltic entrance
  // Indian Ocean ports and passages (Djibouti is inside the Bab el-Mandeb box)
  [[18.6, 72.5], [19.3, 73.1]], // Mumbai / Nhava Sheva (JNPT)
  [[5.7, 79.5], [7.3, 81.4]], // Sri Lanka: Colombo and Hambantota
  [[24.8, 61.9], [25.4, 62.7]], // Gwadar
  [[21.7, 91.3], [22.5, 92.0]], // Chittagong
  [[5.5, 92.5], [7.5, 95.5]], // Six Degree Channel (western entrance to Malacca)
];
// Display names, same order as the boxes above.
export const CHOKEPOINT_NAMES = [
  "Strait of Hormuz", "Bab el-Mandeb", "Suez Canal", "Malacca / Singapore", "Taiwan Strait",
  "Black Sea", "Gibraltar", "Panama Canal", "English Channel", "Danish straits",
  "Mumbai / JNPT", "Colombo / Hambantota", "Gwadar", "Chittagong", "Six Degree Channel",
];

export function shipCategory(code) {
  const t = Number(code);
  if (!Number.isFinite(t) || t <= 0) return "unknown";
  if (t === 35) return "military";
  if (t === 30) return "fishing";
  if (t >= 60 && t <= 69) return "passenger";
  if (t >= 70 && t <= 79) return "cargo";
  if (t >= 80 && t <= 89) return "tanker";
  if (t === 31 || t === 32 || t === 52) return "tug";
  if (t === 36 || t === 37) return "pleasure";
  if (t === 51 || t === 55) return "law-enforcement";
  return "other";
}

function resolveBoxes(setting) {
  if (setting === "global") return [[[-90, -180], [90, 180]]];
  if (setting && setting !== "chokepoints") {
    try {
      const parsed = JSON.parse(setting);
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch {
      /* fall through to default */
    }
  }
  return CHOKEPOINT_BOXES;
}

export function createAisStreamProvider(aisConfig, { WebSocketImpl, now = () => Date.now() } = {}) {
  const store = new Map(); // mmsi -> vessel
  const boxes = resolveBoxes(aisConfig.boxes);
  const st = { connected: false, lastMessageAt: 0, messages: 0, lastError: "", started: false, startedAt: 0 };
  // The backend redeploys every hour (each new cache.json commit), which empties this
  // in-memory store. Ships report every few seconds to a few minutes, so the map refills
  // over the first few minutes. We call that "warming" so the UI can say so.
  const warmupMs = aisConfig.warmupMs ?? 4 * 60 * 1000;
  let ws = null;
  let stopped = false;
  let backoff = 2000;
  let pruneTimer = null;

  function handleMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(typeof raw === "string" ? raw : raw.toString());
    } catch {
      return;
    }
    if (msg.error) {
      st.lastError = String(msg.error);
      return;
    }
    const meta = msg.MetaData || {};
    const mmsi = meta.MMSI || msg.Message?.PositionReport?.UserID || msg.Message?.ShipStaticData?.UserID;
    if (!mmsi) return;
    st.lastMessageAt = now();
    st.messages += 1;

    const prev = store.get(mmsi) || { mmsi, type: null, category: "unknown", destination: null, name: null };

    if (msg.MessageType === "PositionReport" && msg.Message?.PositionReport) {
      const p = msg.Message.PositionReport;
      const lat = Number(p.Latitude);
      const lon = Number(p.Longitude);
      // 91 / 181 mean "position not available" in AIS
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return;
      const sog = Number(p.Sog);
      const cog = Number(p.Cog);
      const hdg = Number(p.TrueHeading);
      if (!store.has(mmsi) && store.size >= aisConfig.maxVessels) return;
      store.set(mmsi, {
        ...prev,
        mmsi,
        name: String(meta.ShipName || prev.name || "").trim() || null,
        lat,
        lon,
        speedKt: Number.isFinite(sog) && sog < 102.3 ? Math.round(sog * 10) / 10 : null,
        course: Number.isFinite(cog) && cog < 360 ? Math.round(cog) : null,
        heading: Number.isFinite(hdg) && hdg < 360 ? Math.round(hdg) : null,
        updatedAt: now(),
      });
    } else if (msg.MessageType === "ShipStaticData" && msg.Message?.ShipStaticData) {
      const s = msg.Message.ShipStaticData;
      store.set(mmsi, {
        ...prev,
        mmsi,
        name: String(s.Name || meta.ShipName || prev.name || "").trim() || null,
        type: Number(s.Type) || prev.type,
        category: shipCategory(s.Type),
        destination: String(s.Destination || "").trim() || prev.destination,
      });
    }
  }

  function connect() {
    if (stopped || !WebSocketImpl) return;
    try {
      ws = new WebSocketImpl(aisConfig.url || "wss://stream.aisstream.io/v0/stream");
    } catch (e) {
      st.lastError = String(e.message || e);
      scheduleReconnect();
      return;
    }
    ws.on("open", () => {
      st.connected = true;
      backoff = 2000;
      // AISStream wants the subscription right after connecting.
      ws.send(
        JSON.stringify({
          APIKey: aisConfig.apiKey,
          BoundingBoxes: boxes,
          FilterMessageTypes: ["PositionReport", "ShipStaticData"],
        })
      );
    });
    ws.on("message", handleMessage);
    ws.on("error", (e) => {
      st.lastError = String(e.message || e);
    });
    ws.on("close", () => {
      st.connected = false;
      scheduleReconnect();
    });
  }

  function scheduleReconnect() {
    if (stopped) return;
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 60000);
  }

  function prune() {
    const cutoff = now() - aisConfig.keepMs;
    for (const [k, v] of store) if ((v.updatedAt || 0) < cutoff) store.delete(k);
  }

  return {
    key: "aisstream",
    handleMessage, // exported for tests
    start() {
      if (st.started) return;
      if (!aisConfig.apiKey) {
        st.lastError = "AISSTREAM_API_KEY not set";
        return;
      }
      st.started = true;
      st.startedAt = now();
      stopped = false;
      connect();
      pruneTimer = setInterval(prune, 60000);
      pruneTimer.unref?.();
    },
    stop() {
      stopped = true;
      clearInterval(pruneTimer);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    },
    status() {
      const age = st.lastMessageAt ? now() - st.lastMessageAt : null;
      let state = "ok";
      if (!aisConfig.apiKey) state = "not-configured";
      else if (!st.connected && !st.lastMessageAt) state = "unavailable";
      else if (age === null || age > aisConfig.staleAfterMs) state = "stale";
      else if (st.startedAt && now() - st.startedAt < warmupMs) state = "warming";
      return { state, connected: st.connected, lastMessageAt: st.lastMessageAt || null, messages: st.messages, vessels: store.size, lastError: st.lastError };
    },
    // The watched areas with how many ships we currently hold in each. Drawn as outlines on the
    // map, so an empty area reads as "no free coverage here" instead of "the app is broken".
    zones() {
      if (aisConfig.boxes === "global") return [];
      const named = boxes === CHOKEPOINT_BOXES;
      const counts = boxes.map(() => 0);
      for (const v of store.values()) {
        if (v.lat === undefined) continue;
        const i = boxes.findIndex(([[a, b], [c, d]]) =>
          v.lat >= Math.min(a, c) && v.lat <= Math.max(a, c) && v.lon >= Math.min(b, d) && v.lon <= Math.max(b, d));
        if (i >= 0) counts[i] += 1;
      }
      return boxes.map((box, i) => ({ name: named ? CHOKEPOINT_NAMES[i] : `Area ${i + 1}`, box, count: counts[i] }));
    },
    // Same counts as a simple { name: count } object, for /api/tracking/status.
    coverage() {
      const out = {};
      for (const z of this.zones()) out[z.name] = z.count;
      return out;
    },
    query(bbox, max = 1500) {
      const out = [];
      for (const v of store.values()) {
        if (v.lat === undefined) continue;
        if (inBbox(v.lat, v.lon, bbox)) out.push(v);
      }
      out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      return out.slice(0, max);
    },
  };
}
