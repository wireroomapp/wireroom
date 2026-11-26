import { geoNaturalEarth1, geoCircle, geoDistance } from "d3";

// Where analyst annotations (markers, lines, shapes, circles, areas, notes) are stored.
//
// The map redraws itself to fit its box: opening the side panel narrows the map, which
// changes the projection's scale and offset. Annotations used to be saved in screen pixels,
// so they slid off the places they were drawn on. Now they are saved in "map units"
// (projection space with scale 1 and no offset), which stay attached to the same spot on
// Earth at any map size. They are converted back to pixels only when drawn.

export const STORAGE_KEY = "wireroom-annotations-v2"; // map units
export const LEGACY_KEY = "wireroom-annotations-v1"; // screen pixels (older versions)

function convert(a, fx, fy, fl) {
  const out = { ...a };
  if (a.type === "line") {
    out.x1 = fx(a.x1); out.y1 = fy(a.y1); out.x2 = fx(a.x2); out.y2 = fy(a.y2);
  } else if (a.type === "polygon") {
    out.points = (Array.isArray(a.points) ? a.points : []).map((p) => ({ x: fx(p.x), y: fy(p.y) }));
  } else if (Number.isFinite(a.x) && Number.isFinite(a.y)) {
    // A circle's center moves like a marker; its radius is a real distance (km), not a size on screen.
    out.x = fx(a.x); out.y = fy(a.y);
    if (a.type === "shape") { out.width = fl(a.width); out.height = fl(a.height); }
  }
  return out;
}

// Screen pixels (at this projection) -> map units.
export function toUnit(a, projection) {
  const s = projection.scale();
  const [tx, ty] = projection.translate();
  return convert(a, (x) => (x - tx) / s, (y) => (y - ty) / s, (l) => l / s);
}

// Map units -> screen pixels (at this projection).
export function toPixel(a, projection) {
  if (a.legacy) return a; // not converted yet; still in old pixel form
  const s = projection.scale();
  const [tx, ty] = projection.translate();
  return convert(a, (x) => x * s + tx, (y) => y * s + ty, (l) => l * s);
}

// Annotations saved by older versions are in pixels. Mark them so they can be converted
// once the map's real size is known.
export function loadAnnotations(storage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      if (Array.isArray(saved)) return saved;
    }
    const old = storage.getItem(LEGACY_KEY);
    if (old) {
      const saved = JSON.parse(old);
      if (Array.isArray(saved)) return saved.map((a) => ({ ...a, legacy: true }));
    }
  } catch {
    /* unreadable storage: start empty */
  }
  return [];
}

// Convert any old pixel annotations using the projection they were most likely drawn with
// (the full-width map at page load).
export function migrateLegacy(list, projection) {
  if (!list.some((a) => a.legacy)) return list;
  return list.map((a) => {
    if (!a.legacy) return a;
    const rest = { ...a };
    delete rest.legacy;
    return toUnit(rest, projection);
  });
}

// ---- Bridge to real-world coordinates (used by the MapLibre map) ----
// "Map units" are Natural Earth projection coordinates at scale 1 with no offset, so the
// same projection with scale 1 converts them to and from longitude/latitude exactly.
const UNIT = geoNaturalEarth1().scale(1).translate([0, 0]);

export function unitToLonLat(x, y) {
  const ll = UNIT.invert([x, y]);
  return ll && Number.isFinite(ll[0]) && Number.isFinite(ll[1]) && Math.abs(ll[1]) <= 90 ? [Math.max(-180, Math.min(180, ll[0])), ll[1]] : null;
}
export function lonLatToUnit(lon, lat) {
  const p = UNIT([lon, lat]);
  return p && Number.isFinite(p[0]) ? { x: p[0], y: p[1] } : null;
}

// ---- Real distances, for circles (a blast radius, a shelter zone, a missile's range) ----
export const EARTH_KM = 6371.0088; // mean Earth radius
export const KM_PER_MI = 1.609344;
export const KM_PER_DEG = (EARTH_KM * Math.PI) / 180; // km along one degree of a great circle
export const MAX_RADIUS_KM = 20000; // half way round the world
export const DEFAULT_COLOR = "#d7dde8";

// Great-circle distance between two [lon, lat] points, in km.
export function distanceKm(a, b) {
  return geoDistance(a, b) * EARTH_KM;
}

export const kmFrom = (value, unit) => (unit === "km" ? value : value * KM_PER_MI);
export const kmTo = (km, unit) => (unit === "km" ? km : km / KM_PER_MI);

// 20 -> "20", 3.25 -> "3.3", 1234 -> "1,234" (one decimal under 10, whole numbers above).
export function roundDistance(v) {
  if (!Number.isFinite(v)) return 0;
  return v < 10 ? Math.round(v * 10) / 10 : Math.round(v);
}
export function formatDistance(km, unit = "mi") {
  const u = unit === "km" ? "km" : "mi";
  return `${roundDistance(kmTo(km, u)).toLocaleString("en-US")} ${u}`;
}

