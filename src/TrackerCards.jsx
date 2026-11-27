import React from "react";
import { Swatch } from "./LiveLayers.jsx";
import { localDay, daysBetween, WR_COUNTRIES, TRACKER_COLORS, KIND_LABEL, SUBTYPE_LABEL, PRECISION_TEXT, LEVEL_TEXT, dayLabel, whenLabel, monthLabel, coverageLabel, deathsText, n, nodeSearchUrl, incidentSearchUrl, sidesText, isUnnamed } from "./contextData.js";

const whereText = (i) => (i.precision === "country" || !i.country ? i.place : `${i.place}, ${i.country}`);
const byText = (i) => (i.by && i.by.length ? i.by.join(", ") : "not named in the reports");
const checkedText = (i) => (i.checkedBy === "ai" ? "Checked by an AI model, then placed from the report" : "Placed automatically from the headline");

// Details cards for the MILITARY, TERRORISM and CYBER trackers (data: contextData.js).
// Same frame as the plane/ship card (.track-card, styled in LiveLayers.jsx).

// Related coverage: what the countries' governments said and what outlets covered around the
// same place and dates, from Wire Room's own feeds (server: /api/related, lib/related.mjs).
const API_BASE = (import.meta.env.VITE_API_BASE || "https://wireroom-backend.onrender.com").replace(/\/+$/, "");
const ALIASES = { "us": ["america", "american", "u.s.", "usa"], "gb": ["uk", "britain", "british"], "tr": ["turkey"], "ae": ["uae"], "kr": ["korea"], "ru": ["russian"], "ua": ["ukrainian"], "il": ["israeli"], "ir": ["iranian"], "cn": ["chinese"], "in": ["indian"], "pk": ["pakistani"] };
const idOfName = (name) => {
  const n = String(name || "").toLowerCase();
  return Object.keys(WR_COUNTRIES).find((id) => WR_COUNTRIES[id].toLowerCase() === n || (ALIASES[id] || []).includes(n)) || null;
};
function Related({ countries, from, to, text, place, exclude = [], pad = 2, outside = null }) {
  const ids = [...new Set(countries.filter((id) => WR_COUNTRIES[id]))];
  const key = [ids.join(","), from, to, text, place].join("|");
  // The answer is kept with the key it was fetched for, so a new event shows "Looking…" until its own answer arrives.
  const [result, setResult] = React.useState({ key: null, official: [], news: [] });
  React.useEffect(() => {
    if (!ids.length) return undefined;
    const ctrl = new AbortController();
    const skip = ids.flatMap((id) => [WR_COUNTRIES[id], ...(ALIASES[id] || [])]).join(",");
    const qs = new URLSearchParams({ c: ids.join(","), from, to: to || from, q: text || "", place: place || "", skip, pad: String(pad) });
    fetch(`${API_BASE}/api/related?${qs}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setResult({ key, official: (d && d.official) || [], news: (d && d.news) || [] }))
      .catch((e) => { if (e.name !== "AbortError") setResult({ key, official: [], news: [] }); });
    return () => ctrl.abort();
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const state = { loading: ids.length > 0 && result.key !== key, official: result.key === key ? result.official : [], news: result.key === key ? result.news : [] };
  const skipUrls = new Set(exclude);
  const official = state.official.filter((r) => !skipUrls.has(r.url));
  const news = state.news.filter((r) => !skipUrls.has(r.url));
  const names = ids.map((id) => WR_COUNTRIES[id]).join(" and ");
  return (
    <div className="tc-related">
      <div className="tc-related-head">Related coverage</div>
      <div className="tc-related-note">
        {ids.length ? `Matched by place and date from ${names}${ids.length > 1 ? "'s feeds" : "'s feed"}. Not this event's own source.` : `Wire Room doesn't follow ${outside || "this country"}'s sources yet.`}
      </div>
      {state.loading && <div className="tc-related-note">Looking…</div>}
      {!state.loading && ids.length > 0 && !official.length && !news.length && (
        <div className="tc-related-note">Nothing matched in the reports Wire Room holds for these dates.</div>
      )}
      {(official.length > 0 || news.length > 0) && (
        <ul className="tc-src">
          {[...official, ...news].map((r) => (
            <li key={r.url}>
              <b className={r.sourceType === "official" ? "off" : ""}>{r.sourceType === "official" ? "Official" : "News"}</b>{r.source} · {dayLabel(r.publishedAt)}
              <a href={r.url} target="_blank" rel="noreferrer">Read →</a>
              <div style={{ color: "var(--muted)" }}>{r.headline}{r.translatedFrom ? " (machine-translated)" : ""}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
const dayOnly = (iso) => String(iso || "").slice(0, 10);

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
          <b className={s.sourceType === "official" ? "off" : ""}>{s.sourceType === "official" ? "Official" : "News"}</b>{s.source} · {dayLabel(s.publishedAt)}
          {s.url && <a href={s.url} target="_blank" rel="noreferrer">Read →</a>}
          {s.headline !== item.title && <div style={{ color: "var(--muted)" }}>{s.headline}</div>}
        </li>
      ))}
      {item.sources.length > max && <li style={{ color: "var(--muted)" }}>+{item.sources.length - max} more</li>}
    </ul>
  );
}

// One map marker = every event of one tracker reported at one place. A single event gets the
// full card; several get a list, like a marker a user pinned several reports to.
export function PlaceCard({ group, onClose, onPin, warOf }) {
  if (group.items.length === 1) return <IncidentCard item={group.items[0]} onClose={onClose} onPin={() => onPin(group.items[0])} war={warOf(group.items[0])} />;
  const color = group.kind === "strike" ? TRACKER_COLORS.strike : TRACKER_COLORS[group.kind];
  const where = group.precision === "country" ? `${group.place} · no city named` : group.precision === "worldwide" ? "Worldwide · no single place" : group.place;
  const adv = group.items.find((x) => x.advisory)?.advisory;
  return (
    <div className="track-card" role="dialog" aria-label={`${KIND_LABEL[group.kind]} reports at ${group.place}`} {...stop}>
      <Head onClose={onClose} title={where}
        icon={<Swatch kind={ICON_KIND[group.kind]} color={color} hollow={group.subtype !== "attack" && group.kind !== "strike"} size={12} />}
        kindText={`${KIND_LABEL[group.kind]} · ${group.items.length} events reported · last 7 days`} />
      {(group.precision === "country" || group.precision === "worldwide") && <div className="tc-adv" style={{ color: "var(--muted)" }}>{PRECISION_TEXT[group.precision].replace(/^./, (c) => c.toUpperCase())}.</div>}
      {adv && (
        <div className="tc-adv">US travel advisory for {adv.name}: Level {adv.level} of 4, {adv.levelText}. <a href={adv.url} target="_blank" rel="noreferrer">Read →</a></div>
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
              {it.kind !== "cyber" && <div className="ev-by">By: {byText(it)}{it.target ? ` · Target: ${it.target}` : ""}</div>}
              <Sources item={it} max={3} />
              {onPin && <button type="button" className="tc-pin ev-pin" onClick={() => onPin(it)}>Pin to map</button>}
            </li>
          );
        })}
      </ol>
      <div className="tc-foot">
        <span>{group.items.some((x) => x.checkedBy === "ai") ? "Checked by an AI model and placed from the reports" : "Placed automatically from the headlines"}. Reported, not verified by Wire Room.</span>
      </div>
    </div>
  );
}

// A reported terrorist attack or threat, cyberattack or warning, or military strike.
export function IncidentCard({ item, onClose, onPin, war = null }) {
  const color = item.kind === "strike" ? TRACKER_COLORS.strike : TRACKER_COLORS[item.kind];
  const hollow = item.subtype !== "attack";
  const rows = [
    ["Where", `${whereText(item)} · ${PRECISION_TEXT[item.precision] || item.precision}`],
    ...(item.kind !== "cyber" || (item.by && item.by.length) ? [["By", byText(item)]] : []),
    ...(item.target ? [["Target", item.target]] : []),
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
        <div className="tc-adv">US travel advisory for {item.advisory.name}: Level {item.advisory.level} of 4, {item.advisory.levelText}. <a href={item.advisory.url} target="_blank" rel="noreferrer">Read →</a></div>
      )}
      <Sources item={item} />
      <Related
        countries={[item.iso && item.iso.toLowerCase(), ...(item.by || []).map(idOfName)].filter(Boolean)}
        outside={item.country || item.place}
        from={dayOnly(item.firstReported)} to={dayOnly(item.lastReported)}
        text={item.title} place={item.precision === "country" ? "" : item.place}
        exclude={item.sources.map((s) => s.url).filter(Boolean)} />
      <div className="tc-foot">
        <span>{checkedText(item)}{item.translatedFrom ? " (machine-translated)" : ""}. Reported, not verified by Wire Room.</span>
      </div>
      <div className="tc-actions">
        {onPin && <button type="button" className="tc-pin" onClick={onPin}>Pin to map</button>}
        {incidentSearchUrl(item) && <a className="tc-intel" style={{ textDecoration: "none", display: "inline-block" }} href={incidentSearchUrl(item)} target="_blank" rel="noreferrer">Search news for this →</a>}
      </div>
    </div>
  );
}

