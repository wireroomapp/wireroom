import Parser from "rss-parser";
import { ProxyAgent } from "undici";
import { createHash } from "crypto";

// Optional paid-proxy support. Unset by default (free, direct requests).
// When you're ready to pay for a residential proxy service (needed for
// sites that block cloud/datacenter traffic, like Ukraine's does), set
// the PROXY_URL environment variable to the connection string your
// provider gives you, e.g. http://user:pass@proxy.provider.com:8080 â€”
// exact format varies by provider, check their docs when you sign up.
const proxyAgent = process.env.PROXY_URL ? new ProxyAgent(process.env.PROXY_URL) : null;

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

const parser = new Parser();

// Confirmed, working official feeds. Add to this as more get verified â€”
// unverified countries automatically fall back to the Google News layer
// below, so a missing entry here never breaks anything.
export const OFFICIAL_FEEDS = {
  es: ["https://www.lamoncloa.gob.es/paginas/rss.aspx?tipo=1","https://www.lamoncloa.gob.es/paginas/rss.aspx?tipo=2"],
  it: ["https://www.governo.it/it/feed/rss"],
  us: ["https://www.whitehouse.gov/news/feed/"],
  gb: ["https://www.gov.uk/government/organisations/prime-ministers-office-10-downing-street.atom"],
  // Note: Ukraine's president.gov.ua actively blocks cloud/datacenter IP
  // ranges (confirmed 403 from both Render and GitHub Actions/Azure) â€”
  // a deliberate security measure, not a bug on our end. It runs on the
  // Google News fallback instead; not worth chasing further for a free project.
  ca: ["https://www.pm.gc.ca/en/news.rss"],
  de: ["https://www.bundeskanzler.de/service/rss/bk-de/1859752/feed.xml"],
  fr: ["https://www.elysee.fr/feed"],
  tw: ["https://english.president.gov.tw/RSSNEWS.aspx"],
  jp: ["https://japan.kantei.go.jp/index-e2.rdf"],

};

export const OFFICIAL_DOMAINS = {
  mx: ["gob.mx"],
  br: ["gov.br/planalto"],
  ar: ["argentina.gob.ar"],
};



// Countries where we know the official government domain but don't have
// (or can't use) a direct RSS feed â€” either none exists, or the site
// blocks cloud/datacenter traffic (like Ukraine's does). For these, we
// ask Google News to search *only* that domain. Google fetches the page,
// not us, so this sidesteps the block entirely â€” and the content is
// still 100% the government's own words, just discovered via Google
// instead of a dedicated feed. Genuinely tagged "official," not a
// workaround dressed up as one.

export const COUNTRY_INFO = {
  us: { name: "United States", sources: ["White House", "Department of Defense", "Department of State"] },
  ca: { name: "Canada", sources: ["Prime Minister's Office", "Global Affairs Canada", "National Defence"] },
  mx: { name: "Mexico", sources: ["Presidencia", "SecretarÃ­a de Relaciones Exteriores", "Defensa"] },
  br: { name: "Brazil", sources: ["PresidÃªncia", "MinistÃ©rio das RelaÃ§Ãµes Exteriores", "MinistÃ©rio da Defesa"] },
  ar: { name: "Argentina", sources: ["Casa Rosada", "CancillerÃ­a", "Ministerio de Defensa"] },
  gb: { name: "United Kingdom", sources: ["Prime Minister's Office", "Foreign Office", "Ministry of Defence"] },
  fr: { name: "France", sources: ["Ã‰lysÃ©e", "MinistÃ¨re de l'Europe et des Affaires Ã©trangÃ¨res", "MinistÃ¨re des ArmÃ©es"] },
  de: { name: "Germany", sources: ["Bundesregierung", "AuswÃ¤rtiges Amt", "Bundeswehr"] },
  it: { name: "Italy", sources: ["Presidenza del Consiglio", "Ministero degli Esteri", "Ministero della Difesa"] },
  es: { name: "Spain", sources: ["La Moncloa", "Ministerio de Asuntos Exteriores", "Ministerio de Defensa"] },
  pl: { name: "Poland", sources: ["Kancelaria Premiera", "Ministerstwo Spraw Zagranicznych", "Ministerstwo Obrony"] },
  ua: { name: "Ukraine", sources: ["Office of the President", "Ministry of Foreign Affairs", "Ministry of Defence"] },
  ru: { name: "Russia", sources: ["Kremlin", "Ministry of Foreign Affairs", "Ministry of Defence"] },
  tr: { name: "TÃ¼rkiye", sources: ["Presidency", "Ministry of Foreign Affairs", "Ministry of National Defence"] },
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
  "&nbsp;": " ", "&iacute;": "Ã­", "&aacute;": "Ã¡", "&eacute;": "Ã©",
  "&oacute;": "Ã³", "&uacute;": "Ãº", "&ntilde;": "Ã±",
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
  return clean.length > 220 ? clean.slice(0, 217) + "â€¦" : clean;
}