// The outline of a circle on the Earth's surface: every point is radiusKm from the center,
// so it stays a true distance ring on any projection (it looks oval far from the equator,
// as it should on a flat map). Longitudes are unwrapped so a ring across the date line
// doesn't streak across the whole map.
export function circleRing(lon, lat, radiusKm, steps = 96) {
  const deg = Math.min(radiusKm, MAX_RADIUS_KM) / KM_PER_DEG;
  const ring = geoCircle().center([lon, lat]).radius(deg).precision(360 / steps)().coordinates[0];
  let prev = lon;
  return ring.map(([x, y]) => {
    let ux = x;
    while (ux - prev > 180) ux -= 360;
    while (prev - ux > 180) ux += 360;
    prev = ux;
    return [ux, y];
  });
}

// Every [lon, lat] an annotation reaches (to frame someone's map so all of it shows).
export function annotationLonLats(a) {
  if (!a || a.legacy) return [];
  let pts;
  if (a.type === "line") pts = [unitToLonLat(a.x1, a.y1), unitToLonLat(a.x2, a.y2)];
  else if (a.type === "polygon") pts = (a.points || []).map((p) => unitToLonLat(p.x, p.y));
  else if (a.type === "circle") {
    const c = unitToLonLat(a.x, a.y);
    pts = c && a.radiusKm > 0 ? circleRing(c[0], c[1], a.radiusKm, 16) : [c];
  } else {
    pts = [unitToLonLat(a.x, a.y)];
    if (a.type === "shape") pts.push(unitToLonLat(a.x + a.width, a.y + a.height));
  }
  return pts.filter(Boolean);
}

// The middle of an area's corners (where its name goes).
function middle(points) {
  const n = points.length;
  return [points.reduce((s, p) => s + p[0], 0) / n, points.reduce((s, p) => s + p[1], 0) / n];
}

// Annotations (stored in map units) as GeoJSON features for MapLibre.
export function annotationsToGeoJSON(list, selectedId) {
  const features = [];
  for (const a of list) {
    if (a.legacy) continue; // still in old pixel form; converted shortly after load
    const sel = a.id === selectedId;
    if (a.type === "circle") {
      const c = unitToLonLat(a.x, a.y);
      if (!c || !(a.radiusKm > 0)) continue;
      const color = a.color || DEFAULT_COLOR;
      features.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [circleRing(c[0], c[1], a.radiusKm)] }, properties: { id: a.id, kind: "area", color, sel } });
      // Name and radius sit just above the ring's top edge, clear of whatever is at its center.
      const radius = `${formatDistance(a.radiusKm, a.unit)} radius`;
      const top = [c[0], Math.min(85, c[1] + Math.min(a.radiusKm, MAX_RADIUS_KM) / KM_PER_DEG)];
      features.push({ type: "Feature", geometry: { type: "Point", coordinates: top }, properties: { id: a.id, kind: "area-label", label: a.label ? `${a.label}\n${radius}` : radius, anchor: "bottom", color, sel } });
      continue;
    }
    if (a.type === "polygon") {
      const pts = (a.points || []).map((p) => unitToLonLat(p.x, p.y));
      if (pts.length < 3 || pts.some((p) => !p)) continue;
      const color = a.color || DEFAULT_COLOR;
      features.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [[...pts, pts[0]]] }, properties: { id: a.id, kind: "area", color, sel } });
      if (a.label) features.push({ type: "Feature", geometry: { type: "Point", coordinates: middle(pts) }, properties: { id: a.id, kind: "area-label", label: a.label, anchor: "center", color, sel } });
      continue;
    }
    if (a.type === "marker" || a.type === "text") {
      const ll = unitToLonLat(a.x, a.y);
      if (!ll) continue;
      features.push({ type: "Feature", geometry: { type: "Point", coordinates: ll },
        properties: { id: a.id, kind: a.type, label: (a.type === "text" ? a.text : a.label) || "", color: a.color || "#d7dde8", pins: (a.pins || []).length, sel } });
    } else if (a.type === "line") {
      const p1 = unitToLonLat(a.x1, a.y1), p2 = unitToLonLat(a.x2, a.y2);
      if (!p1 || !p2) continue;
      features.push({ type: "Feature", geometry: { type: "LineString", coordinates: [p1, p2] }, properties: { id: a.id, kind: "line", label: a.label || "", sel } });
    } else if (a.type === "shape") {
      const nw = unitToLonLat(a.x, a.y), se = unitToLonLat(a.x + a.width, a.y + a.height);
      if (!nw || !se) continue;
      const [w, n] = nw, [e, s] = se;
      features.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [[[w, n], [e, n], [e, s], [w, s], [w, n]]] }, properties: { id: a.id, kind: "shape", label: a.label || "", sel, lx: w, ly: n } });
    }
  }
  return { type: "FeatureCollection", features };
}
