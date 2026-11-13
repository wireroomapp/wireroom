import { createHash } from "node:crypto";
// Trackers: places reported terrorism, cyber and military incidents on the map, and summarizes
// active wars.
//
// TERRORISM / CYBER / strikes are found in the reports Wire Room already collects (official
// statements and trusted outlets, with English translations). A report becomes an incident when
// its headline describes an event (an attack, a threat, a hack), not policy or anniversaries. The
// place is read from the headline: an airport, a city, a region or sea, or else the country.
// Reports of the same event (same kind, close in time and place, similar words) are grouped, so a
// marker can say "reported by 4 sources". These are REPORTS, never confirmed by Wire Room.
//
// Wars come from the UCDP conflict data (lib/context.mjs): researcher-verified, 1-2 months behind.
//
// Place names: GeoNames cities (CC BY 4.0), OurAirports (public domain), Natural Earth countries.

export const WINDOW_DAYS = 7; // a week (lib/history.mjs SHOW_DAYS)

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------
export const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[‘’ʼ`´]/g, "'").toLowerCase();
const stripPublisher = (h) => String(h || "").replace(/\s+[-–|]\s+[^-–|]{1,60}$/, "").trim();
export const englishHeadline = (it) => stripPublisher((it.tr && it.tr.headline) || it.headline);
// The summary, minus what adds nothing: Google News summaries repeat the headline and end with
// the publisher's name ("... The Times of Israel"), which must not be read as a place.
export const englishSummary = (it) => {
  let s = String((it.tr && it.tr.summary) || it.summary || "").trim();
  const h = englishHeadline(it);
  if (h && norm(s).startsWith(norm(h).slice(0, 60))) return "";
  if (it.source) s = s.split(it.source).join(" ");
  return s.trim();
};
const englishText = (it) => [englishHeadline(it), englishSummary(it)].filter(Boolean).join(" ");

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------
const TERROR_SIGNAL = /\b(terror(?! (targets?|infrastructure|operatives?|cells?|sites?))\w*|suicide (bomb\w*|attack\w*)|car bomb\w*|ieds?|improvised explosive|jihadi\w*|islamic state|isis|isil|daesh|al-?qaeda|al-?shabaab|boko haram|ttp|tehreek-e-taliban|lashkar\w*|jaish\w*|bomb threats?|bomb hoax\w*)\b/;
const TERROR_EVENT = /\b(attack\w*|bomb(s|ing|ings|ed)?|blasts?|explosions?|explod\w*|shooting|shot|gunm[ae]n|stabb\w*|hostages?|kill\w*|injur\w*|wounded|dead|deaths?|threats?|plots?|foil\w*|thwart\w*|evacuat\w*|suspicious|alert|claims? responsibility|raid\w*|ambush\w*)\b/;
const TERROR_THREAT = /\b(threats?|plots?|plotting|planned|planning|charged|foil\w*|thwart\w*|evacuat\w*|suspicious|alert|warns?|warning|hoax\w*|arrested|detained|planning)\b/;
const TERROR_HARM = /\b(kill\w*|dead|deaths?|injur\w*|wounded|exploded|blast|explosion|stabbed|shot dead)\b/;
// Not an incident: designations, laws, trials, anniversaries, cooperation.
const NOT_INCIDENT = /\b(designat\w*|blacklist\w*|sanction\w*|listed as|labell?ed|anniversary|years since|years after|marking|memorial|commemorat\w*|laws?|bill|legislation|court|trials?|sentenc\w*|convict\w*|extradit\w*|financing|cooperation|dialogue|exercise|drill|conference|summit|strategy|statement on the|condemns?|condolences?|jail\w*|prison|evidence|efforts?|initiat\w*|concerns?|express\w*|offers?|boost\w*|rejects?|denies|ties|deals?)\b/;

const CYBER_SIGNAL = /\b(cyber ?-?attacks?|cyberattacks?|hack(ed|ers?|ing)|ransomware|data breach(es)?|breached (systems?|networks?|servers?|accounts?|databases?)|ddos|malware|spyware|wiper|phishing campaign|cyber espionage|cyber intrusion|exploited vulnerabilit\w*|zero-day)\b/;
const CYBER_NOT = /\b(tips|how to|guide|month|conference|training|scheme|launch\w*|partnership|agreement|strategy|plan|bill|law|survey|award|jobs?|hiring|course|mandate\w*|regulator|rules|fines?|spotlight|what else|at risk|risks?|secret weapon|army of|unfixed|third of|half of|percent|per cent|this year|study|seeks?|arrested|amid|at odds|role in)\b|\?\s*$/;
const WARNING = /\b(warns?|warnings? (of|about|over)|advisory)\b/;

const STRIKE_SIGNAL = /\b(air ?strikes?|airstrikes?|drone (strikes?|attacks?)|drones? (hit|struck|attack\w*)|missile (strikes?|attacks?)|missiles? (hit|struck)|ballistic missile (strikes?|attacks?|launch\w*)|shelling|shelled|artillery|rocket (attacks?|fire)|rockets? (hit|fired)|bombard\w*|glide bombs?|killed in (an? )?(strike|attack|shelling)|shot down|counter-?offensive|armed clashes|heavy fighting|frontline|front line|(us|u\.s|american|israeli|iranian|russian|ukrainian|enemy|military|naval|retaliatory|deadly|overnight) (air ?)?strikes?|strikes? (hits?|on|kills?|killed|targets?))\b/;
const STRIKE_NOT = /\b(talks|summit|meeting|aid package|sanction\w*|budget|vote|election|condemns?|discuss\w*|phone call|calls? for|tribute|anniversary|protests?|protesters?|police|demonstrat\w*|riots?|workers|ties|deals?|cooperation|program\w*|joined|holds? off|threatens?|vows?|considers?|ready to|calls? off|cancels?|pauses?|resume|plans?|planning|planned|preparing|compensation|cop\d+)\b/;

// Questions, explainers and speculation describe no event ("Why experts fear Canada's
// not-for-profits are prime targets for hackers", "Can Iran attack Israel ...?").
const SPECULATION = /^(why|how|what|whats|is|are|can|could|should|would|will|inside|analysis|opinion|explainer|explained|watch|video|podcast)\b|\b(could|might|may be|would|fears?|feared|prime targets?|vulnerable to|experts? (say|warn|fear)|what we know|explained|explainer|analysis|opinion)\b|\?\s*$/;

export function classify(item) {
  const head = norm(englishHeadline(item));
  const text = norm(englishText(item));
  if (!head) return null;
  if (SPECULATION.test(head) && item.agency !== "cyber") return null;
  if (item.agency === "cyber") {
    // National cyber agencies: warnings about active threats only, not guidance or announcements.
    if (/\b(ransomware|actors?|exploit\w*|campaign|targeting|breach|malicious|compromise\w*|attack\w*|threat\w*)\b/.test(head) && !CYBER_NOT.test(head)) return { kind: "cyber", subtype: "warning" };
    return null;
  }
  if (TERROR_SIGNAL.test(text) && TERROR_EVENT.test(head) && !NOT_INCIDENT.test(head)) {
    const subtype = TERROR_HARM.test(head) ? "attack" : TERROR_THREAT.test(head) ? "threat" : "attack";
    return { kind: "terrorism", subtype };
  }
  if (CYBER_SIGNAL.test(head) && !CYBER_NOT.test(head) && !NOT_INCIDENT.test(head)) return { kind: "cyber", subtype: WARNING.test(head) ? "warning" : "attack" };
  if (STRIKE_SIGNAL.test(head) && !STRIKE_NOT.test(head)) return { kind: "strike", subtype: "attack" };
  return null;
}

// ---------------------------------------------------------------------------
// Place names
// ---------------------------------------------------------------------------
// Words before a place name that mean "this is where it happened" (not "this government said").
const LOCATIVE = new Set(["in", "at", "near", "on", "outside", "inside", "across", "into", "hits", "struck", "strikes", "targeting", "targets", "targeted", "toward", "towards", "around", "off", "breached", "hacked", "attacked", "bombed", "shelled", "against"]);
// Words after these usually describe an earlier or background event ("... in retaliation for an
// attack on X", "... amid strikes in Y"), so places after them count for less.
// A country right before one of these is who acted or spoke, not where it happened
// ("Ukraine strikes Russia's refinery", "Russia is trying to divide Ukraine"). Not "accuses" or
// "blames": the accuser is usually the victim ("France accuses Iran of hacking").
const ACTOR_VERB = /^(says?|said|is|was|has|have|launch\w*|fires?|fired|attacks?|strikes?|hits?|denies|warns?|plans?|planning|targets?|downs?|shoots?|shot|vows?|threatens?|tells?|urges?|calls?)$/;
const CLAUSE_BREAK = new Set(["after", "following", "amid", "retaliation", "despite", "since", "while", "as", "weeks", "months", "years"]);
const FILLER = new Set(["the", "a", "an", "northern", "southern", "eastern", "western", "central", "northeastern", "northwestern", "southeastern", "southwestern"]);
// Nationality words place an event in that country (weakly), e.g. "near the Yemeni capital".
const DEMONYMS = { american: "United States of America", british: "United Kingdom", french: "France", german: "Germany", italian: "Italy", spanish: "Spain", polish: "Poland", ukrainian: "Ukraine", russian: "Russia", turkish: "Turkey", israeli: "Israel", iranian: "Iran", saudi: "Saudi Arabia", emirati: "United Arab Emirates", egyptian: "Egypt", nigerian: "Nigeria", indian: "India", pakistani: "Pakistan", chinese: "China", japanese: "Japan", "south korean": "South Korea", "north korean": "North Korea", taiwanese: "Taiwan", australian: "Australia", indonesian: "Indonesia", mexican: "Mexico", brazilian: "Brazil", canadian: "Canada", yemeni: "Yemen", syrian: "Syria", iraqi: "Iraq", lebanese: "Lebanon", afghan: "Afghanistan", somali: "Somalia", sudanese: "Sudan", malian: "Mali", swedish: "Sweden", dutch: "Netherlands", belgian: "Belgium", danish: "Denmark", norwegian: "Norway", finnish: "Finland", irish: "Ireland", greek: "Greece", palestinian: "Palestine", bangladeshi: "Bangladesh", burmese: "Myanmar", filipino: "Philippines", kenyan: "Kenya", ethiopian: "Ethiopia", libyan: "Libya", jordanian: "Jordan", qatari: "Qatar" };
// Armed groups closely tied to one place: a weak hint used only when nothing better is named.
const ACTOR_PLACES = { houthi: "yemen", houthis: "yemen", hezbollah: "lebanon", hamas: "gaza strip", "al-shabaab": "somalia", "al shabaab": "somalia", "boko haram": "nigeria", ttp: "khyber pakhtunkhwa", "tehreek-e-taliban": "khyber pakhtunkhwa", jnim: "mali" };
// Names that are usually something else in headlines: capitals used for governments
// ("Moscow says"), people's names, ordinary words. They count only after a locative word.
const NEEDS_LOCATIVE = new Set(["washington", "moscow", "beijing", "kyiv", "tehran", "jerusalem", "london", "paris", "berlin", "tokyo", "ankara", "delhi", "new delhi", "islamabad", "riyadh", "cairo", "brussels", "seoul", "pyongyang", "taipei", "damascus", "beirut", "baghdad", "kabul",
  "jackson", "austin", "lincoln", "florence", "charlotte", "victoria", "hamilton", "regina", "eugene", "gary", "orlando", "aurora", "jordan", "chad", "georgia", "mali", "niger", "of", "nice", "reading", "mobile", "split", "orange", "surprise", "independence", "concord", "mission", "union", "bath", "sale", "march", "may", "male", "most", "obama", "trump", "santa", "san", "la", "mon", "man", "pop", "bar", "toledo", "dallas", "phoenix", "lafayette", "elizabeth", "marion", "madison", "warren", "carson", "allen", "jefferson", "franklin", "clinton", "kent", "york", "wellington", "salem", "columbus", "troy", "peoria", "rome", "athens", "berkeley", "cambridge", "oxford", "manchester", "chester", "durham", "newport"]);
const STOP = new Set(["hit", "the", "a", "an", "and", "or", "for", "to", "new", "says", "said", "say", "after", "as", "with", "from", "by", "is", "are", "was", "be", "not", "no", "up", "out", "its", "his", "her", "their", "this", "that", "over", "under", "about", "more", "less", "first", "last", "next", "west", "east", "north", "south", "us", "un", "eu", "it", "he", "she", "we", "you", "they", "all", "one", "two", "three", "four"]);

export function buildGeocoder(gaz) {
  const index = new Map(); // key -> [{ kind, name, iso, lon, lat, pop }]
  const add = (key, e) => { if (!key || STOP.has(key)) return; const l = index.get(key); if (l) l.push(e); else index.set(key, [e]); };
  for (const [names, iso, pop, lon, lat, name] of gaz.cities) for (const n of names) add(n, { kind: "city", name, iso, lon, lat, pop });
  for (const [names, iso, lon, lat] of gaz.regions) for (const n of names) add(n, { kind: "region", name: names[0].replace(/\b\w/g, (c) => c.toUpperCase()), iso, lon, lat, pop: 0 });
  const countryByName = new Map();
  for (const [names, name, lon, lat, iso = ""] of gaz.countries) {
    const e = { kind: "country", name, iso, lon, lat, pop: 0 };
    for (const n of names) { add(n, e); countryByName.set(n, e); }
  }
  const airportKeys = new Map(); // distinctive key -> airport
  const airportsByCity = new Map();
  for (const [keys, city, iso, lon, lat, name] of gaz.airports) {
    const e = { kind: "airport", name, iso, lon, lat, pop: 0 };
    for (const k of keys) if (!airportKeys.has(k)) airportKeys.set(k, e);
    if (city && !airportsByCity.has(city)) airportsByCity.set(city, e);
  }
  const aliases = gaz.aliases || {};

  function locate(text, hintIso = "") {
    const raw = norm(text).replace(/[^a-z0-9' .-]+/g, " ");
    const tokens = raw.split(/\s+/).filter(Boolean);
    const poss = tokens.map((w) => /'s$/.test(w)); // "Russia's Smolensk region"
    const words = tokens.map((w) => w.replace(/'s$/, "").replace(/^[.'-]+|[.'-]+$/g, ""));
    const hasAirport = /\bairports?\b/.test(raw);
    const isLocative = (i, depth = 0) => {
      const p1 = words[i - 1], p2 = words[i - 2], p3 = words[i - 3];
      const fill = (w) => FILLER.has(w) || /^\d[\d,.]*$/.test(w || "");
      if (LOCATIVE.has(p1) || (fill(p1) && (LOCATIVE.has(p2) || (fill(p2) && LOCATIVE.has(p3))))) return true;
      // A place right after "in <Country>'s" is where it happened too.
      return depth < 2 && i > 0 && poss[i - 1] && index.has(words[i - 1]) && isLocative(i - 1, depth + 1);
    };
    let broken = -1; // index of the first clause-break word
    for (let i = 0; i < words.length; i++) if (CLAUSE_BREAK.has(words[i])) { broken = i; break; }
    const cands = [];
    for (let i = 0; i < words.length; i++) {
      const late = broken >= 0 && i > broken ? -30 : 0;
      for (let n = 4; n >= 1; n--) {
        if (i + n > words.length) continue;
        let key = words.slice(i, i + n).join(" ");
        key = aliases[key] || key;
        const locative = isLocative(i);
        const loc = (locative ? 40 : 0) + late;
        if (hasAirport && airportKeys.has(key)) cands.push({ ...airportKeys.get(key), score: 90 + loc, n, pos: i });
        if (hasAirport && words[i + n] === "airport" && airportsByCity.has(key)) cands.push({ ...airportsByCity.get(key), score: 85 + loc, n, pos: i });
        // Nationality words usually name who did it ("Russian drones"); they place an event only
        // after a locative ("near the Yemeni capital").
        if (locative && DEMONYMS[key] && countryByName.get(norm(DEMONYMS[key]))) cands.push({ ...countryByName.get(norm(DEMONYMS[key])), score: 3 + loc, n, pos: i });
        if (ACTOR_PLACES[key]) { const a = index.get(ACTOR_PLACES[key]); if (a) cands.push({ ...a[0], score: 4 + late, n, pos: i }); }
        const hits = index.get(key);
        if (!hits) continue;
        if (/^(river|sea|strait|gulf|mountains?|valley|bay|lake)$/.test(words[i + n] || "")) continue; // "the Dnipro River", not the city
        for (const h of hits) {
          const small = h.kind === "city" && h.pop < 100000;
          if ((NEEDS_LOCATIVE.has(key) || small || key.length <= 3) && !locative) continue;
          const base = h.kind === "region" ? 40 : h.kind === "city" ? 30 + Math.log10(Math.max(h.pop, 10)) : 5;
          // The report's country breaks ties between same-named cities (not between countries:
          // an Indian statement about an attack off Oman is about Oman).
          const actor = h.kind === "country" && !locative && ACTOR_VERB.test(words[i + n] || "") ? -20 : 0;
          cands.push({ ...h, score: base + loc + actor + (h.kind === "city" && hintIso && h.iso === hintIso ? 12 : 0) + n, n, pos: i });
        }
      }
    }
    if (!cands.length) return null;
    cands.sort((a, b) => b.score - a.score || a.pos - b.pos); // ties: the place named first
    let best = cands[0];
    // "Drone attack in Russia, Belgorod governor says": prefer a named city or region inside the
    // winning country over the country itself.
    if (best.kind === "country" && best.iso) {
      const inner = cands.find((c) => c.kind !== "country" && c.iso === best.iso && c.score >= 30);
      if (inner) best = inner;
    }
    return { name: best.name, kind: best.kind, iso: best.iso, lon: best.lon, lat: best.lat };
  }
  const isoName = new Map();
  for (const [, name, , , iso = ""] of gaz.countries) if (iso && !isoName.has(iso)) isoName.set(iso, name);
  return { locate, country: (name) => countryByName.get(norm(name)) || null, countryName: (iso) => isoName.get(iso) || "" };
}

// ---------------------------------------------------------------------------
// Grouping reports of the same event
// ---------------------------------------------------------------------------
const KEYWORD_STOP = new Set([...STOP, "in", "at", "on", "of", "near", "amid", "into", "has", "have", "had", "will", "could", "would", "after", "before", "over", "while", "news", "report", "reports", "reported", "update", "live", "latest"]);
// Rough word stems, so "bombing"/"bomb" and "killed"/"kills" count as the same word.
const stem = (w) => (w.length > 5 ? w.replace(/(ings?|ed|es|s)$/, "") : w.length > 4 ? w.replace(/s$/, "") : w);
const words = (s) => new Set(norm(s).split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !KEYWORD_STOP.has(w)).map(stem));
const jaccard = (a, b) => { let i = 0; for (const w of a) if (b.has(w)) i++; return i / Math.max(1, a.size + b.size - i); };
const km = (a, b) => {
  const R = 6371, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};

// ---------------------------------------------------------------------------
// Who carried it out, as the report names it
// ---------------------------------------------------------------------------
// A nationality, country or armed group right before attack words ("Russian strikes", "Israeli
// drone", "Houthi missiles", "Ukraine strikes Russia's refinery"), or after "by" ("hit by Russian
// drones"). Nothing is guessed: no name in the headline means "not named".
const ACTOR_DISPLAY = { houthi: "Houthis", houthis: "Houthis", hezbollah: "Hezbollah", hamas: "Hamas", "al-shabaab": "al-Shabaab", "al shabaab": "al-Shabaab", "boko haram": "Boko Haram", ttp: "TTP", jnim: "JNIM", "islamic state": "Islamic State", isis: "Islamic State", rsf: "RSF", idf: "Israel", m23: "M23", taliban: "Taliban", nato: "NATO" };
const ATTACK_NOUN = /^(air ?strikes?|airstrikes?|strikes?|drones?|missiles?|rockets?|shelling|attacks?|forces|troops|jets?|warplanes?|artillery|bombing|bombardment|raids?|fire|gunfire|soldiers)$/;
const ATTACK_MODIFIER = /^(-?backed|-?led|drone|air|missile|military|naval|navy|army|ballistic|attack|kamikaze|cruise)$/;
const ATTACK_VERB = /^(strikes?|struck|hits?|attacks?|attacked|launch\w*|fires?|fired|shells?|shelled|bombs?|bombed|downs?|downed|shoots?|shot|targets?|targeted|raids?|raided|pounds?|pounded)$/;
export function partiesFor(item) {
  const head = englishHeadline(item);
  const by = [];
  const push = (n) => { if (n && !by.includes(n)) by.push(n); };
  if (/\b(U\.S\.|US)(-led)?\s+(air ?strikes?|strikes?|struck|launch\w*|hits|attacks?|fires|fired|bombs|bombed|military|forces|troops|drones?|missiles?|navy|jets?|warplanes?|bombing|raids?)\b/.test(head) && !/\b(U\.S\.|US)\s+\w+\s+by\b/.test(head)) push("United States");
  const w = norm(head).replace(/[^a-z0-9' -]+/g, " ").split(/\s+/).filter(Boolean).map((x) => x.replace(/'s$/, ""));
  for (let i = 0; i < w.length; i++) {
    for (const n of [2, 1]) {
      const key = w.slice(i, i + n).join(" ");
      const name = DEMONYMS[key] ? plainName(DEMONYMS[key]) : ACTOR_DISPLAY[key] || (COUNTRY_KEYS.has(key) ? COUNTRY_KEYS.get(key) : null);
      if (!name) continue;
      const next = w[i + n] || "", after = w[i + n + 1] || "";
      // "Iran hit by ..." is the target, not the attacker.
      const verb = ATTACK_VERB.test(next) && after !== "by";
      if (ATTACK_NOUN.test(next) || verb || (ATTACK_MODIFIER.test(next) && (ATTACK_NOUN.test(after) || ATTACK_VERB.test(after))) || w[i - 1] === "by") push(name);
      break;
    }
  }
  return by.slice(0, 2);
}
const plainName = (n) => (n === "United States of America" ? "United States" : n);
const COUNTRY_KEYS = new Map(["United States", "Canada", "Mexico", "Brazil", "Argentina", "United Kingdom", "France", "Germany", "Italy", "Spain", "Poland", "Ukraine", "Russia", "Turkey", "Israel", "Iran", "Saudi Arabia", "United Arab Emirates", "Egypt", "South Africa", "Nigeria", "India", "Pakistan", "China", "Japan", "South Korea", "North Korea", "Taiwan", "Australia", "New Zealand", "Indonesia", "Yemen", "Syria", "Iraq", "Lebanon", "Afghanistan", "Somalia", "Sudan", "Mali", "Venezuela", "Colombia", "Philippines", "Myanmar", "Ethiopia", "Eritrea", "Libya", "Jordan", "Qatar", "Azerbaijan", "Armenia", "Georgia", "Belarus", "Thailand", "Cambodia", "Vietnam", "Chad", "Niger", "Burkina Faso"].map((n) => [norm(n), n]));

export function extractIncidents(cache, geocoder, { now = new Date(), windowDays = WINDOW_DAYS, verdicts = null, keyOf = null } = {}) {
  const since = now.getTime() - windowDays * 86400000;
  const raw = [];
  const seen = new Set();
  for (const [countryId, entry] of Object.entries(cache.countries || {})) {
    for (const type of ["official", "independent"]) {
      for (const it of entry[type] || []) {
        const t = Date.parse(it.publishedAt || "");
        if (!Number.isFinite(t) || t < since || t > now.getTime() + 3600000) continue;
        const dedupe = it.url || it.id;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        const hintIso = countryId.toUpperCase();
        // An AI verdict (when the AI check is on, see lib/ai-check.mjs) replaces the keyword rules
        // for this report: whether it is an event, what kind, where, and who carried it out.
        const v = verdicts && keyOf ? verdicts.get(keyOf(it)) : null;
        let cls, place = null, by = null, target = null;
        if (v) {
          if (!v.event || !["terrorism", "cyber", "military"].includes(v.kind)) continue;
          cls = { kind: v.kind === "military" ? "strike" : v.kind, subtype: ["attack", "threat", "warning"].includes(v.subtype) ? v.subtype : "attack" };
          const c = v.country ? geocoder.country(v.country) : null;
          const iso = (c && c.iso) || hintIso;
          if (v.place) place = geocoder.locate(`in ${v.place}`, iso);
          if (place && c && c.iso && place.iso && place.iso !== c.iso && place.kind !== "region") place = null; // a same-named place elsewhere
          if (!place && c) place = { ...c, kind: "country" };
          by = v.attacker && !/^(unknown|unclear|none|not stated)$/i.test(v.attacker) ? [String(v.attacker).slice(0, 60)] : [];
          target = v.target ? String(v.target).slice(0, 80) : null;
        } else {
          cls = classify(it);
          if (!cls) continue;
        }
        if (!place) place = geocoder.locate(englishHeadline(it), hintIso) || geocoder.locate(englishSummary(it), hintIso);
        if (!place) {
          // No place named. A government statement is about its own country; anything else is
          // left off the map rather than guessed.
          if (type !== "official") continue;
          const c = geocoder.country(COUNTRY_NAMES[countryId] || "");
          if (!c) continue;
          place = { ...c, kind: "country", iso: c.iso || hintIso };
        }
        raw.push({ ...cls, t, place, countryId, item: it, words: words(englishHeadline(it)), by: by || partiesFor(it), target, ai: Boolean(v) });
      }
    }
  }
  raw.sort((a, b) => a.t - b.t);
  const groups = [];
  for (const r of raw) {
    // A report that names only the country joins a city's group only when it is clearly the same
    // story (it could be anywhere in that country).
    const need = (x) => {
      const n = (x.place.kind === "country") + (r.place.kind === "country");
      return n === 2 ? 0.2 : n === 1 ? 0.4 : 0.12;
    };
    const samePlace = (x) => (x.place.kind === "country" || r.place.kind === "country"
      ? Boolean(x.place.iso && x.place.iso === r.place.iso)
      : km(x.place, r.place) <= 80);
    const similar = (x) => Math.max(...x.reports.map((o) => jaccard(o.words, r.words)));
    // Same kind, within 48 hours, same place and similar words. A cyber story names the victim or
    // the attacker, so near-identical cyber headlines are grouped wherever they point.
    const g = groups.find((x) => x.kind === r.kind && Math.abs(r.t - x.last) <= 48 * 3600000 &&
      ((samePlace(x) && similar(x) >= need(x)) || (r.kind === "cyber" && similar(x) >= 0.3)));
    if (g) {
      g.reports.push(r);
      g.last = Math.max(g.last, r.t);
      // Keep the most specific place any report gave.
      const rank = { airport: 4, city: 3, region: 2, country: 1 };
      if ((rank[r.place.kind] || 0) > (rank[g.place.kind] || 0)) g.place = r.place;
      if (r.subtype === "attack") g.subtype = "attack";
    } else {
      groups.push({ kind: r.kind, subtype: r.subtype, place: r.place, first: r.t, last: r.t, reports: [r] });
    }
  }
  return groups.map((g) => {
    const reports = g.reports.slice().sort((a, b) => (a.item.sourceType === "official" ? -1 : 0) - (b.item.sourceType === "official" ? -1 : 0) || a.t - b.t);
    const lead = reports[0].item;
    const earliest = g.reports.reduce((m, r) => (r.t < m.t ? r : m), g.reports[0]);
    const outlets = [...new Set(g.reports.map((r) => r.item.source))];
    const by = [...new Set(g.reports.flatMap((r) => r.by || []))].slice(0, 3);
    const target = g.reports.map((r) => r.target).find(Boolean) || null;
    return {
      // Stable while reports join: named after the earliest report.
      id: `${g.kind}-${createHash("sha1").update(String(earliest.item.url || englishHeadline(earliest.item))).digest("hex").slice(0, 12)}`,
      kind: g.kind,
      subtype: g.subtype,
      title: englishHeadline(lead),
      summary: englishSummary(lead).slice(0, 300),
      translatedFrom: lead.tr ? lead.tr.from : null,
      place: g.place.name,
      precision: g.place.kind, // airport | city | region | country
      iso: g.place.iso || "",
      lat: g.place.lat,
      lon: g.place.lon,
      country: g.place.kind === "country" ? g.place.name : geocoder.countryName(g.place.iso),
      by, // who carried it out, as the reports name it (empty: not named)
      target,
      checkedBy: g.reports.some((r) => r.ai) ? "ai" : "rules",
      firstReported: new Date(g.first).toISOString(),
      lastReported: new Date(g.last).toISOString(),
      sourceCount: outlets.length,
      officialCount: g.reports.filter((r) => r.item.sourceType === "official").length,
      sources: g.reports.slice(0, 8).map((r) => ({
        source: r.item.source, sourceType: r.item.sourceType, headline: englishHeadline(r.item).slice(0, 200),
        url: r.item.url || "", publishedAt: r.item.publishedAt, countryId: r.countryId,
      })),
    };
  }).sort((a, b) => (a.lastReported < b.lastReported ? 1 : -1));
}

// Our country ids -> names (for the fallback place and for wars).
export const COUNTRY_NAMES = {
  us: "United States", ca: "Canada", mx: "Mexico", br: "Brazil", ar: "Argentina", gb: "United Kingdom", fr: "France", de: "Germany", it: "Italy", es: "Spain",
  pl: "Poland", ua: "Ukraine", ru: "Russia", tr: "Turkey", il: "Israel", ir: "Iran", sa: "Saudi Arabia", ae: "United Arab Emirates", eg: "Egypt", za: "South Africa",
  ng: "Nigeria", in: "India", pk: "Pakistan", cn: "China", jp: "Japan", kr: "South Korea", tw: "Taiwan", au: "Australia", id: "Indonesia",
};

// ---------------------------------------------------------------------------
// Wars (from UCDP conflict events)
// ---------------------------------------------------------------------------
const plainCountry = (s) => String(s || "").replace(/\s*\(.*?\)\s*/g, "").trim();
const monthsBetween = (toYm, date) => {
  const a = String(toYm || "").match(/^(\d{4})-(\d{2})/), b = String(date || "").match(/^(\d{4})-(\d{2})/);
  return a && b ? (Number(a[1]) - Number(b[1])) * 12 + (Number(a[2]) - Number(b[2])) : 0;
};
const median = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

// Every state-based armed conflict UCDP recorded in the window gets a marker, however small: one
// clash with 3 deaths shows too. Its level uses UCDP's own definitions, counted over the window
// (about the last 12 months): war = 1,000+ battle deaths, armed conflict = 25+, below that "armed clashes".
export const CONFLICT_LEVELS = [["war", 1000], ["armed conflict", 25], ["armed clashes", 0]];
const GW_COUNTRY = (code, evs) => plainCountry((evs.find((e) => e.country) || {}).country || "") || `area ${code}`;

export function buildWars(conflict, strikes, { nodes = 24 } = {}) {
  const events = (conflict && conflict.events) || [];
  const byName = new Map();
  for (const e of events) {
    if (e.type !== 1 || !e.conflict) continue; // state-based armed conflicts
    if (!byName.has(e.conflict)) byName.set(e.conflict, []);
    byName.get(e.conflict).push(e);
  }
  const nameToId = new Map(Object.entries(COUNTRY_NAMES).map(([id, n]) => [norm(n), id]));
  nameToId.set("russia", "ru"); nameToId.set("united states of america", "us");
  const wars = [];
  for (const [name, evs] of byName) {
    const deaths = evs.reduce((a, e) => ({ best: a.best + e.deaths.best, low: a.low + e.deaths.low, high: a.high + e.deaths.high, civilians: a.civilians + e.deaths.civilians }), { best: 0, low: 0, high: 0, civilians: 0 });
    // "XXX475": UCDP hasn't identified the actors yet (the number is the country's code).
    const unnamed = /^XXX\d/.test(name);
    const sideCount = (key) => { const m = new Map(); for (const e of evs) m.set(e[key], (m.get(e[key]) || 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k).filter(Boolean); };
    const sideA = sideCount("sideA"), sideB = sideCount("sideB");
    const countries = [...new Set(evs.map((e) => plainCountry(e.country)))];
    // Our countries involved: where it's fought, and governments on either side.
    const ours = new Set();
    for (const c of countries) { const id = nameToId.get(norm(c)); if (id) ours.add(id); }
    for (const s of [...sideA, ...sideB]) { const m = s.match(/^Government of (.+)$/); if (m) { const id = nameToId.get(norm(plainCountry(m[1]))); if (id) ours.add(id); } }
    const sorted = evs.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.deaths.best - a.deaths.best));
    const lon = median(evs.map((e) => e.lon)), lat = median(evs.map((e) => e.lat));
    // Deaths in the latest month UCDP has published, the "latest casualty count".
    const lastMonth = (conflict.coverage && conflict.coverage.to) || (sorted[0] ? sorted[0].date.slice(0, 7) : "");
    const inLast = evs.filter((e) => (e.date || "").slice(0, 7) === lastMonth);
    const latestMonth = { month: lastMonth, events: inLast.length, best: inLast.reduce((a, e) => a + e.deaths.best, 0), low: inLast.reduce((a, e) => a + e.deaths.low, 0), high: inLast.reduce((a, e) => a + e.deaths.high, 0) };
    const title = unnamed ? `${GW_COUNTRY(name, evs)}: armed clashes, sides not yet identified`
      : plainCountry(name.replace(/:\s*Government$/, "").replace(/:\s*Government\//, ": ")).replace(/\s+-\s+/g, " – ").replace(/United States of America/g, "United States");
    const level = CONFLICT_LEVELS.find(([, min]) => deaths.best >= min)[0];
    const months = conflict.coverage ? monthsBetween(conflict.coverage.to, (sorted[0] || {}).date) : 0;
    wars.push({
      id: `war-${norm(name).replace(/[^a-z0-9]+/g, "-")}`,
      name: title,
      ucdpName: name,
      level,
      quiet: months >= 3, // no event in the last 3 months of data
      sides: unnamed ? { a: ["Not yet identified by UCDP"], b: [] } : { a: sideA.slice(0, 3).map(plainCountry), b: sideB.slice(0, 5).filter((x) => !/^XXX\d/.test(x)).map(plainCountry) },
      countries,
      ourCountries: [...ours],
      lat: Math.round(lat * 1000) / 1000, lon: Math.round(lon * 1000) / 1000,
      events: evs.length,
      deaths,
      latestMonth,
      latestEvent: sorted[0] ? sorted[0].date : null,
      coverage: conflict.coverage || null,
      // Each node keeps what happened: UCDP's first source headline and which outlet it came from
      // (UCDP doesn't publish article links).
      nodes: sorted.slice(0, nodes).map((e) => ({
        id: e.id, date: e.date, lat: e.lat, lon: e.lon, best: e.deaths.best, low: e.deaths.low, high: e.deaths.high, civilians: e.deaths.civilians,
        place: e.place, wp: e.wherePrec, sideA: e.sideA, sideB: e.sideB, headline: e.headline || "", office: e.office || "", sources: e.sources || 0,
      })),
      reported: [],
    });
  }
  // Attach each recent reported strike to the nearest war fought in that country (or within
  // 600 km). A strike that names a side ("US strike", "Israeli drones") leans to that side's war.
  const sideKeys = (w) => {
    const keys = new Set();
    for (const side of [...w.sides.a, ...w.sides.b]) {
      for (const part of String(side).split(/,\s*/)) {
        const m = part.match(/^Government of (.+)$/);
        if (!m) continue;
        const c = norm(plainCountry(m[1]));
        keys.add(c);
        if (c === "united states of america") { keys.add("us"); keys.add("u.s"); keys.add("american"); keys.add("united states"); }
        if (DEMONYM_OF[c]) keys.add(DEMONYM_OF[c]);
      }
    }
    return keys;
  };
  const attach = (list) => {
    for (const w of list) w.reported = [];
    for (const s of strikes || []) {
      let best = null, bd = Infinity;
      const text = norm(s.title || "");
      for (const w of list) {
        const inCountry = w.ourCountries.includes((s.iso || "").toLowerCase()) || w.countries.some((c) => norm(c) === norm(s.place));
        let d = Math.min(...w.nodes.map((n) => km(n, s)), km(w, s));
        if (!(inCountry || d <= 600)) continue;
        if (w.interstate && [...sideKeys(w)].some((k) => new RegExp(`\\b${k.replace(/[.]/g, "\\.")}\\b`).test(text))) d -= 500;
        // "Strikes in Gaza", "southern Lebanon": the war named after that place.
        const sub = norm(String(w.ucdpName || "").split(":")[1] || "").replace(/government\/?/, "").trim();
        if (sub && (SUB_KEYS[sub] || [sub]).some((k) => text.includes(k) || norm(s.place).includes(k))) d -= 1000;
        // "Houthi missiles", "Hezbollah drones": the group's war.
        if (Object.entries(ACTOR_PLACES).some(([actor, place]) => text.includes(actor) && w.countries.some((c) => norm(c) === place || norm(c).startsWith(place)))) d -= 800;
        if (d < bd) { bd = d; best = w; }
      }
      if (best && best.reported.length < 25) best.reported.push(s.id);
    }
  };
  for (const w of wars) w.interstate = w.sides.b.some((x) => /^Government of /.test(x)) && w.sides.a.some((x) => /^Government of /.test(x));
  wars.sort((a, b) => b.deaths.best - a.deaths.best);
  attach(wars);
  return wars;
}

// ---------------------------------------------------------------------------
// Reports related to a war, for its intel panel
// ---------------------------------------------------------------------------
// A report is related when it names where the war is fought (a country, a region inside it, or an
// armed group tied to it) AND uses words about fighting. Official statements come from every
// government Wire Room follows (so both sides appear when both are covered), plus trusted outlets.
const WAR_WORDS = /\b(conflict|special military operation|peace settlement|attacks?|attacked|strikes?|struck|troops|soldiers|military|army|armed forces|offensive|ceasefire|cease-fire|truce|peace (talks|deal|plan|process)|killed|casualties|missiles?|drones?|front ?line|fighting|clashes|militants?|rebels?|insurgents?|shelling|invasion|occupied|hostages?|airstrikes?|air strikes?|bombing|bombard\w*|prisoners? of war|pows?)\b/;
const DEMONYM_OF = Object.fromEntries(Object.entries(DEMONYMS).map(([d, c]) => [norm(c), d]));
const escapeRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Wars named after a place or group inside a country ("Pakistan: Balochistan") get their own
// words, so their panel isn't the same as the country's main war.
const SUB_KEYS = {
  balochistan: ["balochistan", "baluchistan", "baloch", "quetta", "bla"],
  palestine: ["palestine", "palestinian", "palestinians", "gaza", "gaza strip", "west bank", "hamas", "rafah", "khan yunis"],
  "southern lebanon": ["lebanon", "lebanese", "hezbollah", "southern lebanon", "south lebanon"],
  arakan: ["arakan", "rakhine", "arakan army"],
  amhara: ["amhara", "fano"],
  azawad: ["azawad", "kidal", "tuareg", "fla"],
  "islamic state": ["islamic state", "isis", "isil", "iswap", "daesh"],
};
const ACRONYMS_OK = new Set(["ttp", "jnim", "tplf", "iswap", "pij", "bla", "m23"]);
const SPEECH = "says?|said|slams?|condemns?|urges?|calls?|warns?|denies|rejects?|accuses?|welcomes?|demands?|hails?|praises?|backs?|supports?|critici[sz]es?|thanks?|offers?|pledges?|vows?|insists?";

export function warReports(cache, war, gaz, { now = new Date(), days = 30, maxOfficial = 20, max = 40 } = {}) {
  const keys = new Set();
  const countryKeys = new Set();
  const isos = new Set();
  const countryIso = new Map((gaz.countries || []).map(([names, , , , iso]) => [names[0], iso]));
  const sub = norm(String(war.ucdpName || "").split(":")[1] || "").replace(/government\/?/, "").trim();
  for (const c of war.countries || []) {
    const n = norm(c);
    countryKeys.add(n);
    if (DEMONYM_OF[n]) countryKeys.add(DEMONYM_OF[n]);
    if (n === "russia") countryKeys.add("russian");
    if (countryIso.get(n)) isos.add(countryIso.get(n));
  }
  for (const b of war.sides?.b || []) for (const part of String(b).split(/[/,]/)) {
    const raw = part.trim(), k = norm(raw);
    if (k === "is") { keys.add("islamic state"); continue; }
    const acronym = raw.length <= 4 && raw === raw.toUpperCase();
    if ((acronym ? ACRONYMS_OK.has(k) : k.length >= 4) && !/^(government|forces|group)\b/.test(k)) keys.add(k);
  }
  const requireCountry = sub === "islamic state"; // the group is everywhere; this war is in one country
  if (sub) for (const k of SUB_KEYS[sub] || [sub]) keys.add(k);
  else {
    for (const k of countryKeys) keys.add(k);
    for (const [names, iso] of gaz.regions || []) if (isos.has(iso)) for (const n of names) keys.add(n);
    for (const [actor, place] of Object.entries(ACTOR_PLACES)) {
      const p = (gaz.regions || []).find((r) => r[0].includes(place));
      if (countryKeys.has(place) || (p && isos.has(p[1]))) keys.add(actor);
    }
  }
  if (!keys.size) return [];
  const alt = (set) => [...set].map(escapeRe).join("|");
  const placeRe = new RegExp(`\\b(${alt(keys)})\\b`);
  const countryRe = new RegExp(`\\b(${alt(countryKeys)})\\b`);
  // "war" alone is too loose ("amid Gulf war"); it counts when tied to this war's places.
  const warRe = new RegExp(`\\b(${alt(keys)})('s)? war\\b|\\bwar (in|on|with|against|for) (the )?(${alt(keys)})\\b`);
  // "Pakistan condemns the attack on ..." names the speaker, not where the war is.
  const speakerRe = new RegExp(`\\b(${alt(keys)})('s)?( (foreign|prime|defen[cs]e) (ministry|minister))? (${SPEECH})\\b`, "g");
  const since = now.getTime() - days * 86400000;
  const official = [], independent = [];
  const seen = new Set();
  for (const [countryId, entry] of Object.entries(cache.countries || {})) {
    for (const type of ["official", "independent"]) {
      for (const it of entry[type] || []) {
        const t = Date.parse(it.publishedAt || "");
        if (!Number.isFinite(t) || t < since || t > now.getTime() + 3600000) continue;
        const text = norm(englishText(it));
        if (!(WAR_WORDS.test(text) || warRe.test(text)) || !placeRe.test(text.replace(speakerRe, " "))) continue;
        if (requireCountry && !countryRe.test(text)) continue;
        const h = norm(englishHeadline(it));
        if (seen.has(it.url) || seen.has(h)) continue;
        seen.add(it.url); seen.add(h);
        const out = {
          id: it.id, countryId, sourceType: it.sourceType || type, source: it.source, headline: it.headline,
          summary: String(it.summary || "").slice(0, 280), url: it.url || "", publishedAt: it.publishedAt, date: it.date, dateOnly: it.dateOnly,
          ...(it.tr ? { tr: { from: it.tr.from, headline: it.tr.headline, ...(it.tr.summary ? { summary: String(it.tr.summary).slice(0, 280) } : {}) } } : {}),
          t,
        };
        (type === "official" ? official : independent).push(out);
      }
    }
  }
  const byDate = (a, b) => b.t - a.t;
  official.sort(byDate);
  independent.sort(byDate);
  // Official statements: the governments fighting first, taking turns so one prolific ministry
  // doesn't crowd out the other side; then other governments' statements.
  const sides = new Set(war.ourCountries || []);
  const queues = new Map();
  for (const r of official) if (sides.has(r.countryId)) { if (!queues.has(r.countryId)) queues.set(r.countryId, []); queues.get(r.countryId).push(r); }
  const picked = [];
  while (picked.length < maxOfficial && [...queues.values()].some((q) => q.length)) for (const q of queues.values()) if (q.length && picked.length < maxOfficial) picked.push(q.shift());
  for (const r of official) { if (picked.length >= Math.min(maxOfficial, picked.length + 8) || sides.has(r.countryId)) continue; picked.push(r); }
  for (const r of independent) { if (picked.length >= max) break; picked.push(r); }
  return picked.sort(byDate).map(({ t, ...r }) => r);
}
