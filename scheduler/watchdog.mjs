// Keeps the hourly data job on time.
//
// The data job (.github/workflows/fetch-news.yml) runs on GitHub's built-in schedule, but GitHub
// treats schedules as "best effort": in practice runs were 4 to 7 hours apart. This watchdog runs
// inside the backend (which is kept awake), checks every few minutes when the job last started,
// and starts it through GitHub's API if it's overdue. When GitHub's schedule is on time, the
// watchdog does nothing.
//
// Needs one environment variable on the backend: GITHUB_DISPATCH_TOKEN, a fine-grained GitHub
// token limited to this repository with "Actions: Read and write". Without it, nothing happens.

const API = "https://api.github.com";
const ACTIVE = new Set(["queued", "in_progress", "waiting", "requested", "pending"]);

export function watchdogConfig(env = process.env) {
  const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
  return {
    token: env.GITHUB_DISPATCH_TOKEN || "",
    repo: env.GITHUB_REPO || "wireroomapp/wireroom",
    workflow: env.DATA_WORKFLOW || "fetch-news.yml",
    ref: env.DATA_WORKFLOW_REF || "main",
    maxAgeMin: num(env.DATA_MAX_AGE_MINUTES, 70), // start the job if the last one began longer ago than this
    checkEveryMin: num(env.DATA_CHECK_MINUTES, 5),
  };
}

export function createWatchdog(cfg = watchdogConfig(), { fetchImpl = globalThis.fetch, now = () => Date.now(), log = console } = {}) {
  const state = {
    enabled: Boolean(cfg.token),
    maxAgeMinutes: cfg.maxAgeMin,
    lastCheckAt: null,
    lastRunStartedAt: null,
    lastRunStatus: null,
    lastDispatchAt: null,
    dispatches: 0,
    lastError: null,
  };
  const headers = {
    Authorization: `Bearer ${cfg.token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "wireroom-backend-watchdog",
  };
  const maxAgeMs = cfg.maxAgeMin * 60000;
  let busy = false;

  async function check() {
    if (!cfg.token || busy) return state;
    busy = true;
    state.lastCheckAt = new Date(now()).toISOString();
    try {
      const base = `${API}/repos/${cfg.repo}/actions/workflows/${encodeURIComponent(cfg.workflow)}`;
      const r = await fetchImpl(`${base}/runs?per_page=1`, { headers });
      if (!r.ok) throw new Error(`Couldn't read the job's runs (HTTP ${r.status})`);
      const run = ((await r.json()) || {}).workflow_runs?.[0] || null;
      state.lastRunStartedAt = run ? run.created_at : null;
      state.lastRunStatus = run ? run.status : null;

      const running = run && ACTIVE.has(run.status);
      const lastStart = run ? Date.parse(run.created_at) : 0;
      const recentlyAsked = state.lastDispatchAt && now() - Date.parse(state.lastDispatchAt) < maxAgeMs;
      if (running || now() - lastStart < maxAgeMs || recentlyAsked) {
        state.lastError = null;
        return state;
      }

      const d = await fetchImpl(`${base}/dispatches`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ ref: cfg.ref }),
      });
      if (d.status !== 204 && !d.ok) throw new Error(`Couldn't start the job (HTTP ${d.status})`);
      state.lastDispatchAt = new Date(now()).toISOString();
      state.dispatches += 1;
      state.lastError = null;
      log.log?.(`Watchdog: data job was overdue (last start ${state.lastRunStartedAt || "never"}), started it.`);
    } catch (e) {
      state.lastError = String((e && e.message) || e).slice(0, 200);
      log.warn?.(`Watchdog: ${state.lastError}`);
    } finally {
      busy = false;
    }
    return state;
  }

  let first = null;
  let timer = null;
  return {
    state,
    check,
    start() {
      if (!cfg.token || timer) return;
      first = setTimeout(check, 20000);
      timer = setInterval(check, cfg.checkEveryMin * 60000);
      first.unref?.();
      timer.unref?.();
    },
    stop() {
      clearTimeout(first);
      clearInterval(timer);
      timer = null;
    },
  };
}