// A war: casualties from UCDP, a web of its latest attacks on the map, and the intel panel.
export function WarCard({ war, onClose, onPin, intelOpen, onToggleIntel, reportedCount = 0, ucdpThrough = null, refDay = null }) {
  // UCDP publishes 1–2 months late: say exactly how far its data trails the day shown.
  const lag = ucdpThrough && refDay ? daysBetween(ucdpThrough, refDay) : null;
  const ago = (d) => (refDay && d ? ` (${daysBetween(d, refDay)} days before ${refDay === localDay() ? "today" : "this day"})` : "");
  const lm = war.latestMonth || {};
  const rows = [
    ["Sides", sidesText(war.sides)],
    ["Level", (LEVEL_TEXT[war.level] || LEVEL_TEXT.war).note],
    [coverageLabel(war.coverage) || "Total", `${deathsText(war.deaths)} · ${n(war.events)} events`],
    ["Latest event", `${dayLabel(war.latestEvent)}${ago(war.latestEvent)}`],
    ["Reported strikes", reportedCount ? `${reportedCount} in the news, last 7 days` : "none matched in the last 7 days"],
  ];
  return (
    <div className="track-card" role="dialog" aria-label="War details" {...stop}>
      <Head onClose={onClose} title={war.name} icon={<Swatch kind="war" color={TRACKER_COLORS.war} size={12} />} kindText={`${(LEVEL_TEXT[war.level] || LEVEL_TEXT.war).label} · UCDP verified events`} />
      <div className="tc-big">{n(lm.best)} killed<small>{monthLabel(lm.month)} · best estimate{Math.min(lm.low, lm.best) !== Math.max(lm.high, lm.best) ? `, range ${n(Math.min(lm.low, lm.best))}–${n(Math.max(lm.high, lm.best))}` : ""}{!lm.best && war.latestEvent ? ` · last event ${dayLabel(war.latestEvent)}` : ""}</small></div>
      {lag !== null && lag > 0 ? (
        <div className="tc-lag">UCDP data ends {dayLabel(ucdpThrough)}: {lag} days behind {refDay === localDay() ? "today" : "this day"}. Fighting since then shows only as strikes reported in the news (dashed lines).</div>
      ) : (
        <div className="tc-lag ok">UCDP verified events, published 1–2 months after they happen.</div>
      )}
      <div style={{ font: "11px var(--font)", color: "var(--muted)", margin: "0 0 8px" }}>Totals cover {coverageLabel(war.coverage) || "the latest 12 months"} only; earlier fighting isn't INCLUDED.</div>
      <dl>
        {rows.map(([k, v]) => (<React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>))}
      </dl>
      <div className="tc-legend">
        <span><svg width="22" height="6" aria-hidden="true"><line x1="0" y1="3" x2="22" y2="3" stroke={TRACKER_COLORS.war} strokeWidth="1.5" /></svg>Latest {war.nodes.length} UCDP-verified events (size = deaths)</span>
        <span><svg width="22" height="6" aria-hidden="true"><line x1="0" y1="3" x2="22" y2="3" stroke={TRACKER_COLORS.strike} strokeWidth="1.5" strokeDasharray="3 2" /></svg>Strikes reported in the news, not yet verified</span>
      </div>
      <div className="tc-foot">
        <span>Side names as UCDP codes them. Figures may be revised.</span>
        <a href="https://ucdp.uu.se/downloads/" target="_blank" rel="noreferrer">UCDP data →</a>
      </div>
      <div className="tc-actions">
        <button type="button" className={`tc-intel ${intelOpen ? "on" : ""}`} aria-pressed={intelOpen} onClick={onToggleIntel}>
          {intelOpen ? "Close intel panel" : "Open intel panel"}{war.reportCount ? ` · ${war.reportCount}` : ""}
        </button>
        {onPin && <button type="button" className="tc-pin" onClick={onPin}>Pin to map</button>}
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
      <Head onClose={onClose} title={node.place || war.name} icon={<Swatch kind="war" color={TRACKER_COLORS.war} size={12} />} kindText="Conflict event · UCDP verified dataset" />
      {headline ? (
        <>
          <div style={{ font: "11px var(--font)", color: "var(--muted)", letterSpacing: 0, margin: "0 0 3px" }}>What happened (headline of UCDP's source)</div>
          <div className="tc-quote" style={{ fontStyle: "normal", color: "var(--text)" }}>“{headline}”</div>
        </>
      ) : <div className="tc-quote">UCDP didn't record a source headline for this event.</div>}
      <dl>
        <dt>Date</dt><dd>{dayLabel(node.date)}</dd>
        <dt>Deaths</dt><dd>{deathsText(node)}{node.civilians ? ` · ${n(node.civilians)} civilian${node.civilians === 1 ? "" : "s"}` : ""}</dd>
        <dt>Who</dt><dd>{isUnnamed(node.sideA) ? "Sides not yet identified by UCDP" : [node.sideA, node.sideB].filter(Boolean).join(" vs ") || war.name}</dd>
        <dt>Source</dt><dd>{node.office || "—"}{node.sources > 1 ? ` (1 of ${node.sources} reports UCDP used)` : ""}</dd>
        <dt>Place</dt><dd>{approx ? "Approximate: UCDP only knows the wider area" : "Location known"}</dd>
      </dl>
      <Related countries={war.ourCountries || []} outside={(war.countries || []).join(" and ")}
        from={node.date} to={node.date} pad={3}
        text={node.headline && !/^\d{1,2} \w+ \d{4}$/.test(node.headline) ? node.headline : ""}
        place={String(node.place || "").split(",")[0]} />
      <div className="tc-foot">
        <span>Coded by UCDP researchers from news and NGO reports. Preliminary; may be revised. UCDP doesn't publish article links.</span>
      </div>
      <div className="tc-actions">
        {search && <a className="tc-pin" style={{ textDecoration: "none", display: "inline-block" }} href={search} target="_blank" rel="noreferrer">Search news for this →</a>}
        <button type="button" className="tc-intel" onClick={onOpenWar}>{war.name} →</button>
      </div>
    </div>
  );
}
