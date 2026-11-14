import { useEffect, useState } from "react";

// Trackers (new map only): MILITARY, TERRORISM and CYBER markers from /api/incidents, built
// hourly by scripts/collect-incidents.mjs (see lib/incidents.mjs for how reports become markers,
// lib/history.mjs for past days). Loaded when a tracker is first turned on; today's map is
// refreshed every 30 minutes, past days are kept once loaded.

export const TRACKER_COLORS = { war: "#ff4d4d", strike: "#ff8a3d", terrorism: "#f5c242", cyber: "#ff5fd2" };
export const TRACKER_CREDITS = {
  military: "Wars: UCDP Candidate Events Dataset, Uppsala University (CC BY 4.0)",
  reports: "Incident markers: placed from collected reports (not verified by Wire Room)",
  places: "Places: GeoNames (CC BY 4.0), OurAirports, Natural Earth",
};

// Local calendar days ("2026-11-13"). A past day is shown as the map stood at the end of it.
export function localDay(d = new Date()) {
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function dayEnd(day) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999);
}
export function shiftDay(day, n) {
  const [y, m, d] = day.split("-").map(Number);
  return localDay(new Date(y, m - 1, d + n, 12));
}
export function shortDay(day) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, 12).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
// Whole days from one "YYYY-MM-DD" to another (positive when b is later).
export function daysBetween(a, b) {
  const t = (s) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((t(b) - t(a)) / 86400000);
}
export function longDay(day) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, 12).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

