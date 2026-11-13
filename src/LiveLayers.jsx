import React, { memo } from "react";
import { AIRCRAFT_COLOR, SHIP_LEGEND, shipColor, aircraftPath, shipPaths, timeAgo, iconScale } from "./trackingGeo.js";
import { TRACKER_COLORS, TRACKER_CREDITS, coverageLabel } from "./contextData.js";

// ---------------------------------------------------------------------------
// Drawn inside the map's zoomed <g>. Pointer events are off: taps are matched
// to the nearest aircraft/ship in App.jsx (hitTest), which keeps the layer to a
// handful of DOM nodes even with thousands of positions.
// ---------------------------------------------------------------------------
export const TrackLayerSvg = memo(function TrackLayerSvg({ aircraft, ships, k, selected }) {
  const air = aircraft.length ? aircraftPath(aircraft, k) : "";
  const sea = ships.length ? shipPaths(ships, k) : [];
  const strokeW = (0.7 * Math.min(1.6, iconScale(k))) / k;
  return (
    <g className="tracks" pointerEvents="none">
      {sea.map(({ color, d }) => (
        <path key={color} d={d} fill={color} fillOpacity=".9" stroke="#071019" strokeWidth={strokeW} />
      ))}
      {air && <path d={air} fill={AIRCRAFT_COLOR} stroke="#071019" strokeWidth={strokeW} />}
      {selected && (
        <circle cx={selected.x} cy={selected.y} r={(5 + 5 * iconScale(k)) / k} fill="none" stroke="#fff" strokeWidth={1.8 / k} />
      )}
    </g>
  );
});

// ---------------------------------------------------------------------------
// Outlines of the areas the ship feed watches, with live counts. Areas with no
// ships say so, so an empty sea looks deliberate rather than broken.
// ---------------------------------------------------------------------------
const ZONE_SHOW = new Set(["ok", "warming", "stale"]);

export const ZoneOutlines = memo(function ZoneOutlines({ zones, k, status, width = 1200 }) {
  if (!zones.length || !ZONE_SHOW.has(status)) return null;
  const waiting = status === "warming";
  const fs = 9 / k;
  return (
    <g className="ship-zones" pointerEvents="none">
      {zones.map((z) => {
        const empty = z.count === 0;
        const color = empty ? "#c9974b" : "#4e6076";
        const text = empty
          ? `${z.name.toUpperCase()} · ${waiting ? "WAITING FOR DATA" : "NO FREE COVERAGE"}`
          : `${z.name.toUpperCase()} · ${z.count.toLocaleString()}`;
        // Labels only once the map is wide enough on screen that they don't pile up (phones need to zoom in).
        const showLabel = width * k >= (empty ? 1100 : 2400);
        return (
          <g key={z.name} data-zone={z.name}>
            <path d={z.d} fill={empty ? "rgba(201,151,75,.06)" : "none"} stroke={color}
              strokeWidth={1 / k} strokeDasharray={`${4 / k} ${3 / k}`} strokeOpacity=".9" />
            {showLabel && (
              <text x={z.lx} y={z.ly - 4 / k} fontSize={fs} fontFamily="monospace" letterSpacing={0.6 / k}
                fill={empty ? "#c9974b" : "#8795a7"} paintOrder="stroke" stroke="#071019" strokeWidth={3 / k}>
                {text}
              </text>
            )}
          </g>
        );
      })}
    </g>
  );
});

// ---------------------------------------------------------------------------
// Toggle box (bottom-left of the map)
// ---------------------------------------------------------------------------
const PROBLEM_TEXT = {
  unavailable: "Live feed unavailable right now.",
  stale: "Feed has gone quiet. Positions may be out of date.",
  "not-configured": "This layer is not available yet.",
  license_blocked: "This layer is not available yet.",
  disabled: "This layer is not available yet.",
};

function feedProblem(feed, label) {
  if (feed.status === "warming") return `${label}: just restarted, more vessels appear over the next few minutes.`;
  const text = PROBLEM_TEXT[feed.status];
  return text ? `${label}: ${text}` : "";
}

