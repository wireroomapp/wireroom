import { test } from "node:test";
import assert from "node:assert/strict";
import { readViewFromUrl, viewToSearch } from "../src/urlState.js";

const IDS = ["us", "ua", "cn"];

test("reads a country and mode from a shared link", () => {
  assert.deepEqual(readViewFromUrl("?country=UA&mode=both", IDS), { country: "ua", mode: "both", global: false, war: null });
});

test("ignores unknown countries and modes instead of failing", () => {
  assert.deepEqual(readViewFromUrl("?country=zz&mode=lol", IDS), { country: null, mode: null, global: false, war: null });
  assert.deepEqual(readViewFromUrl("", IDS), { country: null, mode: null, global: false, war: null });
});

test("reads the global feed", () => {
  assert.equal(readViewFromUrl("?view=global", IDS).global, true);
  // a country wins over view=global
  assert.equal(readViewFromUrl("?view=global&country=us", IDS).global, false);
});

test("builds short links and leaves out the default mode", () => {
  assert.equal(viewToSearch({ country: "ua", mode: "official" }), "?country=ua");
  assert.equal(viewToSearch({ country: "ua", mode: "news" }), "?country=ua&mode=news");
  assert.equal(viewToSearch({ global: true, mode: "both" }), "?view=global&mode=both");
  assert.equal(viewToSearch({ mode: "official" }), "");
});

test("keeps unrelated parameters like the map engine", () => {
  assert.equal(viewToSearch({ country: "cn", mode: "both" }, "?engine=d3&country=us"), "?engine=d3&country=cn&mode=both");
  assert.equal(viewToSearch({}, "?engine=d3&view=global"), "?engine=d3");
});

test("round trip", () => {
  const search = viewToSearch({ country: "us", mode: "news" });
  assert.deepEqual(readViewFromUrl(search, IDS), { country: "us", mode: "news", global: false, war: null });
});

test("reads and builds war links", () => {
  assert.equal(readViewFromUrl("?war=war-russia-ukraine&mode=both", IDS).war, "war-russia-ukraine");
  assert.equal(readViewFromUrl("?war=<script>", IDS).war, null);
  assert.equal(readViewFromUrl("?war=war-x&country=us", IDS).war, null, "a country wins");
  assert.equal(viewToSearch({ war: "war-russia-ukraine", mode: "both" }, "?view=global"), "?war=war-russia-ukraine&mode=both");
});
