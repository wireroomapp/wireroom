// Wire Room's MapLibre style: all free sources.
//   - OpenStreetMap data (borders, roads, places) as vector tiles from OpenFreeMap
//   - NASA GIBS imagery (Blue Marble, ASTER shaded relief, city lights)
//   - Elevation for hillshading and 3D terrain: AWS Terrain Tiles (built from SRTM and other public data)
// Everything is in ONE style; switching the base look only flips layer visibility, so the
// Wire Room layers (countries, ships, planes, coverage outlines) are never wiped.

const GIBS = (layer, level, ext) =>
  `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer}/default/GoogleMapsCompatible_Level${level}/{z}/{y}/{x}.${ext}`;

export const NASA_CREDIT = 'Imagery: <a href="https://earthdata.nasa.gov/gibs" target="_blank" rel="noreferrer">NASA GIBS</a> (ESDIS)';
export const OSM_CREDIT = '<a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank" rel="noreferrer">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>';
export const DEM_CREDIT = 'Elevation: <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noreferrer">Mapzen Terrain Tiles</a> (SRTM, GMTED, NED, ETOPO1) via AWS Open Data';

// Base looks the user can pick. "imagery" = which NASA raster layer is shown under the map lines.
export const BASES = [
  { id: "map", label: "MAP", imagery: null },
  { id: "satellite", label: "SATELLITE", imagery: "nasa-bluemarble" },
  { id: "relief", label: "RELIEF", imagery: "nasa-relief" },
  { id: "night", label: "NIGHT", imagery: "nasa-night" },
];
const IMAGERY_LAYERS = ["nasa-bluemarble", "nasa-relief", "nasa-night"];

const FONT = ["Noto Sans Regular"];
const FONT_BOLD = ["Noto Sans Bold"];
const FONT_ITALIC = ["Noto Sans Italic"];
const EMPTY = { type: "FeatureCollection", features: [] };
const NAME = ["coalesce", ["get", "name:en"], ["get", "name_en"], ["get", "name"]];

export const SHIP_COLOR_EXPR = [
  "match", ["get", "category"],
  ["military", "law-enforcement"], "#ff5c5c",
  "tanker", "#e8a33d",
  "cargo", "#4fa6a0",
  "passenger", "#b48cff",
  "fishing", "#8bd17c",
  "#8795a7",
];