function countLabel(feed) {
  if (feed.status === "loading") return "…";
  if (feed.status === "idle") return "";
  if (!feed.items.length && PROBLEM_TEXT[feed.status]) return "!";
  return feed.items.length.toLocaleString();
}

// Small versions of the map icons, so each tracker's button matches what it puts on the map.
const HEX = "M0,-4.4L3.8,-2.2L3.8,2.2L0,4.4L-3.8,2.2L-3.8,-2.2Z";
export function Swatch({ kind, color, hollow = false, size = 11 }) {
  const fill = hollow ? "none" : color;
  return (
    <svg width={size} height={size} viewBox="-5 -5 10 10" aria-hidden="true" style={{ flexShrink: 0 }}>
      {kind === "air" && <path d="M0,-4.5L3.2,3.5L0,1.5L-3.2,3.5Z" fill={color} />}
      {kind === "ship" && <path d="M0,-3.6L3.6,0L0,3.6L-3.6,0Z" fill={color} />}
      {kind === "war" && (<>
        <circle r="2.9" fill="none" stroke={color} strokeWidth="1.3" />
        <path d="M0,-4.8V-3.2M0,3.2V4.8M-4.8,0H-3.2M3.2,0H4.8" stroke={color} strokeWidth="1.2" />
        <circle r="1" fill={color} />
      </>)}
      {kind === "strike" && <path d="M0,-4.6L1.2,-1.6L4.4,-1.6L1.9,0.5L2.8,3.8L0,1.9L-2.8,3.8L-1.9,0.5L-4.4,-1.6L-1.2,-1.6Z" fill={color} />}
      {kind === "terrorism" && (<>
        <path d="M0,-4.3L4.6,3.8L-4.6,3.8Z" fill={fill} stroke={color} strokeWidth={hollow ? 1.1 : 0} strokeLinejoin="round" />
        <path d="M0,-1.4V1.3M0,2.3V2.9" stroke={hollow ? color : "#071019"} strokeWidth="1.1" />
      </>)}
      {kind === "cyber" && (<>
        <path d={HEX} fill={fill} stroke={color} strokeWidth={hollow ? 1.1 : 0} />
        <path d="M0.6,-2.6L-1.4,0.4H0.4L-0.6,2.6L1.5,-0.5H-0.3Z" fill={hollow ? color : "#071019"} />
      </>)}
    </svg>
  );
}