const COUNTRY_TIMEZONES = {
  br: "America/Sao_Paulo",
  in: "Asia/Kolkata",
};

function toDateLabel(item, countryId) {
  const d = item.isoDate || item.pubDate;
  if (!d) return "Recent";

  const parsed = new Date(d);
  if (isNaN(parsed)) return "Recent";

  const timeZone = COUNTRY_TIMEZONES[countryId] || undefined;

  const datePart = parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone,
  });

  if (item.dateOnly) return datePart;

  const timePart = parsed.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });

  return `${datePart} \u00B7 ${timePart}`;
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
    console.error(`Feed failed: ${url} â€” ${err.message}`);
    return []; // one bad feed never breaks the whole run
  } finally {
    clearTimeout(timeoutId);
  }
}

function toResultItem(item, countryId, sourceType, source) {
  const key = item.link || item.title || Math.random().toString();
  const hash = createHash("sha1").update(key).digest("hex").slice(0, 16);

  const rawDate = item.isoDate || item.pubDate || null;

  const effectiveDateOnly =
    Boolean(item.dateOnly) ||
    (countryId === "br" && sourceType === "official");

  const displayItem = { ...item, dateOnly: effectiveDateOnly };

  let displayDate = toDateLabel(displayItem, countryId);

  // Brazil official results are discovered through Google News, whose
  // timestamp can fall on the previous calendar day in Brazil.
  // When the government headline contains the actual date, use it.
  if (countryId === "br" && sourceType === "official") {
    const brazilDateMatch = `${item.title || ""} ${item.contentSnippet || ""}`.match(
      /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/
    );

    if (brazilDateMatch) {
      const [, day, month, year] = brazilDateMatch;
      const months = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
      ];

      const monthIndex = Number(month) - 1;

      if (monthIndex >= 0 && monthIndex < 12) {
        displayDate = `${months[monthIndex]} ${Number(day)}, ${year}`;
      }
    }
  }

  return {
    id: `${countryId}-${sourceType}-${hash}`,
    countryId,
    sourceType,
    source,
    headline: stripHtml(item.title || "Untitled"),
    summary: toSummary(item),
    date: displayDate,
    publishedAt: rawDate,
    dateOnly: effectiveDateOnly,
    url: item.link || "",
    importance: sourceType === "official" ? 3 : 2,
  };
}

// Fetches official content indirectly via Google News, restricted to a
// specific government domain. Double-checks each result's actual link
// domain before trusting it â€” belt and suspenders.

// Government sites that publish mainly in a local language often need a
// same-language query to be indexed as "News" results by Google â€” an
// English-only search can come back empty even when the site IS indexed.
const DOMAIN_SEARCH_LOCALE = {
  mx: { hl: "es-MX", gl: "MX", term: "presidencia" },
  br: { hl: "pt-BR", gl: "BR", term: "Presidente da República" },
  ar: { hl: "es-419", gl: "AR", term: "Comunicado Oficial Número" },
  ua: { hl: "uk", gl: "UA", term: "Ð¿Ñ€ÐµÐ·Ð¸Ð´ÐµÐ½Ñ‚" },
  kr: { hl: "ko", gl: "KR", term: "ëŒ€í†µë ¹" },
};

