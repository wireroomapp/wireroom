import { useEffect, useLayoutEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { buildStyle, applyBase, makeIcons, BASES } from "./wireroomStyle.js";
import { WORLD_BBOX, trackId } from "../trackingGeo.js";

// The full-scale map: MapLibre (free, open source) drawing OpenStreetMap data from
// OpenFreeMap, NASA imagery, and free elevation data. Flat or globe, optional 3D terrain.
// Wire Room's own layers (country dots, ships, planes, coverage outlines) are drawn by
// MapLibre too, so they stay attached to the right place at every zoom, size and projection.

const PREFS_KEY = "wireroom-map-view-v1";
const TILT_ZOOM = 4; // below this zoom the camera stays level (whole-globe view)
const ZONE_SHOW = new Set(["ok", "warming", "stale"]);
const EMPTY = { type: "FeatureCollection", features: [] };

function loadPrefs() {
  try { return { base: "map", globe: false, terrain: false, ...JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") }; }
  catch { return { base: "map", globe: false, terrain: false }; }
}
function savePrefs(p) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* private mode: fine */ }
}

// Visible area as "south,west,north,east", snapped outward to 5 degrees so small moves reuse requests.
function viewBbox(map) {
  if (map.getZoom() < 2.5) return WORLD_BBOX;
  const b = map.getBounds();
  const w = b.getWest(), e = b.getEast();
  if (e - w >= 300 || w < -180 || e > 180) return WORLD_BBOX;
  const snap = (v, f) => f(v / 5) * 5;
  const s = Math.max(-90, snap(b.getSouth() - 3, Math.floor)), n = Math.min(90, snap(b.getNorth() + 3, Math.ceil));
  return `${s},${Math.max(-180, snap(w - 3, Math.floor))},${n},${Math.min(180, snap(e + 3, Math.ceil))}`;
}

const point = (lon, lat, properties) => ({ type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] }, properties });

