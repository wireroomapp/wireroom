// Related coverage for one event: official statements and outlet reports Wire Room already
// collected for the event's countries, around its dates, that share its place or topic words.
// These are matches, not the event's own sources, and the UI labels them that way.

const DAY = 86400000;
const COMMON_SHARE = 0.03; // a word in more than 3% of the countries' headlines is too common to match on

// Words that say nothing about which event this is.
const STOP = new Set(`a an the and or but of to in on at by for from with without into over under about after before
during amid against between near off out up down as is are was were be been being has have had do does did will
would can could may might must shall should not no nor than then that this these those there their they them its
it he she his her we our you your who whom whose which what when where why how all any each few more most other
some such only own same so too very just also new says said say saying report reports reported reportedly according
told tells amid latest update live news today yesterday week weeks day days year years month months first last
one two three four five six seven eight nine ten dozens hundreds thousands people man men woman women official
officials government govt minister ministry president prime office statement statements press release meeting
summit visit visits talks call calls video photo photos watch read more top world international`.split(/\s+/));
// Common to many events: they count, but for less than a place or a specific topic word.
const WEAK = new Set(`attack attacks attacked strike strikes struck killed kill kills killing dead death deaths
wounded injured military army forces troops war drone drones missile missiles shelling bomb bombing explosion
security police threat threats warning cyber cyberattack hackers hack hacked terror terrorism terrorist`.split(/\s+/));

const norm = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
export function words(text) {
  return [...new Set(norm(text).replace(/['’]s\b/g, "").split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w)))];
}

// The English headline: the translation when there is one, minus a trailing " - Outlet name".
export function englishHeadline(item) {
  const h = (item.tr && item.tr.headline) || item.headline || "";
  return h.replace(/\s+[-–|]\s+[^-–|]{2,80}$/, "").trim();
}

/**
 * @param cache    data/cache.json
 * @param opts.countries  Wire Room country ids to look in (e.g. ["ua", "ru"])
 * @param opts.from/to    the event's first and last day (ISO strings or Dates)
 * @param opts.text       the event's headline
 * @param opts.place      the event's place name (counts double)
 * @param opts.skipWords  words that match everything here (the countries' own names)
 * @param opts.exclude    URLs already shown as the event's own sources
 */
export function relatedReports(cache, { countries = [], from, to, text = "", place = "", skipWords = [], exclude = [], pad = 2, maxOfficial = 3, maxNews = 4 } = {}) {
  const start = new Date(from).getTime() - pad * DAY;
  const end = new Date(to || from).getTime() + pad * DAY + DAY;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { official: [], news: [] };
  const skip = new Set(skipWords.flatMap(words));
  const placeWords = words(place).filter((w) => !skip.has(w));
  const topicWords = words(text).filter((w) => !skip.has(w) && !placeWords.includes(w));
  if (!placeWords.length && !topicWords.length) return { official: [], news: [] };
  const excluded = new Set(exclude);
  const pool = [];
  for (const id of countries) {
    const entry = cache.countries && cache.countries[id];
    if (entry) for (const item of [...(entry.official || []), ...(entry.independent || [])]) pool.push([id, item, words(englishHeadline(item))]);
  }
  // Words that appear all over these countries' feeds ("president", "national", "russian")
  // can't tell one event from another, so they don't count.
  const df = new Map();
  for (const [, , ws] of pool) for (const w of ws) df.set(w, (df.get(w) || 0) + 1);
  const common = (w) => pool.length >= 50 && (df.get(w) || 0) / pool.length > COMMON_SHARE;
  const own = norm(text).replace(/[^a-z0-9]+/g, " ").trim();
  const same = (h) => own.length > 20 && norm(h).replace(/[^a-z0-9]+/g, " ").trim() === own;
  const official = [], news = [], seen = new Set(), seenHeadlines = new Set();
  for (const [id, item, ws] of pool) {
    const t = Date.parse(item.publishedAt || item.date);
    if (!(t >= start && t < end) || !item.url || excluded.has(item.url) || seen.has(item.url)) continue;
    const have = new Set(ws);
    let placeHits = 0, strong = 0, weak = 0;
    for (const w of placeWords) if (have.has(w) && !common(w)) placeHits++;
    for (const w of topicWords) if (have.has(w) && !common(w)) { if (WEAK.has(w)) weak++; else strong++; }
    // A government statement: it names the place, or shares two specific words.
    // An outlet report (outlets cover far more): the place plus something about what happened, or three specific words.
    const isOfficial = item.sourceType === "official";
    if (isOfficial ? !(placeHits || strong >= 2) : !((placeHits && strong + weak >= 1) || strong >= 3)) continue;
    const headline = englishHeadline(item);
    const hkey = norm(headline).replace(/[^a-z0-9]+/g, " ").trim();
    if (same(headline) || seenHeadlines.has(hkey)) continue; // the event's own headline, or the same story twice
    seenHeadlines.add(hkey);
    seen.add(item.url);
    (isOfficial ? official : news).push({
      countryId: id, sourceType: item.sourceType, source: item.source, headline,
      translatedFrom: item.tr && item.tr.from ? item.tr.from : null,
      url: item.url, publishedAt: item.publishedAt || item.date, score: placeHits * 2 + strong + weak / 2,
    });
  }
  const order = (a, b) => b.score - a.score || Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
  return { official: official.sort(order).slice(0, maxOfficial), news: news.sort(order).slice(0, maxNews) };
}
