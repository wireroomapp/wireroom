import express from "express";
import Parser from "rss-parser";

/*
  WIRE ROOM / WORLD WIRE — backend
  --------------------------------
  No API key. No AI calls. No cost.
  Pulls real RSS/Atom feeds from official government sources where a
  working feed is confirmed, and falls back to a free Google News RSS
  search (scoped to that country's official bodies) everywhere else.
  Google News results are tagged "independent" — they're aggregated
  news coverage, not the primary source, and we don't pretend otherwise.
*/

const parser = new Parser({
  timeout: 8000,
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
  },
});

const app = express();
const PORT = 3001;

// Confirmed, working official feeds. Add to this as more get verified —
// unverified countries automatically fall back to the Google News layer
// below, so a missing entry here never breaks anything.
const OFFICIAL_FEEDS = {
  us: ["https://www.whitehouse.gov/news/feed/"],
  gb: ["https://www.gov.uk/government/organisations/prime-ministers-office-10-downing-street.atom"],
  ua: ["https://www.president.gov.ua/en/rss/news/all.rss"],
  tw: ["https://english.president.gov.tw/RSSNEWS.aspx"],
};

// Mirrors the id/name/sources already defined in the frontend's
// COUNTRIES list, so every country has a fallback search even without
// a confirmed direct feed.
const COUNTRY_INFO = {
  us: { name: "United States", sources: ["White House", "Department of Defense", "Department of State"] },
  ca: { name: "Canada", sources: ["Prime Minister's Office", "Global Affairs Canada", "National Defence"] },
  mx: { name: "Mexico", sources: ["Presidencia", "Secretaría de Relaciones Exteriores", "Defensa"] },
  br: { name: "Brazil", sources: ["Presidência", "Ministério das Relações Exteriores", "Ministério da Defesa"] },
  ar: { name: "Argentina", sources: ["Casa Rosada", "Cancillería", "Ministerio de Defensa"] },
  gb: { name: "United Kingdom", sources: ["Prime Minister's Office", "Foreign Office", "Ministry of Defence"] },
  fr: { name: "France", sources: ["Élysée", "Ministère de l'Europe et des Affaires étrangères", "Ministère des Armées"] },
  de: { name: "Germany", sources: ["Bundesregierung", "Auswärtiges Amt", "Bundeswehr"] },
  it: { name: "Italy", sources: ["Presidenza del Consiglio", "Ministero degli Esteri", "Ministero della Difesa"] },
  es: { name: "Spain", sources: ["La Moncloa", "Ministerio de Asuntos Exteriores", "Ministerio de Defensa"] },
  pl: { name: "Poland", sources: ["Kancelaria Premiera", "Ministerstwo Spraw Zagranicznych", "Ministerstwo Obrony"] },
  ua: { name: "Ukraine", sources: ["Office of the President", "Ministry of Foreign Affairs", "Ministry of Defence"] },
  ru: { name: "Russia", sources: ["Kremlin", "Ministry of Foreign Affairs", "Ministry of Defence"] },
  tr: { name: "Türkiye", sources: ["Presidency", "Ministry of Foreign Affairs", "Ministry of National Defence"] },
  il: { name: "Israel", sources: ["Prime Minister's Office", "Ministry of Foreign Affairs", "IDF"] },
  ir: { name: "Iran", sources: ["Presidency", "Ministry of Foreign Affairs", "Armed Forces"] },
  sa: { name: "Saudi Arabia", sources: ["Royal Court", "Ministry of Foreign Affairs", "Ministry of Defense"] },
  ae: { name: "United Arab Emirates", sources: ["Presidential Court", "Ministry of Foreign Affairs", "Ministry of Defence"] },
  eg: { name: "Egypt", sources: ["Presidency", "Ministry of Foreign Affairs", "Ministry of Defence"] },
  za: { name: "South Africa", sources: ["The Presidency", "DIRCO", "Department of Defence"] },
  ng: { name: "Nigeria", sources: ["State House", "Ministry of Foreign Affairs", "Defence Headquarters"] },
  in: { name: "India", sources: ["Prime Minister's Office", "Ministry of External Affairs", "Ministry of Defence"] },
  pk: { name: "Pakistan", sources: ["Prime Minister's Office", "Ministry of Foreign Affairs", "Inter-Services Public Relations"] },
  cn: { name: "China", sources: ["State Council", "Ministry of Foreign Affairs", "Ministry of National Defense"] },
  jp: { name: "Japan", sources: ["Prime Minister's Office", "Ministry of Foreign Affairs", "Ministry of Defense"] },
  kr: { name: "South Korea", sources: ["Office of the President", "Ministry of Foreign Affairs", "Ministry of National Defense"] },
  tw: { name: "Taiwan", sources: ["Presidential Office", "Ministry of Foreign Affairs", "Ministry of National Defense"] },
  id: { name: "Indonesia", sources: ["Presidential Office", "Ministry of Foreign Affairs", "Ministry of Defense"] },
  au: { name: "Australia", sources: ["Prime Minister's Office", "Department of Foreign Affairs and Trade", "Department of Defence"] },
};

