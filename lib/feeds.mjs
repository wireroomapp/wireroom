import Parser from "rss-parser";
import { ProxyAgent } from "undici";

// Optional paid-proxy support. Unset by default (free, direct requests).
// When you're ready to pay for a residential proxy service (needed for
// sites that block cloud/datacenter traffic, like Ukraine's does), set
// the PROXY_URL environment variable to the connection string your
// provider gives you, e.g. http://user:pass@proxy.provider.com:8080 —
// exact format varies by provider, check their docs when you sign up.
const proxyAgent = process.env.PROXY_URL ? new ProxyAgent(process.env.PROXY_URL) : null;

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

const parser = new Parser();

// Confirmed, working official feeds. Add to this as more get verified —
// unverified countries automatically fall back to the Google News layer
// below, so a missing entry here never breaks anything.
export const OFFICIAL_FEEDS = {
  us: ["https://www.whitehouse.gov/news/feed/"],
  gb: ["https://www.gov.uk/government/organisations/prime-ministers-office-10-downing-street.atom"],
  // Note: Ukraine's president.gov.ua actively blocks cloud/datacenter IP
  // ranges (confirmed 403 from both Render and GitHub Actions/Azure) —
  // a deliberate security measure, not a bug on our end. It runs on the
  // Google News fallback instead; not worth chasing further for a free project.
  tw: ["https://english.president.gov.tw/RSSNEWS.aspx"],
};

// Countries where we know the official government domain but don't have
// (or can't use) a direct RSS feed — either none exists, or the site
// blocks cloud/datacenter traffic (like Ukraine's does). For these, we
// ask Google News to search *only* that domain. Google fetches the page,
// not us, so this sidesteps the block entirely — and the content is
// still 100% the government's own words, just discovered via Google
// instead of a dedicated feed. Genuinely tagged "official," not a
// workaround dressed up as one.
export const OFFICIAL_DOMAINS = {
  ua: ["president.gov.ua"],
};


export const COUNTRY_INFO = {
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

export function stripHtml(str = "") {
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

export function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

async function fetchFeed(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    const fetchOptions = { headers: BROWSER_HEADERS, signal: controller.signal };
    if (proxyAgent) fetchOptions.dispatcher = proxyAgent;

    const res = await fetch(url, fetchOptions);
    if (!res.ok) throw new Error(`Status code ${res.status}`);

    const xml = await res.text();
    const feed = await parser.parseString(xml);
    return feed.items || [];
  } catch (err) {
    console.error(`Feed failed: ${url} — ${err.message}`);
    return []; // one bad feed never breaks the whole run
  } finally {
    clearTimeout(timeoutId);
  }
}

function toResultItem(item, countryId, sourceType, source) {
  return {
    id: `${countryId}-${sourceType}-${Buffer.from(item.link || item.title || "").toString("base64").slice(0, 12)}`,
    countryId,
    sourceType,
    source,
    headline: stripHtml(item.title || "Untitled"),
    summary: toSummary(item),
    date: toDateLabel(item),
    publishedAt: item.isoDate || item.pubDate || null,
    url: item.link || "",
    importance: sourceType === "official" ? 3 : 2,
  };
}

// Fetches official content indirectly via Google News, restricted to a
// specific government domain. Double-checks each result's actual link
// domain before trusting it — belt and suspenders.
async function fetchOfficialViaGoogle(countryId, domains) {
  const siteQuery = domains.map((d) => `site:${d}`).join(" OR ");
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(siteQuery)}&hl=en-US&gl=US&ceid=US:en`;
  const items = await fetchFeed(url);
  return items.filter((item) => domains.some((d) => domainOf(item.link || "").includes(d)));
}

// Does this country have ANY configured way to reach an official source
// (direct feed or domain-restricted search) — regardless of whether
// today's run happened to find items? This is what lets the frontend
// distinguish "verified source, just quiet today" from "we haven't
// found a way in for this country yet."
export function hasVerifiedOfficialSource(countryId) {
  return Boolean(OFFICIAL_FEEDS[countryId] || OFFICIAL_DOMAINS[countryId]);
}

// Fetches both the official feed (if one is confirmed for this country)
// and the Google News fallback, returning them as two separate arrays.
export async function fetchAllForCountry(countryId) {
  const info = COUNTRY_INFO[countryId];
  if (!info) return { official: [], independent: [], officialVerified: false };

  let officialRaw = [];
  if (OFFICIAL_FEEDS[countryId]) {
    officialRaw = (await Promise.all(OFFICIAL_FEEDS[countryId].map(fetchFeed))).flat();
  } else if (OFFICIAL_DOMAINS[countryId]) {
    officialRaw = await fetchOfficialViaGoogle(countryId, OFFICIAL_DOMAINS[countryId]);
  }
  const official = officialRaw
    .slice(0, 6)
    .map((item) => toResultItem(item, countryId, "official", info.sources[0]));

  const query = encodeURIComponent(`${info.name} ${info.sources[0]}`);
  const newsUrl = `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;
  const independentRaw = await fetchFeed(newsUrl);
  const independent = independentRaw
    .slice(0, 6)
    .map((item) => toResultItem(item, countryId, "independent", "Google News"));

  return { official, independent, officialVerified: hasVerifiedOfficialSource(countryId) };
}
