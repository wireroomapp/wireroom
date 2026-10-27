import express from "express";
import { readFileSync, statSync } from "fs";
import compression from "compression";
import { COUNTRY_INFO, hasVerifiedOfficialSource } from "./lib/feeds.mjs";

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

  res.json({
    items,
    generatedAt: cache.generatedAt,
    officialVerified,
    officialStatus: entry.officialStatus || (officialVerified ? null : "not-configured"),
    officialLastOkAt: entry.officialLastOkAt || null,
  });
});
app.get("/api/global", (req, res) => {
  const mode = String(req.query.mode || "both");
  const cache = loadCache();
  if (globalMemo.has(mode)) return res.json(globalMemo.get(mode));
  let items = [];
  for (const countryId of Object.keys(cache.countries)) {
    const entry = cache.countries[countryId] || { official: [], independent: [] };
    if (mode === "official") items.push(...entry.official);
    else if (mode === "news") items.push(...entry.independent);
    else items.push(...entry.official, ...entry.independent);
  }
  items = items.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0)).slice(0, 500);
  const body = { items, generatedAt: cache.generatedAt };
  globalMemo.set(mode, body);
  res.json(body);
});
app.get("/api/health", (req, res) => res.json({ ok: true }));
app.get("/api/status", (req, res) => {
  const cache = loadCache();
  res.json({ generatedAt: cache.generatedAt, countriesCached: Object.keys(cache.countries).length });
});

app.listen(PORT, () => {
  console.log(`Wire Room backend (cache mode) running on port ${PORT}`);
  console.log("Serving from data/cache.json — updated by the scheduled GitHub Action.");
});
