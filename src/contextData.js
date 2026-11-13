import { useEffect, useState } from "react";

// Trackers (new map only): MILITARY, TERRORISM and CYBER markers from /api/incidents, built
// hourly by scripts/collect-incidents.mjs (see lib/incidents.mjs for how reports become markers).
// Loaded once, when a tracker is first turned on.

export const TRACKER_COLORS = { war: "#ff4d4d", strike: "#ff8a3d", terrorism: "#f5c242", cyber: "#ff5fd2" };
export const TRACKER_CREDITS = {
  military: "Wars: UCDP Candidate Events Dataset, Uppsala University (CC BY 4.0)",
  reports: "Incident markers: placed from collected reports (not verified by Wire Room)",
  places: "Places: GeoNames (CC BY 4.0), OurAirports, Natural Earth",
};

export function useContextData(apiBase, path, enabled) {
  const [state, setState] = useState({ status: "idle", data: null });
  const wanted = enabled && state.status === "idle";
  useEffect(() => {
    if (!wanted) return undefined;
    let live = true;
    fetch(`${apiBase}${path}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (live) setState({ status: "ok", data: d }); })
      .catch(() => { if (live) setState({ status: "unavailable", data: null }); });
    return () => { live = false; };
  }, [apiBase, path, wanted]);
  // Let a failed load be retried by turning the tracker off and on.
  const retry = () => setState((s) => (s.status === "unavailable" ? { status: "idle", data: null } : s));
  return { ...state, status: wanted ? "loading" : state.status, retry };
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
