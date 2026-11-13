import { test } from "node:test";
import assert from "node:assert/strict";
import { topicsFor } from "../src/topics.js";

const t = (headline, extra = {}) => topicsFor({ headline, ...extra });

test("tags conflict, cyber and terrorism reports", () => {
  assert.deepEqual(t("Russian drone strikes hit Kharkiv energy grid overnight"), ["conflict"]);
  assert.deepEqual(t("Ceasefire talks stall as fighting continues in Sudan"), ["conflict"]);
  assert.deepEqual(t("CISA, FBI and Partners Warn Organizations of SafePay Ransomware Actors"), ["cyber"]);
  assert.deepEqual(t("China-linked malicious actors called out for cyber espionage"), ["cyber"]);
  assert.deepEqual(t("Suicide bombing kills 12 at checkpoint, TTP claims responsibility"), ["terrorism"]);
  assert.deepEqual(t("Islamic State claims attack on army post"), ["terrorism"]);
  assert.deepEqual(t("Militants kill soldiers in counter-terrorism operation"), ["conflict", "terrorism"]);
});

test("leaves ordinary reports untagged", () => {
  for (const h of [
    "Government wins battle over budget in parliament",
    "Inflation eases as central bank holds rates",
    "Prime Minister meets President of the European Council",
    "Senate Democrats will not let Trump put a right-winger on the Supreme Court",
    "Apple raises $7.5 billion from bond sale",
    "Hamas and Israel exchange proposals in Cairo talks", // groups aren't labeled by Wire Room
    "Farmer kidnappings expose cartel grip on rural Mexico",
  ]) assert.deepEqual(t(h), [], h);
});

test("uses the English translation and tags set at collection", () => {
  assert.deepEqual(topicsFor({ headline: "Андрій Сибіга провів зустріч", tr: { headline: "Sybiha discussed the ceasefire with partners" } }), ["conflict"]);
  assert.deepEqual(topicsFor({ headline: "NCSC scheme will help critical organisations test their defences", topics: ["cyber"] }), ["cyber"]);
  assert.deepEqual(topicsFor(null), []);
});
