import React from "react";
import { Swatch } from "./LiveLayers.jsx";
import { TRACKER_COLORS, KIND_LABEL, SUBTYPE_LABEL, PRECISION_TEXT, dayLabel, whenLabel, monthLabel, coverageLabel, deathsText, n, nodeSearchUrl } from "./contextData.js";

// Details cards for the MILITARY, TERRORISM and CYBER trackers (data: contextData.js).
// Same frame as the plane/ship card (.track-card, styled in LiveLayers.jsx).

const stop = { onPointerDown: (e) => e.stopPropagation(), onClick: (e) => e.stopPropagation() };
const ICON_KIND = { strike: "strike", terrorism: "terrorism", cyber: "cyber" };

function Head({ kindText, title, onClose, icon }) {
  return (
    <div className="tc-head">
      <div>
        <div className="tc-kind" style={{ display: "flex", alignItems: "center", gap: 6 }}>{icon}{kindText}</div>
        <h3>{title}</h3>
      </div>
      <button type="button" aria-label="Close" onClick={onClose}>&times;</button>
    </div>
  );
}

function Sources({ item, max = 5 }) {
  return (
    <ul className="tc-src">
      {item.sources.slice(0, max).map((s) => (
        <li key={s.url || s.headline}>
          <b className={s.sourceType === "official" ? "off" : ""}>{s.sourceType === "official" ? "OFFICIAL" : "NEWS"}</b>{s.source} · {dayLabel(s.publishedAt)}
          {s.url && <a href={s.url} target="_blank" rel="noreferrer">READ →</a>}
          {s.headline !== item.title && <div style={{ color: "#8795a7" }}>{s.headline}</div>}
        </li>
      ))}
      {item.sources.length > max && <li style={{ color: "#718198" }}>+{item.sources.length - max} more</li>}
    </ul>
  );
}

// One map marker = every event of one tracker reported at one place. A single event gets the
// full card; several get a list, like a marker a user pinned several reports to.
export function PlaceCard({ group, onClose, onPin, warOf }) {
  if (group.items.length === 1) return <IncidentCard item={group.items[0]} onClose={onClose} onPin={() => onPin(group.items[0])} war={warOf(group.items[0])} />;
  const color = group.kind === "strike" ? TRACKER_COLORS.strike : TRACKER_COLORS[group.kind];
  const where = group.precision === "country" ? `${group.place} · no city named` : group.place;
  const adv = group.items.find((x) => x.advisory)?.advisory;
  return (
    <div className="track-card" role="dialog" aria-label={`${KIND_LABEL[group.kind]} reports at ${group.place}`} {...stop}>
      <Head onClose={onClose} title={where}
        icon={<Swatch kind={ICON_KIND[group.kind]} color={color} hollow={group.subtype !== "attack" && group.kind !== "strike"} size={12} />}
        kindText={`${KIND_LABEL[group.kind]} · ${group.items.length} EVENTS REPORTED · LAST 10 DAYS`} />
      {group.precision === "country" && <div className="tc-adv" style={{ color: "#8795a7" }}>{PRECISION_TEXT.country}.</div>}
      {adv && (
        <div className="tc-adv">US travel advisory for {adv.name}: Level {adv.level} of 4, {adv.levelText}. <a href={adv.url} target="_blank" rel="noreferrer">READ →</a></div>
      )}
      <ol className="tc-events">
        {group.items.map((it) => {
          const w = warOf(it);
          return (
            <li key={it.id}>
              <div className="ev-meta">
                <span className={`ev-tag ${it.subtype}`}>{SUBTYPE_LABEL[it.subtype]}</span>
                {whenLabel(it.lastReported)} · {it.sourceCount} outlet{it.sourceCount === 1 ? "" : "s"}{w ? ` · ${w.name}` : ""}
              </div>
              <div className="ev-title">{it.title}</div>
              <Sources item={it} max={3} />
              {onPin && <button type="button" className="tc-pin ev-pin" onClick={() => onPin(it)}>PIN TO MAP</button>}
            </li>
          );
        })}
      </ol>
      <div className="tc-foot">
        <span>Placed automatically from the headlines. Reported, not verified by Wire Room.</span>
      </div>
    </div>
  );
}

