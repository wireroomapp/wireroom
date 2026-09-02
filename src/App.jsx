import React, { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";

/*
  WIRE ROOM — Global News Map V2
  Frontend-first architecture:
  - Country/source registry is explicit and editable.
  - UI can consume a future /api/news endpoint.
  - Falls back to demo data so the interface is usable without a backend.
  - No API keys belong in this browser component.
*/

const MAP_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

// The real, deployed backend — no longer a same-origin /api proxy since
// the frontend and backend now live on different domains.
const API_BASE = "https://wireroom-backend.onrender.com";

const COUNTRIES = [
  { id:"us", name:"United States", code:"US", lat:38.9, lon:-77.0, region:"Americas", sources:["White House","Department of Defense","Department of State"] },
  { id:"ca", name:"Canada", code:"CA", lat:45.4, lon:-75.7, region:"Americas", sources:["Prime Minister's Office","Global Affairs Canada","National Defence"] },
  { id:"mx", name:"Mexico", code:"MX", lat:19.4, lon:-99.1, region:"Americas", sources:["Presidencia","Secretaría de Relaciones Exteriores","Defensa"] },
  { id:"br", name:"Brazil", code:"BR", lat:-15.8, lon:-47.9, region:"Americas", sources:["Presidência","Ministério das Relações Exteriores","Ministério da Defesa"] },
  { id:"ar", name:"Argentina", code:"AR", lat:-34.6, lon:-58.4, region:"Americas", sources:["Casa Rosada","Cancillería","Ministerio de Defensa"] },
  { id:"gb", name:"United Kingdom", code:"UK", lat:51.5, lon:-0.1, region:"Europe", sources:["Prime Minister's Office","Foreign Office","Ministry of Defence"] },
  { id:"fr", name:"France", code:"FR", lat:48.9, lon:2.3, region:"Europe", sources:["Élysée","Ministère de l'Europe et des Affaires étrangères","Ministère des Armées"] },
  { id:"de", name:"Germany", code:"DE", lat:52.5, lon:13.4, region:"Europe", sources:["Bundesregierung","Auswärtiges Amt","Bundeswehr"] },
  { id:"it", name:"Italy", code:"IT", lat:41.9, lon:12.5, region:"Europe", sources:["Presidenza del Consiglio","Ministero degli Esteri","Ministero della Difesa"] },
  { id:"es", name:"Spain", code:"ES", lat:40.4, lon:-3.7, region:"Europe", sources:["La Moncloa","Ministerio de Asuntos Exteriores","Ministerio de Defensa"] },
  { id:"pl", name:"Poland", code:"PL", lat:52.2, lon:21.0, region:"Europe", sources:["Kancelaria Premiera","Ministerstwo Spraw Zagranicznych","Ministerstwo Obrony"] },
  { id:"ua", name:"Ukraine", code:"UA", lat:50.45, lon:30.52, region:"Europe", sources:["Office of the President","Ministry of Foreign Affairs","Ministry of Defence"] },
  { id:"ru", name:"Russia", code:"RU", lat:55.75, lon:37.6, region:"Europe/Asia", sources:["Kremlin","Ministry of Foreign Affairs","Ministry of Defence"] },
  { id:"tr", name:"Türkiye", code:"TR", lat:39.9, lon:32.9, region:"Europe/Asia", sources:["Presidency","Ministry of Foreign Affairs","Ministry of National Defence"] },
  { id:"il", name:"Israel", code:"IL", lat:31.77, lon:35.2, region:"Middle East", sources:["Prime Minister's Office","Ministry of Foreign Affairs","IDF"] },
  { id:"ir", name:"Iran", code:"IR", lat:35.7, lon:51.4, region:"Middle East", sources:["Presidency","Ministry of Foreign Affairs","Armed Forces"] },
  { id:"sa", name:"Saudi Arabia", code:"SA", lat:24.7, lon:46.7, region:"Middle East", sources:["Royal Court","Ministry of Foreign Affairs","Ministry of Defense"] },
  { id:"ae", name:"United Arab Emirates", code:"AE", lat:24.5, lon:54.4, region:"Middle East", sources:["Presidential Court","Ministry of Foreign Affairs","Ministry of Defence"] },
  { id:"eg", name:"Egypt", code:"EG", lat:30.0, lon:31.2, region:"Africa", sources:["Presidency","Ministry of Foreign Affairs","Ministry of Defence"] },
  { id:"za", name:"South Africa", code:"ZA", lat:-25.7, lon:28.2, region:"Africa", sources:["The Presidency","DIRCO","Department of Defence"] },
  { id:"ng", name:"Nigeria", code:"NG", lat:9.1, lon:7.5, region:"Africa", sources:["State House","Ministry of Foreign Affairs","Defence Headquarters"] },
  { id:"in", name:"India", code:"IN", lat:28.6, lon:77.2, region:"Asia", sources:["Prime Minister's Office","Ministry of External Affairs","Ministry of Defence"] },
  { id:"pk", name:"Pakistan", code:"PK", lat:33.7, lon:73.1, region:"Asia", sources:["Prime Minister's Office","Ministry of Foreign Affairs","Inter-Services Public Relations"] },
  { id:"cn", name:"China", code:"CN", lat:39.9, lon:116.4, region:"Asia", sources:["State Council","Ministry of Foreign Affairs","Ministry of National Defense"] },
  { id:"jp", name:"Japan", code:"JP", lat:35.7, lon:139.7, region:"Asia", sources:["Prime Minister's Office","Ministry of Foreign Affairs","Ministry of Defense"] },
  { id:"kr", name:"South Korea", code:"KR", lat:37.6, lon:127.0, region:"Asia", sources:["Office of the President","Ministry of Foreign Affairs","Ministry of National Defense"] },
  { id:"tw", name:"Taiwan", code:"TW", lat:25.0, lon:121.6, region:"Asia", sources:["Presidential Office","Ministry of Foreign Affairs","Ministry of National Defense"] },
  { id:"id", name:"Indonesia", code:"ID", lat:-6.2, lon:106.8, region:"Asia", sources:["Presidential Office","Ministry of Foreign Affairs","Ministry of Defense"] },
  { id:"au", name:"Australia", code:"AU", lat:-35.3, lon:149.1, region:"Oceania", sources:["Prime Minister's Office","Department of Foreign Affairs and Trade","Department of Defence"] },
];

const DEMO_NEWS = [
  { id:"demo-1", countryId:"us", sourceType:"official", source:"White House", headline:"Latest presidential statements and announcements", summary:"Demo content for the V2 interface. The production backend will replace this with a verified official source result.", date:"Demo", url:"#", importance:3 },
  { id:"demo-2", countryId:"us", sourceType:"independent", source:"Reuters", headline:"Independent coverage will appear here when enabled", summary:"The independent layer is optional and will be kept separate from official government reporting.", date:"Demo", url:"#", importance:2 },
  { id:"demo-3", countryId:"cn", sourceType:"official", source:"Ministry of Foreign Affairs", headline:"Official statement feed placeholder", summary:"Source-specific ingestion will populate this card once the backend is connected.", date:"Demo", url:"#", importance:3 },
  { id:"demo-4", countryId:"il", sourceType:"official", source:"Government source", headline:"Official government reporting placeholder", summary:"This demonstrates how country activity will surface on the global map.", date:"Demo", url:"#", importance:3 },
];

function SourceTag({ type }) {
  return <span className={`tag ${type === "official" ? "official" : "independent"}`}>{type === "official" ? "OFFICIAL" : "NEWS"}</span>;
}

function NewsCard({ item }) {
  return <article className="card">
    <div className="card-meta"><SourceTag type={item.sourceType}/><span>{item.source}</span><span>{item.date}</span></div>
    <h3>{item.headline}</h3>
    <p>{item.summary}</p>
    {item.url && item.url !== "#" && <a href={item.url} target="_blank" rel="noreferrer">READ ORIGINAL →</a>}
  </article>;
}

export default function WireRoomV2() {
  const [selected, setSelected] = useState(null);
  const [mode, setMode] = useState("official"); // official | news | both
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState("ALL");
  const [feed, setFeed] = useState(DEMO_NEWS);
  const [officialVerifiedMap, setOfficialVerifiedMap] = useState({});
  const [loading, setLoading] = useState(false);
  const [mapFeatures, setMapFeatures] = useState([]);
  const [dims, setDims] = useState({w:1200,h:700});
  const [transform, setTransform] = useState({k:1,x:0,y:0});
  const stageRef = useRef(null);
  const svgRef = useRef(null);
  const zoomRef = useRef(null);
  const abortRef = useRef(null); // cancels a stale request when a newer one starts

  useEffect(() => {
    fetch(MAP_URL).then(r => r.json()).then(topology => {
      const obj = topology.objects.countries;
      if (!obj) return;
      const features = obj.geometries.map(g => ({ type:"Feature", properties:g.properties || {}, geometry:geometryFromTopo(topology,g) })).filter(f=>f.geometry);
      setMapFeatures(features);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const r = entries[0]?.contentRect;
      if (r?.width && r?.height) setDims({w:r.width,h:r.height});
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const projection = useMemo(() => d3.geoNaturalEarth1().fitSize([dims.w,dims.h],{type:"Sphere"}),[dims]);
  const path = useMemo(() => d3.geoPath(projection),[projection]);

  useEffect(() => {
    if (!svgRef.current) return;
    const zoom = d3.zoom().scaleExtent([1,8]).on("zoom", e => setTransform(e.transform));
    d3.select(svgRef.current).call(zoom);
    zoomRef.current = zoom;
    return () => d3.select(svgRef.current).on(".zoom",null);
  }, [dims]);

  const filteredCountries = useMemo(() => COUNTRIES.filter(c => {
    const q = query.trim().toLowerCase();
    return (!q || c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)) && (region === "ALL" || c.region === region);
  }), [query,region]);

  const visibleFeed = useMemo(() => {
    let items = feed;
    if (selected) items = items.filter(i => i.countryId === selected.id);
    // "news" mode maps to the backend's "independent" sourceType tag.
    if (mode !== "both") {
      const wantType = mode === "news" ? "independent" : mode;
      items = items.filter(i => i.sourceType === wantType);
    }
return [...items].sort((a, b) =>
  new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0)
);
  }, [feed,selected,mode]);

  async function loadCountry(country, modeOverride) {
    setSelected(country);
    setLoading(true);
    // Accept an explicit mode so switching filter tabs re-queries the
    // backend instead of only re-filtering whatever was fetched under
    // the mode that was active at selection time.
    const activeMode = modeOverride || mode;

    // Cancel whatever request was still in flight — without this, a
    // slower older request (e.g. from a tab you clicked a moment ago)
    // can resolve AFTER a newer one and silently overwrite it, showing
    // stale content under the wrong tab.
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // Production contract. No browser API key: the future backend owns this request.
      const response = await fetch(
        `${API_BASE}/api/news?country=${encodeURIComponent(country.id)}&mode=${encodeURIComponent(activeMode)}`,
        { signal: controller.signal }
      );
      if (response.ok) {
        const data = await response.json();
 	if (abortRef.current !== controller) return;
       if (Array.isArray(data.items) && abortRef.current === controller) {
  setFeed(data.items);
}
        if (typeof data.officialVerified === "boolean") {
          setOfficialVerifiedMap(prev => ({ ...prev, [country.id]: data.officialVerified }));
        }
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        // Demo data remains visible when no backend exists yet.
      }
    } finally {
      if (abortRef.current === controller) setLoading(false);
    }
  }

  function changeMode(newMode) {
    setMode(newMode);
    if (selected) loadCountry(selected, newMode);
  }

  const regions = ["ALL", ...Array.from(new Set(COUNTRIES.map(c=>c.region)))];

  return <div className="app">
    <style>{CSS}</style>
    <header className="topbar">
      <div className="brand">WORLD <b>WIRE</b></div>
      <div className="subtitle">OFFICIAL STATEMENTS • GLOBAL NEWS</div>
      <div className="status">LIVE MAP / V2</div>
    </header>

    <div className="toolbar">
      <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="SEARCH COUNTRY"/>
      <select value={region} onChange={e=>setRegion(e.target.value)}>{regions.map(r=><option key={r}>{r}</option>)}</select>
      <div className="mode"><button className={mode==="official"?"active":""} onClick={()=>changeMode("official")}>OFFICIAL</button><button className={mode==="both"?"active":""} onClick={()=>changeMode("both")}>BOTH</button><button className={mode==="news"?"active":""} onClick={()=>changeMode("news")}>NEWS</button></div>
    </div>

    <main className="layout">
      <section className="map-wrap" ref={stageRef}>
        <svg ref={svgRef} className="map" viewBox={`0 0 ${dims.w} ${dims.h}`}>
          <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
            <path d={path({type:"Sphere"})} className="ocean"/>
            <path d={path(d3.geoGraticule().step([20,20])())} className="grid"/>
            {mapFeatures.map((f,i)=><path key={i} d={path(f)} className="land"/>)}
            {filteredCountries.map(c=>{
              const [x,y]=projection([c.lon,c.lat]); const active=selected?.id===c.id;
              const has=feed.some(n=>n.countryId===c.id);
              return <g key={c.id} transform={`translate(${x},${y})`} className="marker" onClick={()=>loadCountry(c)}>
                <circle r={active?6:has?4:3} className={active?"dot active":"dot"}/>
                {has && <circle r="7" className="pulse"/>}
                <text y="15">{c.code}</text>
              </g>;
            })}
          </g>
        </svg>
        <div className="map-note">SELECT A COUNTRY • CLICK MARKER FOR SOURCES</div>
      </section>

      <aside className={`panel ${selected?"open":""}`}>
        <div className="panel-head">
          <div>
            <div className="eyebrow">COUNTRY BRIEF</div>
            <h1>{selected?.name || "GLOBAL FEED"}</h1>
            <p>{selected ? selected.sources.join(" • ") : "Official government statements and optional trusted independent reporting"}</p>
            {selected && officialVerifiedMap[selected.id] !== undefined && (
              <p className={`source-status ${officialVerifiedMap[selected.id] === false ? "unverified" : "verified"}`}>
                {officialVerifiedMap[selected.id] === false
                  ? "⚠ Official source: not yet verified for this country"
                  : "✓ Official source: verified"}
              </p>
            )}
          </div>
          {selected && <button onClick={()=>setSelected(null)}>×</button>}
        </div>
        {loading && <div className="loading">CHECKING SOURCE FEEDS…</div>}
        {!loading && visibleFeed.length === 0 && (
          <div className="empty">
            {mode === "official" && selected && officialVerifiedMap[selected.id] === false ? (
              <>NO VERIFIED OFFICIAL SOURCE YET FOR THIS COUNTRY.<br/><small>We haven't found or confirmed a direct government feed for {selected.name} yet — this isn't the same as "nothing happening," it means the source itself is still unverified. Check the NEWS tab for independent coverage in the meantime.</small></>
            ) : mode === "official" && selected ? (
              <>NO NEW OFFICIAL STATEMENTS RIGHT NOW.<br/><small>{selected.name}'s official source is verified and connected — it just hasn't published anything new since the last check.</small></>
            ) : (
              <>NO STORIES IN THIS FILTER YET.<br/><small>The backend source-ingestion layer will populate this feed.</small></>
            )}
          </div>
        )}
        {visibleFeed.map(item=><NewsCard key={item.id} item={item}/>)}
      </aside>
    </main>
  </div>;
}

function geometryFromTopo(topology, geom) {
  const decode = (arc) => { let x=0,y=0; return arc.map(([dx,dy])=>{x+=dx;y+=dy;return topology.transform?[x*topology.transform.scale[0]+topology.transform.translate[0],y*topology.transform.scale[1]+topology.transform.translate[1]]:[x,y];}); };
  const ring = indices => { let out=[]; indices.forEach((idx,i)=>{const rev=idx<0;const n=rev?~idx:idx;let a=decode(topology.arcs[n]);if(rev)a=a.reverse();out=i?out.concat(a.slice(1)):a;});return out; };
  const conv = a => a.map(r=>ring(r));
  if (geom.type==="Polygon") return {type:"Polygon",coordinates:conv(geom.arcs)};
  if (geom.type==="MultiPolygon") return {type:"MultiPolygon",coordinates:geom.arcs.map(p=>conv(p))};
  return null;
}

const CSS = `
*{box-sizing:border-box} body{margin:0;background:#071019} .app{min-height:100vh;background:#071019;color:#e8e3d8;font-family:Arial,sans-serif}.topbar{height:64px;border-bottom:1px solid #1c2a3b;display:flex;align-items:center;padding:0 22px;gap:18px}.brand{font-weight:800;letter-spacing:.12em;font-size:21px}.brand b{color:#c9974b}.subtitle{font:11px monospace;color:#718198;letter-spacing:.08em}.status{margin-left:auto;font:10px monospace;color:#4fa6a0}.toolbar{height:54px;border-bottom:1px solid #162538;display:flex;align-items:center;gap:9px;padding:8px 18px}.toolbar input,.toolbar select,.mode button{background:#0c1724;border:1px solid #26384d;color:#aeb8c6;padding:8px 10px;font:11px monospace}.toolbar input{width:190px}.mode{margin-left:auto;display:flex}.mode button{cursor:pointer}.mode button.active{color:#c9974b;border-color:#c9974b}.layout{height:calc(100vh - 118px);display:flex}.map-wrap{position:relative;flex:1;min-width:0}.map{width:100%;height:100%;touch-action:none;cursor:grab}.map:active{cursor:grabbing}.ocean{fill:#0b1725;stroke:#21334a}.grid{fill:none;stroke:#142233;stroke-width:.5}.land{fill:#142230;stroke:#2a3c50;stroke-width:.65}.marker{cursor:pointer}.dot{fill:#c9974b}.dot.active{fill:#e8e3d8;stroke:#c9974b;stroke-width:2}.pulse{fill:none;stroke:#c9974b;stroke-width:1;opacity:.55;animation:pulse 2s infinite}.marker text{font:8px monospace;fill:#65758a;text-anchor:middle}.map-note{position:absolute;bottom:16px;left:18px;font:10px monospace;color:#4e6076}.panel{width:410px;background:#0c1724;border-left:1px solid #1c2a3b;padding:20px;overflow:auto}.panel-head{display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid #1c2a3b;padding-bottom:14px;margin-bottom:14px}.panel-head h1{margin:2px 0 4px;font-size:28px}.panel-head p{margin:0;color:#718198;font:10px monospace;line-height:1.5}.panel-head button{height:30px;background:none;border:1px solid #26384d;color:#8795a7;cursor:pointer}.eyebrow{font:9px monospace;letter-spacing:.12em;color:#4fa6a0}.source-status{margin:6px 0 0;font:10px monospace;letter-spacing:.04em}.source-status.verified{color:#4fa6a0}.source-status.unverified{color:#c9974b}.loading,.empty{font:11px monospace;color:#718198;padding:24px 4px;line-height:1.7}.card{border:1px solid #1d2d40;background:#071019;padding:13px;margin-bottom:10px}.card-meta{display:flex;gap:8px;align-items:center;color:#586b82;font:9px monospace;margin-bottom:8px}.tag{padding:2px 5px;border:1px solid}.tag.official{color:#4fa6a0;border-color:#315e5b}.tag.independent{color:#8a98aa;border-color:#3a4655}.card h3{font-size:14px;line-height:1.35;margin:0 0 7px}.card p{font-size:12px;line-height:1.5;color:#9ba8b8;margin:0 0 8px}.card a{font:10px monospace;color:#c9974b;text-decoration:none}@keyframes pulse{0%{transform:scale(1);opacity:.6}100%{transform:scale(3.2);opacity:0}}@media(max-width:800px){.layout{height:auto;min-height:calc(100vh - 118px)}.panel{position:absolute;right:0;top:118px;bottom:0;height:calc(100vh - 118px);width:min(420px,100%);transform:translateX(100%);transition:transform .25s;z-index:4}.panel.open{transform:translateX(0)}.subtitle{display:none}.toolbar{overflow:auto}.toolbar input{width:150px}.map-wrap{height:calc(100vh - 118px)}.status{display:none}}
`;
