// Shareable links: the address bar mirrors what's open, so a link like
//   wireroom.onrender.com/?country=ua&mode=both
// opens Ukraine's brief in BOTH mode. Other parameters (such as ?engine=d3) are kept.

const MODES = ["official", "news", "both"];
const DEFAULT_MODE = "official";

// Read the view from a query string. Unknown countries or modes are ignored, never an error.
export function readViewFromUrl(search, countryIds) {
  let params;
  try { params = new URLSearchParams(search || ""); } catch { return { country: null, mode: null, global: false }; }
  const c = (params.get("country") || "").toLowerCase();
  const m = (params.get("mode") || "").toLowerCase();
  const country = countryIds.includes(c) ? c : null;
  return {
    country,
    mode: MODES.includes(m) ? m : null,
    global: !country && (params.get("view") || "").toLowerCase() === "global",
  };
}

// Build the query string for the current view, keeping any unrelated parameters.
export function viewToSearch({ country, mode, global }, currentSearch = "") {
  let params;
  try { params = new URLSearchParams(currentSearch); } catch { params = new URLSearchParams(); }
  params.delete("country");
  params.delete("mode");
  params.delete("view");
  if (country) params.set("country", country);
  else if (global) params.set("view", "global");
  if (mode && mode !== DEFAULT_MODE) params.set("mode", mode);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}
