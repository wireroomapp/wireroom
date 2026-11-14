// Builds the tracker files from data Wire Room already has (see lib/incidents.mjs):
//   data/incidents.json  reported terrorism, cyber and military incidents (last 7 days), active conflicts
//   data/war-intel.json  for each war, the latest related official statements and outlet reports
//   data/ai-verdicts.json the optional AI check's saved answers (only when ANTHROPIC_API_KEY is set)
//   data/history/incidents.json every incident ever placed, so past days can be shown (lib/history.mjs)
// Inputs: data/cache.json (reports), data/conflict.json (UCDP), data/advisories.json (optional).
// Run by the hourly GitHub Action after the news and context steps. Always exits 0.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { WINDOW_DAYS, buildGeocoder, extractIncidents, warReports, englishHeadline, englishSummary } from "../lib/incidents.mjs";
import { AI_MODEL, AI_SIGNAL, reportKey, judgeReports, pruneVerdicts } from "../lib/ai-check.mjs";
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

  // Optional AI check (lib/ai-check.mjs): new attack-like reports from the window, not yet judged.
  const saved = readJson("data/ai-verdicts.json", { version: 1, verdicts: {} });
  let verdicts = pruneVerdicts(saved.verdicts, now);
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    const since = now.getTime() - WINDOW_DAYS * 86400000;
    const pending = [];
    const seen = new Set();
    for (const entry of Object.values(cache.countries || {})) for (const type of ["official", "independent"]) for (const it of entry[type] || []) {
      const t = Date.parse(it.publishedAt || "");
      const key = reportKey(it);
      if (!Number.isFinite(t) || t < since || seen.has(key) || verdicts[key]) continue;
      seen.add(key);
      if (AI_SIGNAL.test(`${englishHeadline(it)} ${englishSummary(it)}`)) pending.push(it);
    }
    const res = await judgeReports(pending, { apiKey, now });
    for (const [k, v] of res.verdicts) verdicts[k] = v;
    const events = [...res.verdicts.values()].filter((v) => v.event).length;
    console.log(`AI check (${AI_MODEL}): ${res.verdicts.size} of ${pending.length} new reports judged, ${events} events, ${res.calls} calls${res.skipped ? `, ${res.skipped} left for the next run` : ""}.`);
    if (res.error) console.log(`::warning::AI check stopped: ${res.error}. The keyword rules cover the rest.`);
  } else {
    console.log("AI check off (no ANTHROPIC_API_KEY): keyword rules only.");
  }
  writeIfChanged("data/ai-verdicts.json", { version: 1, model: AI_MODEL, verdicts }, "AI verdicts");
  const verdictMap = new Map(Object.entries(verdicts));

  // Every incident in the news cache, folded into the archive; then the map as of now.
  const all = extractIncidents(cache, geo, { now, windowDays: SCAN_DAYS, verdicts: verdictMap, keyOf: reportKey });
  const cacheUrls = new Set();
  for (const entry of Object.values(cache.countries || {})) for (const type of ["official", "independent"]) for (const it of entry[type] || []) if (it.url) cacheUrls.add(it.url);
  const prevArchive = readJson(ARCHIVE_FILE, { version: 1, incidents: [] });
  const archive = mergeArchive(prevArchive.incidents, all, cacheUrls, now);
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
