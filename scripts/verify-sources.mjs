// Temporary: check candidate sources from GitHub's servers (the build sandbox can't reach them).
import Parser from "rss-parser";
const parser = new Parser();
const H = { "User-Agent": "Mozilla/5.0 (compatible; WireRoomBot/1.0; +https://wireroom.onrender.com)", Accept: "*/*" };
const feeds = [
  ["CISA all advisories", "https://www.cisa.gov/cybersecurity-advisories/all.xml"],
  ["CISA news", "https://www.cisa.gov/news.xml"],
  ["NCSC news", "https://www.ncsc.gov.uk/api/1/services/v1/news-rss-feed.xml"],
  ["NCSC threat reports", "https://www.ncsc.gov.uk/api/1/services/v1/report-rss-feed.xml"],
  ["CCCS alerts", "https://www.cyber.gc.ca/api/cccs/rss/v1/get?feed=alerts_advisories&lang=en"],
  ["ASD guess 1", "https://www.cyber.gov.au/rss/alerts"],
  ["ASD guess 2", "https://www.cyber.gov.au/rss/advisories"],
  ["ASD guess 3", "https://www.cyber.gov.au/about-us/view-all-content/alerts-and-advisories/rss.xml"],
  ["JPCERT en", "https://www.jpcert.or.jp/english/rss/jpcert-en.rdf"],
  ["JPCERT blog", "https://blogs.jpcert.or.jp/en/atom.xml"],
  ["CERT-EU advisories", "https://cert.europa.eu/publications/security-advisories-rss"],
  ["CERT-FR alertes", "https://www.cert.ssi.gouv.fr/alerte/feed/"],
  ["CERT-In guess", "https://www.cert-in.org.in/RSS.jsp"],
  ["State Dept advisories", "https://travel.state.gov/_res/rss/TAsTWs.xml"],
];
for (const [name, url] of feeds) {
  try {
    const r = await fetch(url, { headers: H, signal: AbortSignal.timeout(15000) });
    const text = await r.text();
    let line = `== ${name} HTTP ${r.status} ${text.length}B`;
    try {
      const f = await parser.parseString(text);
      line += ` items=${f.items.length}`;
      console.log(line);
      for (const it of f.items.slice(0, 6)) console.log(`   ${(it.isoDate || it.pubDate || "").slice(0, 16)} | ${(it.title || "").slice(0, 100)} | ${(it.link || "").slice(0, 90)}`);
      if (name.startsWith("State")) {
        const cats = f.items.slice(0, 3).map((i) => JSON.stringify(i.categories));
        console.log("   categories sample:", cats.join(" ; "));
        const terror = f.items.filter((i) => /<b>\s*terrorism\s*<\/b>/i.test(i.content || "")).length;
        console.log(`   items mentioning <b>terrorism</b>: ${terror}`);
        console.log("   desc sample:", (f.items[0].content || "").slice(0, 600).replace(/\s+/g, " "));
      }
    } catch (e) { console.log(line + " parse-failed: " + e.message.slice(0, 80) + " | starts: " + text.slice(0, 120).replace(/\s+/g, " ")); }
  } catch (e) { console.log(`== ${name} FAILED ${e.message}`); }
}
// FCDO travel advice (UK) terrorism wording
for (const c of ["france", "india", "pakistan", "iceland"]) {
  try {
    const r = await fetch(`https://www.gov.uk/api/content/foreign-travel-advice/${c}`, { headers: H });
    const j = await r.json();
    const parts = j.details?.parts || [];
    const p = parts.find((x) => /safety|terror/i.test(x.slug || x.title));
    const body = (p?.body || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const m = body.match(/[^.]*terroris[^.]*\./i);
    console.log(`== FCDO ${c} HTTP ${r.status} parts=${parts.map((x) => x.slug).join(",")} | ${m ? m[0].slice(0, 200) : "(no terrorism sentence)"}`);
  } catch (e) { console.log(`== FCDO ${c} FAILED ${e.message}`); }
}
// UCDP Candidate monthly CSVs
for (const v of ["26_0_10", "26_0_9", "26_0_8"]) {
  const url = `https://ucdp.uu.se/downloads/candidateged/GEDEvent_v${v}.csv`;
  try {
    const r = await fetch(url, { headers: H, signal: AbortSignal.timeout(30000) });
    const t = r.ok ? await r.text() : "";
    const lines = t.split(/\r?\n/);
    console.log(`== UCDP ${v} HTTP ${r.status} ${t.length}B rows=${lines.length - 1}`);
    if (r.ok) { console.log("   header:", lines[0].slice(0, 900)); console.log("   row1:", lines[1].slice(0, 900)); }
  } catch (e) { console.log(`== UCDP ${v} FAILED ${e.message}`); }
}
