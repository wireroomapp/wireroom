import {
  COUNTRY_INFO,
  INDEPENDENT_SOURCES,
  OFFICIAL_FEEDS,
  OFFICIAL_DOMAINS,
  fetchAllForCountry
} from "../lib/feeds.mjs";

const countries = Object.keys(COUNTRY_INFO);
let failures = 0;
let warnings = 0;

console.log(`WIRE ROOM FEED HEALTH CHECK — ${countries.length} countries\n`);

for (const country of countries) {
  try {
    const result = await fetchAllForCountry(country);

    const officialSources = {};
    const newsSources = {};
    const malformed = [];

    for (const item of result.official) {
      officialSources[item.source] = (officialSources[item.source] || 0) + 1;

      if (!item.headline || !item.source || !item.publishedAt || !item.url) {
        malformed.push(`OFFICIAL:${item.id || "unknown"}`);
      }
    }

    for (const item of result.independent) {
      newsSources[item.source] = (newsSources[item.source] || 0) + 1;

      if (!item.headline || !item.source || !item.publishedAt || !item.url) {
        malformed.push(`NEWS:${item.id || "unknown"}`);
      }
    }

    const hasConfiguredOfficial =
      Boolean(OFFICIAL_FEEDS[country]) ||
      Boolean(OFFICIAL_DOMAINS[country]) ||
      ["kr", "cn", "au", "in"].includes(country);

    const problems = [];

    if (result.officialVerified && result.official.length === 0) {
      problems.push("VERIFIED BUT NO OFFICIAL ITEMS");
    }

    if (!result.officialVerified && hasConfiguredOfficial) {
      problems.push("CONFIGURED OFFICIAL SOURCE BUT UNVERIFIED");
    }

    if (result.independent.length === 0) {
      problems.push("NO NEWS ITEMS");
    }

    if (malformed.length) {
      problems.push(`MALFORMED ITEMS: ${malformed.length}`);
    }

    const level =
      problems.some(p => /VERIFIED|MALFORMED|UNVERIFIED/.test(p))
        ? "FAIL"
        : problems.length
          ? "WARN"
          : "OK";

    if (level === "FAIL") failures++;
    if (level === "WARN") warnings++;

    console.log(
      `${country.toUpperCase().padEnd(3)} | ${level.padEnd(4)} | ` +
      `OFFICIAL ${String(result.official.length).padStart(3)} | ` +
      `NEWS ${String(result.independent.length).padStart(3)} | ` +
      `VERIFIED ${String(result.officialVerified).padEnd(5)}`
    );

    if (Object.keys(officialSources).length) {
      console.log(`     OFFICIAL SOURCES: ${JSON.stringify(officialSources)}`);
    }

    if (Object.keys(newsSources).length) {
      console.log(`     NEWS SOURCES: ${JSON.stringify(newsSources)}`);
    }

    if (problems.length) {
      console.log(`     ISSUES: ${problems.join(" | ")}`);
    }
  } catch (err) {
    failures++;
    console.log(
      `${country.toUpperCase().padEnd(3)} | FAIL | ERROR: ${err.message}`
    );
  }

  console.log("");
}

console.log(
  `RESULT: ${failures} failure(s), ${warnings} warning(s), ` +
  `${countries.length - failures - warnings} OK`
);

if (failures > 0) {
  process.exitCode = 1;
}
