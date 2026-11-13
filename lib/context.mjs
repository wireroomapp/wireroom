// Context layers: verified conflict events and government terrorism advisories.
//
// Wire Room does not generate alerts. These layers show what an accountable source has
// published, with its uncertainty left visible:
//
//  CONFLICT  UCDP Candidate Events Dataset (Uppsala University), CC BY 4.0.
//            Every event is coded by researchers from news and NGO reports, with a low /
//            best / high death estimate, how precisely the place and date are known, and a
//            status flag when figures are still being checked. Released monthly, so it runs
//            about 1-2 months behind: accuracy over immediacy.
//  ADVISORY  US Department of State travel advisories (public domain, US government work):
//            countries where the advisory names terrorism as a risk, with the advisory level.
//            One government's guidance for its own travelers, labeled as such.

export const UCDP_BASE = "https://ucdp.uu.se/downloads/candidateged/";
export const ADVISORY_FEED = "https://travel.state.gov/_res/rss/TAsTWs.xml";

// ---------------------------------------------------------------------------
// CSV (RFC 4180: quoted fields, doubled quotes, line breaks inside quotes)
// ---------------------------------------------------------------------------
export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", i = 0, q = false;
  const s = String(text || "");
  while (i < s.length) {
    const c = s[i];
    if (q) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        q = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"') { q = true; i++; continue; }
    if (c === ",") { row.push(field); field = ""; i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += c; i++;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function csvObjects(text) {
  const rows = parseCsv(text);
  const head = rows.shift() || [];
  return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, k) => [h, r[k] ?? ""])));
}

// ---------------------------------------------------------------------------
// UCDP
// ---------------------------------------------------------------------------
// Monthly release names: "26_0_9" = September 2026. Newest first, starting last month.
export function ucdpMonthlyVersions(now = new Date(), count = 6) {
  const out = [];
  let y = now.getUTCFullYear(), m = now.getUTCMonth(); // getUTCMonth() is 0-based, so this is last month
  for (let k = 0; k < count; k++) {
    if (m === 0) { y -= 1; m = 12; }
    out.push(`${String(y).slice(-2)}_0_${m}`);
    m -= 1;
  }
  return out;
}

const VIOLENCE = { 1: "state-based", 2: "non-state", 3: "one-sided" };
// UCDP's precision codes, from the Candidate codebook v1.5.
const WHERE = { 1: "exact location", 2: "within about 25 km", 3: "district only (shown at its center)", 4: "province only (shown at its center)", 5: "along a border, river or road, or a vague area", 6: "country only (location unknown)", 7: "international waters or airspace" };
const WHEN = { 1: "exact day", 2: "within 2-6 days", 3: "week only", 4: "month only", 5: "within the year" };

const int = (v) => { const n = Number.parseInt(v, 10); return Number.isFinite(n) ? n : null; };
const num = (v) => { const n = Number.parseFloat(v); return Number.isFinite(n) ? n : null; };
const first = (v, max = 180) => String(v || "").split(";")[0].trim().slice(0, max);

export function toConflictEvent(r) {
  const lat = num(r.latitude), lon = num(r.longitude);
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const type = int(r.type_of_violence);
  const wp = int(r.where_prec), dp = int(r.date_prec);
  return {
    id: String(r.id || r.relid),
    date: String(r.date_start || "").slice(0, 10),
    dateEnd: String(r.date_end || "").slice(0, 10),
    datePrec: dp, datePrecText: WHEN[dp] || "unknown",
    lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4,
    wherePrec: wp, wherePrecText: WHERE[wp] || "unknown",
    place: [r.where_description || r.where_coordinates, r.adm_1].filter(Boolean).join(", ").slice(0, 140),
    country: r.country || "",
    type, typeText: VIOLENCE[type] || "unknown",
    conflict: (r.conflict_name || r.dyad_name || "").slice(0, 120),
    sideA: (r.side_a || "").slice(0, 100), sideB: (r.side_b || "").slice(0, 100),
    deaths: { best: int(r.best) ?? 0, low: int(r.low) ?? 0, high: int(r.high) ?? 0, civilians: int(r.deaths_civilians) ?? 0 },
    sources: int(r.number_of_sources) ?? 0,
    headline: first(r.source_headline),
    office: first(r.source_office, 60),
    status: r.code_status || "", // "Clear", or what UCDP is still checking: "Check deaths", "Check dyad", ...
    clarity: int(r.event_clarity), // 1 = a single incident, 2 = a total reported over several days
  };
}

