import { useEffect, useLayoutEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { buildStyle, applyBase, makeIcons, BASES, ANNOTATION_LAYERS, NASA_CREDIT, DEM_CREDIT } from "./wireroomStyle.js";
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
  // Analyst tools
  annotations, tool = "select", pinning = false,
  onAnnotationTap, onDrawPoint, onDrawDrag, onPinPlace, controlRef,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [prefs, setPrefs] = useState(loadPrefs);
  const lookup = useRef(new Map()); // track key -> full item, for taps
  const terrainOn = useRef(false); // 3D terrain setting, readable from map event handlers
  const userPitched = useRef(false); // did the person tilt the map by hand? then leave the angle alone
  const prevTerrain = useRef(null);
  const prefsRef = useRef(prefs);
  const draft = useRef(null); // line/shape being drawn: { start: [lon,lat], startPt, last }
  const suppressClickUntil = useRef(0);
  // Latest callbacks for the map's event handlers (which are set up once).
  const cb = useRef({});
  useLayoutEffect(() => {
    cb.current = { onCountryClick, onTrackClick, onEmptyClick, onViewChange, countries, tool, pinning, onAnnotationTap, onDrawPoint, onDrawDrag, onPinPlace };
    prefsRef.current = prefs;
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
      // Lets EXPORT read the map image. NASA, OpenFreeMap and the elevation tiles all allow this.
      canvasContextAttributes: { preserveDrawingBuffer: true },
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
    // Checked when the map has fully stopped ("moveend"), not when zooming ends: a phone pinch
    // keeps gliding after the fingers lift, so at "zoomend" the map is still moving.
    // A tilt started by a gesture (two-finger drag, right-drag, compass control) carries the
    // original browser event; our own animations don't.
    map.on("pitchstart", (e) => { if (e && e.originalEvent) userPitched.current = true; });
    let lastZoom = map.getZoom();
    map.on("moveend", () => {
      const z = map.getZoom();
      // Only react when the zoom actually changed. Our own tilt/level animations also end with
      // "moveend"; reacting to those could loop forever (the camera can stop a hair off level).
      if (Math.abs(z - lastZoom) < 0.05) return;
      lastZoom = z;
      if (z < TILT_ZOOM - 1) {
        userPitched.current = false;
        if (map.getPitch() > 1) map.easeTo({ pitch: 0, duration: 500 });
      } else if (terrainOn.current && z >= TILT_ZOOM && !userPitched.current && map.getPitch() < 30) {
        // If this tilt gets interrupted (e.g. by the next pinch), the next stop simply tries again.
        map.easeTo({ pitch: 55, duration: 800 });
      }
    });
    // Tile or font failures (e.g. a free service is down) shouldn't break the page.
    map.on("error", (e) => console.warn("Map:", e && e.error ? e.error.message : e));

    const box = (p, r) => [[p.x - r, p.y - r], [p.x + r, p.y + r]];
    const hitAnnotation = (pt) => {
      const f = map.queryRenderedFeatures(box(pt, 10), { layers: ANNOTATION_LAYERS });
      return f.length ? f[0].properties : null;
    };
    map.on("click", (e) => {
      if (!map.getLayer("wr-country-dot")) return;
      if (Date.now() < suppressClickUntil.current) return; // this click ended a line/shape drag
      const k = cb.current;
      const ll = [e.lngLat.lng, e.lngLat.lat];
      // Drawing tools: a tap places a marker or a note.
      if (k.tool === "marker" || k.tool === "text") { k.onDrawPoint?.(k.tool, ll); return; }
      if (k.tool !== "select") return; // line/shape are drawn by dragging
      const ann = hitAnnotation(e.point);
      // Pinning a report/ship/plane: tap a marker to pin to it, or tap the map for a new marker.
      if (k.pinning) {
        if (ann && ann.kind === "marker") k.onAnnotationTap?.(ann.id);
        else k.onPinPlace?.(ll);
        return;
      }
      if (ann) { k.onAnnotationTap?.(ann.id); return; }
      const c = map.queryRenderedFeatures(box(e.point, 10), { layers: ["wr-country-dot", "wr-country-code"] });
      if (c.length) {
        const country = k.countries.find((x) => x.id === c[0].properties.id);
        if (country) k.onCountryClick?.(country);
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
        if (hit) { k.onTrackClick?.(hit.kind, hit.item); return; }
      }
      k.onEmptyClick?.();
    });

    // Drawing lines and shapes by dragging (mouse or one finger). Two fingers still zoom.
    const draftShape = (a, b, tool) => {
      if (tool === "line") return { type: "Feature", geometry: { type: "LineString", coordinates: [a, b] }, properties: {} };
      const [w, e] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])], [s2, n] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
      return { type: "Feature", geometry: { type: "Polygon", coordinates: [[[w, n], [e, n], [e, s2], [w, s2], [w, n]]] }, properties: {} };
    };
    const setDraft = (f) => map.getSource("wr-draft")?.setData({ type: "FeatureCollection", features: f ? [f] : [] });
    const dragTool = () => cb.current.tool === "line" || cb.current.tool === "shape";
    const startDraw = (e) => {
      if (!dragTool()) return;
      const touches = e.originalEvent && e.originalEvent.touches;
      if (touches && touches.length > 1) { draft.current = null; setDraft(null); return; }
      e.preventDefault();
      const ll = [e.lngLat.lng, e.lngLat.lat];
      draft.current = { start: ll, startPt: e.point, last: ll, lastPt: e.point };
    };
    const moveDraw = (e) => {
      const d = draft.current;
      if (!d) return;
      const touches = e.originalEvent && e.originalEvent.touches;
      if (touches && touches.length > 1) { draft.current = null; setDraft(null); return; } // pinch: cancel
      d.last = [e.lngLat.lng, e.lngLat.lat];
      d.lastPt = e.point;
      setDraft(draftShape(d.start, d.last, cb.current.tool));
    };
    const endDraw = () => {
      const d = draft.current;
      if (!d) return;
      draft.current = null;
      setDraft(null);
      const dx = Math.abs(d.lastPt.x - d.startPt.x), dy = Math.abs(d.lastPt.y - d.startPt.y);
      const tool = cb.current.tool;
      const bigEnough = tool === "line" ? Math.hypot(dx, dy) > 8 : dx > 8 && dy > 8;
      if (bigEnough) {
        suppressClickUntil.current = Date.now() + 400;
        cb.current.onDrawDrag?.(tool, d.start, d.last);
      }
    };
    map.on("mousedown", startDraw);
    map.on("touchstart", startDraw);
    map.on("mousemove", moveDraw);
    map.on("touchmove", moveDraw);
    map.on("mouseup", endDraw);
    map.on("touchend", endDraw);
    map.on("touchcancel", () => { draft.current = null; setDraft(null); });

    const hoverLayers = ["wr-country-dot", "wr-country-code", "wr-ships", "wr-planes", ...ANNOTATION_LAYERS];
    map.on("mousemove", (e) => {
      if (!map.getLayer("wr-country-dot")) return;
      if (cb.current.tool !== "select") { map.getCanvas().style.cursor = "crosshair"; return; }
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
        map.easeTo({ pitch: 55, duration: 800 });
      }
    } else {
      userPitched.current = false;
      // Drop the terrain first, then level the camera a moment later (removing terrain
      // during a camera move cancels that move).
      map.setTerrain(null);
      if (terrainChanged && map.getPitch() > 0) {
        setTimeout(() => { if (!terrainOn.current && mapRef.current && mapRef.current.getPitch() > 1) mapRef.current.easeTo({ pitch: 0, duration: 600 }); }, 60);
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

  // The user's annotations.
  useEffect(() => {
    const src = ready && mapRef.current?.getSource("wr-ann");
    if (src && annotations) src.setData(annotations);
  }, [ready, annotations]);

  // Line/shape tools: one finger or mouse drag draws instead of moving the map.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    if (tool === "line" || tool === "shape") map.dragPan.disable(); else map.dragPan.enable();
    if (tool === "select") map.getCanvas().style.cursor = "";
  }, [ready, tool]);

  // What EXPORT needs from this map: the drawn image and the credits for what's on it.
  useEffect(() => {
    if (!controlRef) return undefined;
    controlRef.current = {
      getCanvas: () => mapRef.current?.getCanvas() || null,
      credits: () => {
        const p = prefsRef.current;
        const strip = (h) => h.replace(/<[^>]+>/g, "");
        const out = ["Map data © OpenStreetMap contributors (OpenFreeMap)"];
        if (p.base !== "map") out.push(strip(NASA_CREDIT));
        if (p.base === "map" || p.base === "satellite" || p.terrain) out.push(strip(DEM_CREDIT).replace(" via AWS Open Data", ""));
        return out;
      },
    };
    return () => { controlRef.current = null; };
  }, [controlRef]);

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
@media(max-width:800px){.ml-controls{top:50%;transform:translateY(-60%);gap:4px}.ml-row{flex-direction:column;align-items:flex-end}.ml-controls button{padding:5px 6px;font-size:9px;min-width:66px;text-align:center}}
`;
