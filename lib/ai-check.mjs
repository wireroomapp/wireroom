// AI review of collected reports (optional: runs only when ANTHROPIC_API_KEY is set, a GitHub
// secret). A small AI model reads each report once and answers two things:
//
// 1. Relevance: is this useful to someone following government, politics, security, conflict,
//    international affairs or the national economy? Off-topic NEWS reports (sports, celebrity,
//    entertainment, lifestyle, shopping...) are hidden from the intel panels. The server keeps
//    them and a SHOW button brings them back, labeled. Official government statements are never
//    hidden: they are the government's own channel.
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

// Kept for reference: words that make a report possibly an event (the AI now reads every report).
export const AI_SIGNAL = /\b(terror\w*|bomb\w*|blast|explosi\w*|attack\w*|strikes?|struck|drones?|missiles?|rockets?|shell\w*|artillery|hack\w*|cyber\w*|ransomware|breach\w*|ddos|malware|shoot\w*|shot|gunm\w*|gunfire|killed|kills?|militants?|clash\w*|raids?|airstrikes?|hostages?|assassinat\w*|threats?|plots?|evacuat\w*|ambush\w*|insurgen\w*|offensive|downed|intercept\w*)\b/i;

export const reportKey = (it) => createHash("sha1").update(String(it.url || englishHeadline(it) || it.id || "")).digest("hex").slice(0, 16);

export const SYSTEM_PROMPT = `You review news reports for Wire Room, a public map of what governments say and what trusted outlets report about world affairs. For each report answer two questions.

1. RELEVANCE. "keep": true if the report is useful to someone following government, politics, elections, diplomacy, international relations, military and security, conflict, terrorism, crime or courts of national significance, cyber security, the national economy, trade, sanctions, energy, public health emergencies, disasters, migration or human rights. "keep": false for sports, celebrity, entertainment, TV and film, music, lifestyle, food, travel tips, fashion, shopping and product deals, horoscopes, puzzles, routine weather, local human-interest stories, and company news with no policy or national-economy angle. When unsure, keep. Give a short "topic" label of one or two words (e.g. "elections", "diplomacy", "conflict", "economy", "sports", "entertainment").

2. EVENT. "event": true only if the report describes ONE specific event that happened (or a specific threat, plot or warning):
- "terrorism": a terrorist attack, bombing, or a specific terror threat or plot (subtype "attack" or "threat").
- "cyber": a cyberattack, hack, data breach, or an official warning about an active cyber campaign (subtype "attack" or "warning").
- "military": a strike, attack, shelling, or armed clash by armed forces or armed groups, including between countries (subtype "attack").
Not events: opinion, analysis, explainers, questions, forecasts, statistics, policy, laws, court cases, arrests for old crimes, sanctions, designations, anniversaries, diplomatic statements, protests, labor strikes, general threats to strike someday, and reports about the effects of a war in general. When unsure, not an event.
For events also give: "place" (the most specific place where it happened, as written: airport, city, region, or null), "country" (where it happened, in English; not the speaker's or outlet's country), "attacker" (only if the report names or attributes it, e.g. "Russia", "Houthis"; else null), "target" (briefly, or null).

Answer with JSON only: an array with one object per report, in order. Examples:
[{"i":0,"keep":true,"topic":"conflict","event":true,"kind":"military","subtype":"attack","place":"Smolensk","country":"Russia","attacker":"Ukraine","target":"Smolensk region"},
{"i":1,"keep":true,"topic":"elections","event":false},
{"i":2,"keep":false,"topic":"sports","event":false}]`;

export function requestBody(batch, model = AI_MODEL) {
  const lines = batch.map((it, i) => JSON.stringify({ i, headline: englishHeadline(it), summary: englishSummary(it).slice(0, 300) || undefined, outlet: it.source }));
  return {
    model,
    max_tokens: 90 * batch.length + 200,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: `Reports:\n${lines.join("\n")}` }],
  };
}

const KINDS = new Set(["terrorism", "cyber", "military"]);
const SUBTYPES = new Set(["attack", "threat", "warning"]);
const str = (v, max) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

// The model's reply -> one clean verdict per report (anything malformed is dropped, not guessed).
export function parseVerdicts(text, batch, now = new Date()) {
  const out = new Map();
  const m = String(text || "").match(/\[[\s\S]*\]/);
  if (!m) return out;
  let arr;
  try { arr = JSON.parse(m[0]); } catch { return out; }
  if (!Array.isArray(arr)) return out;
  for (const v of arr) {
    if (!v || !Number.isInteger(v.i) || !batch[v.i] || typeof v.event !== "boolean") continue;
    const event = v.event && KINDS.has(v.kind);
    out.set(reportKey(batch[v.i]), {
      keep: v.keep !== false, // missing = keep
      topic: str(v.topic, 24),
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

async function callModel(batch, { apiKey, model, fetchImpl, now }) {
  const r = await fetchImpl("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(requestBody(batch, model)),
    signal: AbortSignal.timeout(90000),
  });
  if (!r.ok) {
    const hint = r.status === 401 ? " (check the API key)" : r.status === 400 ? " (check the model name or account credit)" : r.status === 429 ? " (rate limit; the rest waits for the next run)" : "";
    throw new Error(`HTTP ${r.status}${hint}`);
  }
  const data = await r.json();
  const text = (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
  return parseVerdicts(text, batch, now);
}

// Ask the model about reports with no saved answer yet, a few batches at a time. Stops at the
// first API error (the rules still cover everything), and never sends more than maxReports in one
// run (the rest waits for the next hourly run).
export async function judgeReports(reports, { apiKey, model = AI_MODEL, fetchImpl = fetch, batchSize = 25, maxReports = 900, concurrency = 3, now = new Date() } = {}) {
  const verdicts = new Map();
  const todo = reports.slice(0, maxReports);
  const batches = [];
  for (let k = 0; k < todo.length; k += batchSize) batches.push(todo.slice(k, k + batchSize));
  let error = null, calls = 0, next = 0;
  const worker = async () => {
    while (!error && next < batches.length) {
      const batch = batches[next++];
      try {
        calls++;
        for (const [key, v] of await callModel(batch, { apiKey, model, fetchImpl, now })) verdicts.set(key, v);
      } catch (e) {
        error = e.message;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker));
  return { verdicts, calls, error, skipped: Math.max(0, reports.length - todo.length) };
}

// Keep answers for reports still in the news cache (the panels show them), and recent ones.
export function pruneVerdicts(saved, now = new Date(), liveKeys = null) {
  const since = now.getTime() - KEEP_DAYS * 86400000;
  return Object.fromEntries(Object.entries(saved || {}).filter(([k, v]) => (liveKeys && liveKeys.has(k)) || Date.parse(v.at || "") >= since));
}

// The NEWS reports to hide from the intel panels: url -> topic. Official statements never.
export function hiddenReports(cache, verdicts) {
  const urls = {};
  for (const entry of Object.values(cache.countries || {})) {
    for (const it of entry.independent || []) {
      if (!it.url || it.sourceType === "official") continue;
      const v = verdicts[reportKey(it)];
      if (v && v.keep === false) urls[it.url] = v.topic || "off-topic";
    }
  }
  return urls;
}
