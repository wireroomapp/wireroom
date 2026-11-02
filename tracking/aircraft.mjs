// Aircraft providers. adsb.lol, airplanes.live and ADS-B Exchange-style paid APIs all speak
// the same "ADSBx v2" JSON shape, so ONE adapter covers them. Switching provider = changing
// the base URL / key (done through env vars in config.mjs).

import { createThrottledFetcher } from "./util.mjs";

export function normalizeAircraft(raw) {
  const lat = Number(raw.lat);
  const lon = Number(raw.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const alt = raw.alt_baro === "ground" ? 0 : Number(raw.alt_baro);
  const flags = Number(raw.dbFlags) || 0;
  return {
    id: String(raw.hex || "").toLowerCase(),
    callsign: String(raw.flight || "").trim() || null,
    reg: raw.r || null,
    type: raw.t || null,
    lat,
    lon,
    altFt: Number.isFinite(alt) ? alt : null,
    onGround: raw.alt_baro === "ground",
    speedKt: Number.isFinite(Number(raw.gs)) ? Math.round(Number(raw.gs)) : null,
    heading: Number.isFinite(Number(raw.track)) ? Math.round(Number(raw.track)) : null,
    military: (flags & 1) === 1,
  };
}

function normalizeList(json) {
  const list = Array.isArray(json?.ac) ? json.ac : Array.isArray(json?.aircraft) ? json.aircraft : [];
  return list.map(normalizeAircraft).filter((a) => a && a.id);
}

function makeAdsbxV2Provider({ key, baseUrl, headers = {}, minIntervalMs, fetchImpl }) {
  const get = createThrottledFetcher({ fetchImpl, minIntervalMs, headers });
  const base = baseUrl.replace(/\/+$/, "");
  return {
    key,
    // All aircraft inside a circle. radius is nautical miles (max 250 on the public feeds).
    async fetchArea({ lat, lon, radiusNm }) {
      return normalizeList(await get(`${base}/point/${lat}/${lon}/${radiusNm}`));
    },
    // Every military-flagged aircraft worldwide in one call (good fit for a geopolitics map).
    async fetchMilitary() {
      return normalizeList(await get(`${base}/mil`));
    },
  };
}

export function createAircraftProvider(config, fetchImpl = fetch) {
  const minIntervalMs = config.upstreamMinIntervalMs;
  switch (config.aircraftProvider) {
    case "adsblol":
      return makeAdsbxV2Provider({ key: "adsblol", baseUrl: "https://api.adsb.lol/v2", minIntervalMs, fetchImpl });
    case "airplaneslive":
      return makeAdsbxV2Provider({ key: "airplaneslive", baseUrl: "https://api.airplanes.live/v2", minIntervalMs, fetchImpl });
    case "adsbx": {
      const { baseUrl, apiKey, keyHeader } = config.adsbx;
      if (!baseUrl) return null; // not configured yet
      return makeAdsbxV2Provider({
        key: "adsbx",
        baseUrl,
        headers: apiKey ? { [keyHeader]: apiKey } : {},
        minIntervalMs: 0,
        fetchImpl,
      });
    }
    default:
      return null;
  }
}
