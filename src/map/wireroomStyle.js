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
  { id: "map", label: "Map", imagery: null },
  { id: "satellite", label: "Satellite", imagery: "nasa-bluemarble" },
  { id: "relief", label: "Relief", imagery: "nasa-relief" },
  { id: "night", label: "Night", imagery: "nasa-night" },
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

// Tracker markers that share a spot (several reports placed mid-country) fan out around it.
// Slot 0 sits on the spot; country-level markers start at slot 1 so the country dot stays clear.
export const SLOT_OFFSETS = [[0, 0], [15, -13], [-15, -13], [15, 13], [-15, 13], [0, -20], [0, 20], [22, 0], [-22, 0]];
const SLOT_EXPR = ["match", ["get", "slot"], ...SLOT_OFFSETS.slice(1).flatMap((o, i) => [i + 1, ["literal", o]]), ["literal", [0, 0]]];
// The count badge sits at the icon's top-right corner (text offsets are in ems at size 10).
const BADGE_EXPR = ["match", ["get", "slot"], ...SLOT_OFFSETS.flatMap((o, i) => [i, ["literal", [(o[0] + 9) / 10, (o[1] - 9) / 10]]]), ["literal", [0.9, -0.9]]];
const WAR_RED = "#ff4d4d", STRIKE_RED = "#ff6b5e", TERROR_YELLOW = "#f5c542", CYBER_PINK = "#ff5fb4";
const LEVEL_SIZE = ["match", ["get", "level"], "war", 1, "armed conflict", 0.78, 0.6];