// A reported terrorist attack or threat, cyberattack or warning, or military strike.
export function IncidentCard({ item, onClose, onPin, war = null }) {
  const color = item.kind === "strike" ? TRACKER_COLORS.strike : TRACKER_COLORS[item.kind];
  const hollow = item.subtype !== "attack";
  const rows = [
    ["Where", `${item.place} · ${PRECISION_TEXT[item.precision] || item.precision}`],
    ["Reported", item.firstReported === item.lastReported ? whenLabel(item.firstReported) : `${whenLabel(item.firstReported)}, latest ${whenLabel(item.lastReported)}`],
    ["Sources", `${item.sourceCount} outlet${item.sourceCount === 1 ? "" : "s"}${item.officialCount ? `, ${item.officialCount} official statement${item.officialCount === 1 ? "" : "s"}` : ""}`],
  ];
  if (war) rows.push(["War", war.name]);
  return (
    <div className="track-card" role="dialog" aria-label={`${KIND_LABEL[item.kind]} report details`} {...stop}>
      <Head onClose={onClose} title={item.title}
        icon={<Swatch kind={ICON_KIND[item.kind]} color={color} hollow={hollow && item.kind !== "strike"} size={12} />}
        kindText={`${KIND_LABEL[item.kind]} · ${SUBTYPE_LABEL[item.subtype] || ""}`} />
      {item.summary && <div className="tc-quote">{item.summary}</div>}
      <dl>
        {rows.map(([k, v]) => (<React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>))}
      </dl>
      {item.advisory && (
        <div className="tc-adv">US travel advisory for {item.advisory.name}: Level {item.advisory.level} of 4, {item.advisory.levelText}. <a href={item.advisory.url} target="_blank" rel="noreferrer">READ →</a></div>
      )}
      <Sources item={item} />
      <div className="tc-foot">
        <span>Placed automatically from the headline{item.translatedFrom ? " (machine-translated)" : ""}. Reported, not verified by Wire Room.</span>
      </div>
      {onPin && <button type="button" className="tc-pin" onClick={onPin}>PIN TO MAP</button>}
    </div>
  );
}

// A war: casualties from UCDP, a web of its latest attacks on the map, and the intel panel.
export function WarCard({ war, onClose, onPin, intelOpen, onToggleIntel, reportedCount = 0 }) {
  const lm = war.latestMonth || {};
  const rows = [
    ["Sides", `${war.sides.a.join(", ")} vs ${war.sides.b.join(", ") || "—"}`],
    [coverageLabel(war.coverage) || "Total", `${deathsText(war.deaths)} · ${n(war.events)} events`],
    ["Latest event", dayLabel(war.latestEvent)],
    ["Reported strikes", reportedCount ? `${reportedCount} in the news, last 10 days` : "none matched in the last 10 days"],
  ];
  return (
    <div className="track-card" role="dialog" aria-label="War details" {...stop}>
      <Head onClose={onClose} title={war.name} icon={<Swatch kind="war" color={TRACKER_COLORS.war} size={12} />} kindText="WAR · UCDP VERIFIED EVENTS" />
      <div className="tc-big">{n(lm.best)} killed<small>{monthLabel(lm.month)} · best estimate{lm.low !== lm.high ? `, range ${n(lm.low)}–${n(lm.high)}` : ""}</small></div>
      <div style={{ font: "9px monospace", color: "#718198", margin: "0 0 8px" }}>LATEST MONTH UCDP HAS PUBLISHED (1–2 MONTHS BEHIND). TOTALS COVER {(coverageLabel(war.coverage) || "THE LATEST 3 MONTHS").toUpperCase()} ONLY; EARLIER FIGHTING ISN'T INCLUDED.</div>
      <dl>
        {rows.map(([k, v]) => (<React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>))}
      </dl>
      <div className="tc-legend">
        <span><svg width="22" height="6" aria-hidden="true"><line x1="0" y1="3" x2="22" y2="3" stroke={TRACKER_COLORS.war} strokeWidth="1.5" /></svg>Latest {war.nodes.length} UCDP-verified events (size = deaths)</span>
        <span><svg width="22" height="6" aria-hidden="true"><line x1="0" y1="3" x2="22" y2="3" stroke={TRACKER_COLORS.strike} strokeWidth="1.5" strokeDasharray="3 2" /></svg>Strikes reported in the news, not yet verified</span>
      </div>
      <div className="tc-foot">
        <span>Side names as UCDP codes them. Figures may be revised.</span>
        <a href="https://ucdp.uu.se/downloads/" target="_blank" rel="noreferrer">UCDP DATA →</a>
      </div>
      <div className="tc-actions">
        <button type="button" className={`tc-intel ${intelOpen ? "on" : ""}`} aria-pressed={intelOpen} onClick={onToggleIntel}>
          {intelOpen ? "CLOSE INTEL PANEL" : "OPEN INTEL PANEL"}{war.reportCount ? ` · ${war.reportCount}` : ""}
        </button>
        {onPin && <button type="button" className="tc-pin" onClick={onPin}>PIN TO MAP</button>}
      </div>
    </div>
  );
}

