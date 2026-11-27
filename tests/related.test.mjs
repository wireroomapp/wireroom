import test from "node:test";
import assert from "node:assert/strict";
import { relatedReports, englishHeadline } from "../lib/related.mjs";

const cache = {
  countries: {
    ua: {
      official: [
        { sourceType: "official", source: "Office of the President", headline: "Президент про удар по Харкову", tr: { from: "uk", headline: "President on the strike on Kharkiv - Official website" }, url: "https://p/1", publishedAt: "2026-11-20T10:00:00Z" },
        { sourceType: "official", source: "Office of the President", headline: "President met the foreign minister of Liberia", url: "https://p/2", publishedAt: "2026-11-20T11:00:00Z" },
      ],
      independent: [
        { sourceType: "independent", source: "Reuters", headline: "Russian drones hit Kharkiv apartment block, killing three - Reuters", url: "https://n/1", publishedAt: "2026-11-21T08:00:00Z" },
        { sourceType: "independent", source: "AP", headline: "Ukraine says drone attack killed civilians", url: "https://n/2", publishedAt: "2026-11-21T09:00:00Z" },
        { sourceType: "independent", source: "BBC", headline: "Kharkiv strike: what we know", url: "https://n/3", publishedAt: "2026-11-02T09:00:00Z" },
      ],
    },
  },
};
const opts = { countries: ["ua"], from: "2026-11-20", to: "2026-11-21", text: "Russian drone strike on Kharkiv kills three", place: "Kharkiv", skipWords: ["Ukraine", "ukrainian"] };

test("official statements and reports about the same place and dates match; unrelated ones don't", () => {
  const r = relatedReports(cache, opts);
  assert.deepEqual(r.official.map((x) => x.url), ["https://p/1"]);
  assert.deepEqual(r.news.map((x) => x.url), ["https://n/1"]);
  assert.equal(r.official[0].translatedFrom, "uk");
  assert.equal(r.official[0].headline, "President on the strike on Kharkiv");
});

test("reports outside the date window are left out", () => {
  const r = relatedReports(cache, { ...opts, from: "2026-11-10", to: "2026-11-10" });
  assert.equal(r.official.length + r.news.length, 0);
});

test("a country name alone, or only generic words, is not a match", () => {
  const r = relatedReports(cache, { ...opts, text: "Ukraine attack", place: "" });
  assert.equal(r.official.length + r.news.length, 0);
});

test("countries Wire Room doesn't follow return nothing", () => {
  const r = relatedReports(cache, { ...opts, countries: ["dk"] });
  assert.equal(r.official.length + r.news.length, 0);
});

test("englishHeadline drops the trailing outlet name", () => {
  assert.equal(englishHeadline({ headline: "Something happened - The Japan Times" }), "Something happened");
});
