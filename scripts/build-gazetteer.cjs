// Builds lib/gazetteer.json, the place list the trackers use to read where an incident happened
// (see lib/incidents.mjs). Run rarely, by hand, when places need updating:
//
//   npm i --no-save all-the-cities@3 world-atlas@2 topojson-client@3 d3-geo@3 i18n-iso-countries@7
//   curl -L -o /tmp/airports.csv https://davidmegginson.github.io/ourairports-data/airports.csv
//   node scripts/build-gazetteer.cjs /tmp/airports.csv lib/gazetteer.json
//
// Sources: GeoNames cities via all-the-cities (CC BY 4.0), OurAirports large airports (public
// domain), Natural Earth countries via world-atlas (public domain). Regions and aliases below
// are hand-written.
const fs = require("fs");
const cities = require("all-the-cities");
const t = require("world-atlas/countries-50m.json");
const { feature } = require("topojson-client");
const d3 = require("d3-geo");
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[‘’ʼ`´]/g, "'").toLowerCase().trim();
const HOT = new Set("UA RU IL PS SY LB YE SD SS SO ML BF NE NG PK AF IN MM CD IQ IR ET LY CO MX HT TW KR KP PH TR EG SA AE CN JP GB FR DE".split(" "));
const out = { cities: [], airports: [], countries: [], regions: [] };
// Cities: >=100k anywhere; >=20k in countries that are often in conflict/terror/cyber news.
for (const c of cities) {
  if (!(c.population >= 100000 || (c.population >= 20000 && HOT.has(c.country)))) continue;
  const [lon, lat] = c.loc.coordinates;
  const names = [...new Set([norm(c.name), norm(c.altName)].filter((n) => n && n.length >= 3))];
  out.cities.push([names, c.country, c.population, Math.round(lon * 1000) / 1000, Math.round(lat * 1000) / 1000, c.name]);
}
// Airports: OurAirports large airports (public domain)
const lines = fs.readFileSync(process.argv[2], "utf8").split("\n");
const head = lines.shift().split(",").map((h) => h.replace(/"/g, ""));
const parseLine = (l) => { const r = []; let f = "", q = false; for (let i = 0; i < l.length; i++) { const ch = l[i]; if (q) { if (ch === '"') { if (l[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; } else if (ch === '"') q = true; else if (ch === ",") { r.push(f); f = ""; } else f += ch; } r.push(f); return r; };
for (const l of lines) {
  if (!l.includes("large_airport")) continue;
  const r = Object.fromEntries(head.map((h, i) => [h, parseLine(l)[i]]));
  if (r.type !== "large_airport") continue;
  const city = norm(r.municipality);
  const base = norm(r.name).replace(/\b(international|intl|airport|aeroport|aeropuerto|aeroporto|flughafen|regional|airfield)\b/g, " ").replace(/\s+/g, " ").trim();
  const keys = new Set();
  if (city) keys.add(city);
  if (base) keys.add(base);
  const distinct = base.replace(city, "").replace(/\s+/g, " ").trim();
  if (distinct.length >= 4) keys.add(distinct);
  for (const k of (r.keywords || "").split(",").map(norm)) if (k.length >= 4) keys.add(k);
  if (r.iata_code) keys.add(norm(r.iata_code));
  keys.delete(city); // a city name alone isn't specific enough to pick an airport
  for (const k of [...keys]) if (k.length < 3) keys.delete(k);
  out.airports.push([[...keys].filter(Boolean), city, r.iso_country, Math.round(+r.longitude_deg * 1000) / 1000, Math.round(+r.latitude_deg * 1000) / 1000, r.name]);
}
// Countries: Natural Earth (largest piece), plus common short names
const fc = feature(t, t.objects.countries);
const isoLib = require("i18n-iso-countries");
const NUM_FIX = { "Kosovo": "XK", "N. Cyprus": "CY", "Somaliland": "SO" };
const ALIAS = { "United States of America": ["united states", "u.s.", "usa", "america"], "United Kingdom": ["uk", "britain", "great britain", "england"], "Dem. Rep. Congo": ["dr congo", "drc", "democratic republic of the congo"], "Central African Rep.": ["central african republic"], "S. Sudan": ["south sudan"], "Bosnia and Herz.": ["bosnia"], "Myanmar": ["burma"], "Côte d'Ivoire": ["ivory coast", "cote d'ivoire"], "Palestine": ["palestinian territories", "west bank"], "Czechia": ["czech republic"], "Turkey": ["turkiye"], "Macedonia": ["north macedonia"], "Dominican Rep.": ["dominican republic"], "eSwatini": ["eswatini"] };
for (const f of fc.features) {
  let g = f.geometry; if (!g) continue;
  if (g.type === "MultiPolygon") { let best = null, a = -1; for (const c of g.coordinates) { const p = { type: "Polygon", coordinates: c }; const ar = d3.geoArea(p); if (ar > a) { a = ar; best = p; } } g = best; }
  const [lon, lat] = d3.geoCentroid({ type: "Feature", geometry: g });
  const names = [norm(f.properties.name), ...(ALIAS[f.properties.name] || [])];
  const iso = NUM_FIX[f.properties.name] || isoLib.numericToAlpha2(String(f.id).padStart(3, "0")) || "";
  out.countries.push([names, f.properties.name, Math.round(lon * 100) / 100, Math.round(lat * 100) / 100, iso]);
}
// A country-level marker ("drone attack in Russia", no city named) sits at the country's center of
// population (population-weighted median of its cities), not its geographic middle, which for
// Russia, Canada or Australia is far from where almost anything happens.
const wmedian = (pairs) => { const s = pairs.slice().sort((a, b) => a[0] - b[0]); const tot = s.reduce((t, p) => t + p[1], 0); let acc = 0; for (const [v, w] of s) { acc += w; if (acc >= tot / 2) return v; } return s.length ? s[s.length - 1][0] : 0; };
const byIso = new Map();
for (const c of out.cities) { if (!byIso.has(c[1])) byIso.set(c[1], []); byIso.get(c[1]).push(c); }
for (const k of out.countries) {
  const cs = byIso.get(k[4]) || [];
  if (cs.length < 3) continue;
  k[2] = Math.round(wmedian(cs.map((c) => [c[3], c[2]])) * 100) / 100;
  k[3] = Math.round(wmedian(cs.map((c) => [c[4], c[2]])) * 100) / 100;
}
// Regions and seas that often appear in conflict and shipping news (approximate centers)
out.regions = [
  [["gaza strip", "gaza"], "PS", 34.4, 31.42], [["west bank"], "PS", 35.25, 31.95], [["crimea"], "UA", 34.1, 45.3], [["donbas", "donbass"], "UA", 38.5, 48.2],
  [["donetsk region", "donetsk oblast"], "UA", 37.8, 48.0], [["kherson region"], "UA", 33.5, 46.7], [["zaporizhzhia region"], "UA", 35.8, 47.4], [["kursk region"], "RU", 36.2, 51.6],
  [["red sea"], "", 38.5, 20.0], [["black sea"], "", 34.0, 43.4], [["gulf of aden"], "", 48.0, 12.5], [["strait of hormuz"], "", 56.4, 26.6], [["south china sea"], "", 114.0, 12.0],
  [["taiwan strait"], "", 119.6, 24.3], [["kashmir"], "IN", 75.3, 34.2], [["balochistan", "baluchistan"], "PK", 65.6, 28.6], [["khyber pakhtunkhwa"], "PK", 71.8, 34.5],
  [["sinai"], "EG", 33.8, 29.5], [["darfur"], "SD", 24.0, 13.5], [["golan heights"], "IL", 35.75, 33.0], [["northern israel"], "IL", 35.3, 32.9], [["southern lebanon", "south lebanon"], "LB", 35.4, 33.25],
  [["northern ireland"], "GB", -6.7, 54.65], [["scotland"], "GB", -4.2, 56.8], [["wales"], "GB", -3.7, 52.3],
];
// Aliases for cities whose usual English spelling differs from GeoNames
out.aliases = { kiev: "kyiv", odesa: "odessa", kharkov: "kharkiv", bombay: "mumbai", "khan younis": "khan yunis", mykolayiv: "mykolaiv", "st petersburg": "saint petersburg", "st. petersburg": "saint petersburg" };
fs.writeFileSync(process.argv[3], JSON.stringify(out));
console.log("cities", out.cities.length, "airports", out.airports.length, "countries", out.countries.length, "size", fs.statSync(process.argv[3]).size);
