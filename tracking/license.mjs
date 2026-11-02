// License guard. This is a safety rail, not legal advice.
// "commercial" values describe what the providers' public terms said when we checked
// (Nov 2026). Re-check the official terms before relying on any of this.

export const PROVIDER_INFO = {
  adsblol: {
    label: "adsb.lol",
    commercial: "unverified", // terms do not clearly address commercial use; data is ODbL; a key requirement is announced
    attribution: "Aircraft data: adsb.lol (ODbL)",
    note: "Commercial use is not specified. Ask the operators in writing before launch.",
  },
  airplaneslive: {
    label: "airplanes.live",
    commercial: "no", // API is stated as non-commercial
    attribution: "Aircraft data: airplanes.live",
    note: "API is for non-commercial use. Needs a separate arrangement for commercial use.",
  },
  adsbx: {
    label: "ADS-B Exchange-style API",
    commercial: "contract", // fine only under a commercial contract you hold
    attribution: "",
    note: "Use only with a commercial licence from your provider.",
  },
  aisstream: {
    label: "AISStream.io",
    commercial: "unverified", // free single tier in beta; commercial wording not confirmed
    attribution: "Vessel data: AISStream.io",
    note: "Read their current terms before commercial use. Beta service, no uptime promise.",
  },
};

// Returns { allowed, reason, info }
export function checkLicense(providerKey, config) {
  const info = PROVIDER_INFO[providerKey];
  if (!info) return { allowed: false, reason: `Unknown provider "${providerKey}"`, info: null };

  if (config.mode !== "commercial") {
    return { allowed: true, reason: "", info };
  }
  if (config.cleared[providerKey]) {
    return { allowed: true, reason: "", info };
  }
  return {
    allowed: false,
    reason:
      `${info.label} is not cleared for commercial mode. ${info.note} ` +
      `After you have written permission or a licence, set LICENSE_CLEARED_${providerKey.toUpperCase()}=true, ` +
      `or switch provider.`,
    info,
  };
}
