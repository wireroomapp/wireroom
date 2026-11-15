import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import * as d3 from "d3";
import { useTrackingFeed } from "./useTracking.js";
import { WORLD_BBOX, visibleBbox, projectItems, projectZones, hitTest, trackId, trackToReport } from "./trackingGeo.js";
import { exportMapImage } from "./exportMap.js";
import { STORAGE_KEY as ANNOTATION_KEY, toUnit, toPixel, loadAnnotations, migrateLegacy, annotationsToGeoJSON } from "./annotationSpace.js";
import MapLibreView from "./map/MapLibreView.jsx";
import { readViewFromUrl, viewToSearch } from "./urlState.js";
import SourcesPanel from "./SourcesPanel.jsx";
import { PlaceCard, WarCard, NodeCard } from "./TrackerCards.jsx";
import { DayBar } from "./DayBar.jsx";
import { useTrackerData, localDay, dayEnd, longDay, daysBetween, incidentToReport, warToReport, TRACKER_CREDITS, LEVEL_TEXT, sidesText, monthLabel, coverageLabel, n as num } from "./contextData.js";

// Which map to draw. "maplibre" = the full-scale map (OpenFreeMap + NASA + MapLibre, globe and terrain).
// "d3" = the classic flat map. Override in the address bar with ?engine=d3 or ?engine=maplibre.
// The new map needs WebGL (3D graphics in the browser). Very old devices without it get the classic map.
function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") || c.getContext("webgl"));
  } catch { return false; }
}
const MAP_ENGINE = (() => {
  try { const q = new URLSearchParams(window.location.search).get("engine"); if (q) return q.toLowerCase(); } catch { /* no window */ }
  const wanted = (import.meta.env.VITE_MAP_ENGINE || "maplibre").toLowerCase();
  return wanted === "maplibre" && !webglAvailable() ? "d3" : wanted;
})();
const ML = MAP_ENGINE === "maplibre";
import { TrackLayerSvg, LiveLayerControls, TrackCard, ZoneOutlines } from "./LiveLayers.jsx";

/*
  WIRE ROOM — Global News Map V2
  Frontend-first architecture:
  - Country/source registry is explicit and editable.
  - UI can consume a future /api/news endpoint.
  - Falls back to demo data so the interface is usable without a backend.
  - No API keys belong in this browser component.
*/

const MAP_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

// The real, deployed backend — no longer a same-origin /api proxy since
// the frontend and backend now live on different domains.
const API_BASE = import.meta.env.VITE_API_BASE || "https://wireroom-backend.onrender.com";

// Set VITE_FEEDBACK_URL (Render env var or .env.local) to a Google Form / mailto: link.
// The FEEDBACK button only shows when this is set.
const FEEDBACK_URL = import.meta.env.VITE_FEEDBACK_URL || "";

const COUNTRIES = [
  { id:"us", name:"United States", code:"US", lat:38.9, lon:-77.0, region:"Americas", sources:["White House","Department of Defense","Department of State"] },
  { id:"ca", name:"Canada", code:"CA", lat:45.4, lon:-75.7, region:"Americas", sources:["Prime Minister's Office","Global Affairs Canada","National Defence"] },
  { id:"mx", name:"Mexico", code:"MX", lat:19.4, lon:-99.1, region:"Americas", sources:["Presidencia","Secretaría de Relaciones Exteriores","Defensa"] },
  { id:"br", name:"Brazil", code:"BR", lat:-15.8, lon:-47.9, region:"Americas", sources:["Presidência","Ministério das Relações Exteriores","Ministério da Defesa"] },
  { id:"ar", name:"Argentina", code:"AR", lat:-34.6, lon:-58.4, region:"Americas", sources:["Casa Rosada","Cancillería","Ministerio de Defensa"] },
  { id:"gb", name:"United Kingdom", code:"UK", lat:51.5, lon:-0.1, region:"Europe", sources:["Prime Minister's Office","Foreign Office","Ministry of Defence"] },
  { id:"fr", name:"France", code:"FR", lat:48.9, lon:2.3, region:"Europe", sources:["Élysée","Ministère de l'Europe et des Affaires étrangères","Ministère des Armées"] },
  { id:"de", name:"Germany", code:"DE", lat:52.5, lon:13.4, region:"Europe", sources:["Bundesregierung","Auswärtiges Amt","Bundeswehr"] },
  { id:"it", name:"Italy", code:"IT", lat:41.9, lon:12.5, region:"Europe", sources:["Presidenza del Consiglio","Ministero degli Esteri","Ministero della Difesa"] },
  { id:"es", name:"Spain", code:"ES", lat:40.4, lon:-3.7, region:"Europe", sources:["La Moncloa","Ministerio de Asuntos Exteriores","Ministerio de Defensa"] },
  { id:"pl", name:"Poland", code:"PL", lat:52.2, lon:21.0, region:"Europe", sources:["Kancelaria Premiera","Ministerstwo Spraw Zagranicznych","Ministerstwo Obrony"] },
  { id:"ua", name:"Ukraine", code:"UA", lat:50.45, lon:30.52, region:"Europe", sources:["Office of the President","Ministry of Foreign Affairs","Ministry of Defence"] },
  { id:"ru", name:"Russia", code:"RU", lat:55.75, lon:37.6, region:"Europe/Asia", sources:["Kremlin","Ministry of Foreign Affairs","Ministry of Defence"] },
  { id:"tr", name:"Türkiye", code:"TR", lat:39.9, lon:32.9, region:"Europe/Asia", sources:["Presidency","Ministry of Foreign Affairs","Ministry of National Defence"] },
  { id:"il", name:"Israel", code:"IL", lat:31.77, lon:35.2, region:"Middle East", sources:["Prime Minister's Office","Ministry of Foreign Affairs","IDF"] },
  { id:"ir", name:"Iran", code:"IR", lat:35.7, lon:51.4, region:"Middle East", sources:["Presidency","Ministry of Foreign Affairs","Armed Forces"] },
  { id:"sa", name:"Saudi Arabia", code:"SA", lat:24.7, lon:46.7, region:"Middle East", sources:["Royal Court","Ministry of Foreign Affairs","Ministry of Defense"] },
  { id:"ae", name:"United Arab Emirates", code:"AE", lat:24.5, lon:54.4, region:"Middle East", sources:["Presidential Court","Ministry of Foreign Affairs","Ministry of Defence"] },
  { id:"eg", name:"Egypt", code:"EG", lat:30.0, lon:31.2, region:"Africa", sources:["Presidency","Ministry of Foreign Affairs","Ministry of Defence"] },
  { id:"za", name:"South Africa", code:"ZA", lat:-25.7, lon:28.2, region:"Africa", sources:["The Presidency","DIRCO","Department of Defence"] },
  { id:"ng", name:"Nigeria", code:"NG", lat:9.1, lon:7.5, region:"Africa", sources:["State House","Ministry of Foreign Affairs","Defence Headquarters"] },
  { id:"in", name:"India", code:"IN", lat:28.6, lon:77.2, region:"Asia", sources:["Prime Minister's Office","Ministry of External Affairs","Ministry of Defence"] },
  { id:"pk", name:"Pakistan", code:"PK", lat:33.7, lon:73.1, region:"Asia", sources:["Prime Minister's Office","Ministry of Foreign Affairs","Inter-Services Public Relations"] },
  { id:"cn", name:"China", code:"CN", lat:39.9, lon:116.4, region:"Asia", sources:["State Council","Ministry of Foreign Affairs","Ministry of National Defense"] },
  { id:"jp", name:"Japan", code:"JP", lat:35.7, lon:139.7, region:"Asia", sources:["Prime Minister's Office","Ministry of Foreign Affairs","Ministry of Defense"] },
  { id:"kr", name:"South Korea", code:"KR", lat:37.6, lon:127.0, region:"Asia", sources:["Office of the President","Ministry of Foreign Affairs","Ministry of National Defense"] },
  { id:"tw", name:"Taiwan", code:"TW", lat:25.0, lon:121.6, region:"Asia", sources:["Presidential Office","Ministry of Foreign Affairs","Ministry of National Defense"] },
  { id:"id", name:"Indonesia", code:"ID", lat:-6.2, lon:106.8, region:"Asia", sources:["Presidential Office","Ministry of Foreign Affairs","Ministry of Defense"] },
  { id:"au", name:"Australia", code:"AU", lat:-35.3, lon:149.1, region:"Oceania", sources:["Prime Minister's Office","Department of Foreign Affairs and Trade","Department of Defence"] },
];

const COUNTRY_BY_ID = Object.fromEntries(COUNTRIES.map(c => [c.id, c]));
// Review link (?review=1, not shown anywhere on the site): lists the NEWS reports the AI review
// hid, marked, so its choices can be checked. Without it, hidden reports simply don't appear.
const REVIEW_MODE = (() => { try { return new URLSearchParams(window.location.search).get("review") === "1"; } catch { return false; } })();

// What a shared link asks to open (?country=ua&mode=both, ?view=global, ?war=...). See urlState.js.
const INITIAL_URL_VIEW = (() => {
  try { return readViewFromUrl(window.location.search, COUNTRIES.map(c => c.id)); } catch { return { country: null, mode: null, global: false, war: null, day: null }; }
})();
const INITIAL_COUNTRY = COUNTRIES.find(c => c.id === INITIAL_URL_VIEW.country) || null;

const DEMO_NEWS = [
  { id:"demo-1", countryId:"us", sourceType:"official", source:"White House", headline:"Latest presidential statements and announcements", summary:"Demo content for the V2 interface. The production backend will replace this with a verified official source result.", date:"Demo", url:"#", importance:3 },
  { id:"demo-2", countryId:"us", sourceType:"independent", source:"Reuters", headline:"Independent coverage will appear here when enabled", summary:"The independent layer is optional and will be kept separate from official government reporting.", date:"Demo", url:"#", importance:2 },
  { id:"demo-3", countryId:"cn", sourceType:"official", source:"Ministry of Foreign Affairs", headline:"Official statement feed placeholder", summary:"Source-specific ingestion will populate this card once the backend is connected.", date:"Demo", url:"#", importance:3 },
  { id:"demo-4", countryId:"il", sourceType:"official", source:"Government source", headline:"Official government reporting placeholder", summary:"This demonstrates how country activity will surface on the global map.", date:"Demo", url:"#", importance:3 },
];

const TAG_LABELS = { official: "Official", aircraft: "Aircraft", vessel: "Vessel", conflict: "Conflict data", advisory: "Advisory" };
function SourceTag({ type }) {
  const cls = type === "official" ? "official" : type === "aircraft" || type === "vessel" || type === "conflict" || type === "advisory" ? "track" : "independent";
  return <span className={`tag ${cls}`}>{TAG_LABELS[type] || "News"}</span>;
}

// "uk" -> "Ukrainian", using the browser's own list of language names.
function languageName(code) {
  try { return new Intl.DisplayNames(["en"], { type: "language" }).of(code) || String(code).toUpperCase(); } catch { return String(code || "").toUpperCase(); }
}

