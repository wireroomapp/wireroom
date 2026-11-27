import React, { memo, useState } from "react";
import { AIRCRAFT_COLOR, SHIP_LEGEND, shipColor, aircraftPath, shipPaths, timeAgo, iconScale } from "./trackingGeo.js";
import { TRACKER_COLORS, TRACKER_CREDITS, shortDay, daysBetween, localDay } from "./contextData.js";

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
          ? `${z.name} · ${waiting ? "waiting for data" : "no free coverage"}`
          : `${z.name} · ${z.count.toLocaleString()}`;
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
        <circle r="3.4" fill="none" stroke={color} strokeWidth="1.3" />
        <circle r="1.6" fill={color} />
      </>)}
      {kind === "strike" && (<>
        <circle r="2.6" fill="none" stroke={color} strokeWidth="1.1" />
        <path d="M0,-4.6V-1.4M0,1.4V4.6M-4.6,0H-1.4M1.4,0H4.6" stroke={color} strokeWidth="1.1" strokeLinecap="round" />
      </>)}
      {kind === "terrorism" && <path d="M0,-4.3L4.6,3.8L-4.6,3.8Z" fill={fill} stroke={color} strokeWidth={hollow ? 1.1 : 0} strokeLinejoin="round" />}
      {kind === "cyber" && <path d={HEX} fill={fill} stroke={color} strokeWidth={hollow ? 1.1 : 0} />}
    </svg>
  );
}

