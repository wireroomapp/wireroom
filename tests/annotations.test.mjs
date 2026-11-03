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
