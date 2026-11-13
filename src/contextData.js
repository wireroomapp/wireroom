import { useEffect, useState } from "react";

// Context layers (new map only): verified conflict events (UCDP) and US travel advisories that
// name terrorism. Both are loaded once, when first turned on; they change daily at most.
// See lib/context.mjs for where the data comes from and how uncertainty is kept.

export const CONFLICT_TYPES = [
  [1, "State-based", "#e05a4f"],
  [2, "Non-state", "#e39a45"],
  [3, "One-sided (vs civilians)", "#b07ad6"],
];
export const ADVISORY_COLORS = { 1: "#8fa3b8", 2: "#d9c25a", 3: "#e39a45", 4: "#e05a4f" };
export const CONTEXT_CREDITS = {
  conflict: "Conflict events: UCDP Candidate Events Dataset, Uppsala University (CC BY 4.0)",
  advisories: "Advisories: U.S. Department of State",
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
  // Let a failed load be retried by turning the layer off and on.
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
  const m = String(d || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : d || "—";
}

export function deathsText(d) {
  if (!d) return "—";
  const range = d.low !== d.high ? ` (range ${d.low.toLocaleString()}–${d.high.toLocaleString()})` : "";
  return `${d.best.toLocaleString()} best estimate${range}${d.civilians ? `, ${d.civilians.toLocaleString()} civilians` : ""}`;
}

export const STATUS_TEXT = {
  "Clear": "Clear: parties, deaths, source and location established",
  "Check deaths": "Still checking: death figures may be revised",
  "Check dyad": "Still checking: which armed groups were involved",
  "Check type of violence": "Still checking: deaths may come from more than one type of violence",
  "Check incompatibility": "Still checking: what the conflict is over",
  "Check vague or biased source": "Caution: the source is known to be biased",
  "Check geography": "Still checking: location could be refined",
  "Check": "Still checking: may duplicate another event",
};

export function contextToReport(kind, item) {
  if (kind === "conflict") {
    const pos = `${Math.abs(item.lat).toFixed(2)}°${item.lat >= 0 ? "N" : "S"}, ${Math.abs(item.lon).toFixed(2)}°${item.lon >= 0 ? "E" : "W"}`;
    return {
      id: `ctx:conflict:${item.id}`,
      sourceType: "conflict",
      source: "UCDP (verified dataset)",
      headline: `${item.sideA || "Unknown"} vs ${item.sideB || "unknown"} · ${item.country}`,
      summary: `${item.typeText} violence on ${dayLabel(item.date)} (${item.datePrecText}) near ${item.place || pos} (${item.wherePrecText}). Deaths: ${deathsText(item.deaths)}. ${item.sources} source report(s). UCDP status: ${item.status || "n/a"}.`,
      date: dayLabel(item.date),
      publishedAt: item.date ? `${item.date}T00:00:00Z` : null,
      url: "https://ucdp.uu.se/downloads/",
      lat: item.lat,
      lon: item.lon,
    };
  }
  return {
    id: `ctx:advisory:${item.name}:${item.date}`,
    sourceType: "advisory",
    source: "U.S. Department of State",
    headline: `${item.name} · Level ${item.level}: ${item.levelText}`,
    summary: `US travel advisory naming: ${item.risks.join(", ")}. One government's guidance for its own citizens, issued ${dayLabel(item.date)}.`,
    date: dayLabel(item.date),
    publishedAt: item.date ? `${item.date}T00:00:00Z` : null,
    url: item.url,
    lat: item.lat,
    lon: item.lon,
  };
}

