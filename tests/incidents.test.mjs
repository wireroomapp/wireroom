import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classify, buildGeocoder, extractIncidents, buildWars, warReports } from "../lib/incidents.mjs";

const gaz = JSON.parse(readFileSync(new URL("../lib/gazetteer.json", import.meta.url), "utf8"));
const geo = buildGeocoder(gaz);
const c = (headline, extra = {}) => classify({ headline, ...extra });
const at = (text, hint = "") => {
  const p = geo.locate(text, hint);
  return p && `${p.name}|${p.kind}`;
};

test("classifies attacks, threats and hacks, not policy news", () => {
  assert.deepEqual(c("Car bomb kills Russian soldier near St Petersburg in targeted assassination"), { kind: "terrorism", subtype: "attack" });
  assert.deepEqual(c("Bomb threat forces evacuation of Gatwick airport terminal"), { kind: "terrorism", subtype: "threat" });
  assert.deepEqual(c("France accuses Iran of hacking supermarket fridges"), { kind: "cyber", subtype: "attack" });
  assert.deepEqual(c("India cybercrime agency warns financial firms of AI-driven cyberattacks"), { kind: "cyber", subtype: "warning" });
  assert.deepEqual(c("Ukraine drone strike in Russia's Smolensk region kills 2, regional governor says"), { kind: "strike", subtype: "attack" });
  assert.deepEqual(c("Exploited vulnerability in VPN appliances", { agency: "cyber" }), { kind: "cyber", subtype: "warning" });
  for (const h of [
    "EU designates group as a terrorist organisation",
    "Court jails man for terror offences",
    "Government rejects terror financing claims",
    "IDF says it struck Hezbollah terror targets", // a claim about targets, not a terror attack
    "Top tips for Cybersecurity Awareness Month",
    "New rules mandate breach reporting within 72 hours",
    "Workers strike over pay at the port",
    "Police clash with protesters after the vote",
    "Prime Minister meets President of the European Council",
  ]) assert.equal(c(h), null, h);
  assert.equal(c("Guidance for small businesses", { agency: "cyber" }), null);
  for (const h of [
    "Why experts fear Canada's not-for-profits are prime targets for hackers",
    "Can Iran attack Israel with its own Operation Spiderweb?",
    "Russia planning strikes on Ukraine's food industry, intelligence source says",
    "Trump holds off Iran strikes",
  ]) assert.equal(c(h), null, h);
  assert.deepEqual(c("Tehran says city in southern Iran hit by ‘an enemy strike’"), { kind: "strike", subtype: "attack" });
});

test("reads where it happened from the headline", () => {
  assert.equal(at("Bomb threat forces evacuation of Gatwick airport terminal"), "London Gatwick Airport|airport");
  assert.equal(at("Poland opens terror probe into deadly Krakow attack"), "Kraków|city");
  assert.equal(at("Russian colonel killed in St. Petersburg car bombing, three months after another attack"), "Saint Petersburg|city");
  assert.equal(at("Houthi rebels say at least 44 killed in airstrike near Yemeni capital"), "Yemen|country");
  assert.equal(at("Ukraine drone strike in Russia's Smolensk region kills 2"), "Smolensk|city");
  assert.equal(at("Zelensky confirms Ukrainian hackers breached Russia’s emergency alert app in retaliation for earlier attack on Ukraine’s warning system"), "Russia|country");
  assert.equal(at("Moscow says Ukraine launched drones at Belgorod overnight"), "Belgorod|city");
  assert.equal(at("Explosion reported in Belfast, Northern Ireland"), "Belfast|city");
  assert.notEqual(at("Strikes on bridges along the Dnipro River"), "Dnipro|city", "a river is not its city");
  assert.equal(at("Zelensky says Russia is trying to divide Ukraine along the Dnipro River with strikes on bridges"), "Ukraine|country");
  assert.equal(at("Ukraine strikes Russia's second-largest oil refinery in overnight drone attack"), "Russia|country");
  assert.equal(at("France accuses Iran of hacking supermarket fridges"), "France|country");
  // Names that are usually something else, or no place at all.
  assert.equal(at("Europe hit by fresh wave of bomb threats targeting flights"), null);
  assert.equal(at("Trump says talks will continue"), null);
});

const NOW = new Date("2026-11-10T12:00:00Z");
const item = (id, headline, publishedAt, extra = {}) => ({ id, headline, summary: "", url: `https://example.com/${id}`, publishedAt, source: extra.source || "Outlet", sourceType: extra.sourceType || "independent", ...extra });

