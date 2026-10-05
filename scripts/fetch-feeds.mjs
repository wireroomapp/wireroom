import { writeFileSync, readFileSync, mkdirSync } from "fs";
import { COUNTRY_INFO, fetchAllForCountry, hasVerifiedOfficialSource } from "../lib/feeds.mjs";

const CACHE_FILE = "data/cache.json";
const MAX_HISTORY_PER_TYPE = 500;

function loadPreviousCache() {
  try {
    return JSON.parse(readFileSync(CACHE_FILE, "utf-8"));
  } catch {
    return { generatedAt: null, countries: {} };
  }
}

// Repairs a known text-encoding glitch where "..." was saved as three odd characters.
const BAD_ELLIPSIS = "\u00e2\u20ac\u00a6";
function fixText(item) {
  const fix = (v) => (typeof v === "string" ? v.split(BAD_ELLIPSIS).join("\u2026") : v);
  return { ...item, headline: fix(item.headline), summary: fix(item.summary) };
}

function mergeHistory(existing = [], incoming = []) {
  const byId = new Map();

  for (const item of [...existing, ...incoming]) {
    if (!item || !item.id) continue;
    byId.set(item.id, fixText(item));
  }

  return [...byId.values()]
    .sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0))
    .slice(0, MAX_HISTORY_PER_TYPE);
}

async function main() {
  console.log(`Starting feed fetch for ${Object.keys(COUNTRY_INFO).length} countries...`);

  const previousCache = loadPreviousCache();
  const countries = {};

  for (const countryId of Object.keys(COUNTRY_INFO)) {
    process.stdout.write(`  ${countryId}... `);

    const previousEntry = previousCache.countries?.[countryId] || {
      official: [],
      independent: [],
      officialVerified: hasVerifiedOfficialSource(countryId),
    };

    try {
      const result = await fetchAllForCountry(countryId);

      countries[countryId] = {
        official: mergeHistory(previousEntry.official, result.official),
        independent: mergeHistory(previousEntry.independent, result.independent),
        officialVerified: result.officialVerified,
        officialStatus: result.officialStatus,
        officialLastOkAt:
          result.official.length > 0
            ? new Date().toISOString()
            : previousEntry.officialLastOkAt || null,
        officialLastError:
          result.officialErrors && result.officialErrors.length
            ? result.officialErrors[0]
            : null,
      };

      const verifiedLabel = result.officialVerified
        ? "verified-source"
        : "not-yet-verified";

      console.log(
        `new official=${result.official.length} independent=${result.independent.length} ` +
        `| cached official=${countries[countryId].official.length} ` +
        `independent=${countries[countryId].independent.length} (${verifiedLabel})`
      );
    } catch (err) {
      console.log(`FAILED (${err.message}) - keeping previous cached history`);

      countries[countryId] = {
        officialStatus: "unavailable",
        officialLastOkAt: previousEntry.officialLastOkAt || null,
        officialLastError: String(err.message).slice(0, 200),
        official: previousEntry.official || [],
        independent: previousEntry.independent || [],
        officialVerified:
          typeof previousEntry.officialVerified === "boolean"
            ? previousEntry.officialVerified
            : hasVerifiedOfficialSource(countryId),
      };
    }
  }

  console.log("\n=== Official source health ===");
  const unavailable = [];
  for (const [id, c] of Object.entries(countries)) {
    const status = c.officialStatus || "unknown";
    console.log(`${id}: ${status}` + (c.officialLastError ? ` (${c.officialLastError})` : ""));
    if (status === "unavailable") unavailable.push(id);
  }
  if (unavailable.length) {
    console.log(`::warning::Official source unavailable: ${unavailable.join(", ")}`);
  }

  const cache = {
    generatedAt: new Date().toISOString(),
    countries,
  };

  mkdirSync("data", { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));

  console.log(`Wrote ${CACHE_FILE} with historical report retention.`);
}

main().catch((err) => {
  console.error("Fatal error in fetch-feeds:", err);
  process.exit(1);
});
