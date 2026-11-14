import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classify, buildGeocoder, extractIncidents, buildWars, warReports, partiesFor } from "../lib/incidents.mjs";
import { reportKey, parseVerdicts, requestBody, judgeReports, hiddenReports, pruneVerdicts, needsReview, isAnswer, panelKeeps, readPanelRules, MAX_TRIES, REVIEW_VERSION } from "../lib/ai-check.mjs";
import { COUNTRY_INFO } from "../lib/feeds.mjs";

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
      ...Array.from({ length: 12 }, (_, i) => ev(100 + i, "2026-09-01", 50, { conflict: "XXX475", sideA: "XXX475", sideB: "XXX475", country: "Nigeria", lat: 9, lon: 8 })),
      // One small clash between two countries: it still gets its own marker.
      ev(900, "2026-09-20", 4, { conflict: "Australia - New Zealand", country: "Australia", sideA: "Government of Australia", sideB: "Government of New Zealand", lat: -33.9, lon: 151.2 }),
    ],
  };
  const strikes = [{ id: "s1", lat: 48.5, lon: 36.5, iso: "UA", place: "Kharkiv" }];
  const wars = buildWars(conflict, strikes);
  assert.equal(wars.length, 3, "every conflict shows, however small");
  const w = wars.find((x) => x.name === "Russia – Ukraine");
  assert.equal(w.level, "armed conflict", "UCDP: 25+ deaths is an armed conflict, 1,000+ a war");
  const small = wars.find((x) => x.name === "Australia – New Zealand");
  assert.deepEqual([small.level, small.deaths.best, small.nodes.length, small.interstate], ["armed clashes", 4, 1, true]);
  const unnamed = wars.find((x) => /^Nigeria: armed clashes, sides not yet identified/.test(x.name));
  assert.equal(unnamed.level, "armed conflict");
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

test("names who carried out a strike only when the headline does", () => {
  const by = (headline) => partiesFor({ headline });
  assert.deepEqual(by("Ukraine drone strike in Russia's Smolensk region kills 2"), ["Ukraine"]);
  assert.deepEqual(by("Russian strikes kill three in Ukraine"), ["Russia"]);
  assert.deepEqual(by("Saudi-led coalition says it shot down Houthi missiles aimed at Riyadh"), ["Houthis"]);
  assert.deepEqual(by("New Zealand missile strike on Australian naval base kills 5"), ["New Zealand"]);
  assert.deepEqual(by("Trump says US launched minor strikes on Iran"), ["United States"]);
  assert.deepEqual(by("Tehran says city in southern Iran hit by 'an enemy strike'"), [], "a target is not an attacker");
  assert.deepEqual(by("Explosion at port kills 3"), []);
});

test("a small strike between two countries becomes a marker with who did it", () => {
  const cache = { countries: { au: { official: [], independent: [
    item("nz1", "New Zealand missile strike on Australian naval base in Darwin kills 5", "2026-11-09T08:00:00Z", { source: "ABC" }),
  ] } } };
  const [i] = extractIncidents(cache, geo, { now: NOW });
  assert.deepEqual([i.kind, i.place, i.country, i.by], ["strike", "Darwin", "Australia", ["New Zealand"]]);
});

test("AI verdicts replace the rules for the reports they cover", () => {
  const explainer = item("x", "Why experts fear charities are prime targets for hackers", "2026-11-09T08:00:00Z");
  const quiet = item("y", "Officials review footage after incident at the harbour", "2026-11-09T09:00:00Z");
  const cache = { countries: { ca: { official: [], independent: [explainer, quiet] } } };
  const verdicts = new Map([
    [reportKey(explainer), { event: false }],
    [reportKey(quiet), { event: true, kind: "military", subtype: "attack", place: "Halifax", country: "Canada", attacker: "Unknown", target: "naval yard" }],
  ]);
  const out = extractIncidents(cache, geo, { now: NOW, verdicts, keyOf: reportKey });
  assert.equal(out.length, 1);
  assert.deepEqual([out[0].kind, out[0].place, out[0].by, out[0].target, out[0].checkedBy], ["strike", "Halifax", [], "naval yard", "ai"]);
});

