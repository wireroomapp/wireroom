import React from "react";
import { dayLabel, deathsText, STATUS_TEXT } from "./contextData.js";

// Details card for a tapped conflict event or terrorism advisory (data: contextData.js).
export function ContextCard({ kind, item, onClose, onPin }) {
  const isConflict = kind === "conflict";
  const rows = isConflict
    ? [
        ["Date", `${dayLabel(item.date)}${item.dateEnd && item.dateEnd !== item.date ? ` to ${dayLabel(item.dateEnd)}` : ""} · ${item.datePrecText}`],
        ["Place", `${item.place || item.country} · ${item.wherePrecText}`],
        ["Type", `${item.typeText} violence${item.conflict ? ` · ${item.conflict}` : ""}`],
        ["Deaths", deathsText(item.deaths)],
        ["Sources", `${item.sources} report${item.sources === 1 ? "" : "s"}${item.office ? `, first: ${item.office}` : ""}`],
        ["Status", STATUS_TEXT[item.status] || item.status || "—"],
      ]
    : [
        ["Level", `${item.level} of 4 · ${item.levelText}`],
        ["Risks named", item.risks.join(", ")],
        ["Issued", dayLabel(item.date)],
      ];
  const title = isConflict ? `${item.sideA || "Unknown"} vs ${item.sideB || "unknown"}` : item.name;
  return (
    <div className="track-card" role="dialog" aria-label={isConflict ? "Conflict event details" : "Travel advisory details"}
      onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <div className="tc-head">
        <div>
          <div className="tc-kind">{isConflict ? "CONFLICT EVENT · UCDP VERIFIED DATASET" : "TRAVEL ADVISORY · U.S. STATE DEPARTMENT"}</div>
          <h3>{title}</h3>
        </div>
        <button type="button" aria-label="Close" onClick={onClose}>&times;</button>
      </div>
      <dl>
        {rows.map(([k, v]) => (
          <React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>
        ))}
      </dl>
      {isConflict && item.headline && <div className="tc-quote">“{item.headline}”</div>}
      <div className="tc-foot">
        <span>{isConflict ? "Coded by researchers from news and NGO reports. Preliminary: UCDP may revise it." : "One government's guidance for its citizens, not an intelligence assessment."}</span>
        <a href={isConflict ? "https://ucdp.uu.se/downloads/" : item.url} target="_blank" rel="noreferrer">{isConflict ? "UCDP DATA →" : "READ ADVISORY →"}</a>
      </div>
      {onPin && <button type="button" className="tc-pin" onClick={onPin}>PIN TO MAP</button>}
    </div>
  );
}