export function buildConflict(releases, now = new Date()) {
  // releases: [{ version, events: [...] }] newest first. Later releases can revise an event; keep the newest copy.
  const byId = new Map();
  for (const rel of [...releases].reverse()) for (const e of rel.events) byId.set(e.id, { ...e, release: rel.version });
  const events = [...byId.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const dates = events.map((e) => e.date).filter(Boolean).sort();
  return {
    version: 1,
    source: "UCDP Candidate Events Dataset",
    citation: "Hegre, Croicu, Eck & Högbladh (2020), Introducing the UCDP Candidate Events Dataset, Research & Politics. Uppsala Conflict Data Program, CC BY 4.0.",
    license: "CC BY 4.0",
    url: "https://ucdp.uu.se/downloads/",
    releases: releases.map((r) => r.version),
    coverage: { from: dates[0] || null, to: dates[dates.length - 1] || null },
    checkedAt: now.toISOString(),
    events,
  };
}

// ---------------------------------------------------------------------------
// US State Department travel advisories
// ---------------------------------------------------------------------------
const RISK_WORDS = /^(terrorism|crime|unrest|civil unrest|kidnapping( or hostage taking)?|health|natural disasters?|wrongful detention|arbitrary (arrest|detention|enforcement of laws)|armed conflict|landmines|piracy|time-limited event|other)$/i;

export function cleanAdvisoryName(title) {
  return String(title || "").split(" - Level")[0].replace(/\s+Travel Advisory$/i, "").trim();
}

export function parseAdvisory(item, places) {
  const title = String(item.title || "");
  const lm = title.match(/Level\s+(\d)\s*:\s*([^<]+)$/i);
  if (!lm) return null;
  const name = cleanAdvisoryName(title);
  const html = String(item.content || item.description || "");
  const intro = html.split(/Read the entire|<\/p>/i)[0];
  const risks = [...intro.matchAll(/<b>\s*([^<]+?)\s*<\/b>/gi)].map((m) => m[1].toLowerCase().replace(/\s+/g, " ").trim()).filter((w) => RISK_WORDS.test(w));
  const pos = places[name] || places[title.split(" - ")[0].trim()];
  const code = (item.categories || []).find((c) => c && c.$ && c.$.domain === "Country-Tag");
  return {
    name,
    code: code ? code._ : "",
    level: Number(lm[1]),
    levelText: lm[2].trim(),
    risks: [...new Set(risks)],
    terrorism: risks.includes("terrorism"),
    date: item.isoDate ? item.isoDate.slice(0, 10) : "",
    url: item.link || "https://travel.state.gov/content/travel/en/traveladvisories/traveladvisories.html",
    lon: pos ? pos[0] : null,
    lat: pos ? pos[1] : null,
  };
}

export function buildAdvisories(items, places, now = new Date()) {
  const seen = new Set();
  const all = [];
  const unplaced = [];
  for (const it of items) {
    const a = parseAdvisory(it, places);
    if (!a || seen.has(a.name)) continue;
    seen.add(a.name);
    if (a.lon === null) { unplaced.push(a.name); continue; }
    all.push(a);
  }
  return {
    version: 1,
    source: "U.S. Department of State travel advisories",
    note: "One government's guidance for its own citizens traveling abroad. Not an intelligence assessment.",
    url: "https://travel.state.gov/content/travel/en/traveladvisories/traveladvisories.html",
    checkedAt: now.toISOString(),
    countries: all.length,
    unplaced,
    // Only advisories that name terrorism as a risk are mapped.
    advisories: all.filter((a) => a.terrorism).sort((a, b) => b.level - a.level || a.name.localeCompare(b.name)),
  };
}