const LIVE_CSS = `
.live-box{position:absolute;left:18px;bottom:calc(36px + env(safe-area-inset-bottom));z-index:3;max-width:min(290px,calc(100% - 150px));background:rgba(10,14,20,.86);border:1px solid #26384d;padding:7px 8px;font:9px monospace;color:#8795a7;display:flex;flex-direction:column;gap:5px}
.live-row{display:flex;align-items:center;gap:5px;flex-wrap:wrap}
.live-title{font-weight:700;letter-spacing:.1em;color:#4fa6a0}
.live-btn{display:inline-flex;align-items:center;gap:5px;background:#0c1724;border:1px solid #26384d;color:#aeb8c6;font:10px monospace;padding:5px 7px;cursor:pointer;letter-spacing:.04em}
.live-btn.on{border-color:#c9974b;color:#e8e3d8}
.live-btn .n{color:#c9974b}
.live-note{line-height:1.45}
.live-warn{color:#c9974b;line-height:1.45}
.live-legend{display:flex;flex-wrap:wrap;gap:3px 8px}
.ctx-short{display:none}
@media(max-width:800px){.ctx-short{display:block}}
.live-legend span{display:inline-flex;align-items:center;gap:3px}
.live-credit{color:#4e6076;line-height:1.4}
.track-card{position:absolute;left:50%;bottom:calc(56px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:6;width:min(380px,calc(100% - 24px));max-height:min(62vh,560px);overflow:auto;background:rgba(10,14,20,.96);border:1px solid rgba(255,255,255,.28);padding:10px 12px;color:#e8e3d8;font-family:Arial,sans-serif}
.track-card .tc-head{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}
.track-card .tc-kind{font:9px monospace;letter-spacing:.1em;color:#4fa6a0}
.track-card h3{margin:2px 0 8px;font-size:15px;letter-spacing:.02em}
.track-card dl{display:grid;grid-template-columns:auto 1fr;gap:3px 10px;margin:0 0 8px;font:11px monospace}
.track-card dt{color:#718198}
.track-card dd{margin:0;color:#c4cbd6;overflow-wrap:anywhere}
.track-card .tc-foot{display:flex;justify-content:space-between;align-items:center;gap:8px;font:9px monospace;color:#4e6076}
.track-card a{color:#c9974b;font:10px monospace;text-decoration:none}
.track-card button{background:none;border:1px solid #26384d;color:#8795a7;cursor:pointer;font:12px monospace;padding:2px 7px}
.track-card .tc-quote{font:11px/1.45 Arial,sans-serif;color:#9ba8b8;border-left:2px solid #26384d;padding-left:8px;margin:0 0 8px}
.live-sub{font-weight:700;letter-spacing:.1em;color:#718198}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;flex-shrink:0}
.dot.ring{background:none!important;border:1.5px solid #8795a7}
.track-card .tc-pin{margin-top:9px;border-color:#315e5b;color:#4fa6a0;font:10px monospace;padding:5px 9px;letter-spacing:.04em}
.track-card .tc-actions{display:flex;gap:6px;flex-wrap:wrap}
.track-card .tc-intel{margin-top:9px;border-color:#7a2f2f;color:#ff9d96;font:10px monospace;padding:5px 9px;letter-spacing:.04em}
.track-card .tc-intel.on{background:#2a1214;border-color:#ff4d4d;color:#ffd5d1}
.track-card .tc-big{font:700 22px Arial,sans-serif;color:#ff6b62;margin:0 0 2px}
.track-card .tc-big small{display:block;font:10px monospace;color:#9ba8b8;margin-top:2px}
.track-card .tc-src{list-style:none;margin:0 0 8px;padding:0;display:flex;flex-direction:column;gap:5px}
.track-card .tc-src li{font:11px/1.4 Arial,sans-serif;color:#c4cbd6;border-left:2px solid #26384d;padding-left:7px}
.track-card .tc-src li b{font:9px monospace;letter-spacing:.06em;color:#8795a7;margin-right:5px}
.track-card .tc-src li b.off{color:#c9974b}
.track-card .tc-src li a{margin-left:6px}
.track-card .tc-adv{font:10px/1.45 monospace;color:#c9974b;margin:0 0 8px}
.track-card .tc-legend{font:9px/1.5 monospace;color:#718198;margin:0 0 8px;display:flex;flex-direction:column;gap:2px}
.track-card .tc-legend span{display:inline-flex;align-items:center;gap:5px}
.live-btn .sw{display:inline-flex}
.track-card .tc-foot a,.track-card .tc-foot button{white-space:nowrap}
@media(max-width:800px){.live-box{left:10px;max-width:calc(100% - 140px);padding:6px}.live-title,.live-sub,.live-legend,.ctx-long{display:none}.live-btn{padding:5px 6px}.track-card{max-height:52vh}}
`;

function trkCount(data, n) {
  if (data.status === "loading") return "…";
  if (data.status === "unavailable") return "!";
  return data.status === "ok" ? n.toLocaleString() : "";
}

