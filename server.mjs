import express from "express";
import { readFileSync } from "fs";
import { COUNTRY_INFO } from "./lib/feeds.mjs";

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
const PORT = process.env.PORT || 3001;

// Allow requests from the deployed frontend (different domain).
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET");
  next();
});

function loadCache() {
  try {
    const raw = readFileSync("data/cache.json", "utf-8");
    return JSON.parse(raw);
  } catch {
    // No cache yet (e.g. first deploy before the scheduled job has run).
    return { generatedAt: null, countries: {} };
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

  let items;
  if (mode === "official") items = entry.official;
  else if (mode === "news") items = entry.independent;
  else items = [...entry.official, ...entry.independent];

  items = [...items].sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));

  res.json({ items, generatedAt: cache.generatedAt });
});

app.get("/api/status", (req, res) => {
  const cache = loadCache();
  res.json({ generatedAt: cache.generatedAt, countriesCached: Object.keys(cache.countries).length });
});

app.listen(PORT, () => {
  console.log(`Wire Room backend (cache mode) running on port ${PORT}`);
  console.log("Serving from data/cache.json — updated by the scheduled GitHub Action.");
});
