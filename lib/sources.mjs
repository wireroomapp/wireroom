// A plain-language description of where every country's reports come from, for the
// SOURCES page. Built from the same configuration the fetcher uses (lib/feeds.mjs), so it
// can't drift out of date when a source is added or changed.

import { OFFICIAL_FEEDS, OFFICIAL_DOMAINS, COUNTRY_INFO, INDEPENDENT_SOURCES, CYBER_FEEDS, hasVerifiedOfficialSource } from "./feeds.mjs";

export const METHODS = {
  feed: "RSS feed published by the government",
  page: "Read directly from the government's own news pages",
  search: "The government's own website, found through a Google News search limited to that site",
  none: "No verified government channel yet",
};

// Countries with their own reader in lib/feeds.mjs (not a plain feed or domain search).
const CUSTOM = {
  kr: { method: "page", links: ["https://www.president.go.kr/"] },
  au: { method: "page", links: ["https://www.pm.gov.au/media"] },
  in: { method: "page", links: ["https://www.pib.gov.in/"] },
  cn: { method: "page", links: ["https://www.mfa.gov.cn/eng/xw/"] },
  pl: { method: "page", links: ["https://www.gov.pl/web/premier", "https://www.gov.pl/web/diplomacy", "https://www.gov.pl/web/national-defence"] },
  il: { method: "search", links: ["https://www.gov.il/"] },
};

// Where a bare search domain doesn't open well in a browser, link the site's front door instead.
const LINK_OVERRIDES = {
  mx: ["https://www.gob.mx/presidencia"],
  br: ["https://www.gov.br/planalto"],
  ar: ["https://www.argentina.gob.ar"],
};

function homeOf(url) {
  try { return new URL(url).origin + "/"; } catch { return null; }
}

function officialFor(id) {
  if (!hasVerifiedOfficialSource(id)) return { method: "none", links: [] };
  if (CUSTOM[id]) return CUSTOM[id];
  if (OFFICIAL_FEEDS[id]) {
    // Link to the government site rather than the raw feed file, which looks broken in a browser.
    return { method: "feed", links: [...new Set(OFFICIAL_FEEDS[id].map(homeOf).filter(Boolean))] };
  }
  if (OFFICIAL_DOMAINS[id]) return { method: "search", links: LINK_OVERRIDES[id] || OFFICIAL_DOMAINS[id].map((d) => `https://${d}`) };
  return { method: "none", links: [] };
}

export function describeSources(cache = { countries: {} }) {
  const countries = Object.entries(COUNTRY_INFO).map(([id, info]) => {
    const entry = (cache.countries || {})[id] || {};
    const { method, links } = officialFor(id);
    const verified = method !== "none";
    return {
      id,
      name: info.name,
      offices: info.sources,
      verified,
      method,
      methodLabel: METHODS[method],
      links,
      status: verified ? entry.officialStatus || null : "not-configured",
      lastOkAt: entry.officialLastOkAt || null,
      officialCount: (entry.official || []).length,
      newsCount: (entry.independent || []).length,
      outlets: (INDEPENDENT_SOURCES[id] || []).map((s) => s.name),
      cyber: [...new Set((CYBER_FEEDS[id] || []).map((f) => f.source))],
      cyberLinks: [...new Set((CYBER_FEEDS[id] || []).map((f) => homeOf(f.url)).filter(Boolean))],
    };
  });
  return {
    generatedAt: cache.generatedAt || null,
    refresh: "About once an hour",
    verifiedCount: countries.filter((c) => c.verified).length,
    totalCount: countries.length,
    countries,
  };
}