async function fetchOfficialViaGoogle(countryId, domains) {
  const siteQuery = domains.map((d) => `site:${d}`).join(" OR ");
  const locale = DOMAIN_SEARCH_LOCALE[countryId] || { hl: "en-US", gl: "US", term: "" };
  const fullQuery = locale.term ? `${locale.term} ${siteQuery}` : siteQuery;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(fullQuery)}&hl=${locale.hl}&gl=${locale.gl}&ceid=${locale.gl}:${locale.hl}`;
  const items = await fetchFeed(url);

  return items.filter((item) => {
    if (countryId === "mx") {
      const text = `${item.title || ""} ${item.contentSnippet || ""}`;
      return /Gob MX/i.test(text);
    }

    if (countryId === "br") {
      const text = `${item.title || ""} ${item.contentSnippet || ""}`;
      if (!/Planalto/i.test(text)) return false;

      // Ignore static Planalto navigation/index pages.
      if (/Página Inicial|Indice|Índice|^Home|Área de Imprensa/i.test(item.title || "")) {
        return false;
      }

      return true;
    }    if (countryId === "ar") {
      const text = `${item.title || ""} ${item.contentSnippet || ""}`;
      return /Comunicado Oficial Número/i.test(text);
    }


    return domains.some((d) => domainOf(item.link || "").includes(d));
  });
}
// Does this country have ANY configured way to reach an official source
// (direct feed or domain-restricted search) â€” regardless of whether
// today's run happened to find items? This is what lets the frontend
// distinguish "verified source, just quiet today" from "we haven't
// found a way in for this country yet."
async function fetchKoreaOfficial() {
  const body = "pageNo=1&pagePerCnt=10&MENU_CD=nFSy219D&CONTENTS_CD=vqNUjDNc&pSiteNo=2&pBoardSeq=2&BBS_CD=&SHORT_URL=briefings";

  try {
    const res = await fetch("https://www.president.go.kr/ajaxf/frBoard/bbsViewGalleryList.do", {
      method: "POST",
      headers: {
        ...BROWSER_HEADERS,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    });

    if (!res.ok) throw new Error(`Status code ${res.status}`);

    const data = await res.json();

    return (data?.data?.list || []).map(item => ({
      title: item.SUBJECT || "Untitled",
      content: item.CONTENTS || "",
      pubDate: item.WRITE_DT
        ? item.WRITE_DT.replace(" ", "T").replace(/\.\d+$/, "") + "+09:00"
        : null,
      isoDate: item.WRITE_DT
        ? item.WRITE_DT.replace(" ", "T").replace(/\.\d+$/, "") + "+09:00"
        : null,
      link: item.BBS_CD
        ? `https://www.president.go.kr/briefings/${item.BBS_CD}`
        : ""
    }));
  } catch (err) {
    console.error(`Korea official feed failed: ${err.message}`);
    return [];
  }
}
async function fetchIsraelOfficial() {
  try {
    const res = await fetch(
      "https://openapi-gc.digital.gov.il/pub/cio/govil/rest/collectors/v1/api/DataCollector/GetResults?CollectorType=news&OfficeId=e744bba9-d17e-429f-abc3-50f7a8a55667&culture=en",
      { headers: { ...BROWSER_HEADERS, "Referer": "https://www.gov.il/", "Accept": "application/json" } }
    );
    if (!res.ok) throw new Error("Status code " + res.status);
    const data = await res.json();

    return (data?.results || []).map(item => {
      const dateStr = item.tags?.metaData?.["Publish Date"]?.[0]?.title || "";
      const m = dateStr.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
      const isoDate = m
        ? m[3] + "-" + m[2] + "-" + m[1] + "T00:00:00+03:00"
        : null;

      return {
        title: item.title || "Untitled",
        content: item.description || item.title || "",
        pubDate: isoDate,
        isoDate,
        link: item.url ? "https://www.gov.il" + item.url : ""
      };
    });
  } catch (err) {
    console.error("Israel official feed failed: " + err.message);
    return [];
  }
}