// Tracker data for today (day = null) or a past day.
export function useTrackerData(apiBase, day, enabled, refreshMs = 30 * 60000) {
  const key = day ? `/api/incidents?until=${encodeURIComponent(dayEnd(day).toISOString())}` : "/api/incidents";
  const [store, setStore] = useState({}); // key -> { status, data, at }
  const [tick, setTick] = useState(0);
  const entry = store[key];
  useEffect(() => {
    if (!enabled) return undefined;
    const fresh = entry && entry.status === "ok" && (day || Date.now() - entry.at < refreshMs - 60000);
    if (fresh) return undefined;
    let live = true;
    fetch(`${apiBase}${key}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (live) setStore((s) => ({ ...s, [key]: { status: "ok", data: d, at: Date.now() } })); })
      .catch(() => { if (live) setStore((s) => ({ ...s, [key]: { status: "unavailable", data: null, at: Date.now() } })); });
    return () => { live = false; };
  }, [apiBase, key, enabled, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  // Today's map: check for a fresh one every half hour while a tracker is on.
  useEffect(() => {
    if (!enabled || day) return undefined;
    const t = setInterval(() => setTick((x) => x + 1), refreshMs);
    return () => clearInterval(t);
  }, [enabled, day, refreshMs]);
  const retry = () => { setStore((s) => { const n = { ...s }; if (n[key] && n[key].status === "unavailable") delete n[key]; return n; }); setTick((x) => x + 1); };
  const status = entry ? entry.status : enabled ? "loading" : "idle";
  return { status, data: entry && entry.status === "ok" ? entry.data : null, retry };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function monthLabel(ym) {
  const m = String(ym || "").match(/^(\d{4})-(\d{2})$/);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : "";
}
export function coverageLabel(cov) {
  if (!cov || !cov.from) return "";
  const a = monthLabel(cov.from), b = monthLabel(cov.to);
  return a === b ? a : `${a.split(" ")[0]}–${b}`;
}
export function dayLabel(d) {
  const m = String(d || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : d || "—";
}
export function whenLabel(iso) {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return "—";
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 60) return `${Math.max(1, mins)} min ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / 1440)} days ago`;
}

export const n = (v) => Number(v || 0).toLocaleString();
export function deathsText(d) {
  if (!d) return "—";
  // UCDP's low/high can come out of order when many events are added up; show the true span.
  const lo = Math.min(d.low ?? d.best, d.best), hi = Math.max(d.high ?? d.best, d.best);
  const range = lo !== hi ? ` (range ${n(lo)}–${n(hi)})` : "";
  return `${n(d.best)} best estimate${range}`;
}

export const PRECISION_TEXT = {
  airport: "at the airport named in the report",
  city: "city named in the report",
  region: "region named in the report",
  country: "country only: the report names no city, so the marker sits mid-country",
};
export const KIND_LABEL = { terrorism: "TERRORISM", cyber: "CYBER", strike: "MILITARY STRIKE" };
// UCDP's definitions, counted over the months Wire Room keeps (about a year).
export const LEVEL_TEXT = {
  war: { label: "WAR", note: "1,000+ battle deaths in the period (UCDP's definition of a war)" },
  "armed conflict": { label: "ARMED CONFLICT", note: "25+ battle deaths in the period (UCDP's definition of an armed conflict)" },
  "armed clashes": { label: "ARMED CLASHES", note: "fewer than 25 deaths in the period: below UCDP's armed-conflict line so far" },
};
export const sidesText = (sides) => [sides.a.join(", "), sides.b.join(", ")].filter(Boolean).join(" vs ") || "—";
export const isUnnamed = (s) => /^XXX\d/.test(String(s || ""));
export const SUBTYPE_LABEL = { attack: "ATTACK REPORTED", threat: "THREAT REPORTED", warning: "WARNING" };

// One map marker per place and tracker: every terrorism (or cyber, or strike) event reported at
// the same city, airport or region, or in the same country with no city named, shares a marker
// that lists them all when tapped.
export function groupByPlace(incidents) {
  const groups = new Map();
  for (const i of incidents || []) {
    if (!Number.isFinite(i.lon) || !Number.isFinite(i.lat)) continue;
    const where = i.precision === "country" ? `country:${i.iso || i.place}` : `${i.precision}:${i.place}:${i.iso}`;
    const key = `${i.kind}|${where}`;
    if (!groups.has(key)) groups.set(key, { key, kind: i.kind, place: i.place, precision: i.precision, iso: i.iso, lon: i.lon, lat: i.lat, items: [] });
    groups.get(key).items.push(i);
  }
  return [...groups.values()].map((g) => {
    g.items.sort((a, b) => String(b.lastReported).localeCompare(String(a.lastReported)));
    g.subtype = g.items.some((x) => x.subtype === "attack") ? "attack" : g.items[0].subtype;
    g.lastReported = g.items[0].lastReported;
    return g;
  });
}

// Pin an incident or a war to a marker: the marker keeps its own copy, like any report.
export function incidentToReport(i) {
  const lead = i.sources[0] || {};
  return {
    id: `trk:${i.id}`,
    sourceType: lead.sourceType === "official" ? "official" : "independent",
    source: lead.source || "Report",
    headline: i.title,
    summary: `${KIND_LABEL[i.kind]} · ${SUBTYPE_LABEL[i.subtype]} at ${i.place}${i.country && i.precision !== "country" ? `, ${i.country}` : ""} (${i.precision}).${i.by && i.by.length ? ` By (as reported): ${i.by.join(", ")}.` : ""} Reported by ${i.sourceCount} source${i.sourceCount === 1 ? "" : "s"}; not verified by Wire Room.`,
    date: dayLabel(i.lastReported),
    publishedAt: i.lastReported,
    url: lead.url || "",
    lat: i.lat,
    lon: i.lon,
  };
}
export function nodeSearchUrl(node) {
  const q = String(node.headline || "").split(/\s+/).slice(0, 14).join(" ");
  return q ? `https://www.google.com/search?tbm=nws&q=${encodeURIComponent(q)}` : "";
}
export function warToReport(w) {
  const lm = w.latestMonth || {};
  return {
    id: `trk:${w.id}:${lm.month || ""}`,
    sourceType: "conflict",
    source: "UCDP (verified dataset)",
    headline: `${w.name} · ${n(lm.best)} killed in ${monthLabel(lm.month)}`,
    summary: `${sidesText(w.sides)}. ${n(w.deaths.best)} killed in ${n(w.events)} events, ${coverageLabel(w.coverage)} (UCDP best estimate; range ${n(Math.min(w.deaths.low, w.deaths.best))}–${n(Math.max(w.deaths.high, w.deaths.best))}).`,
    date: monthLabel(lm.month),
    publishedAt: lm.month ? `${lm.month}-28T00:00:00Z` : null,
    url: "https://ucdp.uu.se/downloads/",
    lat: w.lat,
    lon: w.lon,
  };
}
