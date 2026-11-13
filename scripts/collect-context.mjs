// Collects the two context layers (see lib/context.mjs):
//   data/conflict.json    UCDP Candidate conflict events, latest monthly releases
//   data/advisories.json  US State Department advisories that name terrorism
// Run by the hourly GitHub Action. UCDP publishes monthly, so it's checked at most once a
// day; advisories every run. Big files are only rewritten when their content changes, so the
// repository doesn't grow every hour. Always exits 0: a context problem never blocks the news.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import Parser from "rss-parser";
import { UCDP_BASE, ADVISORY_FEED, csvObjects, toConflictEvent, ucdpMonthlyVersions, buildConflict, buildAdvisories } from "../lib/context.mjs";

const STATE_FILE = "data/context-state.json";
const CONFLICT_FILE = "data/conflict.json";
const ADVISORY_FILE = "data/advisories.json";
const RELEASES_TO_KEEP = Number(process.env.UCDP_RELEASES) || 12; // about a year of events (one release per month)
const HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; WireRoomBot/1.0; +https://wireroom.onrender.com)" };

const readJson = (f, fallback) => { try { return JSON.parse(readFileSync(f, "utf-8")); } catch { return fallback; } };
const now = new Date();
const state = readJson(STATE_FILE, {});

async function fetchText(url, timeoutMs = 60000) {
  const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) { const e = new Error(`HTTP ${r.status}`); e.status = r.status; throw e; }
  return r.text();
}

async function conflict() {
  const last = Date.parse(state.ucdpCheckedAt || "");
  if (Number.isFinite(last) && now - last < 20 * 3600 * 1000 && existsSync(CONFLICT_FILE) && state.ucdpKeep === RELEASES_TO_KEEP) {
    console.log(`Conflict: checked ${Math.round((now - last) / 3600000)}h ago, skipping (UCDP publishes monthly).`);
    return;
  }
  const releases = [];
  for (const v of ucdpMonthlyVersions(now, RELEASES_TO_KEEP + 4)) {
    if (releases.length >= RELEASES_TO_KEEP) break;
    try {
      const rows = csvObjects(await fetchText(`${UCDP_BASE}GEDEvent_v${v}.csv`));
      const events = rows.map(toConflictEvent).filter(Boolean);
      releases.push({ version: v, events });
      console.log(`Conflict: UCDP release ${v}: ${events.length} events`);
    } catch (e) {
      if (e.status === 404) { console.log(`Conflict: UCDP release ${v} not published yet`); continue; }
      throw e;
    }
  }
  if (!releases.length) throw new Error("no UCDP releases found");
  const built = buildConflict(releases, now);
  const prev = readJson(CONFLICT_FILE, null);
  const same = prev && JSON.stringify(prev.releases) === JSON.stringify(built.releases) && prev.events?.length === built.events.length &&
    JSON.stringify(prev.events) === JSON.stringify(built.events);
  if (same) console.log("Conflict: no change since last release.");
  else { writeFileSync(CONFLICT_FILE, JSON.stringify(built)); console.log(`Conflict: wrote ${built.events.length} events (${built.coverage.from} to ${built.coverage.to}).`); }
  state.ucdpCheckedAt = now.toISOString();
  state.ucdpReleases = built.releases;
  state.ucdpKeep = RELEASES_TO_KEEP;
}

async function advisories() {
  const places = readJson(new URL("../lib/advisory-places.json", import.meta.url), {});
  const feed = await new Parser().parseString(await fetchText(ADVISORY_FEED, 30000));
  const built = buildAdvisories(feed.items || [], places, now);
  if (built.unplaced.length) console.log(`::warning::Advisories with no map position (add to lib/advisory-places.json): ${built.unplaced.join(", ")}`);
  const prev = readJson(ADVISORY_FILE, null);
  if (prev && JSON.stringify(prev.advisories) === JSON.stringify(built.advisories)) console.log("Advisories: no change.");
  else { writeFileSync(ADVISORY_FILE, JSON.stringify(built)); console.log(`Advisories: ${built.advisories.length} countries name terrorism (of ${built.countries}).`); }
  state.advisoriesCheckedAt = now.toISOString();
}

for (const [name, job] of [["Conflict", conflict], ["Advisories", advisories]]) {
  try { await job(); } catch (e) { console.log(`::warning::${name} layer not updated: ${e.message}`); }
}
writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
