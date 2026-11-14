// AI review of collected reports (optional: runs only when ANTHROPIC_API_KEY is set, a GitHub
// secret). A small AI model reads each report once and answers two things:
//
// 1. Relevance: is this useful to someone following government, politics, security, conflict,
//    international affairs or the national economy? Off-topic NEWS reports (sports, celebrity,
//    entertainment, lifestyle, shopping...) are hidden from the intel panels. Nothing is deleted:
//    the server keeps them, and the review link (?review=1) shows them, labeled. Official
//    government statements are never hidden: they are the government's own channel.
//    It also names the countries a report is about, so a country's panel can leave out outlet
//    reports that only landed in its feed by search (a US shooting in Iran's panel). Exceptions
//    are set by hand, one pair at a time, in config/panel-rules.json (Israel's panel keeps news
//    about Iran).
// 2. Events (for the trackers, lib/incidents.mjs): is it a real attack, threat, hack or strike?
//    What kind, where, who did it? This replaces the keyword rules for that report.
//
// Answers are saved in data/ai-verdicts.json, so no report is paid for twice. Without a key,
// nothing here runs: keyword rules only, nothing hidden.
//
// Cost (Nov 2026, secondhand pricing for Claude Haiku 5.5: $0.10 / $0.50 per million tokens in /
// out): ~600 new reports a day, roughly $1 a month, plus well under $1 once to review the
// reports already collected.

import { createHash } from "node:crypto";
import { englishHeadline, englishSummary } from "./incidents.mjs";

export const AI_MODEL = process.env.WIREROOM_AI_MODEL || "claude-haiku-5-5";
export const KEEP_DAYS = 15;
export const REVIEW_VERSION = 3; // 2: also asks which countries a report is about. 3: links that aren't a story are off-topic
export const MAX_TRIES = 3; // a report the model gives no usable answer for is asked this often, then left to the keyword rules
// Secondhand prices (Nov 2026), dollars per million tokens, only for the cost estimate in the log.
const PRICE_IN = 0.1, PRICE_OUT = 0.5;
export const estimateCost = (usage) => ((usage.in * PRICE_IN + usage.out * PRICE_OUT) / 1e6);

// Kept for reference: words that make a report possibly an event (the AI now reads every report).
export const AI_SIGNAL = /\b(terror\w*|bomb\w*|blast|explosi\w*|attack\w*|strikes?|struck|drones?|missiles?|rockets?|shell\w*|artillery|hack\w*|cyber\w*|ransomware|breach\w*|ddos|malware|shoot\w*|shot|gunm\w*|gunfire|killed|kills?|militants?|clash\w*|raids?|airstrikes?|hostages?|assassinat\w*|threats?|plots?|evacuat\w*|ambush\w*|insurgen\w*|offensive|downed|intercept\w*)\b/i;

export const reportKey = (it) => createHash("sha1").update(String(it.url || englishHeadline(it) || it.id || "")).digest("hex").slice(0, 16);

export const SYSTEM_PROMPT = `You review news reports for Wire Room, a public map of what governments say and what trusted outlets report about world affairs. For each report answer two questions.

1. RELEVANCE. "keep": true if the report is useful to someone following government, politics, elections, diplomacy, international relations, military and security, conflict, terrorism, crime or courts of national significance, cyber security, the national economy, trade, sanctions, energy, public health emergencies, disasters, migration or human rights. "keep": false for sports, celebrity, entertainment, TV and film, music, lifestyle, food, travel tips, fashion, shopping and product deals, horoscopes, puzzles, routine weather, local human-interest stories, and company news with no policy or national-economy angle. Also "keep": false (topic "not a story") for a link that isn't a report at all: a site's homepage, a section or topic index page, or a bare title that is only a country or section name. When unsure, keep. Give a short "topic" label of one or two words (e.g. "elections", "diplomacy", "conflict", "economy", "sports", "entertainment").
Also give "countries": ISO 3166-1 alpha-2 codes (e.g. "US", "IR", "GB") of up to 4 countries the report is substantially about: where it happens, or whose government, military or people are central to it. A passing mention doesn't count. Use [] for reports about no particular country.

2. EVENT. "event": true only if the report describes ONE specific event that happened (or a specific threat, plot or warning):
- "terrorism": a terrorist attack, bombing, or a specific terror threat or plot (subtype "attack" or "threat").
- "cyber": a cyberattack, hack, data breach, or an official warning about an active cyber campaign (subtype "attack" or "warning").
- "military": a strike, attack, shelling, or armed clash by armed forces or armed groups, including between countries (subtype "attack").
Not events: opinion, analysis, explainers, questions, forecasts, statistics, policy, laws, court cases, arrests for old crimes, sanctions, designations, anniversaries, diplomatic statements, protests, labor strikes, general threats to strike someday, and reports about the effects of a war in general. When unsure, not an event.
For events also give: "place" (the most specific place where it happened, as written: airport, city, region, or null), "country" (where it happened, in English; not the speaker's or outlet's country), "attacker" (only if the report names or attributes it, e.g. "Russia", "Houthis"; else null), "target" (briefly, or null).

Answer with JSON only: an array with exactly one object per report, in order, each carrying the report's "i". No notes, no explanations, no markdown, nothing before or after the array. A report that is unclear or too short to judge still gets its object ("keep": true, "countries": [], "event": false). Examples:
[{"i":0,"keep":true,"topic":"conflict","countries":["RU","UA"],"event":true,"kind":"military","subtype":"attack","place":"Smolensk","country":"Russia","attacker":"Ukraine","target":"Smolensk region"},
{"i":1,"keep":true,"topic":"elections","countries":["US"],"event":false},
{"i":2,"keep":false,"topic":"sports","countries":["US"],"event":false}]`;

