// English translations of non-English reports.
//
// Runs after the hourly fetch (scripts/translate-reports.mjs). Each report is translated once;
// results are kept in data/translations.json (a "translation memory") and attached to reports
// in data/cache.json as item.tr = { from, headline, summary }. The original text is never
// changed, so the app can always show it.
//
// Providers (pick with TRANSLATE_PROVIDER, key in TRANSLATE_API_KEY):
//   deepl      DeepL API (free plan: 500,000 characters/month; free keys end in ":fx")
//   microsoft  Microsoft Translator (free tier: 2,000,000 characters/month; also set TRANSLATE_REGION)
// With no key, nothing is translated and the app shows reports as before.

import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Is this text already English? Cheap check so we don't pay to translate English.
// ---------------------------------------------------------------------------
// Words common in English headlines and rare in the other languages we collect.
const EN_WORDS = new Set([
  "the", "and", "of", "for", "with", "from", "that", "this", "will", "has", "have", "was", "were", "are",
  "says", "said", "after", "over", "its", "their", "been", "new", "minister", "ministry", "prime",
  "president", "government", "meeting", "statement", "foreign", "affairs", "talks", "visit", "between",
]);
// Short words common in Spanish, Portuguese, French, Italian, German, Polish, Indonesian and Turkish
// (words that are also English, like "in", "on", "to", "do", "no", are left out).
const FOREIGN_WORDS = new Set([
  "de", "la", "el", "los", "las", "del", "y", "en", "por", "para", "con", "que", "se", "su", "al", "una", "un",
  "da", "dos", "das", "e", "em", "com", "na", "ao", "os", "uma", "um", "le", "les", "des", "du", "et", "pour",
  "sur", "dans", "au", "aux", "une", "il", "di", "della", "delle", "dei", "per", "alla", "nel", "gli", "und",
  "der", "mit", "von", "zu", "den", "dem", "ist", "für", "auf", "im", "w", "z", "się", "oraz", "dla",
  "ze", "po", "dan", "yang", "untuk", "dengan", "ke", "dari", "ve", "ile", "bir", "için", "bu",
  "presidente", "presidenta", "ministro", "ministra", "governo", "gobierno", "sobre", "pela", "pelo", "não",
  "é", "são", "foi", "como", "mais", "más", "también", "après", "avec", "über", "nach", "bei", "przez",
]);
const ACCENTED = /[àâãäçèéêëìíîïñòóôõöùúûüßąćęłńśźżčřšžőű]/gi;
const LATIN = /[a-zA-Z\u00C0-\u024F]/;

