import { writeFileSync, mkdirSync } from "fs";
import { COUNTRY_INFO, fetchAllForCountry } from "../lib/feeds.mjs";

async function main() {
  console.log(`Starting feed fetch for ${Object.keys(COUNTRY_INFO).length} countries…`);
  const countries = {};

  for (const countryId of Object.keys(COUNTRY_INFO)) {
    process.stdout.write(`  ${countryId}… `);
    try {
      const result = await fetchAllForCountry(countryId);
      countries[countryId] = result;
      console.log(`official=${result.official.length} independent=${result.independent.length}`);
    } catch (err) {
      console.log(`FAILED (${err.message}) — keeping empty for this run`);
      countries[countryId] = { official: [], independent: [] };
    }
  }

  const cache = {
    generatedAt: new Date().toISOString(),
    countries,
  };

  mkdirSync("data", { recursive: true });
  writeFileSync("data/cache.json", JSON.stringify(cache, null, 2));
  console.log("Wrote data/cache.json");
}

main().catch((err) => {
  console.error("Fatal error in fetch-feeds:", err);
  process.exit(1);
});
