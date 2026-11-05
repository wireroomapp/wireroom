import { test } from "node:test";
import assert from "node:assert/strict";
import { createWatchdog, watchdogConfig } from "../scheduler/watchdog.mjs";

const NOW = Date.parse("2026-11-05T12:00:00Z");
const quiet = { log() {}, warn() {} };

function fakeGitHub(lastRun) {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || "GET", body: opts.body, auth: opts.headers?.Authorization });
    if (url.endsWith("/dispatches")) return { ok: true, status: 204, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ workflow_runs: lastRun ? [lastRun] : [] }) };
  };
  return { calls, fetchImpl };
}
const cfg = (extra = {}) => ({ ...watchdogConfig({ GITHUB_DISPATCH_TOKEN: "t" }), ...extra });
const minsAgo = (m) => new Date(NOW - m * 60000).toISOString();

test("does nothing without a token", async () => {
  const gh = fakeGitHub(null);
  const w = createWatchdog(watchdogConfig({}), { fetchImpl: gh.fetchImpl, now: () => NOW, log: quiet });
  await w.check();
  assert.equal(gh.calls.length, 0);
  assert.equal(w.state.enabled, false);
});

test("leaves an on-time job alone", async () => {
  const gh = fakeGitHub({ created_at: minsAgo(40), status: "completed" });
  const w = createWatchdog(cfg(), { fetchImpl: gh.fetchImpl, now: () => NOW, log: quiet });
  await w.check();
  assert.equal(gh.calls.filter((c) => c.method === "POST").length, 0);
});

test("starts an overdue job once, on main, with the token", async () => {
  const gh = fakeGitHub({ created_at: minsAgo(260), status: "completed" });
  let t = NOW;
  const w = createWatchdog(cfg(), { fetchImpl: gh.fetchImpl, now: () => t, log: quiet });
  await w.check();
  const posts = gh.calls.filter((c) => c.method === "POST");
  assert.equal(posts.length, 1);
  assert.match(posts[0].url, /\/repos\/wireroomapp\/wireroom\/actions\/workflows\/fetch-news\.yml\/dispatches$/);
  assert.deepEqual(JSON.parse(posts[0].body), { ref: "main" });
  assert.equal(posts[0].auth, "Bearer t");
  // GitHub may take a moment to list the new run: don't ask again right away.
  t += 10 * 60000;
  await w.check();
  assert.equal(gh.calls.filter((c) => c.method === "POST").length, 1);
  assert.equal(w.state.dispatches, 1);
});

test("doesn't start a second copy while one is running", async () => {
  const gh = fakeGitHub({ created_at: minsAgo(300), status: "in_progress" });
  const w = createWatchdog(cfg(), { fetchImpl: gh.fetchImpl, now: () => NOW, log: quiet });
  await w.check();
  assert.equal(gh.calls.filter((c) => c.method === "POST").length, 0);
});

test("reports errors instead of crashing", async () => {
  const w = createWatchdog(cfg(), { fetchImpl: async () => ({ ok: false, status: 401 }), now: () => NOW, log: quiet });
  const s = await w.check();
  assert.match(s.lastError, /401/);
  // never exposes the token
  assert.ok(!JSON.stringify(s).includes('"t"'));
});