export default function MapLibreView({
  countries, selectedId, hasNews, onCountryClick,
  aircraft, ships, zones, shipsStatus, airOn, shipsOn,
  selectedTrack, onTrackClick, onEmptyClick, onViewChange,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [prefs, setPrefs] = useState(loadPrefs);
  const lookup = useRef(new Map()); // track key -> full item, for taps
  const terrainOn = useRef(false); // 3D terrain setting, readable from map event handlers
  const autoTilted = useRef(false); // did we already tilt for this zoom-in?
  const prevTerrain = useRef(null);
  // Latest callbacks for the map's event handlers (which are set up once).
  const cb = useRef({});
  useLayoutEffect(() => {
    cb.current = { onCountryClick, onTrackClick, onEmptyClick, onViewChange, countries };
  });

  // Create the map once.
  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildStyle(),
      center: [30, 25],
      zoom: 1.4,
      minZoom: 0.6,
      maxZoom: 14,
      attributionControl: false,
      dragRotate: true,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

    // Start Wire Room's layers as soon as the style is ready. (MapLibre's "load" waits for every
    // outside service; if OpenFreeMap or NASA is down it may never fire, and the map would stay empty.)
    const addIcons = () => {
      const icons = makeIcons();
      if (!map.hasImage("wr-plane")) map.addImage("wr-plane", icons.plane, { pixelRatio: 2 });
      if (!map.hasImage("wr-ship")) map.addImage("wr-ship", icons.ship, { pixelRatio: 2, sdf: true });
    };
    const start = () => {
      addIcons();
      setReady(true);
      cb.current.onViewChange?.(viewBbox(map));
    };
    if (map.isStyleLoaded()) start(); else map.once("style.load", start);
    map.on("styleimagemissing", (e) => { if (e.id === "wr-plane" || e.id === "wr-ship") addIcons(); });
    map.on("moveend", () => cb.current.onViewChange?.(viewBbox(map)));
    // Zooming back out to the whole globe: level the camera so the Earth isn't cut off.
    // With 3D terrain on: tilt once when you zoom in close enough to see mountains, and level
    // out when you zoom back out to the whole globe (a tilted globe gets cut off).
    map.on("zoomend", () => {
      if (map.isMoving()) return;
      const z = map.getZoom();
      if (z < TILT_ZOOM - 1) {
        autoTilted.current = false;
        if (map.getPitch() > 0) map.easeTo({ pitch: 0, duration: 500 });
      } else if (terrainOn.current && z >= TILT_ZOOM && !autoTilted.current && map.getPitch() < 30) {
        autoTilted.current = true;
        map.easeTo({ pitch: 55, duration: 800 });
      }
    });
    // Tile or font failures (e.g. a free service is down) shouldn't break the page.
    map.on("error", (e) => console.warn("Map:", e && e.error ? e.error.message : e));

    const box = (p, r) => [[p.x - r, p.y - r], [p.x + r, p.y + r]];
    map.on("click", (e) => {
      if (!map.getLayer("wr-country-dot")) return;
      const c = map.queryRenderedFeatures(box(e.point, 10), { layers: ["wr-country-dot", "wr-country-code"] });
      if (c.length) {
        const country = cb.current.countries.find((x) => x.id === c[0].properties.id);
        if (country) cb.current.onCountryClick?.(country);
        return;
      }
      const t = map.queryRenderedFeatures(box(e.point, 14), { layers: ["wr-ships", "wr-planes"] });
      if (t.length) {
        let best = null, bd = Infinity;
        for (const f of t) {
          const p = map.project(f.geometry.coordinates);
          const d = Math.hypot(p.x - e.point.x, p.y - e.point.y);
          if (d < bd) { bd = d; best = f; }
        }
        const hit = lookup.current.get(best.properties.key);
        if (hit) { cb.current.onTrackClick?.(hit.kind, hit.item); return; }
      }
      cb.current.onEmptyClick?.();
    });
    const hoverLayers = ["wr-country-dot", "wr-country-code", "wr-ships", "wr-planes"];
    map.on("mousemove", (e) => {
      if (!map.getLayer("wr-country-dot")) return;
      const over = map.queryRenderedFeatures(box(e.point, 8), { layers: hoverLayers }).length > 0;
      map.getCanvas().style.cursor = over ? "pointer" : "";
    });

    if (typeof window !== "undefined") window.__wireroomMap = map; // handy for debugging and tests
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Base look, globe and 3D terrain.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    applyBase(map, prefs.base);
    map.setProjection({ type: prefs.globe ? "globe" : "mercator" });
    // Only the 3D button changes the tilt; switching looks or globe leaves the camera alone.
    const terrainChanged = prevTerrain.current !== prefs.terrain;
    prevTerrain.current = prefs.terrain;
    terrainOn.current = prefs.terrain;
    if (prefs.terrain) {
      map.setTerrain({ source: "dem", exaggeration: 1.5 });
      if (terrainChanged && map.getZoom() >= TILT_ZOOM && map.getPitch() < 30) {
        autoTilted.current = true;
        map.easeTo({ pitch: 55, duration: 800 });
      }
    } else {
      autoTilted.current = false;
      if (terrainChanged && map.getPitch() > 0) {
        // Level the camera first, then drop the terrain (removing it mid-move cancels the move).
        map.easeTo({ pitch: 0, duration: 600 });
        map.once("moveend", () => { if (!terrainOn.current) map.setTerrain(null); });
      } else {
        map.setTerrain(null);
      }
    }
    savePrefs(prefs);
  }, [ready, prefs]);

  // Country dots.
  useEffect(() => {
    const src = ready && mapRef.current?.getSource("wr-countries");
    if (!src) return;
    src.setData({ type: "FeatureCollection", features: countries.map((c) => point(c.lon, c.lat, { id: c.id, code: c.code, has: hasNews.has(c.id), active: c.id === selectedId })) });
  }, [ready, countries, selectedId, hasNews]);

  // Planes and ships.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const m = new Map();
    const planes = airOn ? aircraft.filter((a) => Number.isFinite(a.lon) && Number.isFinite(a.lat)).map((a) => {
      const key = trackId("air", a); m.set(key, { kind: "air", item: a });
      return point(a.lon, a.lat, { key, heading: a.heading ?? 0 });
    }) : [];
    const boats = shipsOn ? ships.filter((s) => Number.isFinite(s.lon) && Number.isFinite(s.lat)).map((s) => {
      const key = trackId("ship", s); m.set(key, { kind: "ship", item: s });
      return point(s.lon, s.lat, { key, category: s.category || "other" });
    }) : [];
    lookup.current = m;
    map.getSource("wr-planes").setData({ type: "FeatureCollection", features: planes });
    map.getSource("wr-ships").setData({ type: "FeatureCollection", features: boats });
  }, [ready, aircraft, ships, airOn, shipsOn]);

  // Coverage outlines for the watched ship areas.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const show = shipsOn && ZONE_SHOW.has(shipsStatus) && Array.isArray(zones);
    const waiting = shipsStatus === "warming";
    const polys = [], labels = [];
    if (show) {
      for (const z of zones) {
        const [[a, b], [c, d]] = z.box;
        const s = Math.min(a, c), n = Math.max(a, c), w = Math.min(b, d), e = Math.max(b, d);
        const count = Number(z.count) || 0;
        polys.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] }, properties: { count } });
        const text = count === 0 ? (waiting ? "WAITING FOR DATA" : "NO FREE COVERAGE") : count.toLocaleString();
        labels.push(point(w, n, { count, label: `${z.name.toUpperCase()} · ${text}` }));
      }
    }
    map.getSource("wr-zones").setData({ type: "FeatureCollection", features: polys });
    map.getSource("wr-zone-labels").setData({ type: "FeatureCollection", features: labels });
  }, [ready, zones, shipsStatus, shipsOn]);

  // Ring around the tapped plane or ship.
  useEffect(() => {
    const src = ready && mapRef.current?.getSource("wr-selected");
    if (!src) return;
    const it = selectedTrack?.item;
    src.setData(it && Number.isFinite(it.lon) ? { type: "FeatureCollection", features: [point(it.lon, it.lat, {})] } : EMPTY);
  }, [ready, selectedTrack]);

  const set = (patch) => setPrefs((p) => ({ ...p, ...patch }));
  return (
    <div className="ml-wrap">
      <style>{ML_CSS}</style>
      <div ref={containerRef} className="ml-map" />
      <div className="ml-controls" onPointerDown={(e) => e.stopPropagation()}>
        <div className="ml-row">
          {BASES.map((b) => (
            <button key={b.id} type="button" className={prefs.base === b.id ? "on" : ""} aria-pressed={prefs.base === b.id} onClick={() => set({ base: b.id })}>{b.label}</button>
          ))}
        </div>
        <div className="ml-row">
          <button type="button" className={prefs.globe ? "on" : ""} aria-pressed={prefs.globe} onClick={() => set({ globe: !prefs.globe })} title="Show the Earth as a globe">GLOBE</button>
          <button type="button" className={prefs.terrain ? "on" : ""} aria-pressed={prefs.terrain} onClick={() => set({ terrain: !prefs.terrain })} title="Raise mountains in 3D. Zoom in to see them; tilt with right-drag or two fingers.">3D TERRAIN</button>
        </div>
      </div>
    </div>
  );
}