async function fetchChinaOfficial() {
  const urls = [
    "https://www.mfa.gov.cn/eng/xw/zyxw/",
    "https://www.mfa.gov.cn/eng/xw/wjbxw/"
  ];

  try {
    const pages = await Promise.all(urls.map(async (url) => {
      const res = await fetch(url, { headers: BROWSER_HEADERS });
      if (!res.ok) throw new Error("Status code " + res.status + " for " + url);
      return await res.text();
    }));

    const items = [];

    for (const html of pages) {
      const matches = html.matchAll(/<div>\s*<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<div>\s*([A-Za-z]+\s+\d{1,2},\s+\d{4})\s*<\/div>\s*<\/div>/gi);

      for (const match of matches) {
        const [, href, rawTitle, dateStr] = match;

        const title = rawTitle
          .replace(/<[^>]+>/g, "")
          .replace(/\s+/g, " ")
          .trim();

        const date = new Date(dateStr);

        if (!title || Number.isNaN(date.getTime())) continue;

        const articleUrl = new URL(href, "https://www.mfa.gov.cn/eng/xw/").href;

        let isoDate = date.toISOString();
        let dateOnly = true;

        try {
          const articlePathMatch = articleUrl.match(/\/(t\d+_\d+)\.html$/);
          if (articlePathMatch) {
            const articlePath = articlePathMatch[1];
            const mirrorUrl = "https://un.china-mission.gov.cn/eng/zgyw/" + articlePath.slice(1, 7) + "/" + articlePath + ".htm";

            const mirrorRes = await fetch(mirrorUrl, { headers: BROWSER_HEADERS });
            if (mirrorRes.ok) {
              const mirrorHtml = await mirrorRes.text();
              const timeMatch = mirrorHtml.match(/(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\s+\d{1,2}:\d{2})/);

              if (timeMatch) {
                const parts = timeMatch[1].match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\s+(\d{1,2}):(\d{2})/);
                if (parts) {
                  if (Number(parts[4]) !== 0 || Number(parts[5]) !== 0) {
                    isoDate = new Date(
                      Number(parts[1]),
                      Number(parts[2]) - 1,
                      Number(parts[3]),
                      Number(parts[4]),
                      Number(parts[5])
                    ).toISOString();
                    dateOnly = false;
                  }
                }
              }
            }
          }
        } catch {}

        items.push({
          title,
          content: title,
          pubDate: isoDate,
          isoDate,
          dateOnly,
          link: articleUrl
        });
      }
    }

    const seen = new Set();

    return items
      .filter(item => {
        if (seen.has(item.link)) return false;
        seen.add(item.link);
        return true;
      })
      .sort((a, b) => new Date(b.isoDate) - new Date(a.isoDate));
  } catch (err) {
    console.error("China official feed failed: " + err.message);
    return [];
  }
}
async function fetchAustraliaOfficial() {
  const url = "https://www.pm.gov.au/media?page=0";

  try {
    const res = await fetch(url, { headers: BROWSER_HEADERS });
    if (!res.ok) throw new Error("Status code " + res.status);

    const html = await res.text();
    const items = [];
    const matches = html.matchAll(
      /<h3[^>]*class="card-title"[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h3>\s*<div[^>]*class="card-text date"[^>]*>\s*<time[^>]*datetime="([^"]+)"[^>]*>/gi
    );

    for (const match of matches) {
      const [, href, rawTitle, dateStr] = match;
      const title = rawTitle
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim();

      const date = new Date(dateStr);
      if (!title || Number.isNaN(date.getTime())) continue;

      items.push({
        title,
        content: title,
        pubDate: date.toISOString(),
        isoDate: date.toISOString(),
        link: new URL(href, "https://www.pm.gov.au/").href
      });
    }

    return items
      .filter((item, index, arr) => arr.findIndex(x => x.link === item.link) === index)
      .sort((a, b) => new Date(b.isoDate) - new Date(a.isoDate));
  } catch (err) {
    console.error("Australia official feed failed: " + err.message);
    return [];
  }
}
async function fetchIndiaOfficial() {
  const url = "https://www.pib.gov.in/PMContents/PMContents.aspx?lang=1&menuid=1&reg=3";

  try {
    const res = await fetch(url, { headers: BROWSER_HEADERS });
    if (!res.ok) throw new Error("Status code " + res.status);

    const html = await res.text();
    const items = [];
    const matches = html.matchAll(
      /<li><a[^>]*href='([^']*PressReleseDetail\.aspx\?PRID=\d+)'[^>]*>([^<]+)<\/a>\s*<span[^>]*>Posted on:\s*([^<]+)/gi
    );

    for (const match of matches) {
      const [, href, rawTitle, dateStr] = match;
      const title = rawTitle
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim();

      const parsedDate = new Date(dateStr.trim() + " UTC");
      if (!title || Number.isNaN(parsedDate.getTime())) continue;

      const isoDate = parsedDate.toISOString();

      items.push({
        title,
        content: title,
        pubDate: isoDate,
        isoDate,
        dateOnly: true,
        link: new URL(href, "https://www.pib.gov.in/").href
      });
    }

    return items
      .filter((item, index, arr) => arr.findIndex(x => x.link === item.link) === index)
      .sort((a, b) => new Date(b.isoDate) - new Date(a.isoDate));
  } catch (err) {
    console.error("India official feed failed: " + err.message);
    return [];
  }
}
export function hasVerifiedOfficialSource(countryId) {
  return Boolean(OFFICIAL_FEEDS[countryId] || OFFICIAL_DOMAINS[countryId] || countryId === "kr" || countryId === "cn" || countryId === "au" || countryId === "in");
}