export function buildStyle() {
  return {
    version: 8,
    name: "Wire Room",
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    projection: { type: "mercator" },
    sources: {
      openmaptiles: { type: "vector", url: "https://tiles.openfreemap.org/planet", attribution: OSM_CREDIT },
      "nasa-bluemarble": {
        type: "raster", tileSize: 256, minzoom: 1, maxzoom: 8, attribution: NASA_CREDIT,
        tiles: [GIBS("BlueMarble_ShadedRelief_Bathymetry", 8, "jpeg")],
      },
      "nasa-relief": {
        type: "raster", tileSize: 256, minzoom: 1, maxzoom: 12, attribution: NASA_CREDIT,
        tiles: [GIBS("ASTER_GDEM_Greyscale_Shaded_Relief", 12, "jpg")],
      },
      "nasa-night": {
        type: "raster", tileSize: 256, minzoom: 1, maxzoom: 8, attribution: NASA_CREDIT,
        tiles: [GIBS("VIIRS_CityLights_2012", 8, "jpg")],
      },
      dem: {
        type: "raster-dem", encoding: "terrarium", tileSize: 256, maxzoom: 12, attribution: DEM_CREDIT,
        tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
      },
      // Wire Room data (filled from React)
      "wr-countries": { type: "geojson", data: EMPTY },
      "wr-zones": { type: "geojson", data: EMPTY },
      "wr-zone-labels": { type: "geojson", data: EMPTY },
      "wr-ships": { type: "geojson", data: EMPTY },
      "wr-planes": { type: "geojson", data: EMPTY },
      "wr-selected": { type: "geojson", data: EMPTY },
      "wr-ann": { type: "geojson", data: EMPTY }, // the user's markers, lines, shapes, notes
      "wr-draft": { type: "geojson", data: EMPTY }, // the line/shape being drawn right now
    },
    layers: [
      // Land is the background; water is drawn on top of it.
      { id: "background", type: "background", paint: { "background-color": "#142230" } },

      // NASA imagery (only one visible at a time; hidden layers don't download anything)
      { id: "nasa-bluemarble", type: "raster", source: "nasa-bluemarble", layout: { visibility: "none" }, paint: { "raster-brightness-max": 0.8, "raster-saturation": -0.15 } },
      { id: "nasa-relief", type: "raster", source: "nasa-relief", layout: { visibility: "none" }, paint: { "raster-brightness-max": 0.55, "raster-contrast": 0.1 } },
      { id: "nasa-night", type: "raster", source: "nasa-night", layout: { visibility: "none" }, paint: {} },

      { id: "water", type: "fill", source: "openmaptiles", "source-layer": "water", filter: ["!=", ["get", "brunnel"], "tunnel"], paint: { "fill-color": "#0b1725" } },

      // Terrain shading from elevation data (on the plain map, so mountains show everywhere)
      { id: "hillshade", type: "hillshade", source: "dem", paint: { "hillshade-shadow-color": "#040910", "hillshade-highlight-color": "#3a5068", "hillshade-accent-color": "#0c1724", "hillshade-exaggeration": 0.45 } },

      { id: "rivers", type: "line", source: "openmaptiles", "source-layer": "waterway", minzoom: 6, filter: ["==", ["get", "class"], "river"], paint: { "line-color": "#16314a", "line-width": ["interpolate", ["linear"], ["zoom"], 6, 0.5, 12, 2] } },

      // Roads appear as you zoom in
      { id: "roads-major", type: "line", source: "openmaptiles", "source-layer": "transportation", minzoom: 5, filter: ["match", ["get", "class"], ["motorway", "trunk", "primary"], true, false], paint: { "line-color": "#2f4560", "line-opacity": 0.8, "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.4, 10, 1.6, 14, 4] } },
      { id: "roads-mid", type: "line", source: "openmaptiles", "source-layer": "transportation", minzoom: 8, filter: ["match", ["get", "class"], ["secondary", "tertiary"], true, false], paint: { "line-color": "#27394d", "line-opacity": 0.8, "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.3, 14, 2.5] } },
      { id: "roads-minor", type: "line", source: "openmaptiles", "source-layer": "transportation", minzoom: 11, filter: ["match", ["get", "class"], ["minor", "service"], true, false], paint: { "line-color": "#223246", "line-width": ["interpolate", ["linear"], ["zoom"], 11, 0.3, 15, 1.5] } },

      // Borders
      { id: "borders-states", type: "line", source: "openmaptiles", "source-layer": "boundary", minzoom: 3, filter: ["all", ["==", ["get", "admin_level"], 4], ["!=", ["get", "maritime"], 1]], paint: { "line-color": "#2a3c50", "line-dasharray": [2, 2], "line-width": 0.6 } },
      { id: "borders-countries", type: "line", source: "openmaptiles", "source-layer": "boundary", filter: ["all", ["==", ["get", "admin_level"], 2], ["!=", ["get", "maritime"], 1], ["!=", ["get", "disputed"], 1]], paint: { "line-color": "#4d6683", "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.6, 6, 1.4] } },
      { id: "borders-disputed", type: "line", source: "openmaptiles", "source-layer": "boundary", filter: ["all", ["==", ["get", "admin_level"], 2], ["==", ["get", "disputed"], 1]], paint: { "line-color": "#c9974b", "line-opacity": 0.7, "line-dasharray": [3, 2], "line-width": 1 } },

      // Labels
      { id: "label-seas", type: "symbol", source: "openmaptiles", "source-layer": "water_name", minzoom: 2, layout: { "text-field": NAME, "text-font": FONT_ITALIC, "text-size": 10, "text-letter-spacing": 0.15, "text-max-width": 6 }, paint: { "text-color": "#46617d", "text-halo-color": "#071019", "text-halo-width": 1 } },
      { id: "label-cities", type: "symbol", source: "openmaptiles", "source-layer": "place", minzoom: 4, filter: ["match", ["get", "class"], ["city"], true, false], layout: { "text-field": NAME, "text-font": FONT, "text-size": ["interpolate", ["linear"], ["zoom"], 4, 9, 10, 13] }, paint: { "text-color": "#9aa8b9", "text-halo-color": "#071019", "text-halo-width": 1.2 } },
      { id: "label-towns", type: "symbol", source: "openmaptiles", "source-layer": "place", minzoom: 8, filter: ["match", ["get", "class"], ["town"], true, false], layout: { "text-field": NAME, "text-font": FONT, "text-size": 10 }, paint: { "text-color": "#7d8b9c", "text-halo-color": "#071019", "text-halo-width": 1 } },
      { id: "label-countries", type: "symbol", source: "openmaptiles", "source-layer": "place", maxzoom: 7, filter: ["==", ["get", "class"], "country"], layout: { "text-field": ["upcase", NAME], "text-font": FONT_BOLD, "text-size": ["interpolate", ["linear"], ["zoom"], 1, 8, 6, 12], "text-letter-spacing": 0.12, "text-max-width": 7 }, paint: { "text-color": "#56697f", "text-halo-color": "#071019", "text-halo-width": 1 } },

      // ---- Wire Room layers ----
      { id: "wr-zones-fill", type: "fill", source: "wr-zones", filter: ["==", ["get", "count"], 0], paint: { "fill-color": "#c9974b", "fill-opacity": 0.07 } },
      { id: "wr-zones-line", type: "line", source: "wr-zones", paint: { "line-color": ["case", ["==", ["get", "count"], 0], "#c9974b", "#5b7390"], "line-width": 1, "line-dasharray": [3, 2] } },
      // Areas with no ships are labeled a little earlier than the rest. At world view only the
      // amber outline shows, so seven "NO FREE COVERAGE" labels don't crowd the globe.
      { id: "wr-zones-label-empty", type: "symbol", source: "wr-zone-labels", minzoom: 3, filter: ["==", ["get", "count"], 0],
        layout: { "text-field": ["get", "label"], "text-font": FONT, "text-size": 9.5, "text-anchor": "bottom-left", "text-offset": [0, -0.3], "text-letter-spacing": 0.06, "text-max-width": 40 },
        paint: { "text-color": "#c9974b", "text-halo-color": "#071019", "text-halo-width": 1.5 } },
      { id: "wr-zones-label", type: "symbol", source: "wr-zone-labels", minzoom: 4, filter: [">", ["get", "count"], 0],
        layout: { "text-field": ["get", "label"], "text-font": FONT, "text-size": 9.5, "text-anchor": "bottom-left", "text-offset": [0, -0.3], "text-letter-spacing": 0.06, "text-max-width": 40 },
        paint: { "text-color": "#8795a7", "text-halo-color": "#071019", "text-halo-width": 1.5 } },

      { id: "wr-ships", type: "symbol", source: "wr-ships",
        layout: { "icon-image": "wr-ship", "icon-size": ["interpolate", ["linear"], ["zoom"], 1, 0.4, 6, 0.8, 10, 1.2], "icon-allow-overlap": true, "icon-ignore-placement": true },
        paint: { "icon-color": SHIP_COLOR_EXPR, "icon-halo-color": "#071019", "icon-halo-width": 1 } },
      { id: "wr-planes", type: "symbol", source: "wr-planes",
        layout: { "icon-image": "wr-plane", "icon-size": ["interpolate", ["linear"], ["zoom"], 1, 0.4, 6, 0.65, 10, 0.95], "icon-rotate": ["coalesce", ["get", "heading"], 0], "icon-rotation-alignment": "map", "icon-allow-overlap": true, "icon-ignore-placement": true } },
      { id: "wr-selected", type: "circle", source: "wr-selected", paint: { "circle-radius": 13, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#ffffff", "circle-stroke-width": 1.8 } },

      // Country dots (open the country brief)
      { id: "wr-country-halo", type: "circle", source: "wr-countries", filter: ["==", ["get", "has"], true], paint: { "circle-radius": 9, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#c9974b", "circle-stroke-width": 1, "circle-stroke-opacity": 0.5 } },
      { id: "wr-country-dot", type: "circle", source: "wr-countries",
        paint: { "circle-radius": ["case", ["get", "active"], 6.5, ["get", "has"], 4.5, 3.5], "circle-color": ["case", ["get", "active"], "#e8e3d8", "#c9974b"], "circle-stroke-color": ["case", ["get", "active"], "#c9974b", "#071019"], "circle-stroke-width": ["case", ["get", "active"], 2, 1] } },
      { id: "wr-country-code", type: "symbol", source: "wr-countries",
        layout: { "text-field": ["get", "code"], "text-font": FONT_BOLD, "text-size": 9, "text-offset": [0, 1.25], "text-anchor": "top", "text-allow-overlap": true },
        paint: { "text-color": "#8a98aa", "text-halo-color": "#071019", "text-halo-width": 1.2 } },

      // ---- The user's analysis (markers, lines, shapes, notes). Fixed size on screen at any zoom. ----
      { id: "wr-ann-shape-fill", type: "fill", source: "wr-ann", filter: ["==", ["get", "kind"], "shape"], paint: { "fill-color": "#ffffff", "fill-opacity": 0.05 } },
      { id: "wr-ann-shape-line", type: "line", source: "wr-ann", filter: ["==", ["get", "kind"], "shape"], paint: { "line-color": ["case", ["get", "sel"], "#ffffff", "#d7dde8"], "line-width": ["case", ["get", "sel"], 3, 2] } },
      { id: "wr-ann-line", type: "line", source: "wr-ann", filter: ["==", ["get", "kind"], "line"], layout: { "line-cap": "round" }, paint: { "line-color": ["case", ["get", "sel"], "#ffffff", "#d7dde8"], "line-width": ["case", ["get", "sel"], 4, 2.5] } },
      { id: "wr-draft-fill", type: "fill", source: "wr-draft", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": "#ffffff", "fill-opacity": 0.04 } },
      { id: "wr-draft-line", type: "line", source: "wr-draft", paint: { "line-color": "#ffffff", "line-width": 2, "line-dasharray": [3, 2] } },
      { id: "wr-ann-marker", type: "circle", source: "wr-ann", filter: ["==", ["get", "kind"], "marker"],
        paint: { "circle-radius": ["case", ["get", "sel"], 7.5, 6], "circle-color": ["get", "color"], "circle-opacity": 0.3, "circle-stroke-color": ["case", ["get", "sel"], "#ffffff", ["get", "color"]], "circle-stroke-width": ["case", ["get", "sel"], 3, 2] } },
      { id: "wr-ann-pin-badge", type: "circle", source: "wr-ann", filter: ["all", ["==", ["get", "kind"], "marker"], [">", ["get", "pins"], 0]],
        paint: { "circle-radius": 7.5, "circle-color": "#c9974b", "circle-stroke-color": "#000000", "circle-stroke-width": 1.5, "circle-translate": [10, -10] } },
      { id: "wr-ann-pin-count", type: "symbol", source: "wr-ann", filter: ["all", ["==", ["get", "kind"], "marker"], [">", ["get", "pins"], 0]],
        layout: { "text-field": ["to-string", ["get", "pins"]], "text-font": FONT_BOLD, "text-size": 10, "text-allow-overlap": true, "text-ignore-placement": true },
        paint: { "text-color": "#000000", "text-translate": [10, -10] } },
      { id: "wr-ann-marker-label", type: "symbol", source: "wr-ann", filter: ["all", ["==", ["get", "kind"], "marker"], ["!=", ["get", "label"], ""]],
        layout: { "text-field": ["get", "label"], "text-font": FONT_BOLD, "text-size": 12.5, "text-anchor": "left", "text-offset": [0.9, 0], "text-allow-overlap": true, "text-ignore-placement": true, "text-max-width": 20 },
        paint: { "text-color": "#ffffff", "text-halo-color": "#000000", "text-halo-width": 2 } },
      { id: "wr-ann-text", type: "symbol", source: "wr-ann", filter: ["==", ["get", "kind"], "text"],
        layout: { "text-field": ["get", "label"], "text-font": FONT_BOLD, "text-size": 13.5, "text-anchor": "left", "text-allow-overlap": true, "text-ignore-placement": true, "text-max-width": 24 },
        paint: { "text-color": ["case", ["get", "sel"], "#ffe9b8", "#ffffff"], "text-halo-color": "#000000", "text-halo-width": 2 } },
      { id: "wr-ann-line-label", type: "symbol", source: "wr-ann", filter: ["all", ["==", ["get", "kind"], "line"], ["!=", ["get", "label"], ""]],
        layout: { "symbol-placement": "line-center", "text-field": ["get", "label"], "text-font": FONT_BOLD, "text-size": 12, "text-offset": [0, -0.9], "text-allow-overlap": true, "text-ignore-placement": true },
        paint: { "text-color": "#ffffff", "text-halo-color": "#000000", "text-halo-width": 2 } },
      { id: "wr-ann-shape-label", type: "symbol", source: "wr-ann", filter: ["all", ["==", ["get", "kind"], "shape"], ["!=", ["get", "label"], ""]],
        layout: { "text-field": ["get", "label"], "text-font": FONT_BOLD, "text-size": 12, "text-allow-overlap": true, "text-ignore-placement": true },
        paint: { "text-color": "#ffffff", "text-halo-color": "#000000", "text-halo-width": 2 } },
    ],
  };
}

// Show the chosen base look by flipping visibility. The plain MAP keeps the dark land/water
// colors; imagery looks hide the water fill so NASA's picture shows through.
export const ANNOTATION_LAYERS = ["wr-ann-marker", "wr-ann-pin-badge", "wr-ann-marker-label", "wr-ann-text", "wr-ann-line", "wr-ann-line-label", "wr-ann-shape-line", "wr-ann-shape-fill", "wr-ann-shape-label"];

export function applyBase(map, baseId) {
  const base = BASES.find((b) => b.id === baseId) || BASES[0];
  for (const id of IMAGERY_LAYERS) map.setLayoutProperty(id, "visibility", id === base.imagery ? "visible" : "none");
  map.setLayoutProperty("water", "visibility", base.imagery ? "none" : "visible");
  map.setPaintProperty("background", "background-color", base.imagery ? "#071019" : "#142230");
  // NASA's relief image already has shading; the night image looks best without extra shadows.
  map.setLayoutProperty("hillshade", "visibility", base.id === "map" || base.id === "satellite" ? "visible" : "none");
}

// Small icons drawn in code (no image files to host).
export function makeIcons() {
  const plane = document.createElement("canvas");
  plane.width = plane.height = 32;
  let c = plane.getContext("2d");
  c.translate(16, 16);
  c.beginPath(); c.moveTo(0, -13); c.lineTo(9, 11); c.lineTo(0, 5); c.lineTo(-9, 11); c.closePath();
  c.fillStyle = "#7cc4ff"; c.strokeStyle = "#071019"; c.lineWidth = 2; c.fill(); c.stroke();

  // Ship: white diamond used as an SDF so MapLibre can color it per ship type.
  const ship = document.createElement("canvas");
  ship.width = ship.height = 24;
  c = ship.getContext("2d");
  c.translate(12, 12);
  c.beginPath(); c.moveTo(0, -8); c.lineTo(8, 0); c.lineTo(0, 8); c.lineTo(-8, 0); c.closePath();
  c.fillStyle = "#ffffff"; c.fill();
  return {
    plane: plane.getContext("2d").getImageData(0, 0, 32, 32),
    ship: ship.getContext("2d").getImageData(0, 0, 24, 24),
  };
}
