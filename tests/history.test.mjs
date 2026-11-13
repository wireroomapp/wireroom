import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeArchive, incidentsAsOf, snapshot, SHOW_DAYS } from "../lib/history.mjs";

const src = (url, publishedAt, headline = url, sourceType = "independent") => ({ source: `Outlet ${url}`, sourceType, headline, url, publishedAt });
const inc = (id, kind, sources, extra = {}) => ({
  id, kind, subtype: "attack", title: sources[0].headline, summary: "", place: "Kharkiv", precision: "city", iso: "UA", lat: 50, lon: 36.2,
  firstReported: sources[0].publishedAt, lastReported: sources[sources.length - 1].publishedAt, sourceCount: sources.length, officialCount: 0, sources, ...extra,
});

test("the archive keeps an incident's first id as reports come and go", () => {
  const a1 = inc("strike-aaa", "strike", [src("u1", "2026-11-01T08:00:00Z")]);
  const archive1 = mergeArchive([], [a1], new Set(["u1"]));
  // Next run: a new report joins, and the earliest one has left the news cache, so the grouping
  // names it after a different report.
  const a2 = inc("strike-bbb", "strike", [src("u1", "2026-11-01T08:00:00Z"), src("u2", "2026-11-02T09:00:00Z")]);
  const archive2 = mergeArchive(archive1, [a2], new Set(["u1", "u2"]));
  assert.equal(archive2.length, 1);
  assert.equal(archive2[0].id, "strike-aaa");
  assert.equal(archive2[0].lastReported, "2026-11-02T09:00:00Z");
  // Reports gone from the cache: the archived incident stays.
  assert.equal(mergeArchive(archive2, [], new Set()).length, 1);
  // Reports still in the cache but no longer an incident (better rules): dropped.
  assert.equal(mergeArchive(archive2, [], new Set(["u2"])).length, 0);
});

test("a day shows incidents reported in the week up to it, as known then", () => {
  const archive = [
    inc("t-old", "terrorism", [src("o1", "2026-05-10T10:00:00Z", "Bomb threat at airport")]),
    inc("t-week", "terrorism", [src("w1", "2026-11-03T10:00:00Z", "Bomb threat at station"), src("w2", "2026-11-12T10:00:00Z", "Station bomb threat: 2 arrested, death toll 0")]),
  ];
  const now = incidentsAsOf(archive, new Date("2026-11-13T12:00:00Z"));
  assert.deepEqual(now.map((i) => i.id), ["t-week"], `only the last ${SHOW_DAYS} days`);
  const may = incidentsAsOf(archive, new Date("2026-05-11T23:59:00Z"));
  assert.deepEqual(may.map((i) => i.id), ["t-old"], "a past day shows what was current then");
  const nov5 = incidentsAsOf(archive, new Date("2026-11-05T23:59:00Z"))[0];
  assert.equal(nov5.sources.length, 1, "reports published later are left out");
  assert.equal(nov5.lastReported, "2026-11-03T10:00:00.000Z");
  assert.equal(incidentsAsOf(archive, new Date("2026-11-11T00:00:00Z")).length, 0, "a week after its last report (as of then), it's gone");
});

test("conflicts drop off after 3 months without events; past days use the events known then", () => {
  const ev = (conflict, date, best = 5) => ({ id: `${conflict}-${date}`, type: 1, conflict, date, country: "Ukraine", sideA: "Government of Russia", sideB: "Government of Ukraine", deaths: { best, low: best, high: best, civilians: 0 }, lat: 48, lon: 37, place: "X", wherePrec: 1 });
  const conflict = {
    coverage: { from: "2025-10", to: "2026-09" },
    events: [
      ev("Russia - Ukraine", "2026-09-20"),
      ev("Armenia - Azerbaijan", "2026-03-02"),
    ],
  };
  const today = snapshot({ archive: [], conflict }, new Date("2026-11-13T12:00:00Z"));
  assert.deepEqual(today.wars.map((w) => w.name), ["Russia – Ukraine"], "Armenia–Azerbaijan: last event over 3 months before UCDP's latest data");
  const march = snapshot({ archive: [], conflict }, new Date("2026-03-10T23:59:00Z"));
  assert.deepEqual(march.wars.map((w) => w.name), ["Armenia – Azerbaijan"], "in March, only what had happened by then");
  // A strike reported that week keeps a quiet conflict on the map.
  const strike = inc("s1", "strike", [src("s", "2026-11-12T08:00:00Z", "Azerbaijani drone strike on Armenian border post")], { place: "Armenia", precision: "country", iso: "AM", lat: 40.2, lon: 44.5 });
  const withStrike = snapshot({ archive: [strike], conflict: { ...conflict, events: [...conflict.events, { ...ev("Armenia - Azerbaijan", "2026-03-02"), country: "Armenia", lat: 40.2, lon: 44.6, id: "aa2" }] } }, new Date("2026-11-13T12:00:00Z"));
  assert.ok(withStrike.wars.some((w) => w.name === "Armenia – Azerbaijan"));
});