// Where a line's, shape's or note's source-count badge sits, in screen pixels from its anchor.
const PIN_SLOTS = [["below", [0, 14]], ["corner", [10, 10]], ["left", [-12, 0]]];

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
      // Trackers (MILITARY, TERRORISM, CYBER): see src/contextData.js
      "wr-web": { type: "geojson", data: EMPTY }, // lines from the selected war to its latest attacks
      "wr-web-nodes": { type: "geojson", data: EMPTY }, // the selected war's latest UCDP events
      "wr-incidents": { type: "geojson", data: EMPTY }, // reported strikes, terrorism, cyber
      "wr-wars": { type: "geojson", data: EMPTY },
      "wr-zones": { type: "geojson", data: EMPTY },
      "wr-zone-labels": { type: "geojson", data: EMPTY },
      "wr-ships": { type: "geojson", data: EMPTY },
      "wr-planes": { type: "geojson", data: EMPTY },
      "wr-selected": { type: "geojson", data: EMPTY },
      "wr-ann": { type: "geojson", data: EMPTY }, // the user's markers, lines, shapes, circles, areas, notes
      "wr-draft": { type: "geojson", data: EMPTY }, // the line/shape/circle/area being drawn right now
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
      // amber outline shows, so seven "No free coverage" labels don't crowd the globe.
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
      // ---- Trackers ----
      // The selected war's web: solid lines to UCDP-verified events, dashed to strikes reported in the news.
      { id: "wr-web-line", type: "line", source: "wr-web", filter: ["==", ["get", "kind"], "ucdp"], layout: { "line-cap": "round" },
        paint: { "line-color": WAR_RED, "line-width": ["interpolate", ["linear"], ["zoom"], 2, 0.8, 7, 1.6], "line-opacity": 0.55 } },
      { id: "wr-web-line-rep", type: "line", source: "wr-web", filter: ["==", ["get", "kind"], "report"],
        paint: { "line-color": STRIKE_RED, "line-width": ["interpolate", ["linear"], ["zoom"], 2, 1, 7, 1.8], "line-opacity": 0.85, "line-dasharray": [2, 1.5] } },
      { id: "wr-web-node", type: "circle", source: "wr-web-nodes", layout: { "circle-sort-key": ["get", "best"] },
        paint: {
          "circle-radius": ["min", 11, ["+", 3, ["*", 0.55, ["sqrt", ["get", "best"]]]]],
          "circle-color": WAR_RED, "circle-opacity": ["case", [">=", ["get", "wp"], 4], 0, 0.4],
          "circle-stroke-color": WAR_RED, "circle-stroke-width": 1.3, "circle-stroke-opacity": 0.95,
        } },
      { id: "wr-incidents", type: "symbol", source: "wr-incidents",
        layout: {
          "icon-image": ["get", "icon"], "icon-offset": SLOT_EXPR,
          "icon-size": ["interpolate", ["linear"], ["zoom"], 1, 0.85, 6, 1, 10, 1.15],
          "icon-allow-overlap": true, "icon-ignore-placement": true, "symbol-sort-key": ["get", "rank"],
          "text-field": ["case", [">", ["get", "count"], 1], ["to-string", ["get", "count"]], ""], "text-font": FONT_BOLD, "text-size": 10,
          "text-offset": BADGE_EXPR, "text-allow-overlap": true, "text-ignore-placement": true,
        },
        paint: {
          "icon-opacity": ["case", ["get", "dim"], 0.35, 1], "text-opacity": ["case", ["get", "dim"], 0.35, 1],
          "text-color": "#ffffff", "text-halo-color": "#071019", "text-halo-width": 2.2,
        } },
      { id: "wr-wars", type: "symbol", source: "wr-wars",
        layout: {
          // Size by UCDP level: war (1,000+ deaths) > armed conflict (25+) > armed clashes.
          "icon-image": "wr-war", "icon-size": ["interpolate", ["linear"], ["zoom"], 1, ["*", 0.85, LEVEL_SIZE], 6, ["*", 1.1, LEVEL_SIZE]],
          "icon-allow-overlap": true, "icon-ignore-placement": true, "symbol-sort-key": ["-", 0, ["get", "best"]],
          // Wars are labeled at any zoom, armed conflicts from zoom 2.5, small clashes from zoom 4.
          "text-field": ["step", ["zoom"], ["case", ["==", ["get", "level"], "war"], ["get", "label"], ""],
            2.5, ["case", ["!=", ["get", "level"], "armed clashes"], ["get", "label"], ""], 4, ["get", "label"]],
          "text-font": FONT_BOLD, "text-size": 9.5, "text-anchor": "top", "text-offset": [0, 1.25],
          "text-optional": true, "text-max-width": 16, "text-letter-spacing": 0.04,
        },
        paint: {
          "icon-opacity": ["case", ["get", "dim"], 0.4, ["get", "quiet"], 0.55, 1],
          "text-color": ["case", ["get", "sel"], "#ffffff", "#ffb3ad"], "text-opacity": ["case", ["get", "dim"], 0.4, 1],
          "text-halo-color": "#071019", "text-halo-width": 1.6,
        } },
      { id: "wr-selected", type: "circle", source: "wr-selected", paint: { "circle-radius": 13, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#ffffff", "circle-stroke-width": 1.8 } },

      // Country dots (open the country brief)
      { id: "wr-country-halo", type: "circle", source: "wr-countries", filter: ["==", ["get", "has"], true], paint: { "circle-radius": 9, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#7eb2ff", "circle-stroke-width": 1, "circle-stroke-opacity": 0.5 } },
      { id: "wr-country-dot", type: "circle", source: "wr-countries",
        paint: { "circle-radius": ["case", ["get", "active"], 6.5, ["get", "has"], 4.5, 3.5], "circle-color": ["case", ["get", "active"], "#e8eaed", "#7eb2ff"], "circle-stroke-color": ["case", ["get", "active"], "#7eb2ff", "#071019"], "circle-stroke-width": ["case", ["get", "active"], 2, 1] } },
      { id: "wr-country-code", type: "symbol", source: "wr-countries",
        // One title per country: the short code at world view, the full name once there's room.
        // The base map's own name for these countries is hidden (see hideBaseCountryLabels).
        layout: { "text-field": ["step", ["zoom"], ["get", "code"], 3.5, ["get", "name"]], "text-font": FONT_BOLD, "text-size": ["step", ["zoom"], 9, 3.5, 11], "text-max-width": 8, "text-offset": [0, 1.25], "text-anchor": "top", "text-allow-overlap": true, "text-ignore-placement": true },
        paint: { "text-color": "#8a98aa", "text-halo-color": "#071019", "text-halo-width": 1.2 } },

      // ---- The user's analysis (markers, lines, shapes, circles, areas, notes). ----
      // Circles and freeform areas: a tinted zone in the color the analyst picked (e.g. red for a blast radius).
      { id: "wr-ann-area-fill", type: "fill", source: "wr-ann", filter: ["==", ["get", "kind"], "area"], paint: { "fill-color": ["get", "color"], "fill-opacity": ["case", ["get", "sel"], 0.2, 0.12] } },
      { id: "wr-ann-area-line", type: "line", source: "wr-ann", filter: ["==", ["get", "kind"], "area"], layout: { "line-join": "round" }, paint: { "line-color": ["case", ["get", "sel"], "#ffffff", ["get", "color"]], "line-width": ["case", ["get", "sel"], 3, 2] } },
      { id: "wr-ann-shape-fill", type: "fill", source: "wr-ann", filter: ["==", ["get", "kind"], "shape"], paint: { "fill-color": "#ffffff", "fill-opacity": 0.05 } },
      { id: "wr-ann-shape-line", type: "line", source: "wr-ann", filter: ["==", ["get", "kind"], "shape"], paint: { "line-color": ["case", ["get", "sel"], "#ffffff", "#d7dde8"], "line-width": ["case", ["get", "sel"], 3, 2] } },
      { id: "wr-ann-line", type: "line", source: "wr-ann", filter: ["==", ["get", "kind"], "line"], layout: { "line-cap": "round" }, paint: { "line-color": ["case", ["get", "sel"], "#ffffff", "#d7dde8"], "line-width": ["case", ["get", "sel"], 4, 2.5] } },
      { id: "wr-draft-fill", type: "fill", source: "wr-draft", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": "#ffffff", "fill-opacity": 0.04 } },
      { id: "wr-draft-line", type: "line", source: "wr-draft", filter: ["!=", ["geometry-type"], "Point"], paint: { "line-color": "#ffffff", "line-width": 2, "line-dasharray": [3, 2] } },
      // Corners of an area being drawn (the first one is bigger: tap it to close the area).
      { id: "wr-draft-vertex", type: "circle", source: "wr-draft", filter: ["all", ["==", ["geometry-type"], "Point"], ["!", ["has", "text"]]],
        paint: { "circle-radius": ["case", ["get", "first"], 6, 4], "circle-color": "#ffffff", "circle-opacity": ["case", ["get", "first"], 0.35, 0.9], "circle-stroke-color": "#000000", "circle-stroke-width": 1.5 } },
      // Live readout while drawing (a circle's radius as it grows).
      { id: "wr-draft-label", type: "symbol", source: "wr-draft", filter: ["has", "text"],
        layout: { "text-field": ["get", "text"], "text-font": FONT_BOLD, "text-size": 13, "text-anchor": "bottom", "text-offset": [0, -0.6], "text-allow-overlap": true, "text-ignore-placement": true },
        paint: { "text-color": "#ffffff", "text-halo-color": "#000000", "text-halo-width": 2 } },
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
      // Sources pinned to a line (badge just below its middle), a shape (its top-left corner) or a
      // note (left of it). One layer per position: a fixed screen offset can't vary per feature.
      ...PIN_SLOTS.flatMap(([slot, offset]) => [
        { id: `wr-ann-pins-badge-${slot}`, type: "circle", source: "wr-ann", filter: ["all", ["==", ["get", "kind"], "pins"], ["==", ["get", "slot"], slot]],
          paint: { "circle-radius": 7.5, "circle-color": "#c9974b", "circle-stroke-color": "#000000", "circle-stroke-width": 1.5, "circle-translate": offset } },
        { id: `wr-ann-pins-count-${slot}`, type: "symbol", source: "wr-ann", filter: ["all", ["==", ["get", "kind"], "pins"], ["==", ["get", "slot"], slot]],
          layout: { "text-field": ["to-string", ["get", "pins"]], "text-font": FONT_BOLD, "text-size": 10, "text-allow-overlap": true, "text-ignore-placement": true },
          paint: { "text-color": "#000000", "text-translate": offset } },
      ]),
      // A circle's name and radius above its top edge; an area's name in its middle.
      { id: "wr-ann-area-label", type: "symbol", source: "wr-ann", filter: ["==", ["get", "kind"], "area-label"],
        layout: { "text-field": ["get", "label"], "text-font": FONT_BOLD, "text-size": 12.5, "text-anchor": ["match", ["get", "anchor"], "bottom", "bottom", "center"], "text-offset": ["match", ["get", "anchor"], "bottom", ["literal", [0, -0.35]], ["literal", [0, 0]]], "text-max-width": 22, "text-allow-overlap": true, "text-ignore-placement": true },
        paint: { "text-color": ["case", ["get", "sel"], "#ffe9b8", "#ffffff"], "text-halo-color": "#000000", "text-halo-width": 2 } },
    ],
  };
}

// Show the chosen base look by flipping visibility. The plain MAP keeps the dark land/water
// colors; imagery looks hide the water fill so NASA's picture shows through.
// Tapping these selects the annotation. A circle's or area's inside isn't listed: a big zone
// would otherwise swallow taps on the country dots and trackers inside it (tap its edge or name).
export const ANNOTATION_LAYERS = ["wr-ann-marker", "wr-ann-pin-badge", "wr-ann-marker-label", "wr-ann-text", "wr-ann-line", "wr-ann-line-label", "wr-ann-shape-line", "wr-ann-shape-fill", "wr-ann-shape-label", "wr-ann-area-line", "wr-ann-area-label", ...PIN_SLOTS.map(([slot]) => `wr-ann-pins-badge-${slot}`)];

export function applyBase(map, baseId, look = "dark") {
  const base = BASES.find((b) => b.id === baseId) || BASES[0];
  for (const id of IMAGERY_LAYERS) map.setLayoutProperty(id, "visibility", id === base.imagery ? "visible" : "none");
  map.setLayoutProperty("water", "visibility", base.imagery ? "none" : "visible");
  map.setPaintProperty("background", "background-color", base.imagery ? "#071019" : look === "light" ? "#efece4" : "#142230");
  // NASA's relief image already has shading; the night image looks best without extra shadows.
  map.setLayoutProperty("hillshade", "visibility", base.id === "map" || base.id === "satellite" ? "visible" : "none");
}

// The base map labels every country by name; Wire Room's dots label their own countries, so the
// base map's label for those is hidden to avoid two titles on one country.
export function hideBaseCountryLabels(map, ids) {
  if (!map.getLayer("label-countries")) return;
  const iso = ids.map((id) => String(id).toUpperCase());
  map.setFilter("label-countries", ["all", ["==", ["get", "class"], "country"], ["!", ["in", ["get", "iso_a2"], ["literal", iso]]]]);
}

// Light look for the plain MAP in the light theme. The style above is the dark look; the first
// call saves those dark values so switching back restores them exactly. Imagery looks (satellite,
// relief, night) are dark pictures, so they always keep the dark overlay colors.
const GREY_MARKER = ["==", ["get", "color"], "#d7dde8"];
const LIGHT_PAINT = {
  water: { "fill-color": "#cddbe6" },
  hillshade: { "hillshade-shadow-color": "#8a96a3", "hillshade-highlight-color": "#ffffff", "hillshade-accent-color": "#cfd5dc", "hillshade-exaggeration": 0.3 },
  rivers: { "line-color": "#a9c2d6" },
  "roads-major": { "line-color": "#d6cfbf" },
  "roads-mid": { "line-color": "#e0dacd" },
  "roads-minor": { "line-color": "#e8e3d9" },
  "borders-states": { "line-color": "#b9bfc8" },
  "borders-countries": { "line-color": "#8d97a5" },
  "label-seas": { "text-color": "#5c7a95", "text-halo-color": "#cddbe6" },
  "label-cities": { "text-color": "#3a414c", "text-halo-color": "#ffffff" },
  "label-towns": { "text-color": "#5b6472", "text-halo-color": "#ffffff" },
  "label-countries": { "text-color": "#6b7380", "text-halo-color": "#efece4" },
  "wr-zones-label-empty": { "text-color": "#9a4a08", "text-halo-color": "#ffffff" },
  "wr-zones-label": { "text-color": "#5b6472", "text-halo-color": "#ffffff" },
  "wr-country-halo": { "circle-stroke-color": "#1f5fbf" },
  "wr-country-dot": { "circle-color": ["case", ["get", "active"], "#1f5fbf", "#1f3a5f"], "circle-stroke-color": "#ffffff" },
  "wr-country-code": { "text-color": "#3a414c", "text-halo-color": "#ffffff" },
  "wr-wars": { "text-color": ["case", ["get", "sel"], "#14171c", "#b42318"], "text-halo-color": "#ffffff" },
  "wr-selected": { "circle-stroke-color": "#14171c" },
  "wr-ann-shape-fill": { "fill-color": "#14171c" },
  "wr-ann-shape-line": { "line-color": ["case", ["get", "sel"], "#000000", "#3a414c"] },
  "wr-ann-line": { "line-color": ["case", ["get", "sel"], "#000000", "#3a414c"] },
  "wr-draft-fill": { "fill-color": "#14171c" },
  "wr-draft-line": { "line-color": "#14171c" },
  "wr-ann-marker": {
    "circle-color": ["case", GREY_MARKER, "#3a414c", ["get", "color"]],
    "circle-stroke-color": ["case", ["get", "sel"], "#14171c", ["case", GREY_MARKER, "#3a414c", ["get", "color"]]],
  },
  "wr-ann-marker-label": { "text-color": "#14171c", "text-halo-color": "#ffffff" },
  "wr-ann-text": { "text-color": ["case", ["get", "sel"], "#1f5fbf", "#14171c"], "text-halo-color": "#ffffff" },
  "wr-ann-line-label": { "text-color": "#14171c", "text-halo-color": "#ffffff" },
  "wr-ann-shape-label": { "text-color": "#14171c", "text-halo-color": "#ffffff" },
  "wr-ann-area-fill": { "fill-color": ["case", GREY_MARKER, "#3a414c", ["get", "color"]] },
  "wr-ann-area-line": { "line-color": ["case", ["get", "sel"], "#000000", ["case", GREY_MARKER, "#3a414c", ["get", "color"]]] },
  "wr-ann-area-label": { "text-color": ["case", ["get", "sel"], "#1f5fbf", "#14171c"], "text-halo-color": "#ffffff" },
  "wr-draft-vertex": { "circle-color": "#14171c", "circle-stroke-color": "#ffffff" },
  "wr-draft-label": { "text-color": "#14171c", "text-halo-color": "#ffffff" },
};
const darkPaint = new WeakMap();
export function applyLook(map, look) {
  if (!darkPaint.has(map)) {
    const saved = {};
    for (const [layer, props] of Object.entries(LIGHT_PAINT)) {
      if (!map.getLayer(layer)) continue;
      saved[layer] = {};
      for (const prop of Object.keys(props)) saved[layer][prop] = map.getPaintProperty(layer, prop);
    }
    darkPaint.set(map, saved);
  }
  const table = look === "light" ? LIGHT_PAINT : darkPaint.get(map);
  for (const [layer, props] of Object.entries(table)) {
    if (!map.getLayer(layer)) continue;
    for (const [prop, value] of Object.entries(props)) map.setPaintProperty(layer, prop, value === undefined ? null : value);
  }
}

// Small icons drawn in code (no image files to host). Drawn at 2x and shown at half size.
function draw(size, fn) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const c = cv.getContext("2d");
  c.translate(size / 2, size / 2);
  fn(c);
  return c.getImageData(0, 0, size, size);
}
const DARK = "#071019";
const poly = (c, pts) => { c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); };
const hexPts = (r) => Array.from({ length: 6 }, (_, i) => { const a = (i * Math.PI) / 3 - Math.PI / 2; return [r * Math.cos(a), r * Math.sin(a)]; }); // point at the top

