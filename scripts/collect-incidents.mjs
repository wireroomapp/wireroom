// Builds the tracker files from data Wire Room already has (see lib/incidents.mjs):
//   data/incidents.json  reported terrorism, cyber and military incidents (last 7 days), active conflicts
//   data/war-intel.json  for each war, the latest related official statements and outlet reports
//   data/ai-verdicts.json the optional AI review's saved answers (only when ANTHROPIC_API_KEY is set)
//   data/hidden-reports.json off-topic NEWS reports the AI review hides from the panels (url -> topic)
//   data/history/incidents.json every incident ever placed, so past days can be shown (lib/history.mjs)
// Inputs: data/cache.json (reports), data/conflict.json (UCDP), data/advisories.json (optional).
// Run by the hourly GitHub Action after the news and context steps. Always exits 0.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { buildGeocoder, extractIncidents, warReports } from "../lib/incidents.mjs";
import { AI_MODEL, reportKey, judgeReports, pruneVerdicts, hiddenReports } from "../lib/ai-check.mjs";
import { SHOW_DAYS, mergeArchive, snapshot } from "../lib/history.mjs";

const ARCHIVE_FILE = "data/history/incidents.json";
const SCAN_DAYS = 400; // every report still in the news cache, for the archive

const readJson = (f, fallback) => { try { return JSON.parse(readFileSync(f, "utf-8")); } catch { return fallback; } };
const writeIfChanged = (file, data, label) => {
  const prev = readJson(file, null);
  const strip = (d) => d && JSON.stringify({ ...d, generatedAt: undefined });
  if (prev && strip(prev) === strip(data)) { console.log(`${label}: no change.`); return; }
  writeFileSync(file, JSON.stringify(data));
  console.log(`${label}: wrote ${file}.`);
};

try {
  const now = new Date();
  const cache = readJson("data/cache.json", null);
  if (!cache) throw new Error("data/cache.json is missing");
  const conflict = readJson("data/conflict.json", null);
  const advisories = readJson("data/advisories.json", null);
  const gaz = JSON.parse(readFileSync(new URL("../lib/gazetteer.json", import.meta.url), "utf-8"));
  const geo = buildGeocoder(gaz);

  // Optional AI review (lib/ai-check.mjs): every report in the news cache it hasn't read yet,
  // newest first (a backlog is worked through over a few hourly runs).
  const saved = readJson("data/ai-verdicts.json", { version: 1, verdicts: {} });
  const all = [];
  const seen = new Set();
  for (const entry of Object.values(cache.countries || {})) for (const type of ["official", "independent"]) for (const it of entry[type] || []) {
    const key = reportKey(it);
    if (seen.has(key)) continue;
    seen.add(key);
    all.push({ it, key, t: Date.parse(it.publishedAt || "") || 0 });
  }
  let verdicts = pruneVerdicts(saved.verdicts, now, seen);
  const apiKey = String(process.env.ANTHROPIC_API_KEY || "").trim(); // pasted keys often carry a stray space or newline
  if (apiKey) {
    // Safe hints about the key's shape (never the key itself) for when a pasted key won't work.
    console.log(`AI key check: ${apiKey.length} characters, starts with "sk-ant-": ${apiKey.startsWith("sk-ant-")}, has spaces or line breaks inside: ${/\s/.test(apiKey)}, has unusual characters: ${/[^A-Za-z0-9_-]/.test(apiKey)}.`);
    const pending = all.filter((x) => !verdicts[x.key]).sort((a, b) => b.t - a.t).map((x) => x.it);
    const res = await judgeReports(pending, { apiKey, now });
    for (const [k, v] of res.verdicts) verdicts[k] = v;
    const vs = [...res.verdicts.values()];
    console.log(`AI review (${AI_MODEL}): ${res.verdicts.size} of ${pending.length} unread reports reviewed in ${res.calls} calls: ${vs.filter((v) => !v.keep).length} off-topic, ${vs.filter((v) => v.event).length} events${res.skipped ? `; ${res.skipped} left for the next run` : ""}.`);
    if (res.error) console.log(`::warning::AI review stopped: ${res.error}. Keyword rules cover the rest; nothing new is hidden.`);
  } else {
    console.log("AI review off (no ANTHROPIC_API_KEY): keyword rules only, nothing hidden.");
  }
  writeIfChanged("data/ai-verdicts.json", { version: 1, model: AI_MODEL, verdicts }, `AI verdicts (${Object.keys(verdicts).length} saved)`);
  const hidden = hiddenReports(cache, verdicts);
  writeIfChanged("data/hidden-reports.json", { version: 1, model: AI_MODEL, count: Object.keys(hidden).length, urls: hidden }, `Hidden off-topic news: ${Object.keys(hidden).length}`);
  const verdictMap = new Map(Object.entries(verdicts));

  // Every incident in the news cache, folded into the archive; then the map as of now.
  const found = extractIncidents(cache, geo, { now, windowDays: SCAN_DAYS, verdicts: verdictMap, keyOf: reportKey });
  const cacheUrls = new Set();
  for (const entry of Object.values(cache.countries || {})) for (const type of ["official", "independent"]) for (const it of entry[type] || []) if (it.url) cacheUrls.add(it.url);
  const prevArchive = readJson(ARCHIVE_FILE, { version: 1, incidents: [] });
  const archive = mergeArchive(prevArchive.incidents, found, cacheUrls, now);
  mkdirSync("data/history", { recursive: true });
  writeIfChanged(ARCHIVE_FILE, { version: 1, incidents: archive }, `Archive: ${archive.length} incidents since ${(archive[0] || {}).firstReported || "—"}`);

  const snap = snapshot({ archive, conflict }, now);
  const { strikes, terrorism, cyber, wars } = snap;

  // Context for terrorism markers: the US travel advisory for that country, if it names terrorism.
  const advByIso = new Map();
  for (const a of advisories?.advisories || []) {
    const c = geo.country(a.name);
    if (c?.iso) advByIso.set(c.iso, { name: a.name, level: a.level, levelText: a.levelText, date: a.date, url: a.url });
  }
  for (const t of terrorism) if (advByIso.has(t.iso)) t.advisory = advByIso.get(t.iso);

  const warIntel = {};
  for (const w of wars) {
    const reports = warReports(cache, w, gaz, { now });
    warIntel[w.id] = reports;
    w.reportCount = reports.length;
    w.officialFrom = [...new Set(reports.filter((r) => r.sourceType === "official").map((r) => r.countryId))];
  }

  const generatedAt = now.toISOString();
  writeIfChanged("data/incidents.json", {
    version: 1,
    generatedAt,
    windowDays: SHOW_DAYS,
    conflictCoverage: conflict?.coverage || null,
    historyFrom: (archive[0] || {}).firstReported || null, // earliest day with archived incidents
    ucdpThrough: snap.ucdpThrough, // last day UCDP's data covers (it publishes 1–2 months late)
    activeDays: snap.activeDays,
    dataFrom: conflict?.coverage?.from || null, // earliest UCDP month held (first day a past view can show)
    aiCheck: Boolean(apiKey) || Object.keys(verdicts).length > 0,
    conflictCitation: conflict?.citation || null,
    terrorism,
    cyber,
    strikes,
    wars,
  }, `Trackers: ${terrorism.length} terrorism, ${cyber.length} cyber, ${strikes.length} strikes, ${wars.length} wars`);
  writeIfChanged("data/war-intel.json", { version: 1, generatedAt, wars: warIntel }, "War intel");
} catch (e) {
  console.log(`::warning::Trackers not updated: ${e.message}`);
}