// Many feeds repeat the headline as the summary (often with the publisher's name added).
// Showing it twice looks broken, so the repeat is hidden.
function sameText(a, b) {
  const norm = (t) => String(t || "").toLowerCase().replace(/\s+[-–|]\s+[^-–|]{1,60}$/, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  const n = Math.min(x.length, y.length, 60);
  return x.slice(0, n) === y.slice(0, n);
}

function NewsCard({ item, onPin }) {
  // Reports not in English carry a machine translation (item.tr, added by the hourly job).
  // English is shown first; the original is one tap away.
  const [showOriginal, setShowOriginal] = useState(false);
  const tr = item.tr && item.tr.headline ? item.tr : null;
  const english = Boolean(tr) && !showOriginal;
  return <article className={`card ${item.hiddenByAi ? "off-topic" : ""}`}>
    <div className="card-meta"><SourceTag type={item.sourceType}/><span>{item.source}</span><span>{item.date}</span>
      {item.countryLabel && <span className="card-gov">{item.countryLabel}</span>}
      {item.hiddenByAi && <span className="card-offtopic">{String(item.hiddenByAi).startsWith("about ") ? `Not about this country (AI review): ${String(item.hiddenByAi)}` : `OFF-TOPIC (AI REVIEW): ${String(item.hiddenByAi).toUpperCase()}`}</span>}</div>
    {tr && (
      <div className="tr-note">
        <span>{english ? `Machine-translated from ${languageName(tr.from)}` : `Original · ${languageName(tr.from)}`}</span>
        <button type="button" onClick={() => setShowOriginal(v => !v)}>{english ? "Show original" : "Show English"}</button>
      </div>
    )}
    <h3 lang={english ? "en" : tr ? tr.from : undefined}>{english ? tr.headline : item.headline}</h3>
    {(() => {
      const head = english ? tr.headline : item.headline;
      const body = english ? (tr.summary || "") : item.summary;
      return body && !sameText(head, body) ? <p lang={english ? "en" : tr ? tr.from : undefined}>{body}</p> : null;
    })()}
    {item.url && item.url !== "#" && <a href={item.url} target="_blank" rel="noreferrer">Read original →</a>}
  {onPin && <button type="button" onClick={() => onPin(item)} style={{ marginLeft: 12, background: "none", border: "1px solid var(--ok-line)", color: "var(--ok)", font: "12px var(--font)", padding: "4px 8px", cursor: "pointer" }}>Pin to map</button>}
  </article>;
}

export default function WireRoomV2() {
  const [selected, setSelected] = useState(INITIAL_COUNTRY);
  const [view, setView] = useState(INITIAL_COUNTRY ? "country" : INITIAL_URL_VIEW.global ? "global" : "closed"); // "closed" | "country" | "global"
  const [mode, setMode] = useState(INITIAL_URL_VIEW.mode || "official"); // official | news | both
  // A shared link to a country also flies the map there (new map only).
  const [mapFocus, setMapFocus] = useState(() => (INITIAL_COUNTRY ? { lon: INITIAL_COUNTRY.lon, lat: INITIAL_COUNTRY.lat, key: INITIAL_COUNTRY.id } : null));
  const [linkNote, setLinkNote] = useState("");
  const [showSources, setShowSources] = useState(false);
  const [query, setQuery] = useState("");
  const [intelQuery, setIntelQuery] = useState("");
  const [intelSource, setIntelSource] = useState("");
  const [intelFrom, setIntelFrom] = useState("");
  const [intelTo, setIntelTo] = useState("");
  const [region, setRegion] = useState("ALL");
  const [feed, setFeed] = useState(DEMO_NEWS);
  const [officialVerifiedMap, setOfficialVerifiedMap] = useState({});
  const [officialStatusMap, setOfficialStatusMap] = useState({});
  const [loading, setLoading] = useState(Boolean(INITIAL_COUNTRY));
  const [page, setPage] = useState(1);
  const [mapFeatures, setMapFeatures] = useState([]);
  const [dims, setDims] = useState({w:1200,h:700});
  const [transform, setTransform] = useState({k:1,x:0,y:0});
  const stageRef = useRef(null);
  const svgRef = useRef(null);
  const zoomRef = useRef(null);
  const abortRef = useRef(null); // cancels a stale request when a newer one starts
  const [annotationTool, setAnnotationTool] = useState("select");
  // Saved in map units (see annotationSpace.js) so they stay put when the map resizes.
  const [annotations, setAnnotations] = useState(() => { try { return loadAnnotations(localStorage); } catch { return []; } });
  const [selectedAnnotationId, setSelectedAnnotationId] = useState(null);
  const [pinning, setPinning] = useState(null); // a report waiting to be pinned to a marker
  const pinTapRef = useRef(null);
  const [storageWarn, setStorageWarn] = useState(false);
  const [showWelcome, setShowWelcome] = useState(() => { try { return !localStorage.getItem("wireroom-welcomed-v2"); } catch { return true; } });
  const dismissWelcome = () => { try { localStorage.setItem("wireroom-welcomed-v2", "1"); } catch { /* private mode: just close */ } setShowWelcome(false); };
  const [annotationDraft, setAnnotationDraft] = useState(null);
  // Light or dark look. index.html sets the starting value before the page paints.
  const [theme, setTheme] = useState(() => (typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark"));
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("wireroom-theme", theme); } catch { /* private mode: still switches, just not remembered */ }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "light" ? "#ffffff" : "#0e1116");
  }, [theme]);
  // The drawing tools fold away behind one Draw button. Open on wide screens, folded on phones, then remembered.
  const [toolsOpen, setToolsOpen] = useState(() => {
    try { const v = localStorage.getItem("wireroom-tools-open"); if (v === "1" || v === "0") return v === "1"; } catch { /* ignore */ }
    return typeof window === "undefined" || window.innerWidth > 800;
  });
  useEffect(() => { try { localStorage.setItem("wireroom-tools-open", toolsOpen ? "1" : "0"); } catch { /* ignore */ } }, [toolsOpen]);
  const [labelDialog, setLabelDialog] = useState(null); // in-page label box (replaces browser pop-ups)
  const drawingBlockedRef = useRef(false); // true while a pinch (2+ fingers) is in progress
  const [annotationColor, setAnnotationColor] = useState("#d7dde8");
  const MARKER_COLORS = ["#d7dde8", "#ff4d4d", "#ff9f43", "#ffd166", "#4cd964", "#35c7b0", "#4da3ff", "#9b7bff", "#ff6fb5"];
  const annotationHydratedRef = useRef(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/global?mode=both${REVIEW_MODE ? "&showHidden=1" : ""}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        // If a country was opened meanwhile (e.g. from a shared link), its reports win.
        if (abortRef.current) return;
        if (data && Array.isArray(data.items) && data.items.length) {
          setFeed(data.items);
          setOffTopic({ hidden: data.hidden || 0, aiReview: Boolean(data.aiReview) });
        }
      })
      .catch(() => {
        // Demo data remains visible if the backend can't be reached.
      });
  }, []);
  useEffect(() => {
    fetch(MAP_URL).then(r => r.json()).then(topology => {
      const obj = topology.objects.countries;
      if (!obj) return;
      const features = obj.geometries.map(g => ({ type:"Feature", properties:g.properties || {}, geometry:geometryFromTopo(topology,g) })).filter(f=>f.geometry);
      setMapFeatures(features);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    // Annotations are loaded in the useState initializer above; from here on, changes are saved.
    annotationHydratedRef.current = true;
  }, []);

  useEffect(() => {
    if (!annotationHydratedRef.current) return;
    let saved = true;
    try { localStorage.setItem(ANNOTATION_KEY, JSON.stringify(annotations)); } catch { saved = false; }
    // Warn if the browser refused to save (private mode, storage full).
    setStorageWarn(!saved);
  }, [annotations]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const r = entries[0]?.contentRect;
      if (r?.width && r?.height) {
        setDims({w:r.width,h:r.height});
        // One-time upgrade of annotations saved in pixels by older versions, using the real map size.
        const fitted = d3.geoNaturalEarth1().fitSize([r.width, r.height], {type:"Sphere"});
        setAnnotations(prev => migrateLegacy(prev, fitted));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const projection = useMemo(() => d3.geoNaturalEarth1().fitSize([dims.w,dims.h],{type:"Sphere"}),[dims]);
  const path = useMemo(() => d3.geoPath(projection),[projection]);
  // Annotations in screen pixels for drawing (stored in map units).
  const viewAnnotations = useMemo(() => annotations.map(a => toPixel(a, projection)), [annotations, projection]);

  // ---- Live layers: military aircraft + ships (off until the user turns them on) ----
  const [airOn, setAirOn] = useState(false);
  const [shipsOn, setShipsOn] = useState(false);
  const [trackSel, setTrackSel] = useState(null); // { kind: "air" | "ship", id, item }
  // Trackers (new map only): MILITARY (wars + reported strikes), TERRORISM, CYBER. See contextData.js.
  const [militaryOn, setMilitaryOn] = useState(Boolean(ML && (INITIAL_URL_VIEW.war || INITIAL_URL_VIEW.day)));
  // The day the EVENTS trackers show: null = today (live), or a past local day "YYYY-MM-DD".
  // AI review (lib/ai-check.mjs): off-topic NEWS reports the server hides, and whether to show them.
  const [showOffTopic, setShowOffTopic] = useState(REVIEW_MODE);
  const [offTopic, setOffTopic] = useState({ hidden: 0, aiReview: false });
  const [mapDay, setMapDay] = useState(() => (ML && INITIAL_URL_VIEW.day && INITIAL_URL_VIEW.day < localDay() ? INITIAL_URL_VIEW.day : null));
  const [terrorOn, setTerrorOn] = useState(false);
  const [cyberOn, setCyberOn] = useState(false);
  const [trkSel, setTrkSel] = useState(null); // { kind: "place" | "war" | "node", item, war }
  const [warView, setWarView] = useState(null); // the war whose intel panel is open
  const eventsOn = militaryOn || terrorOn || cyberOn;
  const shownDay = ML && eventsOn ? mapDay : null; // planes/ships and the URL only care while trackers show it
  const incidentData = useTrackerData(API_BASE, ML ? mapDay : null, ML && eventsOn);
  const incidentSet = incidentData.data;
  const shownIncidents = useMemo(() => (incidentSet ? [
    ...(militaryOn ? incidentSet.strikes || [] : []),
    ...(terrorOn ? incidentSet.terrorism || [] : []),
    ...(cyberOn ? incidentSet.cyber || [] : []),
  ] : null), [incidentSet, militaryOn, terrorOn, cyberOn]);
  const shownWars = militaryOn && incidentSet ? incidentSet.wars || [] : null;
  // A selected war follows the day shown (its figures as of that day), or hides if it wasn't active.
  const dayWars = (incidentSet && incidentSet.wars) || [];
  const trkSelDay = trkSel && trkSel.kind === "war" ? (() => { const w = dayWars.find(x => x.id === trkSel.item.id); return w ? { ...trkSel, item: w } : null; })() : trkSel;
  const warViewDay = warView ? dayWars.find(x => x.id === warView.id) || (incidentSet ? null : warView) : null;
  function changeDay(d) {
    setMapDay(d);
    setTrackSel(null);
    if (trkSel && trkSel.kind !== "war") setTrkSel(null);
    if (view === "war" && warView) loadWarIntel(warView, d);
  }
  const suppressTrackClickUntilRef = useRef(0);
  const d3ShipsBbox = useMemo(() => visibleBbox(projection, transform, dims), [projection, transform, dims]);
  const [mlBbox, setMlBbox] = useState(WORLD_BBOX); // visible area reported by the MapLibre map
  const shipsBbox = ML ? mlBbox : d3ShipsBbox;
  // Aircraft: worldwide military feed (one cheap call). Ships: only the area on screen.
  // Planes and ships are live positions only: hidden while the map shows a past day.
  const liveAir = airOn && !shownDay, liveShips = shipsOn && !shownDay;
  const airFeed = useTrackingFeed({ enabled: liveAir, path: "/api/aircraft", bbox: WORLD_BBOX, extra: "&mil=1", pollMs: 15000 });
  const shipFeed = useTrackingFeed({ enabled: liveShips, path: "/api/ships", bbox: shipsBbox, pollMs: 20000 });
  const airProjected = useMemo(() => projectItems(airFeed.items, projection), [airFeed.items, projection]);
  const shipProjected = useMemo(() => projectItems(shipFeed.items, projection), [shipFeed.items, projection]);
  const hasNewsSet = useMemo(() => new Set(feed.map(n => n.countryId)), [feed]);
  const annotationsGeo = useMemo(() => (ML ? annotationsToGeoJSON(annotations, selectedAnnotationId) : null), [annotations, selectedAnnotationId]);
  const shipZones = useMemo(() => projectZones(shipFeed.meta?.zones, projection), [shipFeed.meta, projection]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const zoom = d3.zoom()
      .scaleExtent([1,8])
      .filter(e => e.type === "wheel" || (annotationTool === "select" ? (!e.ctrlKey && !e.button) : (e.type === "touchstart" && e.touches && e.touches.length > 1)))
      .on("zoom", e => setTransform(e.transform));
    d3.select(svg).call(zoom);
    zoomRef.current = zoom;
    return () => d3.select(svg).on(".zoom",null);
  }, [dims, annotationTool]);

  const filteredCountries = useMemo(() => COUNTRIES.filter(c => {
    const q = query.trim().toLowerCase();
    return (!q || c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)) && (region === "ALL" || c.region === region);
  }), [query,region]);

  const visibleFeed = useMemo(() => {
    let items = feed;
    if (selected) items = items.filter(i => i.countryId === selected.id);
    if (mode !== "both") {
      const wantType = mode === "news" ? "independent" : mode;
      items = items.filter(i => i.sourceType === wantType);
    }
    const keyword = intelQuery.trim().toLowerCase();
    if (keyword) {
      items = items.filter(i => [i.headline, i.summary, i.source, i.tr && i.tr.headline, i.tr && i.tr.summary].filter(Boolean).join(" ").toLowerCase().includes(keyword));
    }
    if (intelSource) items = items.filter(i => i.source === intelSource);
    if (intelFrom || intelTo) {
      const fromTime = intelFrom ? new Date(intelFrom + "T00:00:00").getTime() : -Infinity;
      const toTime = intelTo ? new Date(intelTo + "T23:59:59").getTime() : Infinity;
      items = items.filter(i => {
        const time = new Date(i.publishedAt || i.date).getTime();
        if (Number.isNaN(time)) return false;
        return time >= fromTime && time <= toTime;
      });
    }
    return [...items].sort((x, y) => new Date(y.publishedAt || 0) - new Date(x.publishedAt || 0));
  }, [feed,selected,mode,intelQuery,intelSource,intelFrom,intelTo]);

  const REPORTS_PER_PAGE = 20;
  const totalPages = Math.max(1, Math.ceil(visibleFeed.length / REPORTS_PER_PAGE));
  const pageStart = (page - 1) * REPORTS_PER_PAGE;
  const pagedFeed = visibleFeed.slice(pageStart, pageStart + REPORTS_PER_PAGE);

  const sourceOptions = useMemo(() =>
    Array.from(new Set(feed.map(i => i.source).filter(Boolean))).sort((x, y) => x.localeCompare(y)),
    [feed]
  );

  const intelFiltersActive = Boolean(intelQuery.trim() || intelSource || intelFrom || intelTo);

  // Filters belong to one panel: cleared when you open a different country or the global feed.
  function resetIntelFilters() {
    setIntelQuery("");
    setIntelSource("");
    setIntelFrom("");
    setIntelTo("");
  }

  async function loadCountry(country, modeOverride) {
    if (!selected || selected.id !== country.id || view !== "country") resetIntelFilters();
    setPage(1);
    setSelected(country);
    setView("country");
    setWarView(null);
    setLoading(true);
    // Accept an explicit mode so switching filter tabs re-queries the
    // backend instead of only re-filtering whatever was fetched under
    // the mode that was active at selection time.
    const activeMode = modeOverride || mode;
    setOfficialVerifiedMap(prev => { const next = { ...prev }; delete next[country.id]; return next; });
    setOfficialStatusMap(prev => { const next = { ...prev }; delete next[country.id]; return next; });
    return fetchCountryReports(country, activeMode);
  }

  // Fetch one country's reports for a mode (OFFICIAL / NEWS / BOTH).
  async function fetchCountryReports(country, activeMode, showHiddenOverride) {
    // Cancel whatever request was still in flight — without this, a
    // slower older request (e.g. from a tab you clicked a moment ago)
    // can resolve AFTER a newer one and silently overwrite it, showing
    // stale content under the wrong tab.
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // Production contract. No browser API key: the future backend owns this request.
      const response = await fetch(
        `${API_BASE}/api/news?country=${encodeURIComponent(country.id)}&mode=${encodeURIComponent(activeMode)}${(typeof showHiddenOverride === "boolean" ? showHiddenOverride : showOffTopic) ? "&showHidden=1" : ""}`,
        { signal: controller.signal, cache: "no-store" }
      );
      if (response.ok) {
        const data = await response.json();
 	if (abortRef.current !== controller) return;
       if (Array.isArray(data.items) && abortRef.current === controller) {
  setFeed(data.items);
  setOffTopic({ hidden: data.hidden || 0, aiReview: Boolean(data.aiReview) });
}
        if (typeof data.officialVerified === "boolean") {
          setOfficialVerifiedMap(prev => ({ ...prev, [country.id]: data.officialVerified }));
          setOfficialStatusMap(prev => ({ ...prev, [country.id]: { status: data.officialStatus || null, lastOkAt: data.officialLastOkAt || null } }));
        }
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        // Demo data remains visible when no backend exists yet.
      }
    } finally {
      if (abortRef.current === controller) setLoading(false);
    }
  }
  // Opened from a shared link: load that country's reports once.
  useEffect(() => {
    if (INITIAL_COUNTRY) fetchCountryReports(INITIAL_COUNTRY, INITIAL_URL_VIEW.mode || "official");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- only on the first page load

  // Keep the address bar in step with what's open, so copying it shares this exact view.
  useEffect(() => {
    try {
      const search = viewToSearch({ country: view === "country" && selected ? selected.id : null, global: view === "global", war: view === "war" && warView ? warView.id : null, day: shownDay, mode }, window.location.search);
      if (search !== window.location.search) window.history.replaceState(null, "", window.location.pathname + search + window.location.hash);
    } catch { /* very old browser: links just won't update */ }
  }, [selected, view, mode, warView, shownDay]);

  // LINK button: phones get the share sheet, computers copy the link.
  async function shareView() {
    const url = window.location.href;
    const title = selected ? `${selected.name} on Wire Room` : "Wire Room";
    const touch = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    if (touch && navigator.share) {
      try { await navigator.share({ title, url }); return; } catch (e) { if (e && e.name === "AbortError") return; }
    }
    let copied;
    try { await navigator.clipboard.writeText(url); copied = true; } catch {
      try {
        const box = document.createElement("textarea");
        box.value = url; box.setAttribute("readonly", ""); box.style.position = "fixed"; box.style.opacity = "0";
        document.body.appendChild(box); box.select(); copied = document.execCommand("copy"); box.remove();
      } catch { copied = false; }
    }
    setLinkNote(copied ? "Link copied" : "Copy the address bar to share");
    setTimeout(() => setLinkNote(""), 2200);
  }

  function loadGlobal(showHiddenOverride = undefined) {
    if (view !== "global") resetIntelFilters();
    setPage(1);
    setSelected(null);
    setView("global");
    setWarView(null);
    const show = typeof showHiddenOverride === "boolean" ? showHiddenOverride : showOffTopic;
    fetch(`${API_BASE}/api/global?mode=both${show ? "&showHidden=1" : ""}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data && Array.isArray(data.items) && data.items.length) {
          setFeed(data.items);
          setOffTopic({ hidden: data.hidden || 0, aiReview: Boolean(data.aiReview) });
        }
      })
      .catch(() => {});
  }
  // SHOW / HIDE the reports the AI review marked off-topic, for the panel that's open.
  function toggleOffTopic() {
    const next = !showOffTopic;
    setShowOffTopic(next);
    if (view === "country" && selected) { setLoading(true); fetchCountryReports(selected, mode, next); }
    else if (view === "global") loadGlobal(next);
  }
  function closePanel() {
    resetIntelFilters();
    setSelected(null);
    setView("closed");
    setWarView(null);
  }
  // A war's intel panel: the latest related official statements (all governments Wire Room
  // follows) and outlet reports, collected hourly (scripts/collect-incidents.mjs).
  function openWarIntel(war) {
    if (view !== "war" || !warView || warView.id !== war.id) resetIntelFilters();
    setPage(1);
    setSelected(null);
    setWarView(war);
    setView("war");
    setMode("both");
    // On a phone the panel covers the map, so the war card steps aside (the web stays drawn).
    try { if (window.matchMedia("(max-width: 800px)").matches) setTrkSel(null); } catch { /* old browser */ }
    loadWarIntel(war, mapDay);
  }
  function loadWarIntel(war, day) {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setFeed([]);
    setLoading(true);
    const until = day ? `&until=${encodeURIComponent(dayEnd(day).toISOString())}` : "";
    fetch(`${API_BASE}/api/war-intel?id=${encodeURIComponent(war.id)}${until}`, { signal: controller.signal })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (abortRef.current === controller) setFeed(d && Array.isArray(d.items) ? d.items : []); })
      .catch(() => {})
      .finally(() => { if (abortRef.current === controller) setLoading(false); });
  }
  function toggleWarIntel(war) {
    if (view === "war" && warView && warView.id === war.id) closePanel();
    else openWarIntel(war);
  }
  // A shared link to a war (?war=...): open it once the tracker data has loaded.
  const pendingWarRef = useRef(ML ? INITIAL_URL_VIEW.war : null);
  useEffect(() => {
    if (!pendingWarRef.current || !incidentSet) return;
    const w = (incidentSet.wars || []).find(x => x.id === pendingWarRef.current);
    pendingWarRef.current = null;
    if (!w) return;
    setTrkSel({ kind: "war", item: w });
    setMapFocus({ lon: w.lon, lat: w.lat, key: w.id });
    openWarIntel(w);
  }, [incidentSet]); // eslint-disable-line react-hooks/exhaustive-deps
  function changeMode(newMode) {
    setMode(newMode);
    if (selected) loadCountry(selected, newMode);
  }

  function svgPointFromEvent(e) {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const point = svg.createSVGPoint();
    point.x = e.clientX;
    point.y = e.clientY;
    const transformed = point.matrixTransform(svg.getScreenCTM().inverse());
    return {
      x: (transformed.x - transform.x) / transform.k,
      y: (transformed.y - transform.y) / transform.k
    };
  }

  function addAnnotation(annotation) {
    const id = crypto.randomUUID
      ? crypto.randomUUID()
      : String(Date.now()) + "-" + Math.random();
    const next = { id, ...toUnit(annotation, projection) };
    setAnnotations(prev => [...prev, next]);
    setSelectedAnnotationId(id);
  }

  function startPinReport(item) {
    setSelectedAnnotationId(null);
    setAnnotationTool("select");
    setAnnotationDraft(null);
    setLabelDialog(null);
    setPinning({
      id: item.id,
      countryId: item.countryId || "",
      sourceType: item.sourceType || "",
      source: item.source || "",
      headline: item.headline || "",
      summary: (item.summary || "").slice(0, 400),
      date: item.date || "",
      publishedAt: item.publishedAt || null,
      url: item.url || "",
      ...(item.tr && item.tr.headline ? { tr: { from: item.tr.from, headline: item.tr.headline, summary: (item.tr.summary || "").slice(0, 400) } } : {}),
      ...(Number.isFinite(item.lat) && Number.isFinite(item.lon) ? { lat: item.lat, lon: item.lon } : {})
    });
  }

  function pinReportToMarker(markerId) {
    const report = pinning;
    if (!report) return;
    setAnnotations(prev => prev.map(a => {
      if (a.id !== markerId || a.type !== "marker") return a;
      const pins = a.pins || [];
      if (pins.some(p => p.id === report.id)) return a;
      return { ...a, pins: [...pins, { ...report, pinnedAt: new Date().toISOString() }] };
    }));
    setSelectedAnnotationId(markerId);
    setPinning(null);
  }

  function placePinnedReport(point) {
    const report = pinning;
    if (!report) return;
    addAnnotation({
      type: "marker",
      x: point.x,
      y: point.y,
      label: "",
      color: annotationColor,
      pins: [{ ...report, pinnedAt: new Date().toISOString() }]
    });
    setPinning(null);
  }

  function unpinReport(markerId, pinId) {
    setAnnotations(prev => prev.map(a =>
      a.id === markerId ? { ...a, pins: (a.pins || []).filter(p => p.id !== pinId) } : a
    ));
  }

  function handleMapPointerDown(e) {
    if (pinning && annotationTool === "select") {
      pinTapRef.current = e.isPrimary && e.button === 0
        ? { x: e.clientX, y: e.clientY, id: e.pointerId }
        : null;
      return;
    }
    if (annotationTool === "select" || e.button !== 0) return;

    // A second finger means pinch-zoom, not drawing: drop any half-started
    // drawing and ignore this gesture until the next fresh touch.
    if (!e.isPrimary) {
      drawingBlockedRef.current = true;
      setAnnotationDraft(null);
      return;
    }
    drawingBlockedRef.current = false;

    e.preventDefault();
    e.stopPropagation();

    const point = svgPointFromEvent(e);

    setAnnotationDraft({
      tool: annotationTool,
      start: point,
      end: point
    });

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch { /* not supported: drawing still works without capture */ }
  }

  function handleMapPointerMove(e) {
    if (!annotationDraft) return;

    e.preventDefault();
    e.stopPropagation();

    if (drawingBlockedRef.current) return;
    setAnnotationDraft(prev => ({
      ...prev,
      end: svgPointFromEvent(e)
    }));
  }

  function handleMapPointerUp(e) {
    if (pinning && annotationTool === "select") {
      const t = pinTapRef.current;
      pinTapRef.current = null;
      if (t && e.isPrimary && e.pointerId === t.id && Math.hypot(e.clientX - t.x, e.clientY - t.y) < 10) {
        placePinnedReport(svgPointFromEvent(e));
        suppressTrackClickUntilRef.current = Date.now() + 600; // this tap placed a pin, don't also open a ship/plane
      }
      return;
    }
    if (!annotationDraft) return;

    e.preventDefault();
    e.stopPropagation();

    if (drawingBlockedRef.current) {
      setAnnotationDraft(null);
      return;
    }

    const { tool, start, end } = annotationDraft;
    const width = Math.abs(end.x - start.x);
    const height = Math.abs(end.y - start.y);

    if (tool === "marker") {
      openLabelDialog({ kind: "marker", value: "", point: { x: start.x, y: start.y }, color: annotationColor });
    }

    if (tool === "line" && Math.hypot(end.x - start.x, end.y - start.y) > 8) {
      addAnnotation({
        type: "line",
        x1: start.x,
        y1: start.y,
        x2: end.x,
        y2: end.y,
        label: ""
      });
    }

    if (tool === "shape" && width > 8 && height > 8) {
      addAnnotation({
        type: "shape",
        x: Math.min(start.x, end.x),
        y: Math.min(start.y, end.y),
        width,
        height,
        label: ""
      });
    }

    if (tool === "text") {
      openLabelDialog({ kind: "text", value: "", point: { x: start.x, y: start.y } });
    }

    setAnnotationDraft(null);
  }

  // Tap on empty map (select tool): open the nearest aircraft/ship, or close the card.
  // Country dots and annotations stop their own clicks, so they still win.
  function handleMapClick(e) {
    if (Date.now() < suppressTrackClickUntilRef.current) return;
    if (pinning || annotationTool !== "select" || (!liveAir && !liveShips)) return;
    const hit = hitTest(
      [{ kind: "air", projected: airProjected }, { kind: "ship", projected: shipProjected }],
      svgPointFromEvent(e),
      transform.k
    );
    if (hit) {
      setSelectedAnnotationId(null);
      setTrackSel({ kind: hit.kind, id: trackId(hit.kind, hit.item), item: hit.item });
    } else {
      setTrackSel(null);
    }
  }

  const trackShown = Boolean(trackSel) && !pinning && annotationTool === "select" && !selectedAnnotationId &&
    ((trackSel.kind === "air" && liveAir) || (trackSel.kind === "ship" && liveShips));
  const trkKindOn = (sel) => sel.kind === "place"
    ? (sel.item.kind === "strike" ? militaryOn : sel.item.kind === "terrorism" ? terrorOn : cyberOn)
    : militaryOn;
  const warOfIncident = (i) => (shownWars || []).find(w => (w.reported || []).includes(i.id)) || null;
  const trkShown = Boolean(trkSelDay) && ML && !pinning && annotationTool === "select" && !selectedAnnotationId && trkKindOn(trkSelDay);
  // The war whose web of latest attacks is drawn: the one tapped, or the one whose panel is open.
  const webWar = !militaryOn ? null
    : trkShown && trkSelDay.kind === "war" ? trkSelDay.item
    : trkShown && trkSelDay.war && trkSelDay.kind === "node" ? trkSelDay.war
    : view === "war" ? warViewDay : null;
  const trkKey = trkShown ? (trkSelDay.kind === "place" ? `g:${trkSelDay.item.key}` : trkSelDay.kind === "war" ? `w:${trkSelDay.item.id}` : `n:${trkSelDay.war.id}:${trkSelDay.item.id}`) : null;
  function toggleTracker(kind) {
    if (!militaryOn && !terrorOn && !cyberOn) incidentData.retry();
    if (kind === "military") setMilitaryOn(v => !v);
    else if (kind === "terrorism") setTerrorOn(v => !v);
    else setCyberOn(v => !v);
  }
  const trackLive = trackShown
    ? (trackSel.kind === "air" ? airProjected : shipProjected).find(p => trackId(trackSel.kind, p.item) === trackSel.id) || null
    : null;

  // Save the current map view (markers, lines, notes, live layers) as a PNG.
  const [exportState, setExportState] = useState("idle"); // idle | busy | error
  async function exportMap() {
    if ((!ML && !svgRef.current) || exportState === "busy") return;
    setExportState("busy");
    try {
      const credits = [shownDay && `Events as of the end of ${longDay(shownDay)}`, liveAir && airFeed.attribution, liveShips && shipFeed.attribution,
        ML && militaryOn && TRACKER_CREDITS.military, ML && (militaryOn || terrorOn || cyberOn) && TRACKER_CREDITS.reports,
        ML && (militaryOn || terrorOn || cyberOn) && TRACKER_CREDITS.places].filter(Boolean);
      if (ML) {
        const canvas = mlRef.current && mlRef.current.getCanvas();
        if (!canvas) throw new Error("Map not ready");
        await exportMapImage(canvas, { width: canvas.clientWidth, height: canvas.clientHeight, credits: [...mlRef.current.credits(), ...credits], annotated: annotations.length > 0 });
      } else {
        await exportMapImage(svgRef.current, { width: dims.w, height: dims.h, credits, annotated: annotations.length > 0 });
      }
      setExportState("idle");
    } catch (err) {
      console.error("Map export failed", err);
      setExportState("error");
      setTimeout(() => setExportState("idle"), 3000);
    }
  }

  // ---- Analyst tools on the new map (it reports longitude/latitude) ----
  const mlRef = useRef(null);
  const llToPx = ll => { const p = projection(ll); return p && Number.isFinite(p[0]) ? { x: p[0], y: p[1] } : null; };
  function mlDrawPoint(tool, ll) {
    const point = llToPx(ll);
    if (!point) return;
    openLabelDialog(tool === "marker" ? { kind: "marker", value: "", point, color: annotationColor } : { kind: "text", value: "", point });
  }
  function mlDrawDrag(tool, a, b) {
    const p1 = llToPx(a), p2 = llToPx(b);
    if (!p1 || !p2) return;
    if (tool === "line") addAnnotation({ type: "line", x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, label: "" });
    else addAnnotation({ type: "shape", x: Math.min(p1.x, p2.x), y: Math.min(p1.y, p2.y), width: Math.abs(p2.x - p1.x), height: Math.abs(p2.y - p1.y), label: "" });
  }
  function mlAnnotationTap(id) {
    if (pinning) {
      const a = annotations.find(x => x.id === id);
      if (a && a.type === "marker") pinReportToMarker(id);
      return;
    }
    if (annotationTool === "select") { setSelectedAnnotationId(id); setTrackSel(null); }
  }
  function mlPinPlace(ll) {
    const point = llToPx(ll);
    if (point) placePinnedReport(point);
  }

  // Open the label/note box and put the cursor in it during the same tap. Phones (iPhones
  // especially, some Android keyboards too) only open the keyboard when focus happens inside
  // the tap itself; focusing after React re-renders on its own schedule can leave it closed.
  const labelInputRef = useRef(null);
  function openLabelDialog(d) {
    try { flushSync(() => setLabelDialog(d)); } catch { setLabelDialog(d); }
    const el = labelInputRef.current;
    if (!el) return;
    try {
      el.focus({ preventScroll: true });
      const end = el.value.length;
      el.setSelectionRange(end, end);
    } catch { /* focus not allowed: tapping the box still works */ }
  }

  function editSelectedAnnotation() {
    if (!selectedAnnotationId) return;

    const current = annotations.find(a => a.id === selectedAnnotationId);
    if (!current) return;

    if (current.type === "text") {
      openLabelDialog({ kind: "edit-text", id: current.id, value: current.text || "" });
      return;
    }

    openLabelDialog({ kind: "edit-label", id: current.id, value: current.label || "" });
  }

  function submitLabelDialog() {
    const d = labelDialog;
    if (!d) return;
    const value = (d.value || "").trim();

    if (d.kind === "marker") {
      addAnnotation({ type: "marker", x: d.point.x, y: d.point.y, label: value, color: d.color });
    } else if (d.kind === "text") {
      if (!value) return; // a note needs some text
      addAnnotation({ type: "text", x: d.point.x, y: d.point.y, text: value });
    } else if (d.kind === "edit-text") {
      if (!value) return;
      setAnnotations(prev => prev.map(a => a.id === d.id ? { ...a, text: value } : a));
    } else if (d.kind === "edit-label") {
      setAnnotations(prev => prev.map(a => a.id === d.id ? { ...a, label: value } : a));
    }

    setLabelDialog(null);
  }

  function deleteSelectedAnnotation() {
    const doomed = annotations.find(a => a.id === selectedAnnotationId);
    if (doomed && doomed.pins && doomed.pins.length > 0 &&
        !window.confirm("This marker has " + doomed.pins.length + " pinned report(s). Delete the marker and its pins?")) return;
    if (!selectedAnnotationId) return;

    setAnnotations(prev =>
      prev.filter(a => a.id !== selectedAnnotationId)
    );
    setSelectedAnnotationId(null);
  }

  function clearAnnotations() {
    const pinnedTotal = annotations.reduce((n, a) => n + ((a.pins && a.pins.length) || 0), 0);
    if (pinnedTotal > 0 && !window.confirm("CLEAR removes every annotation, including " + pinnedTotal + " pinned report(s). Continue?")) return;
    if (!annotations.length) return;

    if (window.confirm("Clear all map annotations?")) {
      setAnnotations([]);
      setSelectedAnnotationId(null);
    }
  }

  function applyMarkerColor(color) {
    setAnnotationColor(color);
    if (annotationTool !== "select" || !selectedAnnotationId) return;
    setAnnotations(prev => prev.map(a =>
      a.id === selectedAnnotationId && a.type === "marker" ? { ...a, color } : a
    ));
  }

  const toolButtonStyle = active => ({
    border: "1px solid " + (active ? "var(--accent)" : "var(--line-2)"),
    background: active ? "var(--accent)" : "var(--surface)",
    color: active ? "var(--on-accent)" : "var(--text)",
    borderRadius: 8,
    padding: "8px 12px",
    font: "600 13px var(--font)",
    cursor: "pointer"
  });

  const regions = ["ALL", ...Array.from(new Set(COUNTRIES.map(c=>c.region)))];

  return <div className="app">
    <style>{CSS}</style>
    {showWelcome && (
      <div className="welcome-back" onClick={dismissWelcome}>
        <div className="welcome-card" role="dialog" aria-label="Welcome to Wire Room" onClick={e => e.stopPropagation()}>
          <div className="eyebrow">Early access</div>
          <h2>Wire <b>Room</b></h2>
          <p>What a government says, next to what independent outlets report, for each country, on one map.</p>
          <ul>
            <li>Tap a country to open its brief. Switch <b>Official</b>, <b>News</b>, or <b>Both</b>.</li>
            <li>Tap <b>Draw</b> (top-left of the map) to mark up the map, add notes and pin reports to markers. Tap it again to fold the tools away.</li>
            <li>Some countries have no verified official source yet. The panel says so instead of guessing.</li>
            <li>Tap <b>Live</b> (bottom-left of the map) to show military aircraft, and ships at key chokepoints and Indian Ocean ports.</li>
            {ML && <li>Switch the map to <b>Satellite</b>, <b>Relief</b> or <b>Night</b> (NASA imagery), spin it as a <b>Globe</b>, or raise mountains in <b>3D</b>.</li>}
          </ul>
          <div className="welcome-note">
            <h3>About the live layers</h3>
            <p>Aircraft and ship positions come from free, volunteer-run networks, so coverage has gaps, and ship positions are periodic snapshots, not live. Many military aircraft don't broadcast their position, and some chokepoints, including the Strait of Hormuz, show no ships yet. The map labels these gaps instead of hiding them.</p>
            <h3>What funding will add</h3>
            <ul>
              <li>Satellite ship tracking and licensed flight data for worldwide coverage</li>
              <li>Verified official sources for every country (20 of 29 today)</li>
              <li>Saved maps you can share, and analysts you can follow</li>
            </ul>
          </div>
          <p className="welcome-fine">Your maps are saved in this browser only. Clearing site data will erase them. This is an early version, so rough edges are expected and feedback is welcome.</p>
          <div className="welcome-actions">
            <button className="welcome-go" onClick={dismissWelcome}>Enter the Wire Room</button>
            {FEEDBACK_URL && <a className="welcome-link" href={FEEDBACK_URL} target="_blank" rel="noreferrer">Give feedback</a>}
          </div>
        </div>
      </div>
    )}
    {linkNote && <div className="link-toast" role="status">{linkNote}</div>}
    {showSources && <SourcesPanel apiBase={API_BASE} feedbackUrl={FEEDBACK_URL} onClose={() => setShowSources(false)} onOpenCountry={id => { const c = COUNTRIES.find(x => x.id === id); setShowSources(false); if (c) loadCountry(c); }} />}
    <header className="topbar">
      <div className="brand">
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
        Wire Room
      </div>
      <div className="subtitle">Official statements and independent news, side by side</div>
      <div className="status">
        <span className="status-tag">Early access</span>
        <button className="hdr-btn" onClick={() => setShowSources(true)}>Sources</button>
        <button className="hdr-btn hdr-icon" onClick={() => setTheme(theme === "light" ? "dark" : "light")} aria-label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"} title={theme === "light" ? "Dark theme" : "Light theme"}>
          {theme === "light"
            ? <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
            : <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" stroke="currentColor" strokeWidth="2" /></svg>}
        </button>
        <button className="hdr-btn hdr-icon" onClick={() => setShowWelcome(true)} aria-label="About Wire Room">?</button>
        {FEEDBACK_URL && <a className="hdr-btn hdr-primary" href={FEEDBACK_URL} target="_blank" rel="noreferrer">Feedback</a>}
      </div>
    </header>

           <div className="toolbar">
      <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search countries" aria-label="Search countries"/>
      <select value={region} onChange={e=>setRegion(e.target.value)} aria-label="Region">{regions.map(r=><option key={r} value={r}>{r === "ALL" ? "All regions" : r}</option>)}</select>
      <div className="mode" role="group" aria-label="What to show"><button className={mode==="official"?"active":""} aria-pressed={mode==="official"} onClick={()=>changeMode("official")}>Official</button><button className={mode==="both"?"active":""} aria-pressed={mode==="both"} onClick={()=>changeMode("both")}>Both</button><button className={mode==="news"?"active":""} aria-pressed={mode==="news"} onClick={()=>changeMode("news")}>News</button></div>
    </div>



    <main className="layout">
      <section className="map-wrap" ref={stageRef}>
        {ML ? (
          <MapLibreView
            countries={filteredCountries}
            selectedId={selected ? selected.id : null}
            hasNews={hasNewsSet}
            onCountryClick={c => loadCountry(c)}
            aircraft={airFeed.items}
            ships={shipFeed.items}
            zones={shipFeed.meta?.zones}
            shipsStatus={shipFeed.status}
            airOn={liveAir}
            shipsOn={liveShips}
            selectedTrack={trackShown ? { ...trackSel, item: trackLive ? trackLive.item : trackSel.item } : trkShown && trkSelDay.kind === "node" ? trkSelDay : null}
            onTrackClick={(kind, item) => { setSelectedAnnotationId(null); setTrkSel(null); setTrackSel({ kind, id: trackId(kind, item), item }); }}
            onTrackerClick={(kind, item, war) => { setSelectedAnnotationId(null); setTrackSel(null); setTrkSel({ kind, item, war: war || null }); }}
            incidents={shownIncidents}
            wars={shownWars}
            selectedWar={webWar}
            selectedTrackerKey={trkKey}
            onEmptyClick={() => { setTrackSel(null); setTrkSel(null); setSelectedAnnotationId(null); }}
            onViewChange={setMlBbox}
            annotations={annotationsGeo}
            tool={annotationTool}
            pinning={Boolean(pinning)}
            onAnnotationTap={mlAnnotationTap}
            onDrawPoint={mlDrawPoint}
            onDrawDrag={mlDrawDrag}
            onPinPlace={mlPinPlace}
            controlRef={mlRef}
            focus={mapFocus}
            theme={theme}
          />
        ) : (
        <svg
          ref={svgRef}
          className="map"
          viewBox={`0 0 ${dims.w} ${dims.h}`}
          onPointerDown={handleMapPointerDown}
          onPointerMove={handleMapPointerMove}
          onPointerUp={handleMapPointerUp}
          onClick={handleMapClick}
          onPointerCancel={() => setAnnotationDraft(null)}>
          <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
            <path d={path({type:"Sphere"})} className="ocean"/>
            <path d={path(d3.geoGraticule().step([20,20])())} className="grid"/>
            {mapFeatures.map((f,i)=><path key={i} d={path(f)} className="land"/>)}
            {(airOn || shipsOn) && (
              <>
                {shipsOn && <ZoneOutlines zones={shipZones} k={transform.k} status={shipFeed.status} width={dims.w} />}
                <TrackLayerSvg aircraft={airProjected} ships={shipProjected} k={transform.k} selected={trackLive} />
              </>
            )}
            {filteredCountries.map(c=>{
              const [x,y]=projection([c.lon,c.lat]); const active=selected?.id===c.id;
              const has=feed.some(n=>n.countryId===c.id);
              return <g
                key={c.id}
                transform={`translate(${x},${y})`}
                className="marker"
                style={{pointerEvents: annotationTool === "select" ? "auto" : "none"}}
                onClick={e => {
                  if (annotationTool !== "select") return;
                  e.stopPropagation();
                  loadCountry(c);
                }}
              >
                  <circle r={active?6:has?4:3} transform={`scale(${1/transform.k})`} className={active?"dot active":"dot"}/>
                {has && <g transform={`scale(${1/transform.k})`}><circle r="7" className="pulse"/></g>}
                <g transform={`scale(${1/transform.k})`}>
                  <text y="15">{c.code}</text>
                </g>
              </g>;
            })}
            {viewAnnotations.map(a => {
              const isSelected = selectedAnnotationId === a.id;
              const stroke = isSelected ? "#ffffff" : "#d7dde8";

              if (a.type === "marker") {
                return (
                  <g
                    key={a.id}
                    transform={`translate(${a.x},${a.y})`}
                    onPointerDown={e => e.stopPropagation()}
                    onClick={e => {
                      e.stopPropagation();
                      if (pinning) { pinReportToMarker(a.id); return; }
                      if (annotationTool === "select") {
                        setSelectedAnnotationId(a.id);
                      }
                    }}
                  >
                    <circle
                      r={isSelected ? 7 : 5}
                      fill={a.color || "#d7dde8"}
                      fillOpacity=".28"
                      stroke={isSelected ? "#ffffff" : (a.color || "#d7dde8")}
                      strokeWidth={isSelected ? 3 : 2}
                    />
                    {a.pins && a.pins.length > 0 && (
                      <g pointerEvents="none">
                        <circle cx="9" cy="-9" r="7" fill="#c9974b" stroke="#000" strokeWidth="1.5" />
                        <text x="9" y="-5.5" textAnchor="middle" fontSize="10" fontWeight="800" fill="#000">{a.pins.length}</text>
                      </g>
                    )}
                    {a.label && (
                      <text
                        x="9"
                        y="4"
                        fill="#fff"
                        fontSize="12"
                        fontWeight="700"
                        paintOrder="stroke"
                        stroke="#000"
                        strokeWidth="3"
                      >{a.label}</text>
                    )}
                  </g>
                );
              }

              if (a.type === "line") {
                return (
                  <g
                    key={a.id}
                    onPointerDown={e => e.stopPropagation()}
                    onClick={e => {
                      e.stopPropagation();
                      if (annotationTool === "select") {
                        setSelectedAnnotationId(a.id);
                      }
                    }}
                  >
                    <line
                      x1={a.x1}
                      y1={a.y1}
                      x2={a.x2}
                      y2={a.y2}
                      stroke={stroke}
                      strokeWidth={isSelected ? 4 : 2.5}
                      strokeLinecap="round"
                    />
                    {a.label && (
                      <text
                        x={(a.x1 + a.x2) / 2}
                        y={(a.y1 + a.y2) / 2 - 7}
                        fill="#fff"
                        fontSize="12"
                        fontWeight="700"
                        textAnchor="middle"
                        paintOrder="stroke"
                        stroke="#000"
                        strokeWidth="3"
                      >{a.label}</text>
                    )}
                  </g>
                );
              }

              if (a.type === "shape") {
                return (
                  <g
                    key={a.id}
                    onPointerDown={e => e.stopPropagation()}
                    onClick={e => {
                      e.stopPropagation();
                      if (annotationTool === "select") {
                        setSelectedAnnotationId(a.id);
                      }
                    }}
                  >
                    <rect
                      x={a.x}
                      y={a.y}
                      width={a.width}
                      height={a.height}
                      fill="rgba(255,255,255,.05)"
                      stroke={stroke}
                      strokeWidth={isSelected ? 3 : 2}
                    />
                    {a.label && (
                      <text
                        x={a.x + 6}
                        y={a.y + 16}
                        fill="#fff"
                        fontSize="12"
                        fontWeight="700"
                        paintOrder="stroke"
                        stroke="#000"
                        strokeWidth="3"
                      >{a.label}</text>
                    )}
                  </g>
                );
              }

              if (a.type === "text") {
                return (
                  <text
                    key={a.id}
                    x={a.x}
                    y={a.y}
                    fill="#fff"
                    fontSize="13"
                    fontWeight="700"
                    style={{cursor: "pointer"}}
                    paintOrder="stroke"
                    stroke="#000"
                    strokeWidth="3"
                    onPointerDown={e => e.stopPropagation()}
                    onClick={e => {
                      e.stopPropagation();
                      if (annotationTool === "select") {
                        setSelectedAnnotationId(a.id);
                      }
                    }}
                  >{a.text}</text>
                );
              }

              return null;
            })}

            {annotationDraft && annotationDraft.tool === "line" && (
              <line
                x1={annotationDraft.start.x}
                y1={annotationDraft.start.y}
                x2={annotationDraft.end.x}
                y2={annotationDraft.end.y}
                stroke="#ffffff"
                strokeWidth="2"
                strokeDasharray="6 5"
                pointerEvents="none"
              />
            )}

            {annotationDraft && annotationDraft.tool === "shape" && (
              <rect
                x={Math.min(annotationDraft.start.x, annotationDraft.end.x)}
                y={Math.min(annotationDraft.start.y, annotationDraft.end.y)}
                width={Math.abs(annotationDraft.end.x - annotationDraft.start.x)}
                height={Math.abs(annotationDraft.end.y - annotationDraft.start.y)}
                fill="rgba(255,255,255,.04)"
                stroke="#ffffff"
                strokeWidth="2"
                strokeDasharray="6 5"
                pointerEvents="none"
              />
            )}

            {annotationDraft && annotationDraft.tool === "marker" && (
              <circle
                cx={annotationDraft.start.x}
                cy={annotationDraft.start.y}
                r="6"
                fill="rgba(255,255,255,.15)"
                stroke="#ffffff"
                strokeWidth="2"
                pointerEvents="none"
              />
            )}
          </g>
        </svg>
        )}
        <div className={"annotation-tools" + (toolsOpen ? " open" : "")}>
          <div className="tools-row">
            <button
              type="button"
              className={"tool-btn tool-toggle" + (toolsOpen ? " active" : "")}
              aria-expanded={toolsOpen}
              aria-controls="draw-tools"
              title={toolsOpen ? "Hide the drawing tools" : "Draw and annotate on the map"}
              onClick={() => {
                if (toolsOpen) {
                  // Folding the tools away also puts the map back to normal tapping.
                  setAnnotationTool("select");
                  setAnnotationDraft(null);
                }
                setToolsOpen(!toolsOpen);
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l4-1 11-11-3-3L5 16z" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
              Draw
              <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" className="tool-chev"><path d={toolsOpen ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} fill="none" stroke="currentColor" strokeWidth="2.5" /></svg>
            </button>

            {toolsOpen && (
              <div id="draw-tools" className="tool-group" role="group" aria-label="Drawing tools">
                {[
                  ["select", "Select"],
                  ["marker", "Marker"],
                  ["line", "Line"],
                  ["shape", "Shape"],
                  ["text", "Note"]
                ].map(([tool, label]) => (
                  <button
                    key={tool}
                    type="button"
                    aria-pressed={annotationTool === tool}
                    className={"tool-btn" + (annotationTool === tool ? " active" : "")}
                    onClick={() => {
                      setAnnotationTool(tool);
                      if (tool !== "select") setPinning(null); // picking a drawing tool cancels a pending pin
                      setAnnotationDraft(null);
                      setSelectedAnnotationId(null);
                    }}
                  >
                    {label}
                  </button>
                ))}
                <span className="tool-sep" aria-hidden="true" />
                <button type="button" className="tool-btn quiet" onClick={editSelectedAnnotation} disabled={!selectedAnnotationId}>Edit</button>
                <button type="button" className="tool-btn quiet" onClick={deleteSelectedAnnotation} disabled={!selectedAnnotationId}>Delete</button>
                <button type="button" className="tool-btn quiet" onClick={clearAnnotations}>Clear</button>
                <button type="button" className="tool-btn quiet" onClick={exportMap} disabled={exportState === "busy"} title="Save this map view as an image">
                  {exportState === "busy" ? "Exporting…" : exportState === "error" ? "Export failed" : "Export"}
                </button>
              </div>
            )}
          </div>

          {toolsOpen && (annotationTool === "marker" || (annotations.find(a => a.id === selectedAnnotationId) || {}).type === "marker") && (() => {
            const sel = annotations.find(a => a.id === selectedAnnotationId);
            const active = sel && sel.type === "marker" && annotationTool === "select" ? (sel.color || "#d7dde8") : annotationColor;
            return (
              <div className="tool-colors" role="group" aria-label="Marker color">
                <span>Color</span>
                {MARKER_COLORS.map(color => (
                  <button
                    key={color}
                    type="button"
                    title={"Marker color " + color}
                    aria-label={"Marker color " + color}
                    aria-pressed={active === color}
                    className={"swatch" + (active === color ? " on" : "")}
                    onClick={() => applyMarkerColor(color)}
                    style={{ background: color }}
                  />
                ))}
              </div>
            );
          })()}

          {/* The date bar: its own row under the drawing tools (desktop and phones). */}
          {ML && eventsOn && (
            <DayBar day={mapDay} past={Boolean(mapDay)} loading={incidentData.status === "loading"}
              minDay={`${((incidentSet && incidentSet.dataFrom) || "2025-10")}-01`}
              historyFrom={incidentSet && incidentSet.historyFrom}
              ucdpThrough={militaryOn && incidentSet ? incidentSet.ucdpThrough : null}
              onChange={changeDay} />
          )}
        </div>

        {labelDialog && (
          <div
            onPointerDown={e => e.stopPropagation()}
            style={{
              position: "absolute",
              top: 130,
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 6,
              width: "min(340px, calc(100% - 24px))",
              boxSizing: "border-box",
              background: "var(--overlay)",
              border: "1px solid var(--line-2)",
              padding: 12,
              color: "var(--text)",
              fontSize: 11,
              fontWeight: 700,
              display: "flex",
              flexDirection: "column",
              gap: 8
            }}
          >
            <div>
              {labelDialog.kind === "marker" ? "Marker label (optional)"
                : labelDialog.kind === "text" ? "Note text"
                : labelDialog.kind === "edit-text" ? "Edit note"
                : "Edit label"}
            </div>
            <input
              ref={labelInputRef}
              autoFocus
              type="text"
              enterKeyHint="done"
              autoComplete="off"
              maxLength={140}
              value={labelDialog.value}
              onChange={e => setLabelDialog(prev => prev ? { ...prev, value: e.target.value } : prev)}
              onKeyDown={e => {
                if (e.key === "Enter") submitLabelDialog();
                if (e.key === "Escape") setLabelDialog(null);
              }}
              style={{ fontSize: 16, padding: "6px 8px", background: "var(--surface)", color: "var(--text)", border: "1px solid var(--line-2)" }}
            />
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" onClick={submitLabelDialog} style={toolButtonStyle(true)}>
                {labelDialog.kind === "marker" ? "Place marker" : labelDialog.kind === "text" ? "Add note" : "Save"}
              </button>
              <button type="button" onClick={() => setLabelDialog(null)} style={toolButtonStyle(false)}>Cancel</button>
            </div>
          </div>
        )}

        {(() => {
          const sel = annotations.find(a => a.id === selectedAnnotationId);
          const showList = !pinning && annotationTool === "select" && sel && sel.type === "marker" && sel.pins && sel.pins.length > 0;
          const box = { pointerEvents: "auto", background: "var(--overlay)", border: "1px solid var(--line-2)", padding: 10, color: "var(--text)", fontSize: 11, display: "flex", flexDirection: "column", gap: 6 };
          return (
            <>
              {(pinning || showList) && <style>{"@media(max-width:800px){.panel,.panel.open{transform:translateX(100%) !important}}"}</style>}
              <div style={{ position: "absolute", left: "50%", bottom: 56, transform: "translateX(-50%)", zIndex: 6, width: "min(420px, calc(100% - 24px))", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 8, pointerEvents: "none" }}>
                {storageWarn && (
                  <div style={{ ...box, borderColor: "#ff4d4d", color: "var(--danger)" }}>
                    Storage problem: new annotations and pins are not being saved. Delete some markers or press Clear.
                  </div>
                )}
                {pinning && (
                  <div onPointerDown={e => e.stopPropagation()} style={box}>
                    <div style={{ fontWeight: 800 }}>PINNING: {pinning.headline.length > 90 ? pinning.headline.slice(0, 87) + "..." : pinning.headline}</div>
                    <div>Tap a marker to pin it, or tap the map to add a new marker{Number.isFinite(pinning.lat) ? ", or drop a marker where it is now" : ""}.</div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {Number.isFinite(pinning.lat) && Number.isFinite(pinning.lon) && (
                        <button type="button" onClick={() => {
                          const p = projection([pinning.lon, pinning.lat]);
                          if (p) placePinnedReport({ x: p[0], y: p[1] });
                        }} style={toolButtonStyle(true)}>Pin at its position</button>
                      )}
                      <button type="button" onClick={() => setPinning(null)} style={toolButtonStyle(false)}>Cancel</button>
                    </div>
                  </div>
                )}
                {showList && (
                  <div onPointerDown={e => e.stopPropagation()} style={{ ...box, maxHeight: "38vh", overflowY: "auto" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontWeight: 800 }}>
                      <span>Pinned reports ({sel.pins.length})</span>
                      <button type="button" aria-label="Close" onClick={() => setSelectedAnnotationId(null)} style={toolButtonStyle(false)}>&times;</button>
                    </div>
                    {sel.pins.map(p => (
                      <div key={p.id} style={{ borderTop: "1px solid var(--line-2)", paddingTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", color: "var(--text-2)", fontSize: 10 }}>
                          <SourceTag type={p.sourceType} /><span>{p.source}</span><span>{p.date}</span>
                        </div>
                        <div style={{ fontWeight: 700, fontSize: 12 }}>{(p.tr && p.tr.headline) || p.headline}</div>
                        {p.tr && p.tr.headline && <div style={{ font: "11px var(--font)", color: "var(--muted)" }}>Machine-translated from {languageName(p.tr.from)} · original: {p.headline}</div>}
                        {((p.tr && p.tr.headline) ? p.tr.summary : p.summary) && <div style={{ color: "var(--text-2)", fontSize: 11, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" }}>{(p.tr && p.tr.headline) ? p.tr.summary : p.summary}</div>}
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          {p.url && p.url !== "#" && <a href={p.url} target="_blank" rel="noreferrer" style={{ color: "var(--accent)", fontSize: 10, textDecoration: "none" }}>Open original</a>}
                          <button type="button" onClick={() => unpinReport(sel.id, p.id)} style={{ ...toolButtonStyle(false), fontSize: 10, padding: "3px 7px" }}>Unpin</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          );
        })()}

        <LiveLayerControls
          airOn={airOn}
          onToggleAir={() => setAirOn(v => !v)}
          shipsOn={shipsOn}
          onToggleShips={() => setShipsOn(v => !v)}
          air={airFeed}
          ships={shipFeed}
          trackers={ML ? { militaryOn, terrorOn, cyberOn, onToggle: toggleTracker, data: incidentData } : null}
          pastDay={shownDay}
          initialTab={ML && (INITIAL_URL_VIEW.war || INITIAL_URL_VIEW.day) ? "events" : null}
        />

        {trkShown && !trackShown && trkSelDay.kind === "place" && (
          <PlaceCard group={trkSelDay.item} warOf={warOfIncident} onClose={() => setTrkSel(null)} onPin={(it) => startPinReport(incidentToReport(it))} />
        )}
        {trkShown && !trackShown && trkSelDay.kind === "war" && (
          <WarCard war={trkSelDay.item} onClose={() => setTrkSel(null)} onPin={() => startPinReport(warToReport(trkSelDay.item))}
            intelOpen={view === "war" && warView && warView.id === trkSelDay.item.id} onToggleIntel={() => toggleWarIntel(trkSelDay.item)}
            reportedCount={(trkSelDay.item.reported || []).length} ucdpThrough={incidentSet && incidentSet.ucdpThrough} refDay={shownDay || localDay()} />
        )}
        {trkShown && !trackShown && trkSelDay.kind === "node" && (
          <NodeCard node={trkSelDay.item} war={trkSelDay.war} onClose={() => setTrkSel(null)} onOpenWar={() => setTrkSel({ kind: "war", item: trkSelDay.war })} />
        )}
        {trackShown && (
          <TrackCard
            kind={trackSel.kind}
            item={trackLive ? trackLive.item : trackSel.item}
            fetchedAt={trackSel.kind === "air" ? airFeed.fetchedAt : null}
            onClose={() => setTrackSel(null)}
            onPin={() => startPinReport(trackToReport(trackSel.kind, trackLive ? trackLive.item : trackSel.item, airFeed.fetchedAt))}
          />
        )}
        <div className="map-note">Tap a country to see its sources</div>
        {view === "closed" && <button className="global-fab" onClick={() => loadGlobal()}>Global feed</button>}      </section>

      <aside className={`panel ${view !== "closed" ? "open" : ""}`}>
        <div className="panel-head">
          <div>
            <div className="eyebrow">{view === "war" && warView ? `${(LEVEL_TEXT[(warViewDay || warView).level] || LEVEL_TEXT.war).label} brief · military tracker` : "Country brief"}</div>
            <h1>{view === "war" && warView ? warView.name : selected?.name || "Global feed"}</h1>
            {view === "war" && warView && !warViewDay ? (
              <p className="source-status war">Not active as of {shownDay ? longDay(shownDay) : "today"}: no UCDP event in the 3 months before, and no strike reported that week.</p>
            ) : view === "war" && warView ? (() => {
              const wv = warViewDay;
              const lm = wv.latestMonth || {};
              const sides = (wv.ourCountries || []).map(id => COUNTRY_BY_ID[id]).filter(Boolean);
              const found = new Set(feed.filter(r => r.sourceType === "official").map(r => r.countryId));
              const have = sides.filter(c => found.has(c.id)).map(c => c.name);
              const missing = sides.filter(c => !found.has(c.id)).map(c => c.name);
              return <>
                <p>{sidesText(wv.sides)}</p>
                <p className="source-status war">{num(lm.best)} killed in {monthLabel(lm.month)} · {num(wv.deaths.best)} in {coverageLabel(wv.coverage)} (UCDP best estimates{incidentSet && incidentSet.ucdpThrough ? `; UCDP's data ends ${longDay(incidentSet.ucdpThrough)}, ${daysBetween(incidentSet.ucdpThrough, shownDay || localDay())} days behind` : ", 1–2 months behind"})</p>
                <p className="source-note">
                  Official statements from the governments Wire Room follows, and outlet reports, that mention this war in the 30 days up to {shownDay ? longDay(shownDay) : "today"}{shownDay ? " (only reports still in Wire Room's news archive)" : ""}.
                  {!loading && have.length ? ` Statements found from: ${have.join(", ")}.` : ""}
                  {!loading && missing.length ? ` None found from: ${missing.join(", ")}.` : ""}
                  {!sides.length ? " Wire Room doesn't follow these governments yet, so this panel is outlet reports only." : ""}
                </p>
              </>;
            })() : (
              <p>{selected ? selected.sources.join(" • ") : "Official government statements and optional trusted independent reporting"}</p>
            )}
            {selected && officialVerifiedMap[selected.id] !== undefined && (() => {
              const info = officialStatusMap[selected.id] || {};
              const notVerified = officialVerifiedMap[selected.id] === false || info.status === "not-configured";
              const down = info.status === "unavailable";
              const lastOk = info.lastOkAt ? new Date(info.lastOkAt).toLocaleDateString() : "";
              let text = "\u2713 Verified government channel";
              if (notVerified) text = "\u26a0 No verified government channel yet for this country";
              else if (down) text = "\u26a0 Official source temporarily unavailable \u2014 showing saved reports" + (lastOk ? " (last good: " + lastOk + ")" : "");
              else if (info.status === "empty") text = "\u2713 Verified government channel \u2014 no new statements since last check";
              return <>
                <p className={"source-status " + (notVerified || down ? "unverified" : "verified")}>{text}</p>
                {!notVerified && <p className="source-note">Verified means these statements come from the government itself, not that they are accurate.</p>}
              </>;
            })()}
          </div>
          {view !== "closed" && (
            <div className="panel-actions">
              <button type="button" className="link-btn" onClick={shareView} title="Share a link to this view">{linkNote ? "\u2713" : "LINK"}</button>
              <button type="button" onClick={closePanel} aria-label="Close panel">×</button>
            </div>
          )}
        </div>
        <div className="panel-mode">
          <button className={mode==="official"?"active":""} onClick={()=>changeMode("official")}>Official</button>
          <button className={mode==="both"?"active":""} onClick={()=>changeMode("both")}>Both</button>
          <button className={mode==="news"?"active":""} onClick={()=>changeMode("news")}>News</button>
        </div>
        {loading && <div className="loading">Checking source feeds…</div>}
        {!loading && visibleFeed.length === 0 && (
          <div className="empty">
            {intelFiltersActive ? (
              <>No matching reports.<br/><small>Try a different keyword, source, or date range.</small></>
            ) : mode === "official" && selected && officialVerifiedMap[selected.id] === false ? (
              <>No verified government channel yet for this country.<br/><small>We haven't found or confirmed a direct government channel for {selected.name} yet. That isn't the same as "nothing happening": the source itself is still unverified. Check the NEWS tab for independent coverage in the meantime.</small></>
            ) : mode === "official" && selected && (officialStatusMap[selected.id] || {}).status === "unavailable" ? (
              <>Official source temporarily unavailable.<br/><small>We couldn't reach {selected.name}'s official source on the last check, so nothing new is shown. That doesn't mean nothing was said. Check the NEWS tab for independent coverage in the meantime.</small></>
            ) : mode === "official" && selected ? (
              <>No new official statements right now.<br/><small>{selected.name}'s government channel is verified and connected. It just hasn't published anything new since the last check.</small></>
            ) : view === "war" ? (
              <>No related reports in the last 30 days{mode !== "both" ? " in this mode" : ""}.<br/><small>Wire Room doesn't follow sources for every war yet. The casualty figures above still come from UCDP's researchers. {mode !== "both" ? "Try BOTH." : ""}</small></>
            ) : (
              <>No stories in this filter yet.<br/><small>Nothing has been collected for this view yet. Try another mode or country, or check back after the next hourly update.</small></>
            )}
          </div>
        )}
                {(() => {
          const fld = { minWidth: 0, background: "var(--surface)", border: "1px solid var(--line-2)", color: "var(--text-2)", padding: "7px 8px", font: "12px var(--font)", colorScheme: "dark" };
          return (
            <div style={{ border: "1px solid var(--line)", background: "var(--bg)", padding: 10, marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                <span style={{ font: "12px var(--font)", fontWeight: 700, color: "var(--text-2)", letterSpacing: 0 }}>Intel filter</span>
                {intelFiltersActive && (
                  <button type="button" onClick={() => { resetIntelFilters(); setPage(1); }} style={{ background: "none", border: "1px solid var(--line-2)", color: "var(--muted)", padding: "4px 7px", font: "11px var(--font)", cursor: "pointer" }}>Clear filter</button>
                )}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 6 }}>
                <input value={intelQuery} onChange={e => { setIntelQuery(e.target.value); setPage(1); }} placeholder="Keyword" aria-label="Search reports by keyword" style={fld} />
                <select value={intelSource} onChange={e => { setIntelSource(e.target.value); setPage(1); }} aria-label="Filter reports by source" style={fld}>
                  <option value="">All sources</option>
                  {sourceOptions.map(src => (<option key={src} value={src}>{src}</option>))}
                </select>
                <input type="date" value={intelFrom} onChange={e => { setIntelFrom(e.target.value); setPage(1); }} aria-label="Filter reports from date" title="From date" style={fld} />
                <input type="date" value={intelTo} onChange={e => { setIntelTo(e.target.value); setPage(1); }} aria-label="Filter reports through date" title="To date" style={fld} />
              </div>
              <div style={{ marginTop: 7, color: "var(--muted)", font: "11px var(--font)" }}>
                Searches loaded reports only{intelFiltersActive ? " · " + visibleFeed.length + " matches" : ""}
              </div>
            </div>
          );
        })()}
        {visibleFeed.length > 0 && (
          <div className="pagination">
            <span className="pagination-info">
              REPORTS {pageStart + 1}–{Math.min(pageStart + REPORTS_PER_PAGE, visibleFeed.length)} OF {visibleFeed.length}
              {" "}•{" "}PAGE {Math.min(page, totalPages)} / {totalPages}
            </span>
            {REVIEW_MODE && view !== "war" && offTopic.aiReview && (
              <span className="offtopic-note">
                {showOffTopic
                  ? `Review link: showing the ${offTopic.hidden} news report${offTopic.hidden === 1 ? "" : "s"} the AI review hides here (marked)`
                  : `Review link: the AI review hides ${offTopic.hidden} news report${offTopic.hidden === 1 ? "" : "s"} here`}
                <button type="button" onClick={toggleOffTopic}>{showOffTopic ? "Hide" : "Show"}</button>
              </span>
            )}
            <div className="pagination-buttons">
              <button
                disabled={page <= 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
              >
                ← NEWER
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              >
                OLDER →
              </button>
            </div>
          </div>
        )}
        {pagedFeed.map(item=><NewsCard onPin={startPinReport} key={item.id} item={view === "war" && item.sourceType === "official" ? { ...item, countryLabel: `${(COUNTRY_BY_ID[item.countryId] || {}).name || ""} government`.trim() } : item}/>)}
      </aside>
    </main>
  </div>;
}

function geometryFromTopo(topology, geom) {
  const decode = (arc) => { let x=0,y=0; return arc.map(([dx,dy])=>{x+=dx;y+=dy;return topology.transform?[x*topology.transform.scale[0]+topology.transform.translate[0],y*topology.transform.scale[1]+topology.transform.translate[1]]:[x,y];}); };
  const ring = indices => { let out=[]; indices.forEach((idx,i)=>{const rev=idx<0;const n=rev?~idx:idx;let a=decode(topology.arcs[n]);if(rev)a=a.reverse();out=i?out.concat(a.slice(1)):a;});return out; };
  const conv = a => a.map(r=>ring(r));
  if (geom.type==="Polygon") return {type:"Polygon",coordinates:conv(geom.arcs)};
  if (geom.type==="MultiPolygon") return {type:"MultiPolygon",coordinates:geom.arcs.map(p=>conv(p))};
  return null;
}

const CSS = `
.status{display:flex;align-items:center;gap:10px}.status-tag{letter-spacing:0}.hdr-btn{background:none;border:1px solid var(--line-2);color:var(--text-2);font:12px var(--font);letter-spacing:0;padding:6px 10px;cursor:pointer;text-decoration:none;line-height:1}.hdr-btn:hover{border-color:var(--accent);color:var(--accent)}
.welcome-back{position:fixed;inset:0;z-index:100;background:var(--scrim);display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto}.welcome-card{background:var(--surface);border:1px solid var(--line-2);border-top:2px solid var(--accent);max-width:460px;width:100%;padding:22px;font-family:var(--font)}.welcome-card h2{margin:4px 0 10px;font-size:26px;letter-spacing:0}.welcome-card h2 b{color:var(--accent)}.welcome-card p{margin:0 0 12px;color:var(--text-2);font-size:14px;line-height:1.5}.welcome-card ul{margin:0 0 12px;padding-left:18px;color:var(--text-2);font-size:13px;line-height:1.55}.welcome-card li{margin-bottom:6px}.welcome-card .welcome-fine{font:13px/1.5 var(--font);color:var(--muted)}.welcome-note{border-left:2px solid var(--line-2);padding:2px 0 2px 12px;margin:0 0 12px}.welcome-note h3{margin:0 0 5px;font:700 12px var(--font);letter-spacing:0;color:var(--ok);text-transform:none}.welcome-note p{font-size:13px;color:var(--text-2);margin:0 0 10px}.welcome-note ul{margin:0;font-size:12.5px}.welcome-note li{margin-bottom:4px}.welcome-actions{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-top:14px}.welcome-go{background:var(--accent);color:var(--bg);border:0;font:700 14px var(--font);letter-spacing:0;padding:11px 16px;cursor:pointer}.welcome-link{color:var(--accent);font:13px var(--font);letter-spacing:0}
@media(max-width:700px){.subtitle{display:none}.topbar{padding:0 14px}.status{margin-left:auto}.status-tag{display:none}}
*{box-sizing:border-box} body{margin:0;background:var(--bg)} .app{min-height:100vh;background:var(--bg);color:var(--text);font-family:var(--font)}.topbar{height:64px;border-bottom:1px solid var(--line);display:flex;align-items:center;padding:0 22px;gap:18px}.brand{font-weight:800;letter-spacing:0;font-size:21px}.brand b{color:var(--accent)}.subtitle{font:13px var(--font);color:var(--muted);letter-spacing:0}.status{margin-left:auto;font:12px var(--font);color:var(--ok)}.toolbar{height:54px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:9px;padding:8px 18px}.toolbar input,.toolbar select,.mode button{background:var(--surface);border:1px solid var(--line-2);color:var(--text-2);padding:8px 10px;font:13px var(--font)}.toolbar input{width:190px}.mode{margin-left:auto;display:flex}.mode button{cursor:pointer}.mode button.active{color:var(--accent);border-color:var(--accent)}.layout{height:calc(100vh - 118px);display:flex}.map-wrap{position:relative;flex:1;min-width:0}.map{width:100%;height:100%;touch-action:none;cursor:grab}.map:active{cursor:grabbing}.ocean{fill:var(--bg);stroke:var(--line-2)}.grid{fill:none;stroke:var(--line);stroke-width:.5}.land{fill:#142230;stroke:var(--line-2);stroke-width:.65}.marker{cursor:pointer}.dot{fill:var(--accent)}.dot.active{fill:var(--text);stroke:var(--accent);stroke-width:2}.pulse{fill:none;stroke:var(--accent);stroke-width:1;opacity:.55;animation:pulse 2s infinite;pointer-events:none}.marker text{font:10px var(--font);fill:var(--muted);text-anchor:middle}.map-note{position:absolute;bottom:calc(16px + env(safe-area-inset-bottom));left:18px;font:12px var(--font);color:var(--muted)}.global-fab{position:absolute;bottom:calc(16px + env(safe-area-inset-bottom));right:18px;background:var(--surface);border:1px solid var(--accent);color:var(--accent);padding:8px 14px;font:12px var(--font);letter-spacing:0;cursor:pointer;z-index:5}.panel{width:410px;background:var(--surface);border-left:1px solid var(--line);padding:20px;overflow:auto;display:none;flex-direction:column}.panel.open{display:flex}.panel-head{display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid var(--line);padding-bottom:14px;margin-bottom:14px}.panel-head h1{margin:2px 0 4px;font-size:28px}.panel-head p{margin:0;color:var(--muted);font:12px var(--font);line-height:1.5}.panel-head button{height:30px;background:none;border:1px solid var(--line-2);color:var(--muted);cursor:pointer}.panel-actions{display:flex;gap:6px;align-items:flex-start;flex-shrink:0}.panel-head .link-btn{font:12px var(--font);letter-spacing:0;padding:0 9px;min-width:44px}.panel-head .link-btn:hover{border-color:var(--accent);color:var(--text)}.link-toast{position:fixed;left:50%;top:76px;transform:translateX(-50%);z-index:120;background:var(--surface);border:1px solid var(--accent);color:var(--text);font:12px var(--font);letter-spacing:0;padding:8px 12px}.panel-mode{display:none}.panel-mode button{background:var(--surface);border:1px solid var(--line-2);color:var(--text-2);padding:8px 10px;font:13px var(--font);cursor:pointer}.panel-mode button.active{color:var(--accent);border-color:var(--accent)}.eyebrow{font:11px var(--font);letter-spacing:0;color:var(--ok)}.source-status{margin:6px 0 0;font:12px var(--font);letter-spacing:0}.source-status.verified{color:var(--ok)}.source-status.unverified{color:var(--accent)}
.source-status.war{color:var(--danger)}
.card-gov{color:var(--accent);letter-spacing:0}
.card.off-topic{opacity:.62}
.card-offtopic{color:#9b7bff;letter-spacing:0}
.offtopic-note{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font:11px var(--font);color:var(--text-2);letter-spacing:0;margin-top:6px;flex-basis:100%}
.offtopic-note button{background:none;border:1px solid #3d3566;color:#b7a4ff;font:11px var(--font);padding:3px 7px;cursor:pointer;letter-spacing:0}.source-note{margin:3px 0 0;font:11px/1.4 var(--font);color:var(--muted)}.loading,.empty{font:13px var(--font);color:var(--muted);padding:24px 4px;line-height:1.7}.card{border:1px solid var(--line);background:var(--bg);padding:13px;margin-bottom:10px}.annotation-tools{max-width:calc(100% - 350px)}@media(max-width:800px){.annotation-tools{max-width:calc(100% - 20px)}}.card-meta{display:flex;flex-wrap:wrap;gap:8px;align-items:center;color:var(--muted);font:11px var(--font);margin-bottom:8px}.tr-note{display:flex;align-items:center;flex-wrap:wrap;gap:4px 8px;margin:-2px 0 6px;font:11px var(--font);letter-spacing:0;color:var(--ok)}.tr-note button{background:none;border:1px solid var(--line-2);color:var(--muted);font:11px var(--font);letter-spacing:0;padding:2px 6px;cursor:pointer}.tr-note button:hover{border-color:var(--accent);color:var(--text)}.tag{padding:2px 5px;border:1px solid}.tag.official{color:var(--ok);border-color:var(--ok-line)}.tag.independent{color:var(--muted);border-color:var(--line-2)}.tag.track{color:var(--accent);border-color:var(--line-2)}.card h3{font-size:14px;line-height:1.35;margin:0 0 7px}.card p{font-size:12px;line-height:1.5;color:var(--text-2);margin:0 0 8px}.card a{font:12px var(--font);color:var(--accent);text-decoration:none}.pagination{border:1px solid var(--line);background:var(--bg);padding:10px;margin-bottom:10px;font:11px var(--font);color:var(--muted)}.pagination-info{display:block;margin-bottom:8px}.pagination-buttons{display:flex;gap:6px}.pagination-buttons button{flex:1;background:var(--surface);border:1px solid var(--line-2);color:var(--text-2);padding:7px 8px;font:11px var(--font);cursor:pointer}.pagination-buttons button:hover:not(:disabled){color:var(--accent);border-color:var(--accent)}.pagination-buttons button:disabled{opacity:.35;cursor:default}@keyframes pulse{0%{transform:scale(1);opacity:.6}100%{transform:scale(3.2);opacity:0}}@media(max-width:800px){.layout{height:calc(100dvh - 118px);min-height:0;position:relative;overflow:hidden}.panel{display:flex;position:absolute;right:0;top:0;bottom:0;width:min(420px,100%);transform:translateX(100%);transition:transform .25s;z-index:4}.panel.open{transform:translateX(0)}.subtitle{display:none}.toolbar{height:auto;min-height:54px;overflow:hidden;flex-wrap:wrap;padding:8px 10px;gap:6px}.toolbar input{width:min(150px,calc(100vw - 20px))}.toolbar select{max-width:110px}.mode{margin-left:auto;flex-shrink:0}.mode button{padding:8px 7px}.toolbar .mode{display:none}.panel-mode{display:flex;gap:6px;margin:-4px 0 14px;padding-bottom:12px;border-bottom:1px solid var(--line)}.panel-mode button{flex:1;padding:8px 5px}.map-wrap{height:100%;min-height:0}.status{margin-left:auto;gap:6px}.status-tag{display:none}.hdr-btn{padding:6px 7px;letter-spacing:0}}

/* ---- Redesign (Nov 2026): quieter chrome, light and dark themes, sentence case ---- */
.app{font-family:var(--font);background:var(--bg);color:var(--text)}
.topbar{height:56px;background:var(--surface);border-bottom:1px solid var(--line);padding:0 20px;gap:16px}
.brand{display:flex;align-items:center;gap:10px;font:700 17px var(--font);letter-spacing:0;color:var(--text)}
.subtitle{font:13px var(--font);color:var(--muted);letter-spacing:0}
.status{margin-left:auto;display:flex;align-items:center;gap:8px;font:13px var(--font);color:var(--muted)}
.status-tag{font:12px var(--font);color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:3px 9px}
.hdr-btn{height:36px;padding:0 14px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--text);font:500 14px var(--font);letter-spacing:0;display:inline-flex;align-items:center;justify-content:center;gap:6px;cursor:pointer;text-decoration:none;line-height:1}
.hdr-btn:hover{border-color:var(--line-2);color:var(--text);background:var(--surface-2)}
.hdr-icon{width:36px;padding:0;font-weight:600}
.hdr-primary,.hdr-primary:hover{background:var(--text);color:var(--bg);border-color:var(--text)}
.toolbar{height:56px;background:var(--surface);border-bottom:1px solid var(--line);gap:10px;padding:10px 20px}
.toolbar input,.toolbar select{height:36px;border-radius:8px;background:var(--surface-2);border:1px solid var(--line);color:var(--text);font:14px var(--font);padding:0 12px}
.toolbar input{width:220px}.toolbar input::placeholder{color:var(--muted)}
.mode{display:flex;gap:2px;padding:3px;background:var(--surface-2);border-radius:10px}
.mode button,.toolbar .mode button{height:32px;padding:0 16px;border:0;border-radius:8px;background:transparent;color:var(--muted);font:500 14px var(--font);cursor:pointer}
.mode button.active{background:var(--surface);color:var(--text);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.15)}
.layout{height:calc(100vh - 112px)}
.panel{background:var(--surface);border-left:1px solid var(--line)}
.panel-head{border-bottom:1px solid var(--line)}
.panel-head h1{font:700 24px var(--font);margin:2px 0 4px}
.panel-head p{font:13px/1.45 var(--font);color:var(--muted)}
.panel-head button{height:36px;border-radius:8px;border:1px solid var(--line);background:var(--surface-2);color:var(--text);font:500 13px var(--font)}
.eyebrow{font:600 12px var(--font);color:var(--muted);letter-spacing:0}
.source-status{font:13px var(--font)}
.panel-mode{background:var(--surface-2);padding:3px;border-radius:10px;border-bottom:0}
.panel-mode button{border:0;border-radius:8px;background:transparent;color:var(--muted);font:500 14px var(--font);height:34px}
.panel-mode button.active{background:var(--surface);color:var(--text);font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.15)}
.card{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:14px}
.card h3{font:600 15px/1.4 var(--font)}
.card p{font:13px/1.5 var(--font);color:var(--text-2)}
.card-meta{font:12px var(--font);color:var(--muted);font-variant-numeric:tabular-nums}
.card a{font:500 13px var(--font);color:var(--accent)}
.tag{border:0;border-radius:999px;padding:2px 8px;font:600 12px var(--font)}
.tag.official{color:var(--accent);background:var(--accent-soft)}
.tag.independent{color:var(--news);background:var(--news-soft)}
.tag.track{color:var(--accent);background:var(--accent-soft)}
.pagination{background:var(--surface);border:1px solid var(--line);border-radius:10px;font:12px var(--font)}
.pagination-buttons button{border-radius:8px;background:var(--surface-2);border:1px solid var(--line);color:var(--text);font:500 13px var(--font);height:36px}
.loading,.empty{font:13px/1.6 var(--font);color:var(--muted)}
.global-fab{background:var(--surface);border:1px solid var(--line);color:var(--text);border-radius:10px;font:600 14px var(--font);padding:10px 16px;box-shadow:var(--shadow)}
.map-note{font:12px var(--font);color:var(--muted)}
.link-toast{background:var(--surface);border:1px solid var(--line);border-radius:10px;color:var(--text);font:500 13px var(--font);box-shadow:var(--shadow)}
.welcome-back{background:var(--scrim)}
.welcome-card{background:var(--surface);border:1px solid var(--line);border-top:1px solid var(--line);border-radius:14px;font-family:var(--font);color:var(--text);box-shadow:var(--shadow)}
.welcome-card h2{font:700 24px var(--font);letter-spacing:0}.welcome-card h2 b{color:inherit}
.welcome-card p{color:var(--text-2)}.welcome-card ul,.welcome-note p{color:var(--text-2)}
.welcome-card .welcome-fine{font:12px/1.5 var(--font);color:var(--muted)}
.welcome-note{border-left:2px solid var(--line)}.welcome-note h3{font:600 13px var(--font);color:var(--text);letter-spacing:0;text-transform:none}
.welcome-go{background:var(--accent);color:var(--on-accent);border-radius:8px;font:600 14px var(--font);letter-spacing:0;padding:11px 18px}
.welcome-link{color:var(--accent);font:500 14px var(--font)}
.annotation-tools{position:absolute;top:12px;left:12px;z-index:3;display:flex;flex-direction:column;align-items:flex-start;gap:8px}
.tools-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.tool-btn{height:40px;padding:0 12px;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--text);font:500 14px var(--font);display:inline-flex;align-items:center;gap:7px;cursor:pointer;box-shadow:var(--shadow)}
.tool-btn:disabled{opacity:.45;cursor:default}
.tool-toggle.active{border-color:var(--accent);color:var(--accent);background:var(--accent-soft)}
.tool-chev{opacity:.8}
.tool-group{display:flex;flex-wrap:wrap;gap:2px;padding:3px;background:var(--surface);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow)}
.tool-group .tool-btn{height:36px;border:0;box-shadow:none;border-radius:8px;background:transparent}
.tool-group .tool-btn.active{background:var(--accent-soft);color:var(--accent);font-weight:600}
.tool-group .tool-btn.quiet{color:var(--muted)}
.tool-sep{width:1px;align-self:stretch;background:var(--line);margin:6px 4px}
.tool-colors{display:flex;align-items:center;gap:6px;flex-wrap:wrap;background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:6px 10px;font:500 13px var(--font);color:var(--muted);box-shadow:var(--shadow)}
.swatch{width:24px;height:24px;border-radius:50%;padding:0;border:1px solid var(--line-2);cursor:pointer}
.swatch.on{outline:2px solid var(--text);outline-offset:2px}
.app .live-box{background:var(--surface);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow);font:12px var(--font);color:var(--muted);padding:10px 12px;gap:8px}
.app .live-title,.app .live-sub{font-weight:600;color:var(--text);letter-spacing:0}
.app .live-btn{border-radius:999px;background:var(--surface);border:1px solid var(--line);color:var(--text);font:500 13px var(--font);padding:6px 11px}
.app .live-btn.on{border-color:var(--accent);background:var(--accent-soft);color:var(--accent)}
.app .track-card{background:var(--surface);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow);color:var(--text)}
.app .day-bar{background:var(--surface);border:1px solid var(--line);border-radius:10px;box-shadow:var(--shadow);font-family:var(--font)}
.app .day-row button{border-radius:6px;color:var(--text);font:500 13px var(--font)}
@media(max-width:800px){
.toolbar select{max-width:none;width:auto}
.topbar{padding:0 10px 0 14px;gap:8px}.status{gap:6px}.status-tag{display:none}
.hdr-btn{height:40px;padding:0 10px}.hdr-icon{width:40px}
.layout{height:calc(100dvh - 112px)}
.toolbar{height:auto;min-height:56px;padding:8px 10px;gap:6px}
.tool-group .tool-btn{height:40px}
}
`;











