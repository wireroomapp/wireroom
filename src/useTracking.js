// Polls the Wire Room backend for one live layer (aircraft or ships).
// The browser only ever talks to OUR backend, so switching data providers
// (free -> commercial) never requires a frontend change.

import { useEffect, useState } from "react";

const API_BASE = (import.meta.env.VITE_API_BASE || "https://wireroom-backend.onrender.com").replace(/\/+$/, "");
const EMPTY = { items: [], status: "idle", message: "", attribution: "", fetchedAt: null, meta: null };
const TIMEOUT_MS = 25000; // the free Render backend can take a while to wake up

export function useTrackingFeed({ enabled, path, bbox, extra = "", pollMs = 15000 }) {
  const [state, setState] = useState(EMPTY);
  const [debouncedBbox, setDebouncedBbox] = useState(bbox);

  // Wait until the map stops moving before asking for a new area.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedBbox(bbox), 500);
    return () => clearTimeout(t);
  }, [bbox]);

  // Forget old positions when the layer is switched off.
  useEffect(() => {
    if (!enabled) return undefined;
    return () => setState(EMPTY);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    let controller = null;

    async function load() {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return; // tab in background
      controller?.abort();
      const mine = new AbortController();
      controller = mine;
      const timer = setTimeout(() => mine.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(`${API_BASE}${path}?bbox=${debouncedBbox}${extra}`, { signal: mine.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (cancelled || controller !== mine) return;
        setState({
          items: Array.isArray(json.items) ? json.items : [],
          status: json.status || "unavailable",
          message: json.meta?.message || "",
          attribution: json.meta?.attribution || "",
          fetchedAt: json.meta?.fetchedAt || null,
          meta: json.meta || null,
        });
      } catch {
        // Cancelled, or a newer request replaced this one: not an error.
        if (cancelled || controller !== mine) return;
        // Timed out or failed: keep the last positions on screen, but say the feed is down.
        setState((s) => ({ ...s, status: "unavailable", message: "" }));
      } finally {
        clearTimeout(timer);
      }
    }

    load();
    const interval = setInterval(load, pollMs);
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      controller?.abort();
    };
  }, [enabled, path, debouncedBbox, extra, pollMs]);

  if (!enabled) return EMPTY;
  if (state.status === "idle") return { ...state, status: "loading" };
  return state;
}