export function makeIcons() {
  const plane = draw(32, (c) => {
    poly(c, [[0, -13], [9, 11], [0, 5], [-9, 11]]);
    c.fillStyle = "#7cc4ff"; c.strokeStyle = DARK; c.lineWidth = 2; c.fill(); c.stroke();
  });
  // Ship: white diamond used as an SDF so MapLibre can color it per ship type.
  const ship = draw(24, (c) => {
    poly(c, [[0, -8], [8, 0], [0, 8], [-8, 0]]);
    c.fillStyle = "#ffffff"; c.fill();
  });
  // Flat icons with a thin dark edge (Nov 2026 restyle). Solid = attack reported, outlined = threat or warning.
  // War (UCDP conflict): a bullseye. Sized by level on the map and labeled with its name.
  const war = draw(52, (c) => {
    c.fillStyle = "rgba(255,77,77,.18)"; c.beginPath(); c.arc(0, 0, 22, 0, Math.PI * 2); c.fill();
    c.strokeStyle = DARK; c.lineWidth = 7; c.beginPath(); c.arc(0, 0, 13, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = WAR_RED; c.lineWidth = 3.5; c.beginPath(); c.arc(0, 0, 13, 0, Math.PI * 2); c.stroke();
    c.fillStyle = WAR_RED; c.strokeStyle = DARK; c.lineWidth = 2; c.beginPath(); c.arc(0, 0, 6, 0, Math.PI * 2); c.fill(); c.stroke();
  });
  // Strike reported in the news: a crosshair with a soft red glow, open in the middle.
  const strike = draw(40, (c) => {
    c.fillStyle = "rgba(255,107,94,.2)"; c.beginPath(); c.arc(0, 0, 16, 0, Math.PI * 2); c.fill();
    const mark = (color, w) => {
      c.strokeStyle = color; c.lineWidth = w; c.lineCap = "round";
      c.beginPath(); c.arc(0, 0, 9, 0, Math.PI * 2); c.stroke();
      c.beginPath();
      for (const [x1, y1, x2, y2] of [[0, -15, 0, -5], [0, 5, 0, 15], [-15, 0, -5, 0], [5, 0, 15, 0]]) { c.moveTo(x1, y1); c.lineTo(x2, y2); }
      c.stroke();
    };
    mark(DARK, 6); mark(STRIKE_RED, 3);
  });
  // Terrorism: a warning triangle.
  const triangle = (solid) => draw(34, (c) => {
    const pts = [[0, -12], [12.5, 10], [-12.5, 10]];
    c.lineJoin = "round";
    if (solid) { poly(c, pts); c.fillStyle = TERROR_YELLOW; c.fill(); c.strokeStyle = DARK; c.lineWidth = 2.2; c.stroke(); }
    else { poly(c, pts); c.strokeStyle = DARK; c.lineWidth = 6.5; c.stroke(); poly(c, pts); c.fillStyle = "rgba(7,16,25,.85)"; c.fill(); c.strokeStyle = TERROR_YELLOW; c.lineWidth = 3; c.stroke(); }
  });
  // Cyber: a hexagon.
  const hexagon = (solid) => draw(32, (c) => {
    const pts = hexPts(11.5);
    c.lineJoin = "round";
    if (solid) { poly(c, pts); c.fillStyle = CYBER_PINK; c.fill(); c.strokeStyle = DARK; c.lineWidth = 2.2; c.stroke(); }
    else { poly(c, pts); c.strokeStyle = DARK; c.lineWidth = 6.5; c.stroke(); poly(c, pts); c.fillStyle = "rgba(7,16,25,.85)"; c.fill(); c.strokeStyle = CYBER_PINK; c.lineWidth = 3; c.stroke(); }
  });
  return {
    plane, ship, war, strike,
    "terror-attack": triangle(true), "terror-threat": triangle(false),
    "cyber-attack": hexagon(true), "cyber-warning": hexagon(false),
  };
}
export const ICON_IDS = { plane: "wr-plane", ship: "wr-ship", war: "wr-war", strike: "wr-strike", "terror-attack": "wr-terror-attack", "terror-threat": "wr-terror-threat", "cyber-attack": "wr-cyber-attack", "cyber-warning": "wr-cyber-warning" };
