// TEMPLATE for a paid / commercial AIS provider (Spire, MarineTraffic, etc.).
// Not wired in. When you sign a commercial deal:
//   1. Copy this file's shape into a real provider.
//   2. In index.mjs, add a case for it in createShipsProvider().
//   3. Set SHIPS_PROVIDER=<its key> and its credentials on Render.
// The frontend never changes, because it only ever sees this normalized vessel shape:
//   { mmsi, name, lat, lon, speedKt, course, heading, type, category, destination, updatedAt }

export function createTemplateShipsProvider(/* credentials */) {
  return {
    key: "template",
    start() {},
    stop() {},
    status() {
      return { state: "not-configured", connected: false, lastMessageAt: null, messages: 0, vessels: 0, lastError: "Template provider" };
    },
    query(/* bbox, max */) {
      return [];
    },
  };
}