test("groups reports of the same event and drops guesses", () => {
  const cache = {
    countries: {
      gb: {
        official: [item("o1", "Statement on the suspicious package incident", "2026-11-09T09:00:00Z", { sourceType: "official", source: "Home Office" })],
        independent: [
          item("a", "Bomb threat forces evacuation of Gatwick airport terminal", "2026-11-09T08:00:00Z", { source: "BBC" }),
          item("b", "Gatwick airport evacuated after bomb threat, flights delayed", "2026-11-09T10:30:00Z", { source: "Reuters" }),
          item("c", "Flights halted at Gatwick airport as police investigate bomb threat", "2026-11-09T11:30:00Z", { source: "Sky" }),
          item("old", "Bomb threat at Heathrow airport", "2026-10-01T08:00:00Z"),
          item("noplace", "Bomb threat emails sent to dozens of schools", "2026-11-09T12:00:00Z"),
        ],
      },
    },
  };
  const out = extractIncidents(cache, geo, { now: NOW });
  const gatwick = out.find((i) => i.precision === "airport");
  assert.equal(gatwick.place, "London Gatwick Airport");
  assert.equal(gatwick.kind, "terrorism");
  assert.equal(gatwick.subtype, "threat");
  assert.equal(gatwick.sourceCount, 3);
  assert.equal(gatwick.sources.length, 3);
  assert.ok(!out.some((i) => /Heathrow/.test(i.title)), "older than the window");
  assert.equal(out.filter((i) => i.precision === "airport").length, 1, "differently worded reports of one event are grouped");
  assert.ok(!out.some((i) => /schools/.test(i.title)), "an outlet's report with no place is left off the map");
});

test("summarizes wars from UCDP events", () => {
  const ev = (id, date, best, extra = {}) => ({ id, date, lat: 48 + id / 100, lon: 37, type: 1, conflict: "Russia - Ukraine", country: "Ukraine", sideA: "Government of Russia", sideB: "Government of Ukraine", deaths: { best, low: best, high: best + 1, civilians: 0 }, place: `Place ${id}`, wherePrec: 1, ...extra });
  const conflict = {
    coverage: { from: "2026-08", to: "2026-09" },
    events: [
      ...Array.from({ length: 12 }, (_, i) => ev(i, i < 6 ? "2026-08-10" : "2026-09-12", 10)),
      ...Array.from({ length: 12 }, (_, i) => ev(100 + i, "2026-09-01", 50, { conflict: "XXX475 - Government", sideB: "XXX475" })),
    ],
  };
  const strikes = [{ id: "s1", lat: 48.5, lon: 36.5, iso: "UA", place: "Kharkiv" }];
  const wars = buildWars(conflict, strikes);
  assert.equal(wars.length, 1, "placeholder actors are skipped");
  const w = wars[0];
  assert.equal(w.name, "Russia – Ukraine");
  assert.equal(w.deaths.best, 120);
  assert.deepEqual([w.latestMonth.month, w.latestMonth.best, w.latestMonth.events], ["2026-09", 60, 6]);
  assert.deepEqual(w.ourCountries.sort(), ["ru", "ua"]);
  assert.deepEqual(w.reported, ["s1"]);
  assert.equal(w.nodes[0].date, "2026-09-12");
});

test("finds reports about a war from both sides, not ones that only mention a speaker", () => {
  const war = { ucdpName: "Russia - Ukraine", countries: ["Ukraine", "Russia"], sides: { a: ["Government of Russia"], b: ["Government of Ukraine"] }, ourCountries: ["ua", "ru"] };
  const cache = {
    countries: {
      ua: { official: [item("u1", "Russian missile strike on Kyiv kills 3", "2026-11-09T08:00:00Z", { sourceType: "official" })], independent: [] },
      ru: { official: [item("r1", "Defence ministry: air defences shot down 40 Ukrainian drones", "2026-11-09T07:00:00Z", { sourceType: "official" })], independent: [item("n1", "Ukraine war latest: talks resume", "2026-11-08T07:00:00Z")] },
      pk: { official: [], independent: [item("p1", "Pakistan condemns attack on Saudi oil facility", "2026-11-09T07:00:00Z")] },
      us: { official: [item("x1", "Ukraine says it welcomes new aid", "2026-11-09T07:00:00Z", { sourceType: "official" })], independent: [] },
    },
  };
  const got = warReports(cache, war, gaz, { now: NOW }).map((r) => r.id);
  assert.deepEqual(got.sort(), ["n1", "r1", "u1"]);
});