const ML_CSS = `
.ml-wrap{position:absolute;inset:0}
.ml-map{position:absolute;inset:0;background:#071019}
.ml-controls{position:absolute;top:10px;right:10px;z-index:3;display:flex;flex-direction:column;align-items:flex-end;gap:5px}
.ml-row{display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end}
.ml-controls button{background:rgba(10,14,20,.86);border:1px solid #26384d;color:#aeb8c6;font:10px monospace;letter-spacing:.05em;padding:6px 8px;cursor:pointer}
.ml-controls button.on{border-color:#c9974b;color:#e8e3d8}
.ml-wrap .maplibregl-ctrl-bottom-right{bottom:calc(52px + env(safe-area-inset-bottom))}
.ml-wrap .maplibregl-ctrl-group{background:#0c1724;border:1px solid #26384d}
.ml-wrap .maplibregl-ctrl-group button+button{border-top:1px solid #26384d}
.ml-wrap .maplibregl-ctrl-group button .maplibregl-ctrl-icon{filter:invert(.8)}
.ml-wrap .maplibregl-ctrl-attrib{background:rgba(10,14,20,.8);color:#718198;font:10px monospace}
.ml-wrap .maplibregl-ctrl-attrib a{color:#8a98aa}
.ml-wrap .maplibregl-ctrl-attrib-button{filter:invert(.8)}
@media(max-width:800px){.ml-controls button{padding:5px 6px;font-size:9px}}
`;
