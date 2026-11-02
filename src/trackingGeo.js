// Map math for the live aircraft / ship layers on the D3 world map.
// Kept separate from App.jsx so the big component file doesn't grow much.

export const WORLD_BBOX = "-90,-180,90,180";

export const AIRCRAFT_COLOR = "#7cc4ff";

export const SHIP_COLORS = {
  military: "#ff5c5c",
  "law-enforcement": "#ff5c5c",
  tanker: "#e8a33d",
  cargo: "#4fa6a0",
  passenger: "#b48cff",
  fishing: "#8bd17c",
  other: "#8795a7",
};

export const SHIP_LEGEND = [
  ["military", "MILITARY"],
  ["tanker", "TANKER"],
  ["cargo", "CARGO"],
  ["passenger", "PASSENGER"],
  ["other", "OTHER"],
];

export function shipColor(category) {
  return SHIP_COLORS[category] || SHIP_COLORS.other;
}

const r2 = (n) => Math.round(n * 100) / 100;

// Icons grow as you zoom in: small on the world view (where ships bunch up at chokepoints),
// about 2.5x bigger at full zoom so individual ships are easy to see and tap.
export function iconScale(k) {
  return 1 + 0.5 * Math.log2(Math.max(1, k));
}

// The part of the world currently on screen, as "south,west,north,east".
// Snapped outward to 5 degrees so small pans reuse the same request.
// Falls back to the whole world when zoomed out or when the view reaches past the globe's edge.
export function visibleBbox(projection, t, dims) {
  if (!projection || !projection.invert || t.k < 2) return WORLD_BBOX;
  let s = 90, n = -90, w = 180, e = -180;
  for (let i = 0; i <= 4; i++) {
    for (let j = 0; j <= 4; j++) {
      const mx = ((dims.w * i) / 4 - t.x) / t.k;
      const my = ((dims.h * j) / 4 - t.y) / t.k;
      const ll = projection.invert([mx, my]);
      if (!ll || !Number.isFinite(ll[0]) || !Number.isFinite(ll[1])) return WORLD_BBOX;
      const back = projection(ll);
      if (!back || Math.hypot(back[0] - mx, back[1] - my) > 1) return WORLD_BBOX; // off the globe
      s = Math.min(s, ll[1]); n = Math.max(n, ll[1]);
      w = Math.min(w, ll[0]); e = Math.max(e, ll[0]);
    }
  }
  const snap = 5;
  s = Math.max(-90, Math.floor((s - 3) / snap) * snap);
  n = Math.min(90, Math.ceil((n + 3) / snap) * snap);
  w = Math.max(-180, Math.floor((w - 3) / snap) * snap);
  e = Math.min(180, Math.ceil((e + 3) / snap) * snap);
  return `${s},${w},${n},${e}`;
}

// lon/lat -> map coordinates, once per data update (not on every zoom frame).
export function projectItems(items, projection) {
  const out = [];
  for (const item of items) {
    const p = projection([item.lon, item.lat]);
    if (p && Number.isFinite(p[0]) && Number.isFinite(p[1])) out.push({ x: p[0], y: p[1], item });
  }
  return out;
}

// One SVG path for every aircraft: a small arrowhead pointing along its heading.
// Sizes are divided by the zoom level so icons stay the same size on screen.
export function aircraftPath(projected, k) {
  const z = iconScale(k);
  const L = (6.5 * z) / k;
  const W = (4.5 * z) / k;
  let d = "";
  for (const { x, y, item } of projected) {
    if (item.heading == null) {
      const s = (3.2 * z) / k;
      d += `M${r2(x)},${r2(y - s)}L${r2(x + s)},${r2(y)}L${r2(x)},${r2(y + s)}L${r2(x - s)},${r2(y)}Z`;
      continue;
    }
    const h = (item.heading * Math.PI) / 180;
    const pt = (a, len) => `${r2(x + Math.sin(a) * len)},${r2(y - Math.cos(a) * len)}`;
    d += `M${pt(h, L)}L${pt(h + 2.5, W)}L${r2(x)},${r2(y)}L${pt(h - 2.5, W)}Z`;
  }
  return d;
}

// Ships as small diamonds, one path per colour so the whole layer is a handful of DOM nodes.
export function shipPaths(projected, k) {
  const s = (3.4 * iconScale(k)) / k;
  const byColor = new Map();
  for (const { x, y, item } of projected) {
    const c = shipColor(item.category);
    byColor.set(c, (byColor.get(c) || "") + `M${r2(x)},${r2(y - s)}L${r2(x + s)},${r2(y)}L${r2(x)},${r2(y + s)}L${r2(x - s)},${r2(y)}Z`);
  }
  return Array.from(byColor, ([color, d]) => ({ color, d }));
}

