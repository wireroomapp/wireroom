// What the map showed on any day: the incident archive and "as of" snapshots.
//
// Rules (Jango, Nov 13 2026):
// - A reported strike, terrorist attack/threat or cyberattack stays on the map for a week after
//   its last report, then drops off the current map.
// - A conflict stays on the map while active: at least one UCDP event in the ~3 months before the
//   date (or a strike reported that week). Older conflicts drop off.
// - Any past day can be shown as it looked then: incidents reported in the week up to that day,
//   with only the reports published by then, and conflicts active at that time.
//
// The archive (data/history/incidents.json) keeps every incident ever placed, so past days stay
// viewable after their reports leave the news cache (which keeps ~500 reports per feed).

import { buildWars } from "./incidents.mjs";

export const SHOW_DAYS = 7;
export const ACTIVE_DAYS = 92;
export const ARCHIVE_YEARS = 2;
const DAY = 86400000;

const byUrl = (sources) => new Set((sources || []).map((s) => s.url).filter(Boolean));
const outletCount = (sources) => new Set(sources.map((s) => s.source)).size;

// Fold this run's incidents into the archive. An incident keeps its first id even as new reports
// join it or old ones leave the news cache. An archived incident whose reports are still in the
// cache but no longer make an incident (better rules, or the AI check said no) is dropped.
export function mergeArchive(archived, current, cacheUrls, now = new Date()) {
  const out = new Map();
  const urlOwner = new Map();
  for (const a of archived || []) {
    out.set(a.id, a);
    for (const u of byUrl(a.sources)) urlOwner.set(u, a.id);
  }
  const touched = new Set();
  for (const c of current) {
    const matches = new Set([...byUrl(c.sources)].map((u) => urlOwner.get(u)).filter(Boolean));
    if (out.has(c.id)) matches.add(c.id);
    const olds = [...matches].map((id) => out.get(id)).filter((a) => a && a.kind === c.kind);
    let merged = c;
    if (olds.length) {
      const keep = olds.slice().sort((a, b) => String(a.firstReported).localeCompare(String(b.firstReported)))[0];
      const sources = [...c.sources];
      const have = byUrl(sources);
      for (const o of olds) for (const s of o.sources || []) if (s.url && !have.has(s.url)) { sources.push(s); have.add(s.url); }
      sources.sort((a, b) => String(a.publishedAt).localeCompare(String(b.publishedAt)));
      const firsts = [c.firstReported, ...olds.map((o) => o.firstReported)].sort();
      const lasts = [c.lastReported, ...olds.map((o) => o.lastReported)].sort();
      merged = {
        ...c,
        id: keep.id,
        firstReported: firsts[0],
        lastReported: lasts[lasts.length - 1],
        sources: sources.slice(-20),
        sourceCount: Math.max(c.sourceCount, outletCount(sources)),
        officialCount: sources.filter((s) => s.sourceType === "official").length,
      };
      for (const o of olds) out.delete(o.id);
    }
    out.set(merged.id, merged);
    touched.add(merged.id);
  }
  const oldest = now.getTime() - ARCHIVE_YEARS * 365 * DAY;
  for (const [id, a] of out) {
    if (touched.has(id)) continue;
    const stillCached = [...byUrl(a.sources)].some((u) => cacheUrls.has(u));
    if (stillCached || Date.parse(a.lastReported) < oldest) out.delete(id);
  }
  return [...out.values()].sort((a, b) => String(a.firstReported).localeCompare(String(b.firstReported)) || a.id.localeCompare(b.id));
}

// Incidents as the map would have shown them at `until`: reported in the week before, counting
// only the reports published by then.
export function incidentsAsOf(archive, until, { days = SHOW_DAYS } = {}) {
  const end = until.getTime();
  const start = end - days * DAY;
  const out = [];
  for (const a of archive || []) {
    if (Date.parse(a.firstReported) > end || Date.parse(a.lastReported) < start) continue;
    const sources = (a.sources || []).filter((s) => Date.parse(s.publishedAt) <= end)
      .sort((x, y) => String(x.publishedAt).localeCompare(String(y.publishedAt)));
    if (!sources.length) continue;
    const times = sources.map((s) => Date.parse(s.publishedAt)).filter(Number.isFinite).sort((x, y) => x - y);
    const last = times[times.length - 1];
    if (last < start) continue;
    const later = sources.length < (a.sources || []).length;
    out.push({
      ...a,
      // Headline of a report published by then (a later one could give away what happened next).
      ...(later && !sources.some((s) => s.headline === a.title) ? { title: sources[0].headline, summary: "" } : {}),
      firstReported: new Date(times[0]).toISOString(),
      lastReported: new Date(last).toISOString(),
      sources: sources.slice(-8).reverse(),
      sourceCount: outletCount(sources),
      officialCount: sources.filter((s) => s.sourceType === "official").length,
    });
  }
  return out;
}

const ymd = (d) => d.toISOString().slice(0, 10);
const endOfMonth = (ym) => { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const monthsBack = (dateStr, n) => {
  const [y, m] = dateStr.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 - n, 1));
  return t.toISOString().slice(0, 7);
};

// UCDP events as known on a date: events up to that day, from the 12 months before it.
export function conflictAsOf(conflict, until) {
  if (!conflict || !Array.isArray(conflict.events)) return null;
  const day = ymd(until);
  const dataEnd = conflict.coverage && conflict.coverage.to ? conflict.coverage.to : day.slice(0, 7);
  const ref = day < endOfMonth(dataEnd) ? day : null; // a past day inside UCDP's data
  const from = monthsBack(ref || `${dataEnd}-01`, 11);
  const events = ref ? conflict.events.filter((e) => e.date && e.date <= ref && e.date.slice(0, 7) >= from) : conflict.events.filter((e) => e.date && e.date.slice(0, 7) >= from);
  return { ...conflict, coverage: { from, to: ref ? ref.slice(0, 7) : dataEnd }, events, asOfDay: ref };
}

// Conflicts active at `until`: a UCDP event in the ACTIVE_DAYS before it (UCDP runs 1–2 months
// behind, so for recent days that counts back from the end of its data), or a strike reported in
// the news that week.
export function activeWars(wars, conflictView, until, { days = ACTIVE_DAYS } = {}) {
  const dataEndDay = conflictView && conflictView.asOfDay
    ? conflictView.asOfDay
    : conflictView?.coverage?.to ? endOfMonth(conflictView.coverage.to) : ymd(until);
  const ref = Math.min(Date.parse(`${dataEndDay}T23:59:59Z`), until.getTime());
  const since = new Date(ref - days * DAY).toISOString().slice(0, 10);
  return wars.filter((w) => (w.latestEvent && w.latestEvent >= since) || (w.reported && w.reported.length));
}

// The whole tracker picture at `until`.
export function snapshot({ archive, conflict }, until) {
  const incidents = incidentsAsOf(archive, until);
  const strikes = incidents.filter((i) => i.kind === "strike");
  const view = conflictAsOf(conflict, until);
  const wars = view ? activeWars(buildWars(view, strikes), view, until) : [];
  return {
    asOf: until.toISOString(),
    windowDays: SHOW_DAYS,
    conflictCoverage: view ? view.coverage : null,
    terrorism: incidents.filter((i) => i.kind === "terrorism"),
    cyber: incidents.filter((i) => i.kind === "cyber"),
    strikes,
    wars,
  };
}
