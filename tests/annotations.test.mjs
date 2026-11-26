// Annotations must stay on the same spot on Earth when the map is resized (e.g. the side panel opens).
import test from "node:test";
import assert from "node:assert/strict";
import * as d3 from "d3";
import { toUnit, toPixel, loadAnnotations, migrateLegacy, STORAGE_KEY, LEGACY_KEY } from "../src/annotationSpace.js";

const fit = (w, h) => d3.geoNaturalEarth1().fitSize([w, h], { type: "Sphere" });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

test("a marker drawn on a wide map lands on the same place on a narrower map", () => {
  const wide = fit(1366, 702), narrow = fit(956, 702);
  const hormuz = [56.3, 26.5];
  const [x, y] = wide(hormuz);
  const stored = toUnit({ type: "marker", x, y, label: "H" }, wide);
  const shown = toPixel(stored, narrow);
  const [ex, ey] = narrow(hormuz);
  near(shown.x, ex); near(shown.y, ey);
  assert.equal(shown.label, "H");
});

test("lines and shapes convert all their points and sizes", () => {
  const a = fit(1200, 700), b = fit(600, 500);
  const p1 = [10, 50], p2 = [40, 30];
  const [x1, y1] = a(p1), [x2, y2] = a(p2);
  const line = toPixel(toUnit({ type: "line", x1, y1, x2, y2 }, a), b);
  near(line.x1, b(p1)[0]); near(line.y2, b(p2)[1]);
  const shape = toPixel(toUnit({ type: "shape", x: x1, y: y1, width: x2 - x1, height: y2 - y1 }, a), b);
  near(shape.x + shape.width, b(p2)[0]); near(shape.y + shape.height, b(p2)[1]);
});

test("old pixel annotations are loaded, flagged, and migrated once", () => {
  const store = new Map([[LEGACY_KEY, JSON.stringify([{ id: "1", type: "marker", x: 100, y: 200, pins: [{ id: "p" }] }])]]);
  const storage = { getItem: (k) => store.get(k) ?? null };
  const loaded = loadAnnotations(storage);
  assert.equal(loaded[0].legacy, true);
  assert.equal(toPixel(loaded[0], fit(800, 600)).x, 100); // unchanged until migrated
  const proj = fit(1366, 702);
  const migrated = migrateLegacy(loaded, proj);
  assert.equal(migrated[0].legacy, undefined);
  near(toPixel(migrated[0], proj).x, 100);
  assert.deepEqual(migrated[0].pins, [{ id: "p" }]);
  assert.equal(migrateLegacy(migrated, proj), migrated); // nothing left to do: same list back
});

test("new storage wins over the old one", () => {
  const store = new Map([[STORAGE_KEY, "[]"], [LEGACY_KEY, '[{"id":"old","type":"marker","x":1,"y":2}]']]);
  assert.deepEqual(loadAnnotations({ getItem: (k) => store.get(k) ?? null }), []);
});

test("map units <-> longitude/latitude round trip (shared by both maps)", async () => {
  const { unitToLonLat, lonLatToUnit, annotationsToGeoJSON } = await import("../src/annotationSpace.js");
  const u = lonLatToUnit(56.3, 26.5);
  const ll = unitToLonLat(u.x, u.y);
  assert.ok(Math.abs(ll[0] - 56.3) < 1e-6 && Math.abs(ll[1] - 26.5) < 1e-6);
  // A marker drawn on the classic map at Hormuz shows at Hormuz on the new map.
  const wide = fit(1366, 702);
  const [x, y] = wide([56.3, 26.5]);
  const stored = toUnit({ id: "m", type: "marker", x, y, label: "H", pins: [{}, {}] }, wide);
  const gj = annotationsToGeoJSON([stored], "m");
  const [lon, lat] = gj.features[0].geometry.coordinates;
  assert.ok(Math.abs(lon - 56.3) < 1e-6 && Math.abs(lat - 26.5) < 1e-6);
  assert.equal(gj.features[0].properties.pins, 2);
  assert.equal(gj.features[0].properties.sel, true);
});

// ---- Circles (a true-distance radius) and freeform areas ----
test("an area keeps every corner on its spot when the map is resized", () => {
  const a = fit(1200, 700), b = fit(700, 500);
  const corners = [[-91.25, 40.81], [-91.6, 40.2], [-92.05, 40.57]];
  const stored = toUnit({ type: "polygon", points: corners.map((ll) => { const [x, y] = a(ll); return { x, y }; }), label: "Fallout" }, a);
  const shown = toPixel(stored, b);
  corners.forEach((ll, i) => { const [x, y] = b(ll); near(shown.points[i].x, x); near(shown.points[i].y, y); });
  assert.equal(shown.label, "Fallout");
});

