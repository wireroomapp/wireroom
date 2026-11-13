import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCsv, csvObjects, toConflictEvent, ucdpMonthlyVersions, buildConflict, parseAdvisory, buildAdvisories, cleanAdvisoryName } from "../lib/context.mjs";

const places = JSON.parse(readFileSync(new URL("../lib/advisory-places.json", import.meta.url), "utf-8"));

test("CSV parser handles quotes, doubled quotes and commas inside fields", () => {
  assert.deepEqual(parseCsv('a,b,c\n1,"x, ""y""",3\n'), [["a", "b", "c"], ["1", 'x, "y"', "3"]]);
  assert.deepEqual(parseCsv('a\r\n"line1\nline2"\r\n'), [["a"], ["line1\nline2"]]);
});

test("UCDP rows become events with their uncertainty kept", () => {
  const rows = csvObjects(readFileSync(new URL("./fixtures/ucdp-sample.csv", import.meta.url), "utf-8"));
  assert.equal(rows.length, 3);
  const [a, b, c] = rows.map(toConflictEvent);
  assert.equal(a.id, "642418");
  assert.equal(a.date, "2026-09-21");
  assert.deepEqual(a.deaths, { best: 28, low: 26, high: 31, civilians: 3 });
  assert.equal(a.status, "Check deaths");
  assert.equal(a.wherePrec, 4);
  assert.match(a.wherePrecText, /province only/);
  assert.equal(a.typeText, "state-based");
  assert.equal(a.sideB, "TTP");
  assert.equal(a.sources, 7);
  assert.equal(a.headline, 'A key "commander" among those killed');
  assert.equal(b.typeText, "one-sided");
  assert.equal(b.wherePrecText, "exact location");
  assert.equal(c, null, "events without coordinates are dropped");
});

test("monthly release names count back from last month, across years", () => {
  assert.deepEqual(ucdpMonthlyVersions(new Date("2026-11-12T00:00:00Z"), 3), ["26_0_10", "26_0_9", "26_0_8"]);
  assert.deepEqual(ucdpMonthlyVersions(new Date("2027-02-03T00:00:00Z"), 3), ["27_0_1", "26_0_12", "26_0_11"]);
});

test("newer releases replace older copies of the same event", () => {
  const e = (id, date, best) => ({ id, date, deaths: { best } });
  const out = buildConflict([
    { version: "26_0_9", events: [e("1", "2026-09-02", 5), e("2", "2026-09-10", 1)] },
    { version: "26_0_8", events: [e("1", "2026-08-31", 3), e("3", "2026-08-15", 2)] },
  ], new Date("2026-11-12T00:00:00Z"));
  assert.equal(out.events.length, 3);
  assert.equal(out.events.find((x) => x.id === "1").deaths.best, 5);
  assert.deepEqual(out.coverage, { from: "2026-08", to: "2026-09" });
  assert.equal(out.license, "CC BY 4.0");
  assert.equal(out.events[0].id, "2", "newest first");
});

const item = (title, content, tag = "XX") => ({
  title, content, link: "https://travel.state.gov/x", isoDate: "2026-10-23T00:00:00.000Z",
  categories: [{ _: title.split(" - ")[1], $: { domain: "Threat-Level" } }, { _: tag, $: { domain: "Country-Tag" } }],
});

test("advisories: level, risks and terrorism flag from the feed text", () => {
  const iran = parseAdvisory(item("Iran - Level 4: Do Not Travel", "Do not travel<p>to <b>Iran </b>due to the risk of <b>terrorism</b>, <b>unrest</b>, <b>kidnapping</b>, <b>arbitrary arrest</b> of U.S. citizens, and <b>wrongful detention</b>. Read the entire Travel Advisory.</p><ul><li><b>Do not travel to Iran for any reason.</b></li></ul>", "IR"), places);
  assert.equal(iran.level, 4);
  assert.equal(iran.levelText, "Do Not Travel");
  assert.deepEqual(iran.risks, ["terrorism", "unrest", "kidnapping", "arbitrary arrest", "wrongful detention"]);
  assert.equal(iran.terrorism, true);
  assert.equal(iran.code, "IR");
  assert.ok(Number.isFinite(iran.lon) && Number.isFinite(iran.lat));
  const nm = parseAdvisory(item("North Macedonia - Level 1: Exercise Normal Precautions", "<p>Exercise normal precautions in North Macedonia.</p>"), places);
  assert.equal(nm.terrorism, false);
  assert.equal(cleanAdvisoryName("Mexico Travel Advisory - Level 2: Exercise Increased Caution"), "Mexico");
});

test("only terrorism advisories are mapped; duplicates and unknown places are handled", () => {
  const items = [
    item("France - Level 2: Exercise Increased Caution", "<p>Exercise increased caution in <b>France</b> due to <b>terrorism</b> and <b>unrest</b>. Read the entire</p>"),
    item("Iceland - Level 1: Exercise Normal Precautions", "<p>Exercise normal precautions.</p>"),
    item("Tonga - Level 1: Exercise Normal Precautions", "<p>x</p>"),
    item("Tonga - Level 1: Exercise Normal Precautions", "<p>x</p>"),
    item("Atlantis - Level 3: Reconsider Travel", "<p>due to <b>terrorism</b>.</p>"),
  ];
  const out = buildAdvisories(items, places);
  assert.deepEqual(out.advisories.map((a) => a.name), ["France"]);
  assert.equal(out.countries, 3);
  assert.deepEqual(out.unplaced, ["Atlantis"]);
});

test("every State Department country name we have seen has a map position", () => {
  for (const n of ["Burma", "Gaza", "The West Bank", "Côte d’Ivoire", "Democratic Republic of the Congo", "Naoero", "Macau", "Hong Kong", "Kosovo", "South Sudan", "Tuvalu"]) {
    assert.ok(places[n], n);
  }
});