// The five trackers. PLANES and SHIPS are live positions; MILITARY, TERRORISM and CYBER are
// markers built hourly from reports and the UCDP dataset (trackers prop, new map only).
export function LiveLayerControls({ airOn, onToggleAir, shipsOn, onToggleShips, air, ships, trackers = null }) {
  const t = trackers;
  const d = t ? t.data : null;
  const inc = d && d.data;
  const problems = [airOn && feedProblem(air, "Planes"), shipsOn && feedProblem(ships, "Ships"),
    t && (t.militaryOn || t.terrorOn || t.cyberOn) && d.status === "unavailable" && "Trackers: not available right now. Turn one off and on to retry."].filter(Boolean);
  const credits = [airOn && air.attribution, shipsOn && ships.attribution,
    t && t.militaryOn && TRACKER_CREDITS.military, t && (t.militaryOn || t.terrorOn || t.cyberOn) && TRACKER_CREDITS.reports].filter(Boolean);
  const cov = inc ? coverageLabel(inc.conflictCoverage) : "";
  const days = inc ? inc.windowDays : 10;
  const btn = (on, onClick, title, icon, label, count) => (
    <button type="button" className={`live-btn ${on ? "on" : ""}`} aria-pressed={on} onClick={onClick} title={title}>
      <span className="sw">{icon}</span>{label}{on && count !== "" && <span className="n">{count}</span>}
    </button>
  );
  return (
    <div className="live-box" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <style>{LIVE_CSS}</style>
      <div className="live-row">
        <span className="live-title">TRACKERS</span>
        {btn(airOn, onToggleAir, "Military-flagged aircraft worldwide (ADS-B)", <Swatch kind="air" color={AIRCRAFT_COLOR} />, "PLANES", countLabel(air))}
        {btn(shipsOn, onToggleShips, "Ships at strategic chokepoints and Indian Ocean ports (AIS)", <Swatch kind="ship" color={shipColor("cargo")} />, "SHIPS", countLabel(ships))}
        {t && btn(t.militaryOn, () => t.onToggle("military"), "Wars (UCDP verified) and strikes reported in the news", <Swatch kind="war" color={TRACKER_COLORS.war} />, "MILITARY",
          inc ? trkCount(d, inc.wars.length) : trkCount(d, 0))}
        {t && btn(t.terrorOn, () => t.onToggle("terrorism"), "Terrorist attacks and threats reported in the last days", <Swatch kind="terrorism" color={TRACKER_COLORS.terrorism} />, "TERRORISM",
          inc ? trkCount(d, inc.terrorism.length) : trkCount(d, 0))}
        {t && btn(t.cyberOn, () => t.onToggle("cyber"), "Cyberattacks and warnings reported in the last days", <Swatch kind="cyber" color={TRACKER_COLORS.cyber} />, "CYBER",
          inc ? trkCount(d, inc.cyber.length) : trkCount(d, 0))}
      </div>
      {airOn && <div className="live-note">Planes: military-flagged aircraft that broadcast ADS-B. Many don't.</div>}
      {shipsOn && (
        <div className="live-note">
          Ships: outlined areas only (chokepoints and Indian Ocean ports). Free coverage comes from volunteer receivers, so some areas show none.
          {ships.meta?.snapshotAt ? ` Positions as of ${timeAgo(Date.parse(ships.meta.snapshotAt))} (snapshots, not live).` : ""} Zoom in, then tap an icon.
        </div>
      )}
      {shipsOn && (
        <div className="live-legend">
          {SHIP_LEGEND.map(([cat, label]) => (
            <span key={cat}><Swatch kind="ship" color={shipColor(cat)} />{label}</span>
          ))}
        </div>
      )}
      {t && t.militaryOn && (
        <>
          <div className="live-note ctx-short">Military: wars (UCDP{cov ? `, ${cov}` : ""}) and strikes reported in the last {days} days. Tap a war.</div>
          <div className="live-note ctx-long">
            Military: wars from UCDP's researcher-verified events{cov ? ` (${cov}, 1–2 months behind)` : ""}, and strikes reported in the news in the last {days} days. Tap a war for casualties, a web of its latest attacks and an intel panel.
          </div>
          <div className="live-legend">
            <span><Swatch kind="war" color={TRACKER_COLORS.war} />War (UCDP)</span>
            <span><Swatch kind="strike" color={TRACKER_COLORS.strike} />Strike reported</span>
          </div>
        </>
      )}
      {t && (t.terrorOn || t.cyberOn) && (
        <>
          <div className="live-note ctx-short">Reported in the last {days} days, placed from the headline. Not verified.</div>
          <div className="live-note ctx-long">
            {[t.terrorOn && "terrorist attacks and threats", t.cyberOn && "cyberattacks and warnings"].filter(Boolean).join(", and ").replace(/^./, (c) => c.toUpperCase())} reported by official sources and trusted outlets in the last {days} days, placed where the headline says. Reported, not verified. Mid-country markers mean no city was named.
          </div>
          <div className="live-legend">
            {t.terrorOn && <span><Swatch kind="terrorism" color={TRACKER_COLORS.terrorism} />Attack</span>}
            {t.terrorOn && <span><Swatch kind="terrorism" color={TRACKER_COLORS.terrorism} hollow />Threat</span>}
            {t.cyberOn && <span><Swatch kind="cyber" color={TRACKER_COLORS.cyber} />Cyberattack</span>}
            {t.cyberOn && <span><Swatch kind="cyber" color={TRACKER_COLORS.cyber} hollow />Warning</span>}
          </div>
        </>
      )}
      {problems.map((p) => <div key={p} className="live-warn">{p}</div>)}
      {credits.length > 0 && <div className="live-credit">{credits.join(" · ")}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Details card for a tapped aircraft or ship
// ---------------------------------------------------------------------------
const fmt = (v, unit = "") => (v == null || v === "" ? "—" : `${typeof v === "number" ? v.toLocaleString() : v}${unit}`);

export function TrackCard({ kind, item, fetchedAt, onClose, onPin }) {
  const isAir = kind === "air";
  const title = isAir ? item.callsign || item.reg || item.id?.toUpperCase() : item.name || `MMSI ${item.mmsi}`;
  const rows = isAir
    ? [
        ["Type", item.type],
        ["Registration", item.reg],
        ["Altitude", item.onGround ? "On ground" : fmt(item.altFt, " ft")],
        ["Speed", fmt(item.speedKt, " kt")],
        ["Heading", fmt(item.heading, "°")],
        ["ICAO hex", item.id?.toUpperCase()],
      ]
    : [
        ["Type", item.category ? item.category.toUpperCase() : "UNKNOWN"],
        ["Speed", fmt(item.speedKt, " kt")],
        ["Course", fmt(item.course, "°")],
        ["Destination", item.destination],
        ["MMSI", item.mmsi],
      ];
  const updated = isAir ? (fetchedAt ? timeAgo(Date.parse(fetchedAt)) : "") : timeAgo(item.updatedAt);
  const link = isAir
    ? `https://globe.adsb.lol/?icao=${encodeURIComponent(item.id || "")}`
    : `https://www.marinetraffic.com/en/ais/details/ships/mmsi:${encodeURIComponent(item.mmsi)}`;
  return (
    <div className="track-card" role="dialog" aria-label={`${isAir ? "Aircraft" : "Ship"} details`}
      onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <div className="tc-head">
        <div>
          <div className="tc-kind">{isAir ? "MILITARY AIRCRAFT · ADS-B" : "VESSEL · AIS"}</div>
          <h3>{title}</h3>
        </div>
        <button type="button" aria-label="Close" onClick={onClose}>&times;</button>
      </div>
      <dl>
        {rows.map(([k, v]) => (
          <React.Fragment key={k}><dt>{k}</dt><dd>{fmt(v)}</dd></React.Fragment>
        ))}
      </dl>
      <div className="tc-foot">
        <span>{updated ? `Updated ${updated}` : ""}{isAir ? "" : " · self-reported by the ship"}</span>
        <a href={link} target="_blank" rel="noreferrer">{isAir ? "OPEN TRACK →" : "MORE DETAILS →"}</a>
      </div>
      {onPin && (
        <button type="button" className="tc-pin" onClick={onPin}>PIN TO MAP</button>
      )}
    </div>
  );
}