// Nearest aircraft/ship to a tap, within maxPx screen pixels.
export function hitTest(layers, point, k, maxPx = 16) {
  let best = null;
  let bestDist = Math.max(maxPx, 6 + 6 * iconScale(k)) / k;
  for (const { kind, projected } of layers) {
    for (const p of projected) {
      const dist = Math.hypot(p.x - point.x, p.y - point.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = { kind, item: p.item };
      }
    }
  }
  return best;
}

// Watched ship areas (lat/lon boxes) -> outline paths in map coordinates.
// Edges are sampled so they follow the map's curved meridians and parallels.
export function projectZones(zones, projection) {
  if (!Array.isArray(zones)) return [];
  const out = [];
  for (const z of zones) {
    const [[a, b], [c, d]] = z.box || [[0, 0], [0, 0]];
    const s = Math.min(a, c), n = Math.max(a, c), w = Math.min(b, d), e = Math.max(b, d);
    const ring = [];
    const N = 6;
    for (let i = 0; i <= N; i++) ring.push([w + ((e - w) * i) / N, n]);
    for (let i = 1; i <= N; i++) ring.push([e, n - ((n - s) * i) / N]);
    for (let i = 1; i <= N; i++) ring.push([e - ((e - w) * i) / N, s]);
    for (let i = 1; i < N; i++) ring.push([w, s + ((n - s) * i) / N]);
    const pts = ring.map((ll) => projection(ll)).filter((p) => p && Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (pts.length < 4) continue;
    const label = projection([w, n]);
    out.push({
      name: z.name,
      count: Number(z.count) || 0,
      d: "M" + pts.map((p) => `${r2(p[0])},${r2(p[1])}`).join("L") + "Z",
      lx: label ? label[0] : pts[0][0],
      ly: label ? label[1] : pts[0][1],
    });
  }
  return out;
}

export function trackId(kind, item) {
  return kind === "air" ? `air:${item.id}` : `ship:${item.mmsi}`;
}

export function timeAgo(ms) {
  if (!ms) return "";
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  return `${Math.round(m / 60)} h ago`;
}

// A pinnable snapshot of an aircraft or ship, shaped like a news report so the existing
// "pin to marker" system can store and list it. Positions change, so the snapshot
// records where it was and when.
export function trackToReport(kind, item, fetchedAt) {
  const isAir = kind === "air";
  const t = isAir ? (fetchedAt ? Date.parse(fetchedAt) : Date.now()) : item.updatedAt || Date.now();
  const when = new Date(t);
  const p = (n) => String(n).padStart(2, "0");
  const utc = `${p(when.getUTCHours())}:${p(when.getUTCMinutes())} UTC`;
  const pos = `${Math.abs(item.lat).toFixed(2)}°${item.lat >= 0 ? "N" : "S"}, ${Math.abs(item.lon).toFixed(2)}°${item.lon >= 0 ? "E" : "W"}`;
  const n = (v, unit) => (v == null ? null : `${Number(v).toLocaleString()}${unit}`);
  const minute = Math.floor(t / 60000);
  if (isAir) {
    const name = item.callsign || item.reg || (item.id || "").toUpperCase() || "Unknown aircraft";
    const bits = [item.onGround ? "on the ground" : n(item.altFt, " ft"), n(item.speedKt, " kt"), item.heading != null ? `heading ${item.heading}°` : null].filter(Boolean);
    return {
      id: `track:air:${item.id}:${minute}`,
      sourceType: "aircraft",
      source: "ADS-B · adsb.lol",
      headline: `${name}${item.type ? ` · ${item.type}` : ""}`,
      summary: `Military-flagged aircraft${bits.length ? `, ${bits.join(", ")}` : ""}. Position ${pos} at ${utc}.`,
      date: when.toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }),
      publishedAt: when.toISOString(),
      url: `https://globe.adsb.lol/?icao=${encodeURIComponent(item.id || "")}`,
      lat: item.lat,
      lon: item.lon,
    };
  }
  const cat = item.category && item.category !== "unknown" ? item.category : "vessel";
  const bits = [n(item.speedKt, " kt"), item.course != null ? `course ${item.course}°` : null, item.destination ? `bound for ${item.destination}` : null].filter(Boolean);
  return {
    id: `track:ship:${item.mmsi}:${minute}`,
    sourceType: "vessel",
    source: "AIS · AISStream.io",
    headline: `${item.name || `MMSI ${item.mmsi}`} · ${cat.toUpperCase()}`,
    summary: `${cat[0].toUpperCase()}${cat.slice(1)}${bits.length ? `, ${bits.join(", ")}` : ""}. Position ${pos} at ${utc}, self-reported by the ship.`,
    date: when.toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }),
    publishedAt: when.toISOString(),
    url: `https://www.marinetraffic.com/en/ais/details/ships/mmsi:${encodeURIComponent(item.mmsi)}`,
    lat: item.lat,
    lon: item.lon,
  };
}