test("reads the AI model's answers safely", () => {
  const batch = [item("a", "Drone strike hits Kharkiv", "2026-11-09T08:00:00Z"), item("b", "Why cyber matters", "2026-11-09T08:00:00Z")];
  const text = 'Here you go:\n[{"i":0,"event":true,"kind":"military","subtype":"attack","place":"Kharkiv","country":"Ukraine","attacker":"Russia","target":null},{"i":1,"event":false},{"i":7,"event":true,"kind":"cyber"}]';
  const v = parseVerdicts(text, batch, NOW);
  assert.equal(v.size, 2, "answers for reports that weren't asked about are ignored");
  assert.deepEqual(v.get(reportKey(batch[0])).attacker, "Russia");
  assert.equal(v.get(reportKey(batch[1])).event, false);
  assert.equal(parseVerdicts("not json", batch).size, 0);
  const body = requestBody(batch);
  assert.match(body.messages[0].content, /Drone strike hits Kharkiv/);
  // What this model requires: no assistant prefill, no sampling settings; low effort; room to think.
  assert.equal(body.messages[body.messages.length - 1].role, "user");
  assert.ok(!("temperature" in body) && !("top_p" in body));
  assert.deepEqual(body.output_config, { effort: "low" });
  assert.ok(body.max_tokens >= 2500);
});

test("the AI check stops on an API error and keeps going without it", async () => {
  const batch = [item("a", "Drone strike hits Kharkiv", "2026-11-09T08:00:00Z")];
  const res = await judgeReports(batch, { apiKey: "test", fetchImpl: async () => ({ ok: false, status: 401 }) });
  assert.equal(res.verdicts.size, 0);
  assert.match(res.error, /401/);
  const ok = await judgeReports(batch, { apiKey: "test", fetchImpl: async () => ({ ok: true, json: async () => ({ content: [{ type: "text", text: '[{"i":0,"event":true,"kind":"military","subtype":"attack","place":"Kharkiv","country":"Ukraine","attacker":"Russia","target":"power plant"}]' }] }) }) });
  assert.equal(ok.verdicts.size, 1);
});

test("the AI review hides off-topic news, never official statements", async () => {
  const sports = item("s", "Meet the new 'Bachelor,' a quarterback for the Washington Commanders", "2026-11-13T15:53:00Z", { source: "AP" });
  const vote = item("v", "2026 U.S. Senate Election Results", "2026-11-13T18:58:00Z", { source: "AP" });
  const gov = item("g", "President hosts the champions of the World Series", "2026-11-13T12:00:00Z", { sourceType: "official", source: "White House" });
  const reply = '[{"i":0,"keep":false,"topic":"sports","event":false},{"i":1,"keep":true,"topic":"elections","event":false},{"i":2,"keep":false,"topic":"sports","event":false}]';
  const batch = [sports, vote, gov];
  const v = parseVerdicts(reply, batch, NOW);
  assert.equal(v.get(reportKey(sports)).keep, false);
  assert.equal(v.get(reportKey(sports)).topic, "sports");
  assert.equal(v.get(reportKey(vote)).keep, true);
  const verdicts = Object.fromEntries(v);
  const cache = { countries: { us: { official: [gov], independent: [sports, vote] } } };
  assert.deepEqual(hiddenReports(cache, verdicts).urls, { [sports.url]: "sports" }, "official statements are never hidden");
  // A missing "keep" means keep.
  assert.equal(parseVerdicts('[{"i":0,"event":false}]', [vote], NOW).get(reportKey(vote)).keep, true);
});

test("saved answers last as long as their report is in the news cache", () => {
  const saved = { a: { keep: true, at: "2026-01-01T00:00:00Z" }, b: { keep: false, at: "2026-01-01T00:00:00Z" }, c: { keep: true, at: "2026-11-12T00:00:00Z" } };
  assert.deepEqual(Object.keys(pruneVerdicts(saved, NOW, new Set(["a"]))).sort(), ["a", "c"]);
});

