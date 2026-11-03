// Collect a ship snapshot and save it to data/ships.json.
// Run by the hourly GitHub Action (see .github/workflows/fetch-news.yml).
// Never fails the job: if nothing is heard, the previous snapshot is kept.
//
// Local test (PowerShell):
//   $env:AISSTREAM_API_KEY = "your key"; node scripts/collect-ships.mjs
import WebSocket from "ws";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { loadConfig } from "../tracking/config.mjs";
import { collectAisSnapshot } from "../tracking/collect.mjs";

const config = loadConfig();
const file = config.snapshot.file;
const seconds = Number(process.env.SHIPS_COLLECT_SECONDS) || 150;

if (!config.ais.apiKey) {
  console.log("Ship snapshot skipped: AISSTREAM_API_KEY is not set.");
  process.exit(0);
}

console.log(`Listening to AISStream for ${seconds}s...`);
const { snapshot, status } = await collectAisSnapshot(config.ais, { WebSocketImpl: WebSocket, seconds });

if (!snapshot.vessels.length) {
  console.log(`Ship snapshot NOT updated: no ships heard (${status.lastError || "no messages"}). Keeping the previous snapshot.`);
  process.exit(0);
}

mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, JSON.stringify(snapshot));
console.log(`Saved ${snapshot.vessels.length} ships to ${file} (${status.messages} messages).`);
for (const z of snapshot.zones) console.log(`  ${z.name}: ${z.count}`);
process.exit(0);
