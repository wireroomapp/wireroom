// Small shared helpers: bbox parsing/math, throttled fetch, TTL cache.

const NM_PER_DEG_LAT = 60;

export function parseBbox(str) {
  if (typeof str !== "string") return null;
  const parts = str.split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  let [south, west, north, east] = parts;
  south = Math.max(-90, Math.min(90, south));
  north = Math.max(-90, Math.min(90, north));
  west = Math.max(-180, Math.min(180, west));
  east = Math.max(-180, Math.min(180, east));
  if (south >= north) return null;
  return { south, west, north, east };
}

export function inBbox(lat, lon, b) {
  if (lat < b.south || lat > b.north) return false;
  // west > east means the box crosses the antimeridian
  return b.west <= b.east ? lon >= b.west && lon <= b.east : lon >= b.west || lon <= b.east;
}

// Convert a viewport box to a centre point + radius in nautical miles (what ADS-B APIs want).
export function bboxToCircle(b, maxRadiusNm = 250) {
  const lat = (b.south + b.north) / 2;
  let widthDeg = b.east - b.west;
  if (widthDeg < 0) widthDeg += 360;
  const lon0 = b.west + widthDeg / 2;
  const lon = lon0 > 180 ? lon0 - 360 : lon0;
  const halfHeightNm = ((b.north - b.south) / 2) * NM_PER_DEG_LAT;
  const halfWidthNm = (widthDeg / 2) * NM_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
  const needed = Math.hypot(halfHeightNm, halfWidthNm);
  const radiusNm = Math.min(maxRadiusNm, Math.max(10, needed));
  return { lat, lon, radiusNm, truncated: needed > maxRadiusNm };
}

// Round so nearby viewports share one cached upstream call.
export function quantizeCircle(c) {
  return {
    lat: Math.round(c.lat * 4) / 4,
    lon: Math.round(c.lon * 4) / 4,
    radiusNm: Math.min(250, Math.ceil(c.radiusNm / 25) * 25),
    truncated: c.truncated,
  };
}

// Serialises upstream calls and keeps a minimum gap between them.
export function createThrottledFetcher({ fetchImpl = fetch, minIntervalMs = 1100, timeoutMs = 10000, headers = {} } = {}) {
  let chain = Promise.resolve();
  let last = 0;
  return function throttledFetchJson(url, extraHeaders = {}) {
    const run = async () => {
      const wait = Math.max(0, last + minIntervalMs - Date.now());
      if (wait) await new Promise((r) => setTimeout(r, wait));
      last = Date.now();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetchImpl(url, {
          signal: ctrl.signal,
          headers: { "User-Agent": "WireRoom/1.0 (+https://wireroom.onrender.com)", Accept: "application/json", ...headers, ...extraHeaders },
        });
        if (!res.ok) {
          const err = new Error(`Upstream HTTP ${res.status}`);
          err.status = res.status;
          throw err;
        }
        return await res.json();
      } finally {
        clearTimeout(timer);
      }
    };
    const p = chain.then(run, run);
    chain = p.catch(() => {});
    return p;
  };
}

// TTL cache that can still hand back old data if the upstream fails.
export function createCache() {
  const map = new Map();
  return {
    get(key, ttlMs) {
      const e = map.get(key);
      return e && Date.now() - e.at < ttlMs ? e.value : null;
    },
    getStale(key) {
      const e = map.get(key);
      return e ? { value: e.value, at: e.at } : null;
    },
    set(key, value) {
      map.set(key, { value, at: Date.now() });
      if (map.size > 200) map.delete(map.keys().next().value);
    },
  };
}
