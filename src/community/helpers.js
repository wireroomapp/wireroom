// Pure helpers for the Community panel (no network): what gets published, how someone else's
// map is made safe to show, limits that match the database, links in text, friendly errors.
// Tested in tests/community.test.mjs.

// Same limits as the database (supabase/schema.sql).
export const LIMITS = { message: 2000, post: 1000, title: 120, article: 20000, caption: 2000, comment: 1000, bio: 280, displayName: 40, countries: 5, mapItems: 500, mapBytes: 300000 };
export const KINDS = [
  { id: "post", label: "Post", hint: "A short update or thought" },
  { id: "article", label: "Article", hint: "A longer piece with a title" },
  { id: "map", label: "Map", hint: "Your current map, with a title and caption" },
];

const TYPES = new Set(["marker", "text", "line", "shape", "circle", "polygon"]);
const MAX_RADIUS_KM = 20000; // same cap as the map (annotationSpace.js)
const MAX_AREA_POINTS = 200;
const num = (v) => (Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : undefined);
const str = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");
const httpUrl = (u) => (typeof u === "string" && /^https?:\/\//i.test(u) ? u.slice(0, 2000) : "");
const color = (c) => (typeof c === "string" && /^#[0-9a-f]{3,8}$/i.test(c) ? c : undefined);

export const validUsername = (s) => /^[a-z0-9_]{3,20}$/.test(String(s || ""));

// A pinned report keeps its link, headline, outlet and date, never the summary: posting a map
// republishes what's on it, and outlets' summaries are their writing (copyright).
function cleanPin(p) {
  if (!p || typeof p !== "object") return null;
  const headline = str(p.headline, 300);
  if (!headline) return null;
  const out = {
    id: str(String(p.id ?? ""), 120), headline, url: httpUrl(p.url), source: str(p.source, 80),
    sourceType: p.sourceType === "official" ? "official" : "independent", date: str(p.date, 40),
    publishedAt: str(p.publishedAt, 40), countryId: str(p.countryId, 8),
  };
  if (p.tr && typeof p.tr === "object" && p.tr.headline) out.tr = { headline: str(p.tr.headline, 300), from: str(p.tr.from, 12) };
  return out;
}

function cleanOne(a) {
  if (!a || typeof a !== "object" || !TYPES.has(a.type) || a.legacy) return null;
  const out = { id: str(String(a.id ?? ""), 80) || undefined, type: a.type };
  if (a.type === "line") {
    for (const k of ["x1", "y1", "x2", "y2"]) { out[k] = num(a[k]); if (out[k] === undefined) return null; }
  } else if (a.type === "polygon") {
    if (!Array.isArray(a.points)) return null;
    out.points = a.points.slice(0, MAX_AREA_POINTS).map((p) => ({ x: num(p && p.x), y: num(p && p.y) }));
    if (out.points.length < 3 || out.points.some((p) => p.x === undefined || p.y === undefined)) return null;
  } else {
    out.x = num(a.x); out.y = num(a.y);
    if (out.x === undefined || out.y === undefined) return null;
    if (a.type === "shape") { out.width = num(a.width); out.height = num(a.height); if (out.width === undefined || out.height === undefined) return null; }
    if (a.type === "circle") {
      out.radiusKm = num(a.radiusKm);
      if (out.radiusKm === undefined || out.radiusKm <= 0 || out.radiusKm > MAX_RADIUS_KM) return null;
      out.unit = a.unit === "km" ? "km" : "mi";
    }
  }
  if (a.type === "text") out.text = str(a.text, 500);
  else out.label = str(a.label, 120);
  if (a.type === "marker" || a.type === "circle" || a.type === "polygon") {
    const c = color(a.color);
    if (c) out.color = c;
  }
  if (a.type === "marker") {
    const pins = (Array.isArray(a.pins) ? a.pins : []).map(cleanPin).filter(Boolean).slice(0, 50);
    if (pins.length) out.pins = pins;
  }
  return out;
}

// My drawing -> what is stored when I post it.
export function cleanForPublish(annotations) {
  return (Array.isArray(annotations) ? annotations : []).map(cleanOne).filter(Boolean).slice(0, LIMITS.mapItems);
}

// Someone else's map, as loaded: same cleaning (it could have been written by hand, not by this app).
export const sanitizeShared = cleanForPublish;

// A copy into my own drawing: fresh ids so it never clashes with what I have, and a note of
// which post it came from, so a map I post from it can say "based on" that post.
export function copyForMe(annotations, fromPostId, makeId = () => (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`)) {
  return sanitizeShared(annotations).map((a) => ({ ...a, id: makeId(), ...(fromPostId ? { from: fromPostId } : {}) }));
}

// The post most of my drawing was copied from (if any), to credit it.
export function copiedFrom(annotations) {
  const counts = new Map();
  for (const a of Array.isArray(annotations) ? annotations : []) if (a && typeof a.from === "string") counts.set(a.from, (counts.get(a.from) || 0) + 1);
  let best = null;
  for (const [id, n] of counts) if (!best || n > best[1]) best = [id, n];
  return best ? best[0] : null;
}

export function describeDrawing(annotations) {
  const list = Array.isArray(annotations) ? annotations : [];
  const n = (t) => list.filter((a) => a && a.type === t).length;
  const pins = list.reduce((s, a) => s + ((a && a.pins && a.pins.length) || 0), 0);
  const parts = [[n("marker"), "marker"], [n("line"), "line"], [n("shape"), "shape"], [n("circle"), "circle"], [n("polygon"), "area"], [n("text"), "note"], [pins, "pinned report"]]
    .filter(([k]) => k > 0).map(([k, w]) => `${k} ${w}${k === 1 ? "" : "s"}`);
  return parts.length ? parts.join(", ") : "nothing drawn yet";
}

const clean = (s) => String(s || "").trim();

// What's wrong with a post before it is sent (the database checks the same things).
export function postProblem({ kind, title, body, annotations, countries }) {
  const t = clean(title), b = clean(body);
  if (!KINDS.some((k) => k.id === kind)) return "Pick Post, Article or Map.";
  if ((countries || []).length > LIMITS.countries) return `Tag up to ${LIMITS.countries} countries.`;
  if (kind === "post") {
    if (!b) return "Write something first.";
    if (b.length > LIMITS.post) return `Posts are up to ${LIMITS.post} characters. For something longer, write an article.`;
    return null;
  }
  if (!t) return kind === "map" ? "Give your map a title." : "Give your article a title.";
  if (t.length > LIMITS.title) return `Titles are up to ${LIMITS.title} characters.`;
  if (kind === "article") {
    if (!b) return "Write your article first.";
    if (b.length > LIMITS.article) return `Articles are up to ${LIMITS.article.toLocaleString()} characters.`;
    return null;
  }
  if (b.length > LIMITS.caption) return `Captions are up to ${LIMITS.caption.toLocaleString()} characters.`;
  const drawing = cleanForPublish(annotations);
  if (!drawing.length) return "Your map is empty. Close this, tap Draw on the map, add markers, lines, circles, areas, notes or pinned reports, then come back.";
  if ((Array.isArray(annotations) ? annotations.length : 0) > LIMITS.mapItems) return `Maps can have up to ${LIMITS.mapItems} items.`;
  if (JSON.stringify(drawing).length > LIMITS.mapBytes) return "This map is too big to post. Remove some markers or pinned reports.";
  return null;
}

// The row to send for a new post.
export function postRow({ kind, title, body, annotations, countries }) {
  const row = { kind, title: kind === "post" ? "" : clean(title), body: clean(body), countries: (countries || []).slice(0, LIMITS.countries) };
  if (kind === "map") {
    row.annotations = cleanForPublish(annotations);
    const from = copiedFrom(annotations);
    if (from) row.copied_from = from;
  }
  return row;
}

// Messages (newest first) -> one conversation per other person: the latest message and how many
// of theirs I haven't read.
export function groupConversations(rows, myId) {
  const byOther = new Map();
  for (const m of rows || []) {
    const mine = m.sender_id === myId;
    const otherId = mine ? m.recipient_id : m.sender_id;
    const other = (mine ? m.recipient : m.sender) || {};
    if (!byOther.has(otherId)) byOther.set(otherId, { other: { id: otherId, username: other.username || "", display_name: other.display_name || "" }, last: m, unread: 0 });
    if (!mine && !m.read_at) byOther.get(otherId).unread++;
  }
  return [...byOther.values()].sort((a, b) => String(b.last.created_at).localeCompare(String(a.last.created_at)));
}

// Text with web addresses made into links (rendered by the panel as plain text + <a>, never HTML).
export function linkParts(text) {
  const out = [];
  const s = String(text || "");
  const re = /\bhttps?:\/\/[^\s<>"']+/gi;
  let last = 0, m;
  while ((m = re.exec(s))) {
    let url = m[0];
    const trail = url.match(/[.,;:!?)\]]+$/); // "see https://x.com/a." -> link without the dot
    if (trail) url = url.slice(0, -trail[0].length);
    if (m.index > last) out.push({ text: s.slice(last, m.index) });
    out.push({ text: url, href: url });
    last = m.index + url.length;
    re.lastIndex = last;
  }
  if (last < s.length) out.push({ text: s.slice(last) });
  return out;
}

export function timeAgo(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 30 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// Supabase / Postgres errors -> something a visitor can act on.
export function friendlyError(e) {
  const msg = String((e && (e.message || e.error_description)) || e || "");
  if (/Too many/i.test(msg)) return "You're doing that a lot. Please wait a while and try again.";
  if (/duplicate key.*username|profiles_username_key/i.test(msg)) return "That username is taken. Try another.";
  if (/username.*check|profiles_username_check/i.test(msg)) return "Usernames are 3–20 characters: lowercase letters, numbers and _.";
  if (/duplicate key.*follows/i.test(msg)) return "You already follow them.";
  if (/post_shape|violates check constraint/i.test(msg)) return "That post doesn't fit the limits (length or missing title). Check it and try again.";
  if (/Only moderators/i.test(msg)) return "Only moderators can do that.";
  if (/row-level security/i.test(msg)) return "That isn't allowed. If your account was suspended, you can't post or comment.";
  if (/JWT|not authenticated|permission denied/i.test(msg)) return "Please sign in again.";
  if (/Failed to fetch|NetworkError|network|Load failed/i.test(msg)) return "Couldn't reach the community server. Check your connection and try again.";
  return msg ? `Something went wrong: ${msg.slice(0, 160)}` : "Something went wrong.";
}
