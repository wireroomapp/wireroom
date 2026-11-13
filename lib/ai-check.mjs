// Optional AI check for tracker markers (see lib/incidents.mjs).
//
// The keyword rules decide most of the time. When ANTHROPIC_API_KEY is set (a GitHub secret), each
// new report that mentions anything attack-like is also read by a small AI model, which answers:
// is this a real event (not an explainer, forecast or policy story)? what kind? where did it happen?
// who carried it out? Its answer replaces the rules for that report. Answers are saved in
// data/ai-verdicts.json so no report is paid for twice. Without a key, nothing here runs.
//
// Cost (Nov 2026, secondhand pricing for Claude Haiku 5.5: $0.10 / $0.50 per million tokens in /
// out): about 60 reports a day pass the filter, roughly $1 a month.

import { createHash } from "node:crypto";
import { englishHeadline, englishSummary } from "./incidents.mjs";

export const AI_MODEL = process.env.WIREROOM_AI_MODEL || "claude-haiku-5-5";
export const KEEP_DAYS = 15;

// Only reports that could be an event are sent: a loose net, wider than the keyword rules.
export const AI_SIGNAL = /\b(terror\w*|bomb\w*|blast|explosi\w*|attack\w*|strikes?|struck|drones?|missiles?|rockets?|shell\w*|artillery|hack\w*|cyber\w*|ransomware|breach\w*|ddos|malware|shoot\w*|shot|gunm\w*|gunfire|killed|kills?|militants?|clash\w*|raids?|airstrikes?|hostages?|assassinat\w*|threats?|plots?|evacuat\w*|ambush\w*|insurgen\w*|offensive|downed|intercept\w*)\b/i;

export const reportKey = (it) => createHash("sha1").update(String(it.url || englishHeadline(it) || it.id || "")).digest("hex").slice(0, 16);

export const SYSTEM_PROMPT = `You sort news reports for a public map of terrorism, cyberattacks and military strikes. Accuracy matters more than coverage: when unsure, say it is not an event.

For each report decide if it describes ONE specific event that happened (or a specific threat, plot or warning):
- "terrorism": a terrorist attack, bombing, or a specific terror threat or plot (subtype "attack" or "threat").
- "cyber": a cyberattack, hack, data breach, or an official warning about an active cyber campaign (subtype "attack" or "warning").
- "military": a strike, attack, shelling, or armed clash by armed forces or armed groups, including between countries (subtype "attack").
NOT events: opinion, analysis, explainers, questions, forecasts, statistics, policy, laws, court cases, arrests for old crimes, sanctions, designations, anniversaries, diplomatic statements, protests, labor strikes, general threats to strike someday, and reports about the effects of a war in general.

For events, give:
- "place": the most specific place where it happened, as written in the report (airport, city, region), or null.
- "country": the country where it happened, in English (not the country of the speaker or the outlet), or null.
- "attacker": who carried it out, only if the report names or attributes it (e.g. "Russia", "Houthis", "Islamic State"), else null. Write who the report says, not your own guess.
- "target": who or what was attacked, briefly, or null.

Answer with JSON only: an array with one object per report, in order:
[{"i":0,"event":true,"kind":"military","subtype":"attack","place":"Smolensk","country":"Russia","attacker":"Ukraine","target":"Smolensk region"}]
For non-events: {"i":1,"event":false,"kind":null,"subtype":null,"place":null,"country":null,"attacker":null,"target":null}`;

export function requestBody(batch, model = AI_MODEL) {
  const lines = batch.map((it, i) => JSON.stringify({ i, headline: englishHeadline(it), summary: englishSummary(it).slice(0, 300) || undefined, outlet: it.source }));
  return {
    model,
    max_tokens: 120 * batch.length + 200,
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

// Ask the model about reports with no saved answer yet. Stops at the first API error (the rules
// still cover everything), and never sends more than maxReports in one run.
export async function judgeReports(reports, { apiKey, model = AI_MODEL, fetchImpl = fetch, batchSize = 25, maxReports = 300, now = new Date() } = {}) {
  const verdicts = new Map();
  const todo = reports.slice(0, maxReports);
  let error = null, calls = 0;
  for (let k = 0; k < todo.length; k += batchSize) {
    const batch = todo.slice(k, k + batchSize);
    try {
      const r = await fetchImpl("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify(requestBody(batch, model)),
        signal: AbortSignal.timeout(60000),
      });
      calls++;
      if (!r.ok) { error = `HTTP ${r.status}${r.status === 401 ? " (check the API key)" : r.status === 400 ? " (check the model name or account credit)" : ""}`; break; }
      const data = await r.json();
      const text = (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
      for (const [key, v] of parseVerdicts(text, batch, now)) verdicts.set(key, v);
    } catch (e) {
      error = e.message;
      break;
    }
  }
  return { verdicts, calls, error, skipped: Math.max(0, reports.length - todo.length) };
}

// Drop saved answers older than KEEP_DAYS (their reports have left the 10-day window).
export function pruneVerdicts(saved, now = new Date()) {
  const since = now.getTime() - KEEP_DAYS * 86400000;
  return Object.fromEntries(Object.entries(saved || {}).filter(([, v]) => Date.parse(v.at || "") >= since));
}
