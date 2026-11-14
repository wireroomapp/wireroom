import express from "express";
import { readFileSync, statSync } from "fs";
import compression from "compression";
import { COUNTRY_INFO, hasVerifiedOfficialSource } from "./lib/feeds.mjs";
import { registerTracking } from "./tracking/index.mjs";
import { describeSources } from "./lib/sources.mjs";
import { createWatchdog } from "./scheduler/watchdog.mjs";
import { snapshot } from "./lib/history.mjs";
import { warReports } from "./lib/incidents.mjs";

/*
  WIRE ROOM / WORLD WIRE — backend (cache-serving version)
  ---------------------------------------------------------
  This server no longer fetches anything live. A separate scheduled
  GitHub Action runs lib/feeds.mjs on its own timetable and commits the
  results to data/cache.json. This server just reads that file and
  serves it — fast, cheap, and resilient to any single feed being slow
  or temporarily blocked.
*/

const app = express();
app.use(compression());
const PORT = process.env.PORT || 3001;

// Allow requests from the deployed frontend (different domain).
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET");
  res.header("Cache-Control", "public, max-age=60");
  next();
});

// The cache file is ~14 MB. Parse it once and only re-parse when the file
// changes on disk (mtime), instead of on every request.
const CACHE_FILE = "data/cache.json";
let cacheMemo = { mtimeMs: -1, data: { generatedAt: null, countries: {} } };
let globalMemo = new Map(); // mode -> response body, cleared whenever the cache reloads

function loadCache() {
  try {
    const { mtimeMs } = statSync(CACHE_FILE);
    if (mtimeMs !== cacheMemo.mtimeMs) {
      cacheMemo = { mtimeMs, data: JSON.parse(readFileSync(CACHE_FILE, "utf-8")) };
      globalMemo = new Map();
    }
    return cacheMemo.data;
  } catch {
    // No cache yet (e.g. first deploy before the scheduled job has run), or a bad file.
    // Keep serving the last good copy if we have one.
    return cacheMemo.data;
  }
}

// Off-topic NEWS reports hidden by the AI review (lib/ai-check.mjs, data/hidden-reports.json:
// url -> topic). Official statements are never hidden. ?showHidden=1 returns them too, labeled.
// In a country's panel (countryId given), outlet reports about other countries are hidden too.
function hideOffTopic(items, showHidden, countryId = null) {
  const data = loadDataFile("data/hidden-reports.json");
  const urls = data && data.urls ? data.urls : null;
  if (!urls) return { items, hidden: 0, aiReview: false };
  const elsewhere = (countryId && data.elsewhere) || {};
  let hidden = 0;
  const out = [];
  for (const it of items) {
    const official = it.sourceType === "official" || !it.url;
    const about = !official && elsewhere[it.url];
    const topic = official ? undefined : urls[it.url] || (about && !about.includes(countryId) ? `about ${about.map((c) => c.toUpperCase()).join(", ")}` : undefined);
    if (!topic) { out.push(it); continue; }
    hidden++;
    if (showHidden) out.push({ ...it, hiddenByAi: topic });
  }
  return { items: out, hidden, aiReview: true };
}
const wantsHidden = (req) => String(req.query.showHidden || "") === "1";

app.get("/api/news", (req, res) => {
  const countryId = String(req.query.country || "").toLowerCase();
  const mode = String(req.query.mode || "both");

  if (!COUNTRY_INFO[countryId]) {
    return res.status(400).json({ error: "unknown country id" });
  }

  const cache = loadCache();
  const entry = cache.countries[countryId] || { official: [], independent: [] };
  const officialVerified =
    typeof entry.officialVerified === "boolean" ? entry.officialVerified : hasVerifiedOfficialSource(countryId);

  let items;
  if (mode === "official") items = entry.official;
  else if (mode === "news") items = entry.independent;
  else items = [...entry.official, ...entry.independent];

  items = [...items].sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
  const reviewed = hideOffTopic(items, wantsHidden(req), countryId);

  res.json({
    items: reviewed.items,
    hidden: reviewed.hidden,
    aiReview: reviewed.aiReview,
    generatedAt: cache.generatedAt,
    officialVerified,
    officialStatus: entry.officialStatus || (officialVerified ? null : "not-configured"),
    officialLastOkAt: entry.officialLastOkAt || null,
  });
});
app.get("/api/global", (req, res) => {
  const mode = String(req.query.mode || "both");
  const showHidden = wantsHidden(req);
  const cache = loadCache();
  const memoKey = `${mode}|${showHidden ? 1 : 0}`;
  const hiddenData = loadDataFile("data/hidden-reports.json");
  const hit = globalMemo.get(memoKey);
  if (hit && hit.hiddenData === hiddenData) return res.json(hit.body);
  let items = [];
  for (const countryId of Object.keys(cache.countries)) {
    const entry = cache.countries[countryId] || { official: [], independent: [] };
    if (mode === "official") items.push(...entry.official);
    else if (mode === "news") items.push(...entry.independent);
    else items.push(...entry.official, ...entry.independent);
  }
  items = items.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
  const reviewed = hideOffTopic(items, showHidden);
  const kept = reviewed.items.slice(0, 500);
  // How many off-topic reports fall in the same time span as the 500 shown.
  let hidden = 0;
  if (showHidden) hidden = kept.filter((i) => i.hiddenByAi).length;
  else if (reviewed.hidden && kept.length) {
    const oldest = new Date(kept[kept.length - 1].publishedAt || 0);
    hidden = items.length - reviewed.items.length - hideOffTopic(items.filter((i) => new Date(i.publishedAt || 0) < oldest), false).hidden;
  }
  const body = { items: kept, hidden, aiReview: reviewed.aiReview, generatedAt: cache.generatedAt };
  globalMemo.set(memoKey, { body, hiddenData });
  res.json(body);
});
// Live aircraft + ship layers. Sources are switched with environment variables,
// see tracking/README.md. Adds /api/aircraft, /api/ships, /api/tracking/status.
registerTracking(app);