// Is this text already English? A cheap check so we don't pay to translate English.
// When unsure, it says "English" (the report is then shown as it is, never mistranslated).
export function looksEnglish(text = "") {
  const t = String(text).replace(/\s+[-–|]\s+[^-–|]{1,60}$/, ""); // drop a trailing " - Publisher"
  const letters = t.match(/\p{L}/gu) || [];
  if (letters.length < 3) return true;
  const nonLatin = letters.filter((ch) => !LATIN.test(ch)).length;
  if (nonLatin / letters.length > 0.3) return false; // Cyrillic, Korean, Chinese, Hebrew, Arabic...
  const words = t.toLowerCase().match(/[\p{L}'-]+/gu) || [];
  const en = words.filter((w) => EN_WORDS.has(w)).length;
  const foreign = words.filter((w) => FOREIGN_WORDS.has(w)).length;
  if (foreign >= 2 && foreign > en) return false;
  const accents = (t.match(ACCENTED) || []).length;
  if (accents >= 3 && en === 0) return false;
  return true;
}

// Decide from the headline (summaries often just repeat it with the publisher's name).
export function itemLooksEnglish(item) {
  const h = String(item.headline || "").replace(/\s+[-–|]\s+[^-–|]{1,60}$/, "");
  const enough = (h.match(/\p{L}/gu) || []).length >= 12;
  return looksEnglish(enough ? h : `${item.headline || ""} ${item.summary || ""}`);
}

export function memoryKey(item) {
  return createHash("sha1").update(`${item.headline || ""}\u0000${item.summary || ""}`).digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------------------
// Providers: translate(texts) -> [{ from: "uk", text: "..." }] in the same order.
// ---------------------------------------------------------------------------
export function makeProvider({ provider, key, region, fetchImpl = globalThis.fetch }) {
  if (!key) return null;
  const name = (provider || "deepl").toLowerCase();

  if (name === "deepl") {
    // Free-style keys (ending ":fx") use api-free.deepl.com, others api.deepl.com. DeepL's plans
    // change; if the first address says "wrong endpoint" (403), try the other one once and keep it.
    const FREE = "https://api-free.deepl.com";
    const PAID = "https://api.deepl.com";
    let host = key.endsWith(":fx") ? FREE : PAID;
    let switched = false;
    return {
      name: "DeepL",
      maxBatch: 50,
      async translate(texts) {
        const call = (h) => fetchImpl(`${h}/v2/translate`, {
          method: "POST",
          headers: { Authorization: `DeepL-Auth-Key ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ text: texts, target_lang: "EN-US" }),
        });
        let r = await call(host);
        if (r.status === 403 && !switched) {
          switched = true;
          const other = host === FREE ? PAID : FREE;
          const r2 = await call(other);
          if (r2.ok) { host = other; r = r2; }
        }
        if (r.status === 456) throw new Error("DeepL HTTP 456 (character allowance used up)");
        if (!r.ok) throw new Error(`DeepL HTTP ${r.status}`);
        const data = await r.json();
        return (data.translations || []).map((t) => ({ from: String(t.detected_source_language || "").toLowerCase(), text: t.text }));
      },
    };
  }

  if (name === "microsoft" || name === "azure") {
    return {
      name: "Microsoft Translator",
      maxBatch: 50,
      async translate(texts) {
        const headers = { "Ocp-Apim-Subscription-Key": key, "Content-Type": "application/json" };
        if (region) headers["Ocp-Apim-Subscription-Region"] = region;
        const r = await fetchImpl("https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&to=en", {
          method: "POST",
          headers,
          body: JSON.stringify(texts.map((Text) => ({ Text }))),
        });
        if (!r.ok) throw new Error(`Microsoft Translator HTTP ${r.status}`);
        const data = await r.json();
        return data.map((d) => ({
          from: String(d.detectedLanguage?.language || "").toLowerCase(),
          text: d.translations?.[0]?.text || "",
        }));
      },
    };
  }

  throw new Error(`Unknown TRANSLATE_PROVIDER "${provider}" (use deepl or microsoft)`);
}

// Language codes from providers -> one short code ("pt-br" -> "pt", "zh-hans" -> "zh").
export function baseLang(code = "") {
  const c = String(code).toLowerCase();
  if (!c) return "";
  if (c === "nb" || c === "no") return "no";
  return c.split(/[-_]/)[0];
}

// ---------------------------------------------------------------------------
// The job: translate what's new (newest and official first), within a character budget,
// then attach every known translation to the cache.
// ---------------------------------------------------------------------------
export function emptyMemory() {
  return { version: 1, month: null, charsThisMonth: 0, provider: null, entries: {} };
}

function allItems(cache) {
  const out = [];
  for (const entry of Object.values(cache.countries || {})) {
    for (const kind of ["official", "independent"]) for (const it of entry[kind] || []) out.push(it);
  }
  return out;
}

export async function translateCache(cache, memory, {
  provider,
  now = new Date(),
  maxCharsPerRun = 40000,
  monthlyLimit = 450000,
  maxAgeDays = 14, // older reports stay in their original language (keeps the first month in the free tier)
  log = () => {},
} = {}) {
  const mem = memory && memory.entries ? memory : emptyMemory();
  const month = now.toISOString().slice(0, 7);
  if (mem.month !== month) { mem.month = month; mem.charsThisMonth = 0; }

  const items = allItems(cache);
  const stats = { reports: items.length, alreadyKnown: 0, english: 0, translated: 0, chars: 0, waiting: 0, tooOld: 0, errors: 0 };

  // What still needs translating: not in memory and not obviously English.
  const todo = [];
  const seen = new Set();
  for (const it of items) {
    const key = memoryKey(it);
    if (mem.entries[key] || seen.has(key)) { stats.alreadyKnown += 1; continue; }
    seen.add(key);
    if (itemLooksEnglish(it)) { stats.english += 1; continue; }
    const t = Date.parse(it.publishedAt || "");
    if (Number.isFinite(t) && now.getTime() - t > maxAgeDays * 86400000) { stats.tooOld += 1; continue; }
    todo.push({ key, it });
  }
  todo.sort((a, b) =>
    (a.it.sourceType === "official" ? 0 : 1) - (b.it.sourceType === "official" ? 0 : 1) ||
    new Date(b.it.publishedAt || 0) - new Date(a.it.publishedAt || 0));

  if (provider && todo.length) {
    const room = () => Math.min(maxCharsPerRun - stats.chars, monthlyLimit - mem.charsThisMonth);
    let batch = [];
    let batchChars = 0;
    const flush = async () => {
      if (!batch.length) return;
      const texts = [];
      for (const b of batch) { texts.push(b.it.headline || ""); texts.push(b.it.summary || ""); }
      try {
        // Empty summaries still count as a slot so results line up; send a single space.
        const res = await provider.translate(texts.map((t) => t || " "));
        batch.forEach((b, i) => {
          const h = res[i * 2] || {};
          const s = res[i * 2 + 1] || {};
          const from = baseLang(h.from || s.from);
          mem.entries[b.key] = from === "en" || !from
            ? { from: "en", at: now.toISOString() }
            : { from, h: h.text || "", s: (b.it.summary ? s.text : "") || "", at: now.toISOString() };
          if (from && from !== "en") stats.translated += 1; else stats.english += 1;
        });
        stats.chars += batchChars;
        mem.charsThisMonth += batchChars;
      } catch (e) {
        stats.errors += 1;
        log(`Translation batch failed: ${e.message}`);
      }
      batch = [];
      batchChars = 0;
    };
    for (const t of todo) {
      const chars = (t.it.headline || "").length + (t.it.summary || "").length;
      if (chars + batchChars > room()) { stats.waiting += 1; continue; } // over budget: next run
      batch.push(t);
      batchChars += chars;
      if (batch.length >= provider.maxBatch) await flush();
      if (stats.errors >= 3) break; // provider down or key wrong: stop for this run
    }
    await flush();
    mem.provider = provider.name;
  } else {
    stats.waiting = todo.length;
  }

  // Attach translations, and forget ones no longer used by any report.
  const used = new Set();
  for (const it of items) {
    const key = memoryKey(it);
    const e = mem.entries[key];
    delete it.tr;
    if (!e) continue;
    used.add(key);
    if (e.from && e.from !== "en" && e.h) it.tr = { from: e.from, headline: e.h, ...(e.s ? { summary: e.s } : {}) };
  }
  for (const key of Object.keys(mem.entries)) if (!used.has(key)) delete mem.entries[key];

  return { cache, memory: mem, stats };
}
