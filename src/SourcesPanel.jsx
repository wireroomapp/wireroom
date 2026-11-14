import { useEffect, useState } from "react";

// SOURCES page: where every report and map layer comes from, what "verified" means,
// and what isn't covered yet. The country list comes from the backend (/api/sources),
// which builds it from the same configuration the data collector uses.

const STATUS_TEXT = {
  ok: "Working",
  empty: "Working, nothing new",
  unavailable: "Temporarily unreachable",
  "not-configured": "Not yet verified",
};

function ago(iso) {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return "";
  const min = Math.round((Date.now() - t) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} hr ago`;
  return new Date(t).toLocaleDateString();
}

function shortLink(url) {
  try { const u = new URL(url); return (u.hostname.replace(/^www\./, "") + u.pathname).replace(/\/$/, ""); } catch { return url; }
}

const CSS = `
.src-back{position:fixed;inset:0;z-index:110;background:rgba(4,9,15,.84);display:flex;align-items:flex-start;justify-content:center;padding:16px;overflow:auto}
.src-card{background:#0c1724;border:1px solid #26384d;border-top:2px solid #c9974b;max-width:760px;width:100%;padding:20px 22px;font-family:Arial,sans-serif;color:#c4cbd6;margin:24px 0}
.src-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
.src-card h2{margin:2px 0 6px;font-size:22px;letter-spacing:.02em;color:#e8e3d8}
.src-card h3{margin:20px 0 8px;font:700 10px monospace;letter-spacing:.12em;color:#4fa6a0}
.src-card p{margin:0 0 10px;font-size:13.5px;line-height:1.55}
.src-card ul{margin:0 0 10px;padding-left:18px;font-size:13px;line-height:1.55}
.src-card li{margin-bottom:5px}
.src-card a{color:#c9974b}
.src-x{background:none;border:1px solid #26384d;color:#8795a7;cursor:pointer;height:30px;min-width:30px;font-size:16px}
.src-eyebrow{font:10px monospace;letter-spacing:.12em;color:#718198}
.src-sum{font:11px monospace;color:#8795a7;margin:0 0 4px}
.src-sum b{color:#e8e3d8}
.src-list{display:flex;flex-direction:column;border-top:1px solid #1c2a3b}
.src-row{display:grid;grid-template-columns:150px 1fr auto;gap:4px 14px;padding:10px 0;border-bottom:1px solid #1c2a3b;align-items:start}
.src-name{font-weight:700;color:#e8e3d8;font-size:13.5px}
.src-badge{display:inline-block;margin-top:4px;font:9px monospace;letter-spacing:.08em;padding:2px 5px;border:1px solid}
.src-badge.ok{color:#4fa6a0;border-color:#315e5b}
.src-badge.no{color:#c9974b;border-color:#5b4a2c}
.src-badge.down{color:#ff9f43;border-color:#6b4a2a}
.src-detail{font-size:12.5px;line-height:1.5;color:#aeb8c6;min-width:0}
.src-detail .m{color:#8795a7}
.src-detail .links{font:11px monospace;overflow-wrap:anywhere}
.src-detail .meta{font:10px monospace;color:#5d6d81;margin-top:3px}
.src-open{background:none;border:1px solid #26384d;color:#aeb8c6;font:10px monospace;letter-spacing:.06em;padding:6px 9px;cursor:pointer;white-space:nowrap}
.src-open:hover{border-color:#c9974b;color:#e8e3d8}
.src-warn{font:11px monospace;color:#c9974b;margin:8px 0}
.src-fine{font:11px/1.5 monospace;color:#718198;margin-top:16px}
@media(max-width:640px){.src-back{padding:0}.src-card{margin:0;min-height:100%;border-left:0;border-right:0;padding:16px}.src-row{grid-template-columns:1fr auto}.src-detail{grid-column:1 / -1;grid-row:2}}
`;

export default function SourcesPanel({ apiBase, feedbackUrl, onClose, onOpenCountry }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`${apiBase}/api/sources`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (live) setData(d); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [apiBase]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="src-back" onClick={onClose}>
      <style>{CSS}</style>
      <div className="src-card" role="dialog" aria-label="Sources and method" onClick={(e) => e.stopPropagation()}>
        <div className="src-head">
          <div>
            <div className="src-eyebrow">SOURCES &amp; METHOD</div>
            <h2>Where every report comes from</h2>
          </div>
          <button type="button" className="src-x" onClick={onClose} aria-label="Close">×</button>
        </div>

        <p>Wire Room collects reports automatically about once an hour. Each one shows the source's own headline and opening lines (shortened), with a link to the full original. Nothing is rewritten or summarized. Reports in other languages also get a machine translation into English, clearly labeled, with the original one tap away.</p>

        <h3>HOW TO READ THE LABELS</h3>
        <ul>
          <li><b>OFFICIAL</b>: statements from a country's own government channel (head of government, foreign ministry, defense ministry).</li>
          <li><b>NEWS</b>: independent outlets that cover that country, each report linked to its publisher.</li>
          <li><b>Verified government channel</b> means we confirmed the statements come from that government. It does not mean the statements are accurate. Reading the two side by side is the point.</li>
          <li><b>Not yet verified</b> means we haven't confirmed a government channel for that country, so its OFFICIAL tab stays empty rather than guessing.</li>
        </ul>

        <h3>COUNTRIES</h3>
        {data && (
          <p className="src-sum">
            <b>{data.verifiedCount} of {data.totalCount}</b> countries have a verified government channel.
            {data.generatedAt ? ` Last collected ${ago(data.generatedAt)}.` : ""} Refresh: {String(data.refresh || "").toLowerCase()}.
          </p>
        )}
        {!data && !failed && <p className="src-sum">Loading the source list…</p>}
        {failed && <p className="src-warn">Couldn't load the live source list right now. Try again in a minute.</p>}
        {data && (
          <div className="src-list">
            {data.countries.map((c) => {
              const down = c.status === "unavailable";
              return (
                <div className="src-row" key={c.id}>
                  <div>
                    <div className="src-name">{c.name}</div>
                    <span className={`src-badge ${!c.verified ? "no" : down ? "down" : "ok"}`}>
                      {(STATUS_TEXT[c.status] || (c.verified ? "Verified" : "Not yet verified")).toUpperCase()}
                    </span>
                  </div>
                  <div className="src-detail">
                    {c.verified ? (
                      <>
                        <div><span className="m">Official: </span>{c.methodLabel}.</div>
                        <div className="links">
                          {c.links.map((l, i) => (
                            <span key={l}>{i > 0 && " · "}<a href={l} target="_blank" rel="noreferrer">{shortLink(l)}</a></span>
                          ))}
                        </div>
                      </>
                    ) : (
                      <div><span className="m">Official: </span>no verified government channel yet.</div>
                    )}
                    {c.cyber && c.cyber.length > 0 && (
                      <div><span className="m">Cyber agency: </span>{c.cyber.join(", ")}
                        {(c.cyberLinks || []).map((l) => <span key={l} className="links"> · <a href={l} target="_blank" rel="noreferrer">{shortLink(l)}</a></span>)}
                      </div>
                    )}
                    {c.outlets.length > 0 && <div><span className="m">News: </span>{c.outlets.join(", ")}</div>}
                    <div className="meta">
                      {c.officialCount} official · {c.newsCount} news reports stored
                      {c.lastOkAt ? ` · official last collected ${ago(c.lastOkAt)}` : ""}
                    </div>
                  </div>
                  <button type="button" className="src-open" onClick={() => onOpenCountry(c.id)}>OPEN</button>
                </div>
              );
            })}
          </div>
        )}

        <h3>HOW WIRE ROOM HANDLES UNCERTAINTY</h3>
        <ul>
          <li><b>Markers are reports, not verdicts.</b> A TERRORISM, CYBER or strike marker means a named source reported it. Wire Room never confirms an attack on its own; every card says who reported it, when, and how precisely the place is known.</li>
          <li><b>Claims are kept apart from reporting.</b> OFFICIAL is what a government says, NEWS is what independent outlets report, and conflict data is coded by researchers. They are shown side by side, never merged into one verdict.</li>
          <li><b>Ranges, not single numbers.</b> War casualties show UCDP's best estimate with its low–high range, and each event says how precisely its place is known.</li>
          <li><b>Accuracy over speed.</b> Verified conflict data runs 1–2 months behind. The latest reporting is in the panels, clearly marked as reporting.</li>
          <li><b>No labels of its own.</b> Terrorism markers come from reports that use words about terrorism or name groups on UN terrorism sanctions lists. Wire Room doesn't decide which groups are terrorist.</li>
        </ul>

        <h3>TRACKERS: MILITARY, TERRORISM AND CYBER</h3>
        <ul>
          <li><b>Armed conflicts</b> (MILITARY): from the <a href="https://ucdp.uu.se/downloads/" target="_blank" rel="noreferrer">UCDP Candidate Events Dataset</a>, Uppsala University (CC BY 4.0). Researchers code each event of organized violence that caused a death, from news and NGO reports. Released monthly, so it runs 1–2 months behind; events are preliminary and can be revised. Wire Room keeps about a year of releases and shows <b>every</b> state-based conflict in it, however small. Its size and label follow UCDP's definitions over that period: <b>war</b> (1,000+ battle deaths), <b>armed conflict</b> (25+), or <b>armed clashes</b> (fewer). Casualty counts are UCDP's best estimates with their low–high range. Side names are UCDP's; "sides not yet identified" means UCDP hasn't named them yet. Fights between armed groups with no government involved, and attacks on civilians, aren't shown here. Citation: Hegre, Croicu, Eck &amp; Högbladh (2020), <i>Research &amp; Politics</i>.</li>
          <li><b>Web of latest attacks</b>: solid lines go to a war's latest UCDP-verified events, each showing the headline of the report UCDP coded it from and the outlet (UCDP doesn't publish article links); dashed lines go to strikes reported in the news in the last 7 days, which nobody has verified yet. A war's totals cover only the 3 latest UCDP months, so a war that was heavier earlier (e.g. Iran vs Israel and the US, Feb–Jun 2026) looks smaller here.</li>
          <li><b>How long things stay on the map</b>: a reported strike, terrorist attack or threat, or cyberattack stays for a week after its last report. A conflict stays while it's active: at least one UCDP event in the 3 months before the day shown, or a strike reported that week. UCDP publishes 1–2 months late, so the date bar and each war card say exactly where its data ends and how many days behind that is; fighting since then shows only as strikes reported in the news.</li>
          <li><b>Past days</b>: the date bar steps back through past days and shows the map as it stood at the end of each one: incidents reported in the week up to it (only reports published by then) and conflicts active then. Every incident is archived, so past days stay viewable; the archive starts mid-2026 and fills in from there. Planes and ships are live only.</li>
          <li><b>Reported strikes, terrorism and cyber markers</b>: built every hour from the official statements and outlet reports Wire Room already collects (English translations included). A report becomes a marker only when its headline describes an event (an attack, a threat, a hack), not a law, a trial, a designation or an anniversary. The place is read from the headline: an airport, a city, a region, or else the country (shown at its center of population, and the card says so). Reports of the same event are grouped, and events at the same place share one marker with a count. "By" is who carried it out only when a report names them; otherwise it says "not named". When the optional AI check is on, a small AI model (Anthropic's Claude Haiku) also reads each attack-like report and decides whether it's a real event, where it happened and who did it; cards say when it was used. Questions, explainers and forecasts ("why experts fear…", "could Iran…?") don't count as events. These are <b>reports, not confirmed facts</b>, and the matching is automatic, so it can misplace or miss events.</li>
          <li><b>War intel panel</b>: official statements from every government Wire Room follows, plus outlet reports, from the last 30 days that name the war's places or groups and use words about fighting. It says which sides' governments have statements and which don't.</li>
          <li><b>Cyber agencies</b>: US CISA, UK NCSC and Japan JPCERT/CC statements appear in their countries' OFFICIAL reports; their warnings about active threats appear as CYBER warnings. India's CERT-In, Australia's ASD and Canada's Cyber Centre aren't connected yet.</li>
          <li><b>Travel advisories</b>: a terrorism marker's card names the <a href="https://travel.state.gov/content/travel/en/traveladvisories/traveladvisories.html" target="_blank" rel="noreferrer">U.S. State Department</a> advisory level for that country when the advisory names terrorism. One government's guidance for its travelers, not an intelligence assessment.</li>
          <li><b>Place names</b>: <a href="https://www.geonames.org" target="_blank" rel="noreferrer">GeoNames</a> (CC BY 4.0), <a href="https://ourairports.com/data/" target="_blank" rel="noreferrer">OurAirports</a> (public domain) and Natural Earth.</li>
          <li><b>Not tracked:</b> troop or drone movements in real time. No free source reports these reliably; Wire Room won't guess.</li>
        </ul>

        <h3>HOW REPORTS ARE FOUND</h3>
        <ul>
          <li>Where a government publishes an RSS feed, we read it directly.</li>
          <li>Where it doesn't, we read its news pages directly, or find its pages through a Google News search limited to that government's own website.</li>
          <li>Independent reports are found through Google News searches for each listed outlet. Every report links to the original publisher.</li>
        </ul>

        <h3>LIVE LAYERS AND MAP</h3>
        <ul>
          <li><b>Military aircraft</b>: <a href="https://adsb.lol" target="_blank" rel="noreferrer">adsb.lol</a>, a volunteer ADS-B network (ODbL). Only aircraft that broadcast their position appear.</li>
          <li><b>Ships</b>: <a href="https://aisstream.io" target="_blank" rel="noreferrer">AISStream.io</a>, volunteer AIS receivers. Collected as snapshots about once an hour in 15 outlined areas: 10 chokepoints (Hormuz, Bab el-Mandeb, Suez, Malacca, Taiwan Strait, Black Sea, Gibraltar, Panama, English Channel, Danish straits) and 5 Indian Ocean ports and passages (Mumbai, Colombo and Hambantota, Gwadar, Chittagong, Six Degree Channel). Some areas have no free coverage, and the map says so.</li>
          <li><b>Map</b>: <a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> with OpenStreetMap data; imagery from <a href="https://earthdata.nasa.gov/gibs" target="_blank" rel="noreferrer">NASA GIBS</a>; terrain from Mapzen Terrain Tiles via AWS Open Data.</li>
          <li><b>Borders</b>: drawn from OpenStreetMap, which maps the line each side actually controls. Disputed boundaries, including in Kashmir, Aksai Chin and Arunachal Pradesh, are shown as dashed amber lines. Wire Room takes no position on territorial claims.</li>
          <li><b>Your markings</b>: lines, markers, shapes and notes you draw are your own analysis. They're saved only in your browser and never change what anyone else sees. Exported images label them as the author's own.</li>
        </ul>

        <h3>KNOWN LIMITS</h3>
        <ul>
          <li>Up to 500 reports per type are kept for each country. The report filter searches those, not the whole web.</li>
          <li>Maps you draw are saved in this browser only.</li>
          <li>A source can change its website without warning. When that happens, the country shows as temporarily unreachable instead of showing nothing.</li>
        </ul>

        <p className="src-fine">
          Spotted a wrong or missing source?{" "}
          {feedbackUrl ? <a href={feedbackUrl} target="_blank" rel="noreferrer">Tell us here.</a> : "Let us know."}
        </p>
      </div>
    </div>
  );
}
