import { useEffect, useLayoutEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { groupByPlace } from "../contextData.js";
import { buildStyle, applyBase, applyLook, hideBaseCountryLabels, makeIcons, ICON_IDS, SLOT_OFFSETS, BASES, ANNOTATION_LAYERS, NASA_CREDIT, DEM_CREDIT } from "./wireroomStyle.js";
import { WORLD_BBOX, trackId } from "../trackingGeo.js";
import { circleRing, distanceKm, formatDistance } from "../annotationSpace.js";

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

// An area being drawn: its outline so far (closed once it has 3 corners), and its corners.
// `cursor` (optional) is where the pointer is, for a rubber band to the next corner.
function polyDraftFeatures(corners, cursor = null) {
  const pts = cursor ? [...corners, cursor] : corners;
  const out = [];
  if (pts.length >= 3) out.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [[...pts, pts[0]]] }, properties: {} });
  else if (pts.length === 2) out.push({ type: "Feature", geometry: { type: "LineString", coordinates: pts }, properties: {} });
  corners.forEach((c, i) => out.push(point(c[0], c[1], { first: i === 0 })));
  return out;
}

export default function MapLibreView({
  countries, selectedId, hasNews, onCountryClick,
  aircraft, ships, zones, shipsStatus, airOn, shipsOn,
  selectedTrack, onTrackClick, onEmptyClick, onViewChange,
  // Analyst tools
  annotations, tool = "select", pinning = false,
  onAnnotationTap, onDrawPoint, onDrawDrag, onPinPlace, controlRef,
  polyDraft = null, // corners of an area being drawn, [[lon, lat], ...]
  onPolyFinish, // tap on the first corner closes the area
  distanceUnit = "mi", // "mi" | "km": how a circle's radius reads while drawing
  focus = null, // { lon, lat, key, bounds? }: fly here once (a shared link's country; a posted map's area)
  theme = "dark", // "light" gives the plain MAP a light atlas look
  // Trackers: reported incidents (strikes, terrorism, cyber) and wars (see TrackerCards.jsx)
  incidents = null, wars = null, selectedWar = null, selectedTrackerKey = null, onTrackerClick,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [prefs, setPrefs] = useState(loadPrefs);
  const [stylesOpen, setStylesOpen] = useState(false); // phones: the map-style buttons fold behind one button
  const lookup = useRef(new Map()); // track key -> full item, for taps
  const trkLookup = useRef(new Map()); // tracker feature key -> { kind, item, war }
  const terrainOn = useRef(false); // 3D terrain setting, readable from map event handlers
  const userPitched = useRef(false); // did the person tilt the map by hand? then leave the angle alone
  const prevTerrain = useRef(null);
  const prefsRef = useRef(prefs);
  const draft = useRef(null); // line/shape/circle being drawn: { start: [lon,lat], startPt, last }
  const suppressClickUntil = useRef(0);
  // Latest callbacks for the map's event handlers (which are set up once).
  const cb = useRef({});
  useLayoutEffect(() => {
    cb.current = { onCountryClick, onTrackClick, onEmptyClick, onViewChange, countries, tool, pinning, onAnnotationTap, onDrawPoint, onDrawDrag, onPinPlace, onTrackerClick, polyDraft, onPolyFinish, distanceUnit };
    prefsRef.current = prefs;
  });

  // Fly to a place when asked (once per key).
  const focusedKey = useRef(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !focus || focusedKey.current === focus.key) return;
    focusedKey.current = focus.key;
    if (focus.bounds) map.fitBounds(focus.bounds, { padding: 80, maxZoom: 6, duration: 1400, essential: true }); // a posted map, framed
    else map.flyTo({ center: [focus.lon, focus.lat], zoom: Math.max(map.getZoom(), 3.2), duration: 1600, essential: true });
  }, [ready, focus]);

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
      for (const [name, id] of Object.entries(ICON_IDS)) {
        if (!map.hasImage(id)) map.addImage(id, icons[name], { pixelRatio: 2, sdf: name === "ship" });
      }
    };
    const start = () => {
      addIcons();
      setReady(true);
      cb.current.onViewChange?.(viewBbox(map));
    };
    if (map.isStyleLoaded()) start(); else map.once("style.load", start);
    map.on("styleimagemissing", (e) => { if (Object.values(ICON_IDS).includes(e.id)) addIcons(); });
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
      // Area tool: each tap adds a corner; tapping the first corner again closes the area.
      if (k.tool === "polygon") {
        const pts = k.polyDraft || [];
        if (pts.length >= 3) {
          const first = map.project(pts[0]);
          if (Math.hypot(first.x - e.point.x, first.y - e.point.y) <= 12) { k.onPolyFinish?.(); return; }
        }
        k.onDrawPoint?.("polygon", ll);
        return;
      }
      if (k.tool !== "select") return; // line/shape/circle are drawn by dragging
      const ann = hitAnnotation(e.point);
      // Pinning a report/ship/plane: tap a marker or note to pin it there, or tap the map for a new marker.
      if (k.pinning) {
        if (ann && (ann.kind === "marker" || ann.kind === "text" || ann.kind === "pins")) k.onAnnotationTap?.(ann.id);
        else k.onPinPlace?.(ll);
        return;
      }
      if (ann) { k.onAnnotationTap?.(ann.id); return; }
      // Everything else: the nearest thing to the tap wins (country dots, planes/ships, trackers),
      // so a war marker near a country dot is still easy to open.
      const cands = [];
      const near = (layers, r, act, offset) => {
        for (const f of map.queryRenderedFeatures(box(e.point, r), { layers: layers.filter((l) => map.getLayer(l)) })) {
          const p = map.project(f.geometry.coordinates);
          const [ox, oy] = offset ? offset(f) : [0, 0];
          cands.push({ d: Math.hypot(p.x + ox - e.point.x, p.y + oy - e.point.y), act: () => act(f) });
        }
      };
      near(["wr-country-dot", "wr-country-code"], 10, (f) => {
        const country = k.countries.find((x) => x.id === f.properties.id);
        if (country) { k.onCountryClick?.(country); return true; }
        return false;
      });
      near(["wr-ships", "wr-planes"], 14, (f) => {
        const hit = lookup.current.get(f.properties.key);
        if (hit) { k.onTrackClick?.(hit.kind, hit.item); return true; }
        return false;
      });
      const trk = (f) => {
        const hit = trkLookup.current.get(f.properties.key);
        if (hit) { k.onTrackerClick?.(hit.kind, hit.item, hit.war); return true; }
        return false;
      };
      near(["wr-incidents"], 14, trk, (f) => SLOT_OFFSETS[f.properties.slot] || [0, 0]);
      near(["wr-wars"], 16, trk);
      near(["wr-web-node"], 9, trk);
      cands.sort((a, b) => a.d - b.d);
      for (const c of cands) if (c.act()) return;
      k.onEmptyClick?.();
    });

    // Drawing lines, shapes and circles by dragging (mouse or one finger). Two fingers still zoom.
    const draftShape = (a, b, tool) => {
      if (tool === "line") return { type: "Feature", geometry: { type: "LineString", coordinates: [a, b] }, properties: {} };
      if (tool === "circle") {
        // Drag from the center outward; the radius reads out at the edge as it grows.
        const km = distanceKm(a, b);
        return [
          { type: "Feature", geometry: { type: "Polygon", coordinates: [circleRing(a[0], a[1], km)] }, properties: {} },
          { type: "Feature", geometry: { type: "LineString", coordinates: [a, b] }, properties: {} },
          point(b[0], b[1], { text: formatDistance(km, cb.current.distanceUnit) }),
        ];
      }
      const [w, e] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])], [s2, n] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
      return { type: "Feature", geometry: { type: "Polygon", coordinates: [[[w, n], [e, n], [e, s2], [w, s2], [w, n]]] }, properties: {} };
    };
    const setDraft = (f) => map.getSource("wr-draft")?.setData({ type: "FeatureCollection", features: !f ? [] : Array.isArray(f) ? f : [f] });
    const dragTool = () => cb.current.tool === "line" || cb.current.tool === "shape" || cb.current.tool === "circle";
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
      const bigEnough = tool === "line" || tool === "circle" ? Math.hypot(dx, dy) > 8 : dx > 8 && dy > 8;
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
    // Area tool: show the corners so far, plus a rubber band to the pointer.
    map.on("mousemove", (e) => {
      const k = cb.current;
      if (k.tool !== "polygon" || !k.polyDraft || !k.polyDraft.length) return;
      setDraft(polyDraftFeatures(k.polyDraft, [e.lngLat.lng, e.lngLat.lat]));
    });

    const hoverLayers = ["wr-country-dot", "wr-country-code", "wr-ships", "wr-planes", "wr-incidents", "wr-wars", "wr-web-node", ...ANNOTATION_LAYERS];
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
    const look = theme === "light" && prefs.base === "map" ? "light" : "dark";
    applyBase(map, prefs.base, look);
    applyLook(map, look);
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
  }, [ready, prefs, theme]);

  // Country dots.
  useEffect(() => {
    const src = ready && mapRef.current?.getSource("wr-countries");
    if (!src) return;
    src.setData({ type: "FeatureCollection", features: countries.map((c) => point(c.lon, c.lat, { id: c.id, code: c.code, name: c.name, has: hasNews.has(c.id), active: c.id === selectedId })) });
    hideBaseCountryLabels(mapRef.current, countries.map((c) => c.id));
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

  // Trackers: reported incidents, wars, and the selected war's web of latest attacks.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !map.getSource("wr-incidents")) return;
    const m = new Map();
    const used = new Map(); // spot -> next free slot
    const incById = new Map();
    const ICON = { strike: () => "wr-strike", terrorism: (i) => (i.subtype === "attack" ? "wr-terror-attack" : "wr-terror-threat"), cyber: (i) => (i.subtype === "attack" ? "wr-cyber-attack" : "wr-cyber-warning") };
    const RANK = { cyber: 1, terrorism: 2, strike: 3 };
    const warOf = new Map();
    for (const w of wars || []) for (const id of w.reported || []) warOf.set(id, w);
    // One marker per tracker per place; the count badge says how many events it holds.
    const inc = groupByPlace(incidents).map((g) => {
      const key = `g:${g.key}`;
      for (const i of g.items) incById.set(i.id, g);
      m.set(key, { kind: "place", item: g, war: g.items.map((i) => warOf.get(i.id)).find(Boolean) || null });
      const spot = `${g.lon.toFixed(1)},${g.lat.toFixed(1)}`;
      const slot = used.has(spot) ? used.get(spot) : g.precision === "country" ? 1 : 0;
      used.set(spot, slot + 1);
      const dim = Boolean(selectedTrackerKey && selectedTrackerKey.startsWith("g:") && selectedTrackerKey !== key);
      return point(g.lon, g.lat, { key, icon: (ICON[g.kind] || ICON.strike)(g), slot: slot % SLOT_OFFSETS.length, rank: RANK[g.kind] || 0, dim, count: g.items.length });
    });
    const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const ws = (wars || []).map((w) => {
      const key = `w:${w.id}`;
      m.set(key, { kind: "war", item: w });
      const lm = w.latestMonth || {};
      const mon = lm.month ? MON[Number(lm.month.slice(5, 7)) - 1] : "";
      const last = w.latestEvent ? `${MON[Number(w.latestEvent.slice(5, 7)) - 1]} ${Number(w.latestEvent.slice(8, 10))}` : "";
      return point(w.lon, w.lat, {
        key, best: (w.deaths && w.deaths.best) || 0, level: w.level || "war", quiet: Boolean(w.quiet),
        sel: selectedWar ? selectedWar.id === w.id : false, dim: Boolean(selectedWar && selectedWar.id !== w.id),
        label: `${w.name}\n${lm.best ? `${lm.best.toLocaleString()} killed in ${mon} (UCDP)` : `Last event ${last}`}`,
      });
    });
    const lines = [], nodes = [];
    if (selectedWar) {
      const w = (wars || []).find((x) => x.id === selectedWar.id) || selectedWar;
      const from = [w.lon, w.lat];
      for (const nd of w.nodes || []) {
        if (!Number.isFinite(nd.lon)) continue;
        lines.push({ type: "Feature", geometry: { type: "LineString", coordinates: [from, [nd.lon, nd.lat]] }, properties: { kind: "ucdp" } });
        const key = `n:${w.id}:${nd.id}`;
        m.set(key, { kind: "node", item: nd, war: w });
        nodes.push(point(nd.lon, nd.lat, { key, best: nd.best || 0, wp: nd.wp || 0 }));
      }
      const linked = new Set();
      for (const id of w.reported || []) {
        const g = incById.get(id);
        if (!g || linked.has(g)) continue;
        linked.add(g);
        lines.push({ type: "Feature", geometry: { type: "LineString", coordinates: [from, [g.lon, g.lat]] }, properties: { kind: "report" } });
      }
    }
    trkLookup.current = m;
    map.getSource("wr-incidents").setData({ type: "FeatureCollection", features: inc });
    map.getSource("wr-wars").setData({ type: "FeatureCollection", features: ws });
    map.getSource("wr-web").setData({ type: "FeatureCollection", features: lines });
    map.getSource("wr-web-nodes").setData({ type: "FeatureCollection", features: nodes });
  }, [ready, incidents, wars, selectedWar, selectedTrackerKey]);

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
        const text = count === 0 ? (waiting ? "waiting for data" : "no free coverage") : count.toLocaleString();
        labels.push(point(w, n, { count, label: `${z.name} · ${text}` }));
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

  // Line/shape/circle tools: one finger or mouse drag draws instead of moving the map.
  // The area tool keeps dragging for panning, and turns off double-tap zoom (quick taps add corners).
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    if (tool === "line" || tool === "shape" || tool === "circle") map.dragPan.disable(); else map.dragPan.enable();
    if (tool === "polygon") map.doubleClickZoom.disable(); else map.doubleClickZoom.enable();
    if (tool === "select") map.getCanvas().style.cursor = "";
  }, [ready, tool]);

  // The area being drawn (corners placed so far).
  useEffect(() => {
    const src = ready && mapRef.current?.getSource("wr-draft");
    if (!src || draft.current) return; // a drag in progress owns the draft layer
    src.setData({ type: "FeatureCollection", features: tool === "polygon" && polyDraft && polyDraft.length ? polyDraftFeatures(polyDraft) : [] });
  }, [ready, tool, polyDraft]);

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
      <div className={"ml-controls" + (stylesOpen ? " open" : "")} onPointerDown={(e) => e.stopPropagation()}>
        <button type="button" className="ml-styles-toggle" aria-expanded={stylesOpen} onClick={() => setStylesOpen(!stylesOpen)} title="Map style, globe and 3D terrain">
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l9 5-9 5-9-5zM3 13l9 5 9-5" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
          {(BASES.find((b) => b.id === prefs.base) || BASES[0]).label}
        </button>
        <div className="ml-row">
          {BASES.map((b) => (
            <button key={b.id} type="button" className={prefs.base === b.id ? "on" : ""} aria-pressed={prefs.base === b.id} onClick={() => set({ base: b.id })}>{b.label}</button>
          ))}
        </div>
        <div className="ml-row">
          <button type="button" className={prefs.globe ? "on" : ""} aria-pressed={prefs.globe} onClick={() => set({ globe: !prefs.globe })} title="Show the Earth as a globe">Globe</button>
          <button type="button" className={prefs.terrain ? "on" : ""} aria-pressed={prefs.terrain} onClick={() => set({ terrain: !prefs.terrain })} title="Raise mountains in 3D. Zoom in to see them; tilt with right-drag or two fingers.">3D terrain</button>
        </div>
      </div>
    </div>
  );
}