const LIVE_CSS = `
.live-box{position:absolute;left:18px;bottom:calc(36px + env(safe-area-inset-bottom));z-index:3;max-width:min(290px,calc(100% - 150px));background:var(--overlay);border:1px solid var(--line-2);padding:7px 8px;font:11px var(--font);color:var(--muted);display:flex;flex-direction:column;gap:5px}
.live-row{display:flex;align-items:center;gap:5px;flex-wrap:wrap}
.live-title{font-weight:700;letter-spacing:0;color:var(--ok)}
.live-btn{display:inline-flex;align-items:center;gap:5px;background:var(--surface);border:1px solid var(--line-2);color:var(--text-2);font:12px var(--font);padding:5px 7px;cursor:pointer;letter-spacing:0}
.live-btn.on{border-color:var(--accent);color:var(--text)}
.live-btn .n{color:var(--accent)}
.live-note{line-height:1.45}
.live-warn{color:var(--accent);line-height:1.45}
.live-legend{display:flex;flex-wrap:wrap;gap:3px 8px}
.live-world{gap:6px}
.live-world-note{color:var(--muted);font-size:11px;line-height:1.35;flex:1 1 140px}
.ctx-short{display:none}
@media(max-width:800px){.ctx-short{display:block}}
.live-legend span{display:inline-flex;align-items:center;gap:3px}
.live-credit{color:var(--muted);line-height:1.4}
.track-card{position:absolute;left:50%;bottom:calc(56px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:6;width:min(380px,calc(100% - 24px));max-height:min(62vh,560px);overflow:auto;background:var(--overlay);border:1px solid var(--line-2);padding:10px 12px;color:var(--text);font-family:var(--font)}
.track-card .tc-head{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}
.track-card .tc-kind{font:11px var(--font);letter-spacing:0;color:var(--ok)}
.track-card h3{margin:2px 0 8px;font-size:15px;letter-spacing:0}
.track-card dl{display:grid;grid-template-columns:auto 1fr;gap:3px 10px;margin:0 0 8px;font:13px var(--font)}
.track-card dt{color:var(--muted)}
.track-card dd{margin:0;color:var(--text-2);overflow-wrap:anywhere}
.track-card .tc-foot{display:flex;justify-content:space-between;align-items:center;gap:8px;font:11px var(--font);color:var(--muted)}
.track-card a{color:var(--accent);font:12px var(--font);text-decoration:none}
.track-card button{background:none;border:1px solid var(--line-2);color:var(--muted);cursor:pointer;font:14px var(--font);padding:2px 7px}
.track-card .tc-quote{font:11px/1.45 var(--font);color:var(--text-2);border-left:2px solid var(--line-2);padding-left:8px;margin:0 0 8px}
.live-sub{font-weight:700;letter-spacing:0;color:var(--muted)}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;flex-shrink:0}
.dot.ring{background:none!important;border:1.5px solid var(--muted)}
.track-card .tc-pin{margin-top:9px;border-color:var(--ok-line);color:var(--ok);font:12px var(--font);padding:5px 9px;letter-spacing:0}
.track-card .tc-actions{display:flex;gap:6px;flex-wrap:wrap}
.track-card .tc-intel{margin-top:9px;border-color:var(--danger-line);color:var(--danger);font:12px var(--font);padding:5px 9px;letter-spacing:0}
.track-card .tc-intel.on{background:var(--danger-bg);border-color:#ff4d4d;color:var(--danger-strong)}
.track-card .tc-big{font:700 22px var(--font);color:var(--danger);margin:0 0 2px}
.track-card .tc-lag{font:11px/1.45 var(--font);color:var(--danger);border:1px solid var(--danger-line);background:var(--danger-bg);padding:4px 6px;margin:0 0 6px;letter-spacing:0}
.track-card .tc-lag.ok{color:var(--muted);border-color:var(--line);background:none}
.track-card .tc-big small{display:block;font:12px var(--font);color:var(--text-2);margin-top:2px}
.track-card .tc-related{border-top:1px solid var(--line);padding-top:8px;margin:0 0 8px}
.track-card .tc-related-head{font:600 12px var(--font);color:var(--text);margin-bottom:2px}
.track-card .tc-related-note{font:11px/1.4 var(--font);color:var(--muted);margin-bottom:6px}
.track-card .tc-src{list-style:none;margin:0 0 8px;padding:0;display:flex;flex-direction:column;gap:5px}
.track-card .tc-src li{font:11px/1.4 var(--font);color:var(--text-2);border-left:2px solid var(--line-2);padding-left:7px}
.track-card .tc-src li b{font:11px var(--font);letter-spacing:0;color:var(--muted);margin-right:5px}
.track-card .tc-src li b.off{color:var(--accent)}
.track-card .tc-src li a{margin-left:6px}
.track-card .tc-adv{font:12px/1.45 var(--font);color:var(--accent);margin:0 0 8px}
.track-card .tc-legend{font:11px/1.5 var(--font);color:var(--muted);margin:0 0 8px;display:flex;flex-direction:column;gap:2px}
.track-card .tc-legend span{display:inline-flex;align-items:center;gap:5px}
.live-btn .sw{display:inline-flex}
.live-box.past{border-color:var(--accent)}
.live-collapse{position:absolute;top:5px;right:5px;background:none;border:0;color:var(--muted);font:14px var(--font);padding:2px 6px;cursor:pointer}
.live-tabs{padding-right:22px}
.live-collapse:hover,.live-expand:hover{color:var(--text)}
.live-mini{padding:0}
.live-expand{background:none;border:0;color:var(--text);font:600 12px var(--font);padding:8px 10px;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.live-expand .n{color:var(--accent);font-weight:700}
.live-tabs{display:flex;align-items:center;gap:4px;margin-bottom:6px;border-bottom:1px solid var(--line);padding-bottom:5px;flex-wrap:wrap}
.live-tab{background:none;border:0;border-bottom:2px solid transparent;color:var(--muted);font:700 12px var(--font);letter-spacing:0;padding:3px 6px 4px;cursor:pointer;display:inline-flex;align-items:center;gap:5px}
.live-tab.on{color:var(--ok);border-bottom-color:var(--ok)}
.live-tab .n{font-weight:400;color:var(--accent);letter-spacing:0}
.live-tabs .live-sub{margin-left:4px;color:var(--muted);font:11px var(--font)}
.track-card .tc-events{list-style:none;margin:0 0 8px;padding:0;display:flex;flex-direction:column;gap:9px}
.track-card .tc-events>li{border-top:1px solid var(--line);padding-top:8px}
.track-card .ev-meta{font:11px var(--font);color:var(--muted);letter-spacing:0;margin-bottom:3px;display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.track-card .ev-tag{border:1px solid currentColor;padding:0 4px;color:var(--danger)}
.track-card .ev-tag.threat,.track-card .ev-tag.warning{color:var(--accent)}
.track-card .ev-title{font:600 13px/1.35 var(--font);color:var(--text);margin-bottom:5px}
.track-card .tc-events .tc-src{margin-bottom:4px}
.track-card .ev-pin{margin-top:2px;padding:3px 7px}
.track-card .ev-by{font:12px var(--font);color:var(--text-2);margin:0 0 4px}
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
// Two tabs: LIVE (planes, ships: positions) and EVENTS (military, terrorism, cyber: reported
// events). Trackers stay on when you switch tabs; each tab says how many of its trackers are on.
const TAB_KEY = "wireroom-trackers-tab";
function readTab() { try { return localStorage.getItem(TAB_KEY); } catch { return null; } }
function saveTab(v) { try { localStorage.setItem(TAB_KEY, v); } catch { /* private mode */ } }

export function LiveLayerControls({ airOn, onToggleAir, shipsOn, onToggleShips, air, ships, trackers = null, initialTab = null, pastDay = null }) {
  const t = trackers;
  const [tabState, setTab] = useState(() => initialTab || (readTab() === "events" ? "events" : "live"));
  // The trackers box can be tucked into a small button (remembered on this device).
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem("wireroom-trackers-collapsed") === "1"; } catch { return false; } });
  const collapse = (v) => { setCollapsed(v); try { localStorage.setItem("wireroom-trackers-collapsed", v ? "1" : "0"); } catch { /* not remembered */ } };
  const tab = t ? tabState : "live";
  const pick = (v) => { setTab(v); saveTab(v); };
  const liveOn = (airOn ? 1 : 0) + (shipsOn ? 1 : 0);
  const eventsOn = t ? (t.militaryOn ? 1 : 0) + (t.terrorOn ? 1 : 0) + (t.cyberOn ? 1 : 0) : 0;
  const d = t ? t.data : null;
  const inc = d && d.data;
  const problems = [airOn && !pastDay && feedProblem(air, "Planes"), shipsOn && !pastDay && feedProblem(ships, "Ships"),
    t && (t.militaryOn || t.terrorOn || t.cyberOn) && d.status === "unavailable" && "Trackers: not available right now. Turn one off and on to retry."].filter(Boolean);
  const credits = [airOn && air.attribution, shipsOn && ships.attribution,
    t && t.militaryOn && TRACKER_CREDITS.military, t && (t.militaryOn || t.terrorOn || t.cyberOn) && TRACKER_CREDITS.reports].filter(Boolean);
  const days = inc ? inc.windowDays : 10;
  const btn = (on, onClick, title, icon, label, count) => (
    <button type="button" className={`live-btn ${on ? "on" : ""}`} aria-pressed={on} onClick={onClick} title={title}>
      <span className="sw">{icon}</span>{label}{on && count !== "" && <span className="n">{count}</span>}
    </button>
  );
  if (collapsed) {
    return (
      <div className="live-box live-mini" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
        <style>{LIVE_CSS}</style>
        <button type="button" className="live-expand" onClick={() => collapse(false)} aria-label="Show trackers">
          Trackers{liveOn + eventsOn > 0 && <span className="n">{liveOn + eventsOn} on</span>} <span aria-hidden="true">▴</span>
        </button>
      </div>
    );
  }
  return (
    <div className={`live-box ${pastDay ? "past" : ""}`} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <style>{LIVE_CSS}</style>
      {t ? (
        <div className="live-tabs" role="tablist" aria-label="Tracker groups">
          <button type="button" role="tab" aria-selected={tab === "live"} className={`live-tab ${tab === "live" ? "on" : ""}`} onClick={() => pick("live")}>
            Live{liveOn > 0 && <span className="n">{liveOn} on</span>}
          </button>
          <button type="button" role="tab" aria-selected={tab === "events"} className={`live-tab ${tab === "events" ? "on" : ""}`} onClick={() => pick("events")}>
            Events{eventsOn > 0 && <span className="n">{eventsOn} on</span>}
          </button>
          <span className="live-sub">{tab === "live" ? "Positions of planes and ships" : "Wars, attacks and hacks, from reports"}</span>
          <button type="button" className="live-collapse" onClick={() => collapse(true)} aria-label="Hide trackers" title="Hide (tap Trackers to bring it back)">▾</button>
        </div>
      ) : null}
      <div className="live-row">
        {!t && <span className="live-title">Trackers</span>}
        {tab === "live" && btn(airOn, onToggleAir, "Military-flagged aircraft worldwide (ADS-B)", <Swatch kind="air" color={AIRCRAFT_COLOR} />, "Planes", countLabel(air))}
        {tab === "live" && btn(shipsOn, onToggleShips, "Ships at strategic chokepoints and Indian Ocean ports (AIS)", <Swatch kind="ship" color={shipColor("cargo")} />, "Ships", countLabel(ships))}
        {tab === "events" && btn(t.militaryOn, () => t.onToggle("military"), "Armed conflicts (UCDP verified) and strikes reported in the news", <Swatch kind="war" color={TRACKER_COLORS.war} />, "Military",
          inc ? trkCount(d, inc.wars.length) : trkCount(d, 0))}
        {tab === "events" && btn(t.terrorOn, () => t.onToggle("terrorism"), "Terrorist attacks and threats reported in the last days", <Swatch kind="terrorism" color={TRACKER_COLORS.terrorism} />, "Terrorism",
          inc ? trkCount(d, inc.terrorism.length) : trkCount(d, 0))}
        {tab === "events" && btn(t.cyberOn, () => t.onToggle("cyber"), "Cyberattacks and warnings reported in the last days", <Swatch kind="cyber" color={TRACKER_COLORS.cyber} />, "Cyber",
          inc ? trkCount(d, inc.cyber.length) : trkCount(d, 0))}
      </div>
      {tab === "live" && pastDay && (airOn || shipsOn) && <div className="live-warn">Live positions only: hidden while the map shows a past day. Press Today to see them.</div>}
      {tab === "live" && airOn && !pastDay && <div className="live-note">Planes: military-flagged aircraft that broadcast ADS-B. Many don't.</div>}
      {tab === "live" && shipsOn && !pastDay && (
        <div className="live-note">
          Ships: outlined areas only (chokepoints and Indian Ocean ports). Free coverage comes from volunteer receivers, so some areas show none.
          {ships.meta?.snapshotAt ? ` Positions as of ${timeAgo(Date.parse(ships.meta.snapshotAt))} (snapshots, not live).` : ""} Zoom in, then tap an icon.
        </div>
      )}
      {tab === "live" && shipsOn && (
        <div className="live-legend">
          {SHIP_LEGEND.map(([cat, label]) => (
            <span key={cat}><Swatch kind="ship" color={shipColor(cat)} />{label}</span>
          ))}
        </div>
      )}
      {tab === "events" && t.militaryOn && (
        <>
          <div className="live-note ctx-short">Military: active armed conflicts (UCDP), and strikes reported in the last {days} days. Tap one.</div>
          <div className="live-note ctx-long">
            Military: every active armed conflict in UCDP's researcher-verified events (an event in the last 3 months{inc && inc.ucdpThrough ? `; UCDP's data ends ${shortDay(inc.ucdpThrough)}, ${daysBetween(inc.ucdpThrough, pastDay || localDay())} days behind` : ""}), however small, sized war / armed conflict / clashes by deaths over the past year; and every strike reported in the news in the last {days} days, with who carried it out when the report says. Tap a conflict for casualties, a web of its latest attacks and an intel panel.
          </div>
          <div className="live-legend">
            <span><Swatch kind="war" color={TRACKER_COLORS.war} size={13} />War</span>
            <span><Swatch kind="war" color={TRACKER_COLORS.war} size={10} />Armed conflict</span>
            <span><Swatch kind="war" color={TRACKER_COLORS.war} size={8} />Clashes</span>
            <span><Swatch kind="strike" color={TRACKER_COLORS.strike} />Strike reported</span>
          </div>
        </>
      )}
      {tab === "events" && (t.terrorOn || t.cyberOn) && (
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
      {tab === "events" && (t.worldwide || []).length > 0 && (
        <div className="live-row live-world">
          {t.worldwide.map((g) => (
            <button type="button" key={g.key} className={`live-btn ${t.worldwideOpen === g.key ? "on" : ""}`} onClick={() => t.onWorldwide(g)}
              title="Attacks that hit many countries at once, so they have no single spot on the map">
              <span className="sw"><Swatch kind={g.kind === "strike" ? "strike" : g.kind} color={TRACKER_COLORS[g.kind] || TRACKER_COLORS.strike} hollow={g.subtype !== "attack" && g.kind !== "strike"} /></span>
              Worldwide {g.kind === "cyber" ? "cyber" : g.kind}<span className="n">{g.items.length}</span>
            </button>
          ))}
          <span className="live-world-note">Hit many countries at once: no single spot on the map.</span>
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
        ["Type", item.category ? item.category[0].toUpperCase() + item.category.slice(1) : "Unknown"],
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
          <div className="tc-kind">{isAir ? "Military aircraft · ADS-B" : "Vessel · AIS"}</div>
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
        <a href={link} target="_blank" rel="noreferrer">{isAir ? "Open track →" : "More details →"}</a>
      </div>
      {onPin && (
        <button type="button" className="tc-pin" onClick={onPin}>Pin to map</button>
      )}
    </div>
  );
}
