import { useRef } from "react";
import { localDay, shiftDay, longDay, dayLabel } from "./contextData.js";

// Day picker for the EVENTS trackers: step back through past days to see the map as it stood at
// the end of each one, or jump to a date. TODAY returns to the live map (refreshed through the day).
// Two copies are rendered: floating at the top of the map on desktop, inside the TRACKERS box on
// phones (where the top of the map holds the drawing tools). CSS shows one.
export function DayBar({ day, onChange, minDay, historyFrom, past, loading, embedded = false }) {
  const today = localDay();
  const current = day || today;
  const inputRef = useRef(null);
  const go = (d) => onChange(!d || d >= today ? null : d < minDay ? minDay : d);
  const openPicker = () => {
    const el = inputRef.current;
    if (!el) return;
    try { el.showPicker(); } catch { el.focus(); el.click(); }
  };
  const beforeArchive = past && historyFrom && current < historyFrom.slice(0, 10);
  return (
    <div className={`day-bar ${embedded ? "embed" : "float"} ${past ? "past" : ""}`} role="group" aria-label="Map date" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      {!embedded && <style>{DAY_CSS}</style>}
      <div className="day-row">
        <button type="button" aria-label="Previous day" disabled={current <= minDay} onClick={() => go(shiftDay(current, -1))}>◀</button>
        <button type="button" className="day-label" onClick={openPicker} title="Pick a date">
          {past ? longDay(current).toUpperCase() : `TODAY · ${longDay(today).toUpperCase()}`}{loading ? " …" : ""}
        </button>
        <input ref={inputRef} className="day-input" type="date" aria-label="Pick a date" min={minDay} max={today} value={current}
          onChange={(e) => e.target.value && go(e.target.value)} />
        <button type="button" aria-label="Next day" disabled={!past} onClick={() => go(shiftDay(current, 1))}>▶</button>
        {past && <button type="button" className="day-today" onClick={() => go(null)}>TODAY</button>}
      </div>
      {past && (
        <div className="day-note">
          <span className="day-long">The map at the end of this day: incidents reported in the week up to it, conflicts active then. Planes and ships are live only.</span>
          <span className="day-short">As of the end of this day: the week's reports, active conflicts.</span>
          {beforeArchive ? ` Incident archive starts ${dayLabel(historyFrom)}; before that, conflicts only.` : ""}
        </div>
      )}
    </div>
  );
}

const DAY_CSS = `
.day-bar{position:absolute;top:10px;left:50%;transform:translateX(-50%);z-index:5;background:rgba(10,14,20,.92);border:1px solid rgba(255,255,255,.22);padding:4px;font-family:monospace;max-width:min(560px,calc(100% - 24px))}
.day-bar.past{border-color:#c9974b;box-shadow:0 0 0 1px rgba(201,151,75,.35)}
.day-row{display:flex;align-items:center;gap:4px;position:relative}
.day-row button{background:none;border:1px solid #26384d;color:#c4cbd6;font:11px monospace;padding:4px 8px;cursor:pointer;letter-spacing:.06em}
.day-row button:disabled{opacity:.35;cursor:default}
.day-row .day-label{border-color:transparent;color:#e8e3d8;font-weight:700;min-width:170px}
.day-bar.past .day-label{color:#f0c27a}
.day-row .day-today{border-color:#4fa6a0;color:#4fa6a0}
.day-input{position:absolute;left:40px;top:0;width:1px;height:1px;opacity:0;pointer-events:none}
.day-note{font:9px/1.45 monospace;color:#c9974b;padding:4px 4px 1px;max-width:520px}
.day-short{display:none}
.day-bar.embed{display:none;position:static;transform:none;border:0;border-bottom:1px solid #1d2a38;padding:0 0 5px;margin-bottom:5px;background:none;box-shadow:none;max-width:none}
@media(max-width:800px){.day-bar.float{display:none}.day-bar.embed{display:block}.day-bar.embed.past .day-row .day-label{color:#f0c27a}.day-row .day-label{min-width:0;font-size:10px;padding:5px 2px}.day-row button{padding:5px 6px}.day-long{display:none}.day-short{display:inline}}
`;