test("a circle's center moves with the map; its radius is a distance, not a size on screen", () => {
  const a = fit(1200, 700), b = fit(600, 400);
  const [x, y] = a([-91.255, 40.81]);
  const stored = toUnit({ type: "circle", x, y, radiusKm: 32.19, unit: "mi" }, a);
  assert.equal(stored.radiusKm, 32.19);
  const shown = toPixel(stored, b);
  const [ex, ey] = b([-91.255, 40.81]);
  near(shown.x, ex); near(shown.y, ey);
  assert.equal(shown.radiusKm, 32.19);
});

test("every point of a drawn circle is the radius away from its center", async () => {
  const { circleRing, distanceKm } = await import("../src/annotationSpace.js");
  for (const [lon, lat, km] of [[-91.255, 40.81, 32.19], [56.3, 26.5, 500], [0, 70, 1000], [179.5, -16, 300]]) {
    const ring = circleRing(lon, lat, km);
    assert.ok(ring.length > 60, "smooth enough");
    for (const p of ring) assert.ok(Math.abs(distanceKm([lon, lat], p) - km) < km * 0.001 + 0.01, `${p} is ${distanceKm([lon, lat], p)} km, not ${km}`);
    // Across the date line the ring stays in one piece (no jump of ~360 degrees between points).
    for (let i = 1; i < ring.length; i++) assert.ok(Math.abs(ring[i][0] - ring[i - 1][0]) < 90);
  }
});

test("miles and km, and the radius readout", async () => {
  const { kmFrom, kmTo, formatDistance, roundDistance } = await import("../src/annotationSpace.js");
  assert.ok(Math.abs(kmFrom(20, "mi") - 32.18688) < 1e-9);
  assert.equal(kmFrom(20, "km"), 20);
  assert.ok(Math.abs(kmTo(kmFrom(20, "mi"), "mi") - 20) < 1e-9);
  assert.equal(formatDistance(kmFrom(20, "mi"), "mi"), "20 mi");
  assert.equal(formatDistance(kmFrom(20, "mi"), "km"), "32 km");
  assert.equal(formatDistance(5.25, "km"), "5.3 km");
  assert.equal(formatDistance(2000, "km"), "2,000 km");
  assert.equal(roundDistance(9.96), 10);
});

test("circles and areas become map shapes with their names and colors", async () => {
  const { annotationsToGeoJSON, lonLatToUnit, kmFrom } = await import("../src/annotationSpace.js");
  const c = lonLatToUnit(-91.255, 40.81);
  const corners = [[-91.25, 40.81], [-91.6, 40.2], [-92.05, 40.57]].map(([lon, lat]) => lonLatToUnit(lon, lat));
  const gj = annotationsToGeoJSON([
    { id: "c", type: "circle", x: c.x, y: c.y, radiusKm: kmFrom(20, "mi"), unit: "mi", label: "Shelter in place", color: "#ff4d4d" },
    { id: "p", type: "polygon", points: corners, label: "Fallout zone", color: "#ffd166" },
    { id: "bad", type: "polygon", points: corners.slice(0, 2) }, // 2 corners: not an area
    { id: "zero", type: "circle", x: c.x, y: c.y, radiusKm: 0 },
  ], "c");
  const byKind = (id, kind) => gj.features.find((f) => f.properties.id === id && f.properties.kind === kind);
  const ring = byKind("c", "area");
  assert.equal(ring.geometry.type, "Polygon");
  assert.equal(ring.properties.color, "#ff4d4d");
  assert.equal(ring.properties.sel, true);
  assert.equal(byKind("c", "area-label").properties.label, "Shelter in place\n20 mi radius");
  assert.ok(byKind("c", "area-label").geometry.coordinates[1] > 40.81, "the name sits above the ring, not on its center");
  const area = byKind("p", "area");
  assert.equal(area.geometry.coordinates[0].length, 4, "closed ring");
  assert.equal(byKind("p", "area-label").properties.label, "Fallout zone");
  assert.ok(!gj.features.some((f) => f.properties.id === "bad" || f.properties.id === "zero"));
});

test("a posted map is framed to show all of a circle, not just its center", async () => {
  const { annotationLonLats, lonLatToUnit } = await import("../src/annotationSpace.js");
  const c = lonLatToUnit(10, 50);
  const pts = annotationLonLats({ type: "circle", x: c.x, y: c.y, radiusKm: 111.2 });
  const lats = pts.map((p) => p[1]);
  assert.ok(Math.max(...lats) > 50.9 && Math.min(...lats) < 49.1, "reaches about one degree north and south");
  assert.equal(annotationLonLats({ type: "polygon", points: [c, c, c] }).length, 3);
});
