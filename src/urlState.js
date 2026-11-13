// Shareable links: the address bar mirrors what's open, so a link like
//   wireroom.onrender.com/?country=ua&mode=both
// opens Ukraine's brief in BOTH mode, and ?war=war-russia-ukraine opens that war's intel panel
// (MILITARY tracker), and ?day=2026-11-06 shows the trackers as of that day. Other parameters (such as ?engine=d3) are kept.

const MODES = ["official", "news", "both"];
const DEFAULT_MODE = "official";

// Read the view from a query string. Unknown countries or modes are ignored, never an error.
export function readViewFromUrl(search, countryIds) {
  let params;
  try { params = new URLSearchParams(search || ""); } catch { return { country: null, mode: null, global: false, war: null }; }
  const c = (params.get("country") || "").toLowerCase();
  const m = (params.get("mode") || "").toLowerCase();
  const country = countryIds.includes(c) ? c : null;
  const w = (params.get("war") || "").toLowerCase();
  const war = !country && /^war-[a-z0-9-]{1,80}$/.test(w) ? w : null;
  const d = params.get("day") || "";
  return {
    country,
    mode: MODES.includes(m) ? m : null,
    global: !country && !war && (params.get("view") || "").toLowerCase() === "global",
    war,
    day: /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null, // a past day for the EVENTS trackers
  };
}

// Build the query string for the current view, keeping any unrelated parameters.
export function viewToSearch({ country, mode, global, war = null, day = null }, currentSearch = "") {
  let params;
  try { params = new URLSearchParams(currentSearch); } catch { params = new URLSearchParams(); }
  params.delete("country");
  params.delete("mode");
  params.delete("view");
  params.delete("war");
  params.delete("day");
  if (country) params.set("country", country);
  else if (war) params.set("war", war);
  else if (global) params.set("view", "global");
  if (day) params.set("day", day);
  if (mode && mode !== DEFAULT_MODE) params.set("mode", mode);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}
