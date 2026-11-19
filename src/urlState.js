// Shareable links: the address bar mirrors what's open, so a link like
//   wireroom.onrender.com/?country=ua&mode=both
// opens Ukraine's brief in BOTH mode, and ?war=war-russia-ukraine opens that war's intel panel
// (MILITARY tracker), and ?day=2026-11-06 shows the trackers as of that day. ?community=1 opens the
// Community panel and ?post=<id> one post in it. Other parameters (such as ?engine=d3) are kept.

const MODES = ["official", "news", "both"];
const DEFAULT_MODE = "official";

// Read the view from a query string. Unknown countries or modes are ignored, never an error.
export function readViewFromUrl(search, countryIds) {
  let params;
  try { params = new URLSearchParams(search || ""); } catch { return { country: null, mode: null, global: false, war: null, day: null, community: false, post: null }; }
  const c = (params.get("country") || "").toLowerCase();
  const m = (params.get("mode") || "").toLowerCase();
  const country = countryIds.includes(c) ? c : null;
  const w = (params.get("war") || "").toLowerCase();
  const war = !country && /^war-[a-z0-9-]{1,80}$/.test(w) ? w : null;
  const d = params.get("day") || "";
  const p = (params.get("post") || "").toLowerCase();
  const post = !country && !war && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(p) ? p : null;
  return {
    country,
    mode: MODES.includes(m) ? m : null,
    global: !country && !war && (params.get("view") || "").toLowerCase() === "global",
    war,
    day: /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null, // a past day for the EVENTS trackers
    community: Boolean(post) || (!country && !war && params.get("community") === "1"),
    post,
  };
}

// Build the query string for the current view, keeping any unrelated parameters.
export function viewToSearch({ country, mode, global, war = null, day = null, community = false, post = null }, currentSearch = "") {
  let params;
  try { params = new URLSearchParams(currentSearch); } catch { params = new URLSearchParams(); }
  params.delete("country");
  params.delete("mode");
  params.delete("view");
  params.delete("war");
  params.delete("day");
  params.delete("community");
  params.delete("post");
  if (country) params.set("country", country);
  else if (war) params.set("war", war);
  else if (global) params.set("view", "global");
  else if (community && post) params.set("post", post);
  else if (community) params.set("community", "1");
  if (day) params.set("day", day);
  if (mode && mode !== DEFAULT_MODE) params.set("mode", mode);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}