export function requestBody(batch, model = AI_MODEL) {
  const lines = batch.map((it, i) => JSON.stringify({ i, headline: englishHeadline(it), summary: englishSummary(it).slice(0, 300) || undefined, outlet: it.source }));
  return {
    model,
    max_tokens: 220 * batch.length + 600, // generous: a cut-off answer loses reports; only tokens actually written are billed
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: `Reports:\n${lines.join("\n")}` }],
  };
}

const KINDS = new Set(["terrorism", "cyber", "military"]);
const SUBTYPES = new Set(["attack", "threat", "warning"]);
const str = (v, max) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

// Every flat JSON object in the model's reply, whatever surrounds it: a clean array, one object
// per line, markdown fences, notes before or after, or an answer cut off part-way. (One strict
// JSON.parse of the whole reply lost entire batches of 25 whenever the reply had any of those.)
export function flatObjects(text) {
  const out = [];
  const t = String(text || "");
  let start = -1, inStr = false, esc = false;
  for (let k = 0; k < t.length; k++) {
    const ch = t[k];
    if (start >= 0 && inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === "{") { start = k; inStr = false; } // innermost object: a new "{" restarts it
    else if (start >= 0 && ch === '"') inStr = true;
    else if (start >= 0 && ch === "}") {
      try { const o = JSON.parse(t.slice(start, k + 1)); if (o && typeof o === "object" && !Array.isArray(o)) out.push(o); } catch { /* not JSON: skip */ }
      start = -1;
    }
  }
  return out;
}

const countryCodes = (list) => (Array.isArray(list)
  ? [...new Set(list.filter((c) => typeof c === "string" && /^[A-Za-z]{2}$/.test(c.trim())).map((c) => { const x = c.trim().toLowerCase(); return x === "uk" ? "gb" : x; }))].slice(0, 4)
  : []);

// The model's reply -> one clean verdict per report. A report with no usable answer gets none
// (it is asked again, up to MAX_TRIES); nothing is guessed.
export function parseVerdicts(text, batch, now = new Date()) {
  const out = new Map();
  for (const v of flatObjects(text)) {
    const i = typeof v.i === "number" ? v.i : /^\d+$/.test(String(v.i)) ? Number(v.i) : NaN;
    if (!Number.isInteger(i) || !batch[i]) continue;
    if (typeof v.keep !== "boolean" && typeof v.event !== "boolean") continue; // not one of our answers
    const key = reportKey(batch[i]);
    if (out.has(key)) continue;
    const event = v.event === true && KINDS.has(v.kind);
    out.set(key, {
      v: REVIEW_VERSION,
      keep: v.keep !== false, // missing = keep
      topic: str(v.topic, 24),
      countries: countryCodes(v.countries), // lowercase ids like Wire Room's ("us", "gb"); [] = no particular country
      event,
      kind: event ? v.kind : null,
      subtype: event ? (SUBTYPES.has(v.subtype) ? v.subtype : "attack") : null,
      place: event ? str(v.place, 80) : null,
      country: event ? str(v.country, 60) : null,
      attacker: event ? str(v.attacker, 60) : null,
      target: event ? str(v.target, 80) : null,
      at: now.toISOString(),
    });
  }
  return out;
}

async function callModel(batch, { apiKey, model, fetchImpl, now, wait = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const send = () => fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(requestBody(batch, model)),
    signal: AbortSignal.timeout(90000),
  });
  let r = await send();
  if (r.status === 429) { // rate limit: wait as long as the API asks (at most 30 s) and try once more
    const after = Number(r.headers?.get?.("retry-after"));
    await wait(Math.min(30, Math.max(2, Number.isFinite(after) ? after : 5)) * 1000);
    r = await send();
  }
  if (!r.ok) {
    const hint = r.status === 401 ? " (check the API key)" : r.status === 400 ? " (check the model name or account credit)" : r.status === 429 ? " (rate limit; the rest waits for the next run)" : "";
    throw new Error(`HTTP ${r.status}${hint}`);
  }
  const data = await r.json();
  const text = (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
  return {
    verdicts: parseVerdicts(text, batch, now),
    usage: { in: Number(data.usage?.input_tokens) || 0, out: Number(data.usage?.output_tokens) || 0 },
    stop: data.stop_reason || "",
    text,
  };
}