const ML_CSS = `
.ml-wrap{position:absolute;inset:0}
.ml-map{position:absolute;inset:0;background:var(--bg)}
.ml-controls{position:absolute;top:10px;right:10px;z-index:3;display:flex;flex-direction:column;align-items:flex-end;gap:5px}
.ml-row{display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end}
.ml-controls button{background:var(--overlay);border:1px solid var(--line-2);color:var(--text-2);font:12px var(--font);letter-spacing:0;padding:6px 8px;cursor:pointer}
.ml-controls button.on{border-color:var(--accent);color:var(--text)}
.ml-controls button{border-radius:8px;height:34px;font:500 13px var(--font);border-color:var(--line);color:var(--text);box-shadow:var(--shadow)}
.ml-controls button.on{background:var(--accent-soft);color:var(--accent);border-color:var(--accent);font-weight:600}
:root[data-theme="light"] .ml-wrap .maplibregl-ctrl-group button .maplibregl-ctrl-icon,:root[data-theme="light"] .ml-wrap .maplibregl-ctrl-attrib-button{filter:none}
.ml-wrap .maplibregl-ctrl-bottom-right{bottom:calc(52px + env(safe-area-inset-bottom))}
.ml-wrap .maplibregl-ctrl-group{background:var(--surface);border:1px solid var(--line-2)}
.ml-wrap .maplibregl-ctrl-group button+button{border-top:1px solid var(--line-2)}
.ml-wrap .maplibregl-ctrl-group button .maplibregl-ctrl-icon{filter:invert(.8)}
.ml-wrap .maplibregl-ctrl-attrib{background:var(--overlay);color:var(--muted);font:12px var(--font)}
.ml-wrap .maplibregl-ctrl-attrib a{color:var(--muted)}
.ml-wrap .maplibregl-ctrl-attrib-button{filter:invert(.8)}
.ml-controls .ml-styles-toggle{display:none}
.ml-controls button{display:inline-flex;align-items:center;justify-content:center;gap:6px}
.ml-wrap .maplibregl-ctrl-attrib{font-size:11px;line-height:1.35}
@media(max-width:800px){.ml-controls{top:12px;right:10px;transform:none;gap:6px}.ml-controls .ml-styles-toggle{display:inline-flex;height:40px;padding:0 12px}.ml-controls .ml-row{display:none;flex-direction:column;align-items:flex-end;gap:4px}.ml-controls.open .ml-row{display:flex}.ml-controls .ml-row button{height:36px;min-width:96px;font-size:13px}
.ml-wrap .maplibregl-ctrl-attrib.maplibregl-compact{min-height:24px}}
`;
