import { test } from "node:test";
import assert from "node:assert/strict";
import { describeSources } from "../lib/sources.mjs";
import { COUNTRY_INFO, hasVerifiedOfficialSource } from "../lib/feeds.mjs";

test("lists every country, with the same verified count the app shows", () => {
  const out = describeSources();
  assert.equal(out.totalCount, Object.keys(COUNTRY_INFO).length);
  const expected = Object.keys(COUNTRY_INFO).filter(hasVerifiedOfficialSource).length;
  assert.equal(out.verifiedCount, expected);
});

test("every verified country links to a real https government address", () => {
  for (const c of describeSources().countries) {
    if (!c.verified) {
      assert.equal(c.links.length, 0, c.id);
      assert.equal(c.status, "not-configured");
      continue;
    }
    assert.ok(c.links.length > 0, `${c.id} has no link`);
    for (const l of c.links) assert.match(l, /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}/, `${c.id}: ${l}`);
    assert.ok(c.methodLabel, c.id);
  }
});

test("uses live status and counts from the cache", () => {
  const cache = { generatedAt: "2026-11-05T08:00:00Z", countries: { us: { officialStatus: "ok", officialLastOkAt: "2026-11-05T07:57:00Z", official: [1, 2], independent: [1] } } };
  const us = describeSources(cache).countries.find((c) => c.id === "us");
  assert.equal(us.status, "ok");
  assert.equal(us.officialCount, 2);
  assert.equal(us.newsCount, 1);
  assert.equal(describeSources(cache).generatedAt, "2026-11-05T08:00:00Z");
});