// Ask the model about reports, a few batches at a time. Stops at the first API error (the rules
// still cover everything), and never sends more than maxReports in one call (the rest waits for
// the next hourly run). Returns the answers, the keys of reports that were sent but got no usable
// answer, token usage, and a short sample of any reply that came back incomplete.
export async function judgeReports(reports, { apiKey, model = AI_MODEL, fetchImpl = fetch, batchSize = 25, maxReports = 900, concurrency = 3, now = new Date(), wait } = {}) {
  const verdicts = new Map();
  const unanswered = [];
  const problems = [];
  const usage = { in: 0, out: 0 };
  const todo = reports.slice(0, maxReports);
  const batches = [];
  for (let k = 0; k < todo.length; k += batchSize) batches.push(todo.slice(k, k + batchSize));
  let error = null, calls = 0, next = 0;
  const worker = async () => {
    while (!error && next < batches.length) {
      const batch = batches[next++];
      try {
        calls++;
        const res = await callModel(batch, { apiKey, model, fetchImpl, now, ...(wait ? { wait } : {}) });
        for (const [key, v] of res.verdicts) verdicts.set(key, v);
        usage.in += res.usage.in;
        usage.out += res.usage.out;
        const missing = [...new Set(batch.map(reportKey))].filter((k) => !res.verdicts.has(k));
        unanswered.push(...missing);
        if (missing.length) problems.push({ asked: batch.length, answered: batch.length - missing.length, stop: res.stop, head: res.text.slice(0, 160), tail: res.text.length > 160 ? res.text.slice(-160) : "" });
      } catch (e) {
        error = e.message;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker));
  return { verdicts, unanswered, problems, usage, calls, error, skipped: Math.max(0, reports.length - todo.length) };
}

// Keep answers for reports still in the news cache (the panels show them), and recent ones.
export function pruneVerdicts(saved, now = new Date(), liveKeys = null) {
  const since = now.getTime() - KEEP_DAYS * 86400000;
  return Object.fromEntries(Object.entries(saved || {}).filter(([k, v]) => (liveKeys && liveKeys.has(k)) || Date.parse(v.at || "") >= since));
}

// A saved entry is an answer, or a note that the model gave none yet ({ pending, tries }).
export const isAnswer = (v) => Boolean(v) && !v.pending;
// Ask (again) when there is no answer yet and tries remain, or the answer is from an older set of questions.
export const needsReview = (v) => !v || (v.pending ? (v.tries || 0) < MAX_TRIES : v.v !== REVIEW_VERSION);

// Is a report about `countries` one that `panel`'s country panel keeps? Yes when it is about that
// country, about no particular country, or about a country that panel's manual rule lists
// (config/panel-rules.json, alsoKeep: { "il": ["ir"] } keeps news about Iran in Israel's panel).
export function panelKeeps(countries, panel, alsoKeep = {}) {
  if (!Array.isArray(countries) || !countries.length || countries.includes(panel)) return true;
  const also = Array.isArray(alsoKeep && alsoKeep[panel]) ? alsoKeep[panel] : [];
  return countries.some((c) => also.includes(c));
}
// The manual rules, cleaned: lowercase 2-letter ids only; anything malformed is ignored.
export function readPanelRules(json) {
  const out = {};
  const src = json && typeof json === "object" && json.alsoKeep && typeof json.alsoKeep === "object" ? json.alsoKeep : {};
  for (const [panel, list] of Object.entries(src)) {
    const p = String(panel).trim().toLowerCase();
    if (!/^[a-z]{2}$/.test(p) || !Array.isArray(list)) continue;
    const ids = [...new Set(list.map((c) => String(c).trim().toLowerCase()).filter((c) => /^[a-z]{2}$/.test(c) && c !== p))];
    if (ids.length) out[p] = ids;
  }
  return out;
}

// The NEWS reports to hide from the intel panels. Official statements never.
//   urls:      url -> topic, off-topic everywhere
//   elsewhere: url -> countries it's about, for reports in a country's feed that aren't about
//              that country. The server hides these from that country's panel only (they stay in
//              the global feed), unless a manual rule keeps them: the rules are applied by the
//              server at request time, so a rule change needs no new review.
export function hiddenReports(cache, verdicts, alsoKeep = {}) {
  const urls = {}, elsewhere = {};
  const stats = { offTopic: 0, elsewhere: 0, keptByRule: 0 }; // counted per panel appearance
  for (const [cid, entry] of Object.entries(cache.countries || {})) {
    for (const it of entry.independent || []) {
      if (!it.url || it.sourceType === "official") continue;
      const v = verdicts[reportKey(it)];
      if (!isAnswer(v)) continue;
      if (v.keep === false) { urls[it.url] = v.topic || "off-topic"; stats.offTopic++; }
      else if (Array.isArray(v.countries) && v.countries.length && !v.countries.includes(cid)) {
        elsewhere[it.url] = v.countries;
        if (panelKeeps(v.countries, cid, alsoKeep)) stats.keptByRule++; else stats.elsewhere++;
      }
    }
  }
  return { urls, elsewhere, stats };
}
