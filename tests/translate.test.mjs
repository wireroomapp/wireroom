import { test } from "node:test";
import assert from "node:assert/strict";
import { looksEnglish, itemLooksEnglish, translateCache, makeProvider, emptyMemory, memoryKey, baseLang } from "../lib/translate.mjs";

const NOW = new Date("2026-11-05T12:00:00Z");
const recent = "2026-11-05T08:00:00Z";

test("English check: real headlines from the cache", () => {
  // English (left alone)
  for (const h of [
    "North Carolina U.S. Senate Election Live Results 2026 - AP News",
    "Meeting with Government members - Президент России",
    "Türkiye rejects EU's 2026 report as biased, unfair - Hürriyet Daily News",
    "Abdul El-Sayed becomes first Muslim elected to US Senate - Reuters",
    "Taiwan shares close down 3.20% - Focus Taiwan",
  ]) assert.equal(itemLooksEnglish({ headline: h }), true, h);
  // Not English (translated)
  for (const h of [
    "Андрій Сибіга провів зустріч з міністром закордонних справ Румунії",
    "Plan Michoacán por la Paz y la Justicia registra un avance de 67% a un año de su implementación",
    "Presidente Lula assina MP que define alíquotas do imposto",
    "제51차 대통령 주재 수석보좌관회의 관련 강유정 수석대변인 브리핑",
    "KI als Treiber für Wachstum und Innovationen",
    "Bliskie relacje, wspólne cele. Polska i Czechy rozmawiają o współpracy",
  ]) assert.equal(itemLooksEnglish({ headline: h }), false, h);
  assert.equal(looksEnglish(""), true);
});

function fakeDeepL(map) {
  const calls = [];
  return {
    calls,
    provider: {
      name: "Fake",
      maxBatch: 50,
      async translate(texts) {
        calls.push(texts);
        return texts.map((t) => (map[t] ? { from: map[t][0], text: map[t][1] } : { from: "en", text: t }));
      },
    },
  };
}

function cacheWith(items) {
  return { generatedAt: NOW.toISOString(), countries: { ua: { official: items, independent: [] } } };
}

test("translates new non-English reports once and attaches them", async () => {
  const ua = { id: "1", sourceType: "official", headline: "Андрій Сибіга провів зустріч з міністром", summary: "Зустріч у Бухаресті", publishedAt: recent };
  const en = { id: "2", sourceType: "official", headline: "Meeting with the President of the European Council", summary: "", publishedAt: recent };
  const fake = fakeDeepL({ [ua.headline]: ["UK", "Andrii Sybiha met with the minister"], [ua.summary]: ["UK", "Meeting in Bucharest"] });
  const cache = cacheWith([ua, en]);
  const { memory, stats } = await translateCache(cache, emptyMemory(), { provider: fake.provider, now: NOW });

  assert.equal(stats.translated, 1);
  assert.equal(fake.calls.length, 1);
  assert.deepEqual(fake.calls[0], [ua.headline, ua.summary]); // the English report was never sent
  assert.deepEqual(cache.countries.ua.official[0].tr, { from: "uk", headline: "Andrii Sybiha met with the minister", summary: "Meeting in Bucharest" });
  assert.equal(cache.countries.ua.official[0].headline, ua.headline); // original kept
  assert.equal(cache.countries.ua.official[1].tr, undefined);

  // Next hour: the report is fetched again (without .tr). It's re-attached from memory, no new API call.
  const again = cacheWith([{ ...ua }, { ...en }]);
  const r2 = await translateCache(again, memory, { provider: fake.provider, now: NOW });
  assert.equal(fake.calls.length, 1);
  assert.equal(r2.stats.alreadyKnown, 1);
  assert.equal(again.countries.ua.official[0].tr.headline, "Andrii Sybiha met with the minister");
});