// One UCDP event in a war's web of nodes: what happened, per UCDP's source.
export function NodeCard({ node, war, onClose, onOpenWar }) {
  const approx = node.wp >= 4;
  const search = nodeSearchUrl(node);
  const headline = node.headline ? (node.headline.length >= 178 ? `${node.headline.replace(/\s+\S*$/, "")}…` : node.headline) : "";
  return (
    <div className="track-card" role="dialog" aria-label="Conflict event details" {...stop}>
      <Head onClose={onClose} title={node.place || war.name} icon={<Swatch kind="war" color={TRACKER_COLORS.war} size={12} />} kindText="CONFLICT EVENT · UCDP VERIFIED DATASET" />
      {headline ? (
        <>
          <div style={{ font: "9px monospace", color: "#718198", letterSpacing: ".06em", margin: "0 0 3px" }}>WHAT HAPPENED (HEADLINE OF UCDP'S SOURCE)</div>
          <div className="tc-quote" style={{ fontStyle: "normal", color: "#e8e3d8" }}>“{headline}”</div>
        </>
      ) : <div className="tc-quote">UCDP didn't record a source headline for this event.</div>}
      <dl>
        <dt>Date</dt><dd>{dayLabel(node.date)}</dd>
        <dt>Deaths</dt><dd>{deathsText(node)}{node.civilians ? ` · ${n(node.civilians)} civilian${node.civilians === 1 ? "" : "s"}` : ""}</dd>
        <dt>Who</dt><dd>{[node.sideA, node.sideB].filter(Boolean).join(" vs ") || war.name}</dd>
        <dt>Source</dt><dd>{node.office || "—"}{node.sources > 1 ? ` (1 of ${node.sources} reports UCDP used)` : ""}</dd>
        <dt>Place</dt><dd>{approx ? "Approximate: UCDP only knows the wider area" : "Location known"}</dd>
      </dl>
      <div className="tc-foot">
        <span>Coded by UCDP researchers from news and NGO reports. Preliminary; may be revised. UCDP doesn't publish article links.</span>
      </div>
      <div className="tc-actions">
        {search && <a className="tc-pin" style={{ textDecoration: "none", display: "inline-block" }} href={search} target="_blank" rel="noreferrer">SEARCH NEWS FOR THIS →</a>}
        <button type="button" className="tc-intel" onClick={onOpenWar}>{war.name.toUpperCase()} →</button>
      </div>
    </div>
  );
}
