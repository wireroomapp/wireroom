// Wire Room tracking layer: ALL switching between free and commercial sources
// happens here, through environment variables. No code change needed.
//
// Set these on Render (backend service -> Environment):
//   TRACKING_MODE        mvp | commercial        (default: mvp)
//   AIRCRAFT_PROVIDER    adsblol | airplaneslive | adsbx   (default: adsblol)
//   SHIPS_PROVIDER       aisstream | none        (default: aisstream)
//   AISSTREAM_API_KEY    your free key from aisstream.io (backend only, never in App.jsx)
//
// For a paid ADS-B Exchange-style API (commercial licence), set AIRCRAFT_PROVIDER=adsbx plus:
//   ADSBX_BASE_URL       e.g. https://your-licensed-provider.example/v2
//   ADSBX_API_KEY        your key
//   ADSBX_KEY_HEADER     header name the provider wants (default: api-auth)
//
// In commercial mode a provider only runs if you have confirmed you hold the right to use it:
//   LICENSE_CLEARED_ADSBLOL=true    (only after written permission from adsb.lol)
//   LICENSE_CLEARED_ADSBX=true      (only after you have a commercial licence)
//   LICENSE_CLEARED_AISSTREAM=true  (only after you have read and accepted their commercial terms)

const env = process.env;

function num(name, fallback) {
  const v = Number(env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export function loadConfig(e = env) {
  const get = (k, d) => (e[k] === undefined || e[k] === "" ? d : e[k]);
  return {
    mode: String(get("TRACKING_MODE", "mvp")).toLowerCase(),
    aircraftProvider: String(get("AIRCRAFT_PROVIDER", "adsblol")).toLowerCase(),
    shipsProvider: String(get("SHIPS_PROVIDER", "aisstream")).toLowerCase(),

    aircraftCacheMs: Number(get("AIRCRAFT_CACHE_MS", 15000)),
    // Public ADS-B feeds ask for ~1 request/second. We stay a bit under that.
    upstreamMinIntervalMs: Number(get("AIRCRAFT_MIN_INTERVAL_MS", 1100)),
    maxRadiusNm: Number(get("AIRCRAFT_MAX_RADIUS_NM", 250)),
    maxResults: Number(get("TRACKING_MAX_RESULTS", 1500)),

    adsbx: {
      baseUrl: get("ADSBX_BASE_URL", ""),
      apiKey: get("ADSBX_API_KEY", ""),
      keyHeader: get("ADSBX_KEY_HEADER", "api-auth"),
    },

    ais: {
      apiKey: get("AISSTREAM_API_KEY", ""),
      url: get("AISSTREAM_URL", "wss://stream.aisstream.io/v0/stream"), // only change for local testing
      // "chokepoints" (default) or "global" or a JSON list of [[lat1,lon1],[lat2,lon2]] boxes
      boxes: get("SHIPS_BBOXES", "chokepoints"),
      staleAfterMs: Number(get("SHIPS_STALE_AFTER_MS", 10 * 60 * 1000)),
      keepMs: Number(get("SHIPS_KEEP_MS", 30 * 60 * 1000)),
      maxVessels: Number(get("SHIPS_MAX_VESSELS", 25000)),
      warmupMs: Number(get("SHIPS_WARMUP_MS", 4 * 60 * 1000)), // "just restarted" period after a deploy
    },

    cleared: {
      adsblol: get("LICENSE_CLEARED_ADSBLOL", "") === "true",
      airplaneslive: get("LICENSE_CLEARED_AIRPLANESLIVE", "") === "true",
      adsbx: get("LICENSE_CLEARED_ADSBX", "") === "true",
      aisstream: get("LICENSE_CLEARED_AISSTREAM", "") === "true",
    },
  };
}

export { num };
