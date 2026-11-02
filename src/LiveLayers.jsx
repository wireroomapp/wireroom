import React, { memo } from "react";
import { AIRCRAFT_COLOR, SHIP_LEGEND, shipColor, aircraftPath, shipPaths, timeAgo } from "./trackingGeo.js";

// ---------------------------------------------------------------------------
// Drawn inside the map's zoomed <g>. Pointer events are off: taps are matched
// to the nearest aircraft/ship in App.jsx (hitTest), which keeps the layer to a
// handful of DOM nodes even with thousands of positions.
// ---------------------------------------------------------------------------
export const TrackLayerSvg = memo(function TrackLayerSvg({ aircraft, ships, k, selected }) {
  const air = aircraft.length ? aircraftPath(aircraft, k) : "";
  const sea = ships.length ? shipPaths(ships, k) : [];
  const strokeW = 0.7 / k;
  return (
    <g className="tracks" pointerEvents="none">
      {sea.map(({ color, d }) => (
        <path key={color} d={d} fill={color} fillOpacity=".9" stroke="#071019" strokeWidth={strokeW} />
      ))}
      {air && <path d={air} fill={AIRCRAFT_COLOR} stroke="#071019" strokeWidth={strokeW} />}
      {selected && (
        <circle cx={selected.x} cy={selected.y} r={9 / k} fill="none" stroke="#fff" strokeWidth={1.6 / k} />
      )}
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

function Swatch({ kind, color }) {
  return (
    <svg width="10" height="10" viewBox="-5 -5 10 10" aria-hidden="true" style={{ flexShrink: 0 }}>
      {kind === "air"
        ? <path d="M0,-4.5L3.2,3.5L0,1.5L-3.2,3.5Z" fill={color} />
        : <path d="M0,-3.6L3.6,0L0,3.6L-3.6,0Z" fill={color} />}
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
.live-legend span{display:inline-flex;align-items:center;gap:3px}
.live-credit{color:#4e6076;line-height:1.4}
.track-card{position:absolute;left:50%;bottom:calc(56px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:6;width:min(360px,calc(100% - 24px));background:rgba(10,14,20,.96);border:1px solid rgba(255,255,255,.28);padding:10px 12px;color:#e8e3d8;font-family:Arial,sans-serif}
.track-card .tc-head{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}
.track-card .tc-kind{font:9px monospace;letter-spacing:.1em;color:#4fa6a0}
.track-card h3{margin:2px 0 8px;font-size:15px;letter-spacing:.02em}
.track-card dl{display:grid;grid-template-columns:auto 1fr;gap:3px 10px;margin:0 0 8px;font:11px monospace}
.track-card dt{color:#718198}
.track-card dd{margin:0;color:#c4cbd6;overflow-wrap:anywhere}
.track-card .tc-foot{display:flex;justify-content:space-between;align-items:center;gap:8px;font:9px monospace;color:#4e6076}
.track-card a{color:#c9974b;font:10px monospace;text-decoration:none}
.track-card button{background:none;border:1px solid #26384d;color:#8795a7;cursor:pointer;font:12px monospace;padding:2px 7px}
@media(max-width:800px){.live-box{left:10px;max-width:calc(100% - 140px);padding:6px}.live-title,.live-legend{display:none}.live-btn{padding:5px 6px}}
`;

export function LiveLayerControls({ airOn, onToggleAir, shipsOn, onToggleShips, air, ships }) {
  const problems = [airOn && feedProblem(air, "Air"), shipsOn && feedProblem(ships, "Ships")].filter(Boolean);
  const credits = [airOn && air.attribution, shipsOn && ships.attribution].filter(Boolean);
  return (
    <div className="live-box" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <style>{LIVE_CSS}</style>
      <div className="live-row">
        <span className="live-title">LIVE</span>
        <button type="button" className={`live-btn ${airOn ? "on" : ""}`} aria-pressed={airOn} onClick={onToggleAir}
          title="Military-flagged aircraft worldwide (ADS-B)">
          <Swatch kind="air" color={AIRCRAFT_COLOR} />MIL AIR{airOn && <span className="n">{countLabel(air)}</span>}
        </button>
        <button type="button" className={`live-btn ${shipsOn ? "on" : ""}`} aria-pressed={shipsOn} onClick={onToggleShips}
          title="Ships at strategic chokepoints (AIS)">
          <Swatch kind="ship" color={shipColor("cargo")} />SHIPS{shipsOn && <span className="n">{countLabel(ships)}</span>}
        </button>
      </div>
      {airOn && <div className="live-note">Air: military-flagged aircraft that broadcast ADS-B. Many don't.</div>}
      {shipsOn && <div className="live-note">Ships: strategic chokepoints only. Zoom in, then tap an icon for details.</div>}
      {shipsOn && (
        <div className="live-legend">
          {SHIP_LEGEND.map(([cat, label]) => (
            <span key={cat}><Swatch kind="ship" color={shipColor(cat)} />{label}</span>
          ))}
        </div>
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

export function TrackCard({ kind, item, fetchedAt, onClose }) {
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
    </div>
  );
}