test("stays inside the character budget and catches up later", async () => {
  const items = Array.from({ length: 5 }, (_, i) => ({ id: String(i), sourceType: "official", headline: `Reunión número ${i} de la presidenta con el gabinete`, summary: "", publishedAt: recent }));
  const fake = fakeDeepL({});
  fake.provider.translate = async (texts) => texts.map((t) => ({ from: "es", text: `EN:${t}` }));
  const perItem = items[0].headline.length;
  const mem = emptyMemory();
  const r1 = await translateCache(cacheWith(items), mem, { provider: fake.provider, now: NOW, maxCharsPerRun: perItem * 2 });
  assert.equal(r1.stats.translated, 2);
  assert.equal(r1.stats.waiting, 3);
  const r2 = await translateCache(cacheWith(items.map((x) => ({ ...x }))), mem, { provider: fake.provider, now: NOW, maxCharsPerRun: perItem * 10 });
  assert.equal(r2.stats.translated, 3);
  assert.equal(mem.charsThisMonth, perItem * 5);
  // monthly cap
  const capped = await translateCache(cacheWith([{ id: "x", headline: "Otra reunión de la presidenta con los gobernadores", summary: "", publishedAt: recent }]), mem, { provider: fake.provider, now: NOW, monthlyLimit: perItem * 5 });
  assert.equal(capped.stats.translated, 0);
  // new month resets the counter
  const nextMonth = await translateCache(cacheWith([{ id: "x", headline: "Otra reunión de la presidenta con los gobernadores", summary: "", publishedAt: "2026-12-01T08:00:00Z" }]), mem, { provider: fake.provider, now: new Date("2026-12-01T12:00:00Z"), monthlyLimit: perItem * 5 });
  assert.equal(nextMonth.stats.translated, 1);
});

test("skips old reports and works with no key", async () => {
  const old = { id: "o", sourceType: "official", headline: "Reunión de la presidenta con el gabinete de seguridad", summary: "", publishedAt: "2026-09-01T00:00:00Z" };
  const fake = fakeDeepL({});
  const r = await translateCache(cacheWith([old]), emptyMemory(), { provider: fake.provider, now: NOW });
  assert.equal(r.stats.tooOld, 1);
  assert.equal(fake.calls.length, 0);
  const none = await translateCache(cacheWith([{ ...old, publishedAt: recent }]), emptyMemory(), { provider: null, now: NOW });
  assert.equal(none.stats.waiting, 1);
});

test("a failing provider doesn't break the run", async () => {
  const bad = { name: "Bad", maxBatch: 1, translate: async () => { throw new Error("HTTP 403"); } };
  const items = Array.from({ length: 6 }, (_, i) => ({ id: String(i), headline: `Reunión ${i} de la presidenta con el gabinete`, summary: "", publishedAt: recent }));
  const logs = [];
  const r = await translateCache(cacheWith(items), emptyMemory(), { provider: bad, now: NOW, log: (m) => logs.push(m) });
  assert.equal(r.stats.errors, 3); // stops after 3 failures
  assert.equal(r.stats.translated, 0);
  assert.match(logs[0], /403/);
});

test("DeepL and Microsoft requests are built correctly", async () => {
  const seen = [];
  const fetchImpl = async (url, opts) => {
    seen.push({ url, opts });
    if (url.includes("deepl")) return { ok: true, json: async () => ({ translations: [{ detected_source_language: "UK", text: "Hello" }] }) };
    return { ok: true, json: async () => [{ detectedLanguage: { language: "uk" }, translations: [{ text: "Hello", to: "en" }] }] };
  };
  const d = makeProvider({ provider: "deepl", key: "abc:fx", fetchImpl });
  assert.deepEqual(await d.translate(["Привіт"]), [{ from: "uk", text: "Hello" }]);
  assert.equal(seen[0].url, "https://api-free.deepl.com/v2/translate");
  assert.equal(seen[0].opts.headers.Authorization, "DeepL-Auth-Key abc:fx");
  assert.deepEqual(JSON.parse(seen[0].opts.body), { text: ["Привіт"], target_lang: "EN-US" });

  const m = makeProvider({ provider: "microsoft", key: "k", region: "westus2", fetchImpl });
  assert.deepEqual(await m.translate(["Привіт"]), [{ from: "uk", text: "Hello" }]);
  assert.match(seen[1].url, /api\.cognitive\.microsofttranslator\.com\/translate\?api-version=3\.0&to=en/);
  assert.equal(seen[1].opts.headers["Ocp-Apim-Subscription-Region"], "westus2");
  assert.deepEqual(JSON.parse(seen[1].opts.body), [{ Text: "Привіт" }]);

  assert.equal(makeProvider({ key: "" }), null);
  assert.equal(baseLang("PT-BR"), "pt");
  assert.equal(memoryKey({ headline: "a", summary: "b" }), memoryKey({ headline: "a", summary: "b" }));
});
