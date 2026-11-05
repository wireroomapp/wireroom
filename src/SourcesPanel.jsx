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

        <p>Wire Room collects reports automatically about once an hour. Each one shows the source's own headline and opening lines (shortened), in the original language, with a link to the full original. Nothing is rewritten by AI.</p>

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

        <h3>HOW REPORTS ARE FOUND</h3>
        <ul>
          <li>Where a government publishes an RSS feed, we read it directly.</li>
          <li>Where it doesn't, we read its news pages directly, or find its pages through a Google News search limited to that government's own website.</li>
          <li>Independent reports are found through Google News searches for each listed outlet. Every report links to the original publisher.</li>
        </ul>

        <h3>LIVE LAYERS AND MAP</h3>
        <ul>
          <li><b>Military aircraft</b>: <a href="https://adsb.lol" target="_blank" rel="noreferrer">adsb.lol</a>, a volunteer ADS-B network (ODbL). Only aircraft that broadcast their position appear.</li>
          <li><b>Ships</b>: <a href="https://aisstream.io" target="_blank" rel="noreferrer">AISStream.io</a>, volunteer AIS receivers. Collected as snapshots about once an hour at 10 chokepoints. Some areas have no free coverage, and the map says so.</li>
          <li><b>Map</b>: <a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> with OpenStreetMap data; imagery from <a href="https://earthdata.nasa.gov/gibs" target="_blank" rel="noreferrer">NASA GIBS</a>; terrain from Mapzen Terrain Tiles via AWS Open Data.</li>
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
