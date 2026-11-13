// Builds the tracker files from data Wire Room already has (see lib/incidents.mjs):
//   data/incidents.json  reported terrorism, cyber and military incidents (last 10 days) and wars
//   data/war-intel.json  for each war, the latest related official statements and outlet reports
// Inputs: data/cache.json (reports), data/conflict.json (UCDP), data/advisories.json (optional).
// Run by the hourly GitHub Action after the news and context steps. Always exits 0.

import { readFileSync, writeFileSync } from "node:fs";
import { WINDOW_DAYS, buildGeocoder, extractIncidents, buildWars, warReports } from "../lib/incidents.mjs";

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

  const all = extractIncidents(cache, geo, { now });
  const strikes = all.filter((i) => i.kind === "strike");
  const terrorism = all.filter((i) => i.kind === "terrorism");
  const cyber = all.filter((i) => i.kind === "cyber");

  // Context for terrorism markers: the US travel advisory for that country, if it names terrorism.
  const advByIso = new Map();
  for (const a of advisories?.advisories || []) {
    const c = geo.country(a.name);
    if (c?.iso) advByIso.set(c.iso, { name: a.name, level: a.level, levelText: a.levelText, date: a.date, url: a.url });
  }
  for (const t of terrorism) if (advByIso.has(t.iso)) t.advisory = advByIso.get(t.iso);

  const wars = conflict ? buildWars(conflict, strikes) : [];
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
    windowDays: WINDOW_DAYS,
    conflictCoverage: conflict?.coverage || null,
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