test("the AI review works through batches a few at a time", async () => {
  const reports = Array.from({ length: 60 }, (_, i) => item(`r${i}`, `Report ${i}`, "2026-11-09T08:00:00Z"));
  let inFlight = 0, most = 0, calls = 0;
  const fetchImpl = async (url, opts) => {
    calls++; inFlight++; most = Math.max(most, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    const n = JSON.parse(opts.body).messages[0].content.split("\n").length - 1;
    return { ok: true, json: async () => ({ content: [{ type: "text", text: JSON.stringify(Array.from({ length: n }, (_, i) => ({ i, keep: true, topic: "politics", event: false }))) }] }) };
  };
  const res = await judgeReports(reports, { apiKey: "k", fetchImpl, batchSize: 25, concurrency: 2 });
  assert.equal(res.verdicts.size, 60);
  assert.equal(calls, 3);
  assert.ok(most <= 2);
});

test("a country's panel leaves out outlet reports about other countries", () => {
  const dc = item("dc", "Gunman kills one in Washington, DC", "2026-11-13T10:00:00Z", { source: "AP" });
  const both = item("b", "Iran says US strike hit Qeshm island", "2026-11-13T10:00:00Z", { source: "AP" });
  const v = parseVerdicts('[{"i":0,"keep":true,"topic":"crime","countries":["US"],"event":false},{"i":1,"keep":true,"topic":"conflict","countries":["IR","us"],"event":false}]', [dc, both], NOW);
  assert.deepEqual(v.get(reportKey(both)).countries, ["ir", "us"]);
  const cache = { countries: { ir: { official: [], independent: [dc, both] }, us: { official: [], independent: [dc] } } };
  const h = hiddenReports(cache, Object.fromEntries(v));
  assert.deepEqual(h.elsewhere, { [dc.url]: ["us"] }, "hidden from Iran's panel, kept in the US panel");
  assert.equal(needsReview({ keep: true, countries: ["us"] }), true, "answers from an older set of questions are asked again");
  assert.equal(needsReview({ v: REVIEW_VERSION, keep: true, countries: [] }), false);
});

test("reads the AI's answers whatever shape the reply takes", () => {
  const batch = Array.from({ length: 4 }, (_, i) => item(`p${i}`, `Report ${i}`, "2026-11-09T08:00:00Z"));
  const one = (i, extra = "") => `{"i":${i},"keep":true,"topic":"politics","countries":["US"],"event":false${extra}}`;
  // A clean array.
  assert.equal(parseVerdicts(`[${[0, 1, 2, 3].map((i) => one(i)).join(",")}]`, batch, NOW).size, 4);
  // One object per line, no brackets (this used to lose the whole batch).
  assert.equal(parseVerdicts([0, 1, 2, 3].map((i) => one(i)).join("\n"), batch, NOW).size, 4);
  // Markdown fences and a note with brackets and braces after the array.
  assert.equal(parseVerdicts("```json\n[" + [0, 1, 2, 3].map((i) => one(i)).join(",\n") + "]\n```\nNote: report [2] {the short one} was hard to judge.", batch, NOW).size, 4);
  // Cut off part-way: the complete answers still count.
  assert.equal(parseVerdicts(`[${one(0)},${one(1)},{"i":2,"keep":true,"topic":"poli`, batch, NOW).size, 2);
  // One broken answer doesn't take the others down.
  assert.equal(parseVerdicts(`[${one(0)},{"i":1,"keep":true,"topic":"says "hi"","event":false},${one(2)}]`, batch, NOW).size, 2);
  // Index as text, missing "event", quotes and braces inside a value.
  const odd = parseVerdicts(`[{"i":"3","keep":false,"topic":"a \\"quoted\\" {thing}","countries":["uk","XX1","US"]}]`, batch, NOW).get(reportKey(batch[3]));
  assert.deepEqual([odd.keep, odd.event, odd.countries, odd.v], [false, false, ["gb", "us"], REVIEW_VERSION]);
  // A missing countries list means "no particular country", not "ask again forever".
  const none = parseVerdicts('[{"i":0,"keep":true,"event":false}]', batch, NOW).get(reportKey(batch[0]));
  assert.deepEqual(none.countries, []);
  assert.equal(needsReview(none), false);
});

test("a report with no usable answer is retried a few times, then left to the keyword rules", async () => {
  const reports = Array.from({ length: 3 }, (_, i) => item(`q${i}`, `Report ${i}`, "2026-11-09T08:00:00Z"));
  const fetchImpl = async () => ({ ok: true, json: async () => ({ stop_reason: "end_turn", usage: { input_tokens: 900, output_tokens: 60 }, content: [{ type: "text", text: '[{"i":0,"keep":true,"topic":"x","countries":[],"event":false}] I could not judge the others.' }] }) });
  const res = await judgeReports(reports, { apiKey: "k", fetchImpl });
  assert.equal(res.verdicts.size, 1);
  assert.deepEqual(res.unanswered.sort(), [reportKey(reports[1]), reportKey(reports[2])].sort());
  assert.deepEqual(res.usage, { in: 900, out: 60 });
  assert.deepEqual([res.problems[0].asked, res.problems[0].answered, res.problems[0].stop], [3, 1, "end_turn"]);
  assert.equal(needsReview({ pending: true, tries: 1 }), true);
  assert.equal(needsReview({ pending: true, tries: MAX_TRIES }), false, "given up");
  assert.equal(isAnswer({ pending: true, tries: MAX_TRIES }), false);
  // A given-up report is never hidden and doesn't override the keyword rules.
  const cache = { countries: { us: { official: [], independent: reports } } };
  assert.deepEqual(hiddenReports(cache, { [reportKey(reports[1])]: { pending: true, tries: 3 } }).urls, {});
});

test("a rate limit is waited out once", async () => {
  const batch = [item("rl", "Report", "2026-11-09T08:00:00Z")];
  let calls = 0; const waits = [];
  const fetchImpl = async () => (++calls === 1
    ? { ok: false, status: 429, headers: { get: () => "3" } }
    : { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: '[{"i":0,"keep":true,"event":false}]' }] }) });
  const res = await judgeReports(batch, { apiKey: "k", fetchImpl, wait: async (ms) => { waits.push(ms); } });
  assert.equal(res.verdicts.size, 1);
  assert.deepEqual(waits, [3000]);
  assert.equal(res.error, null);
});

