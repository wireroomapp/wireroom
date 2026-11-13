import { readFileSync } from "node:fs";
import { fetchAllForCountry } from "../lib/feeds.mjs";
const c = JSON.parse(readFileSync("data/conflict.json", "utf-8"));
console.log("REPORT events", c.events.length, JSON.stringify(c.coverage), c.releases.join(","));
const byCountry = {}; for (const e of c.events) byCountry[e.country] = (byCountry[e.country] || 0) + 1;
console.log("REPORT top countries", Object.entries(byCountry).sort((a, b) => b[1] - a[1]).slice(0, 15).map((x) => x.join(":")).join(" "));
const st = {}; for (const e of c.events) st[e.status] = (st[e.status] || 0) + 1; console.log("REPORT status", JSON.stringify(st));
const a = JSON.parse(readFileSync("data/advisories.json", "utf-8"));
console.log("REPORT advisories", a.advisories.length, "of", a.countries, "unplaced", JSON.stringify(a.unplaced));
console.log("REPORT", a.advisories.slice(0, 12).map((x) => `${x.name} L${x.level} ${x.risks.join("/")}`).join(" | "));
for (const cc of ["us", "gb", "jp"]) {
  const r = await fetchAllForCountry(cc);
  const cy = r.official.filter((i) => i.agency);
  console.log("REPORT", cc, r.officialStatus, "official", r.official.length, "cyber", cy.length, cy.slice(0, 3).map((i) => `${i.source} > ${i.headline}`).join(" || "));
}