export async function fetchAllForCountry(countryId) {
  const info = COUNTRY_INFO[countryId];
  if (!info) return { official: [], independent: [], officialVerified: false };

  let officialRaw = [];
  if (OFFICIAL_FEEDS[countryId]) {
    officialRaw = (await Promise.all(OFFICIAL_FEEDS[countryId].map(fetchFeed))).flat();
  } else if (countryId === "kr") {
    officialRaw = await fetchKoreaOfficial();
  } else if (countryId === "il") {
    officialRaw = await fetchIsraelOfficial();
  } else if (OFFICIAL_DOMAINS[countryId]) {
    officialRaw = await fetchOfficialViaGoogle(countryId, OFFICIAL_DOMAINS[countryId]);
  } else if (countryId === "au") {
    officialRaw = await fetchAustraliaOfficial();
  } else if (countryId === "in") {
    officialRaw = await fetchIndiaOfficial();
  } else if (countryId === "cn" || countryId === "au" || countryId === "in") {
    officialRaw = await fetchChinaOfficial();
  }
  const sortNewestFirst = (items) =>
    [...items].sort((a, b) => {
      const diff =
        new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0);
      if (diff !== 0) return diff;
      return String(a.id || "").localeCompare(String(b.id || ""));
    });

  const official = sortNewestFirst(
    officialRaw.map((item) =>
      toResultItem(item, countryId, "official", info.sources[0])
    )
  );

  const query = encodeURIComponent(`${info.name} ${info.sources[0]}`);
  const newsUrl = `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;
  const independentRaw = await fetchFeed(newsUrl);

  const independent = sortNewestFirst(
    independentRaw.map((item) =>
      toResultItem(item, countryId, "independent", "Google News")
    )
  );

  return {
    official,
    independent,
    officialVerified: hasVerifiedOfficialSource(countryId),
  };
}