test("hand-made rules let a panel keep another country's news", () => {
  assert.equal(panelKeeps(["ir"], "il", {}), false);
  assert.equal(panelKeeps(["ir"], "il", { il: ["ir"] }), true);
  assert.equal(panelKeeps(["gb", "ir"], "il", { il: ["ir"] }), true);
  assert.equal(panelKeeps(["il"], "ir", { il: ["ir"] }), false, "one-way: Iran's panel doesn't gain Israel news");
  assert.equal(panelKeeps(["us"], "il", { il: ["ir"] }), false);
  assert.equal(panelKeeps([], "il", {}), true, "about no particular country: kept");
  assert.equal(panelKeeps(["il", "us"], "il", {}), true);
  // Messy hand edits are cleaned, never an error.
  assert.deepEqual(readPanelRules({ alsoKeep: { IL: ["IR", " lb ", "il", 7, "lebanon"], kr: "kp", "": ["us"], ua: [] } }), { il: ["ir", "lb"] });
  assert.deepEqual(readPanelRules(null), {});
  // Counted per panel: one hidden from Iran's panel, one kept in Israel's by the rule.
  const dc = item("dc2", "Gunman kills one in Washington, DC", "2026-11-13T10:00:00Z");
  const nuke = item("n", "UN agency fears Iran diverted nuclear material", "2026-11-13T10:00:00Z");
  const verdicts = { [reportKey(dc)]: { v: 2, keep: true, countries: ["us"] }, [reportKey(nuke)]: { v: 2, keep: true, countries: ["ir"] } };
  const cache = { countries: { ir: { official: [], independent: [dc, nuke] }, il: { official: [], independent: [nuke] } } };
  const h = hiddenReports(cache, verdicts, { il: ["ir"] });
  assert.deepEqual(h.stats, { offTopic: 0, elsewhere: 1, keptByRule: 1 });
  assert.deepEqual(h.elsewhere[nuke.url], ["ir"], "the server applies the rule, so the list still names it");
});

test("the rules file in the repo is valid", () => {
  const raw = JSON.parse(readFileSync(new URL("../config/panel-rules.json", import.meta.url), "utf8"));
  const rules = readPanelRules(raw);
  assert.deepEqual(Object.keys(rules).sort(), Object.keys(raw.alsoKeep).sort(), "every line was understood");
  for (const [panel, list] of Object.entries(raw.alsoKeep)) {
    assert.ok(COUNTRY_INFO[panel], `${panel} is one of Wire Room's country panels`);
    assert.deepEqual(rules[panel], list, `${panel}: 2-letter lowercase country ids`);
  }
  assert.deepEqual(rules.il, ["ir"]);
});
