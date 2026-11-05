// Adds English translations to non-English reports in data/cache.json.
// Run by the hourly GitHub Action after fetch-feeds.mjs. Safe to run without a key:
// it then only re-attaches translations already in data/translations.json.
// Always exits 0 so a translation problem never blocks the news update.

import { readFileSync, writeFileSync } from "node:fs";
import { makeProvider, translateCache, emptyMemory } from "../lib/translate.mjs";

const CACHE_FILE = "data/cache.json";
const MEMORY_FILE = "data/translations.json";
const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);

async function main() {
  const cache = JSON.parse(readFileSync(CACHE_FILE, "utf-8"));
  let memory;
  try { memory = JSON.parse(readFileSync(MEMORY_FILE, "utf-8")); } catch { memory = emptyMemory(); }

  let provider = null;
  try {
    provider = makeProvider({
      provider: process.env.TRANSLATE_PROVIDER,
      key: (process.env.TRANSLATE_API_KEY || "").trim(),
      region: (process.env.TRANSLATE_REGION || "").trim(),
    });
  } catch (e) {
    console.log(`::warning::${e.message}`);
  }
  if (!provider) console.log("No TRANSLATE_API_KEY set: re-attaching saved translations only.");

  const { stats } = await translateCache(cache, memory, {
    provider,
    maxCharsPerRun: num(process.env.TRANSLATE_MAX_CHARS_PER_RUN, 40000),
    monthlyLimit: num(process.env.TRANSLATE_MONTHLY_LIMIT, 450000),
    maxAgeDays: num(process.env.TRANSLATE_MAX_AGE_DAYS, 14),
    log: (m) => console.log(`::warning::${m}`),
  });

  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  writeFileSync(MEMORY_FILE, JSON.stringify(memory));
  console.log(
    `Translation: ${stats.translated} newly translated (${stats.chars.toLocaleString()} characters), ` +
    `${stats.waiting} waiting (${provider ? "over this run's or month's budget" : "no key"}), ${stats.errors} failed batches. ` +
    `Month so far: ${memory.charsThisMonth.toLocaleString()} characters (${memory.provider || "no provider"}).`
  );
}

main().catch((e) => {
  console.log(`::warning::Translation step failed: ${e.message}`);
  process.exit(0);
});