// Context layers (see lib/context.mjs): files written by the hourly job, re-read when they change.
const contextMemo = new Map();
function loadDataFile(file) {
  try {
    const { mtimeMs } = statSync(file);
    const hit = contextMemo.get(file);
    if (hit && hit.mtimeMs === mtimeMs) return hit.data;
    const data = JSON.parse(readFileSync(file, "utf-8"));
    contextMemo.set(file, { mtimeMs, data });
    return data;
  } catch {
    return contextMemo.get(file)?.data || null;
  }
}
// The trackers as of a past day (?until=<end of that day, ISO>): built from the incident archive
// and UCDP events (lib/history.mjs), kept in memory for the most recent requests.
const pastMemo = new Map();
function parseUntil(q) {
  const t = Date.parse(String(q || ""));
  if (!Number.isFinite(t) || t < Date.parse("2020-01-01") || t > Date.now() - 3600000) return null;
  return new Date(Math.floor(t / 60000) * 60000);
}
function pastSnapshot(until) {
  const archive = loadDataFile("data/history/incidents.json");
  const conflict = loadDataFile("data/conflict.json");
  if (!archive && !conflict) return null;
  const key = until.toISOString();
  const hit = pastMemo.get(key);
  if (hit && hit.archive === archive && hit.conflict === conflict) return hit.data;
  const current = loadDataFile("data/incidents.json") || {};
  const data = {
    version: 1,
    generatedAt: current.generatedAt,
    past: true,
    historyFrom: current.historyFrom || (archive && archive.incidents[0] ? archive.incidents[0].firstReported : null),
    dataFrom: conflict && conflict.coverage ? conflict.coverage.from : null,
    aiCheck: current.aiCheck,
    ...snapshot({ archive: archive ? archive.incidents : [], conflict }, until),
  };
  pastMemo.delete(key);
  pastMemo.set(key, { archive, conflict, data });
  if (pastMemo.size > 40) pastMemo.delete(pastMemo.keys().next().value);
  return data;
}
app.get("/api/incidents", (req, res, next) => {
  const until = parseUntil(req.query.until);
  if (!until) return next();
  const data = pastSnapshot(until);
  if (!data) return res.status(503).json({ status: "unavailable", error: "Not collected yet" });
  res.set("Cache-Control", "public, max-age=3600");
  res.json({ status: "ok", ...data });
});

for (const [route, file] of [["/api/conflict", "data/conflict.json"], ["/api/advisories", "data/advisories.json"], ["/api/incidents", "data/incidents.json"]]) {
  app.get(route, (req, res) => {
    const data = loadDataFile(file);
    if (!data) return res.status(503).json({ status: "unavailable", error: "Not collected yet" });
    res.set("Cache-Control", "public, max-age=900");
    res.json({ status: "ok", ...data });
  });
}

// One war's intel panel: the latest related official statements and outlet reports.
app.get("/api/war-intel", (req, res) => {
  // A past day: work it out from the news archive (only reports it still holds).
  const until = parseUntil(req.query.until);
  if (until) {
    const snap = pastSnapshot(until);
    const war = snap && snap.wars.find((w) => w.id === String(req.query.id || ""));
    const gaz = loadDataFile("lib/gazetteer.json");
    if (!war || !gaz) return res.status(404).json({ status: "not-found", error: "No such war that day" });
    res.set("Cache-Control", "public, max-age=3600");
    return res.json({ status: "ok", id: war.id, asOf: until.toISOString(), items: warReports(loadCache(), war, gaz, { now: until }) });
  }
  const data = loadDataFile("data/war-intel.json");
  if (!data) return res.status(503).json({ status: "unavailable", error: "Not collected yet" });
  const id = String(req.query.id || "");
  const items = data.wars?.[id];
  if (!items) return res.status(404).json({ status: "not-found", error: "No such war" });
  res.set("Cache-Control", "public, max-age=900");
  res.json({ status: "ok", generatedAt: data.generatedAt, id, items });
});

// Where every country's reports come from (the SOURCES page).
app.get("/api/sources", (req, res) => {
  res.json(describeSources(loadCache()));
});

app.get("/api/health", (req, res) => res.json({ ok: true }));
// Starts the hourly data job if GitHub's scheduler lets it slip (needs GITHUB_DISPATCH_TOKEN).
const watchdog = createWatchdog();
watchdog.start();

app.get("/api/status", (req, res) => {
  const cache = loadCache();
  const ageMin = cache.generatedAt ? Math.round((Date.now() - Date.parse(cache.generatedAt)) / 60000) : null;
  res.json({
    generatedAt: cache.generatedAt,
    dataAgeMinutes: ageMin,
    countriesCached: Object.keys(cache.countries).length,
    dataJob: watchdog.state,
  });
});

app.listen(PORT, () => {
  console.log(`Wire Room backend (cache mode) running on port ${PORT}`);
  console.log("Serving from data/cache.json — updated by the scheduled GitHub Action.");
});