const HTML_ENTITIES = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'",
  "&nbsp;": " ", "&iacute;": "í", "&aacute;": "á", "&eacute;": "é",
  "&oacute;": "ó", "&uacute;": "ú", "&ntilde;": "ñ",
};

function decodeEntities(str = "") {
  let out = str.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(code));
  for (const [entity, char] of Object.entries(HTML_ENTITIES)) {
    out = out.replaceAll(entity, char);
  }
  return out;
}

function stripHtml(str = "") {
  return decodeEntities(str.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

function toSummary(item) {
  const raw = item.contentSnippet || item.content || item.summary || "";
  const clean = stripHtml(raw);
  return clean.length > 220 ? clean.slice(0, 217) + "…" : clean;
}

function toDateLabel(item) {
  const d = item.isoDate || item.pubDate;
  if (!d) return "Recent";
  const parsed = new Date(d);
  if (isNaN(parsed)) return "Recent";
  const datePart = parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const timePart = parsed.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${datePart} · ${timePart}`;
}

async function fetchFeed(url) {
  try {
    const feed = await parser.parseURL(url);
    return feed.items || [];
  } catch (err) {
    console.error(`Feed failed: ${url} — ${err.message}`);
    return []; // one bad feed never breaks the whole request
  }
}

async function getOfficialItems(countryId) {
  const urls = OFFICIAL_FEEDS[countryId] || [];
  const results = await Promise.all(urls.map(fetchFeed));
  return results.flat().map((item) => ({ item, sourceType: "official" }));
}

async function getIndependentItems(countryId) {
  const info = COUNTRY_INFO[countryId];
  if (!info) return [];
  const query = encodeURIComponent(`${info.name} ${info.sources[0]}`);
  const url = `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;
  const items = await fetchFeed(url);
  return items.map((item) => ({ item, sourceType: "independent" }));
}

app.get("/api/news", async (req, res) => {
  const countryId = String(req.query.country || "").toLowerCase();
  const mode = String(req.query.mode || "both");

  if (!COUNTRY_INFO[countryId]) {
    return res.status(400).json({ error: "unknown country id" });
  }

  try {
    const wantOfficial = mode === "official" || mode === "both";
    const wantIndependent = mode === "news" || mode === "both";

    const [officialRaw, independentRaw] = await Promise.all([
      wantOfficial ? getOfficialItems(countryId) : [],
      wantIndependent ? getIndependentItems(countryId) : [],
    ]);

    const combined = [...officialRaw, ...independentRaw]
      .sort((a, b) => new Date(b.item.isoDate || b.item.pubDate || 0) - new Date(a.item.isoDate || a.item.pubDate || 0))
      .slice(0, 6)
      .map(({ item, sourceType }, i) => ({
        id: `${countryId}-${sourceType}-${i}-${Date.now()}`,
        countryId,
        sourceType,
        source: sourceType === "official" ? COUNTRY_INFO[countryId].sources[0] : "Google News",
        headline: stripHtml(item.title || "Untitled"),
        summary: toSummary(item),
        date: toDateLabel(item),
        publishedAt: item.isoDate || item.pubDate || null,
        url: item.link || "",
        importance: sourceType === "official" ? 3 : 2,
      }));

    res.json({ items: combined });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "failed to fetch news", items: [] });
  }
});

app.listen(PORT, () => {
  console.log(`Wire Room backend running at http://localhost:${PORT}`);
  console.log(`Confirmed official feeds: ${Object.keys(OFFICIAL_FEEDS).join(", ")}`);
  console.log(`All ${Object.keys(COUNTRY_INFO).length} countries have a Google News fallback.`);
});
