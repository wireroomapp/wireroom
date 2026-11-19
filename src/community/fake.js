// In-memory stand-in for the community server, for trying the screens locally without Supabase:
// open the dev site with ?fakeCommunity (add &fakeAdmin to be a moderator). Never part of the
// production build. Its rules only roughly mirror supabase/schema.sql; the real rules are tested
// in tests/community-db.test.mjs.
import { sanitizeShared } from "./helpers.js";
import { PAGE } from "./api.js";

export function makeFakeApi() {
  const now = Date.now();
  const iso = (minAgo) => new Date(now - minAgo * 60000).toISOString();
  const admin = (() => { try { return new URLSearchParams(window.location.search).has("fakeAdmin"); } catch { return false; } })();
  const users = [
    { id: "u-alice", username: "alice_osint", display_name: "Alice", bio: "Black Sea shipping and drones.", hidden: false, created_at: iso(9000) },
    { id: "u-bob", username: "bob", display_name: "Bob", bio: "", hidden: false, created_at: iso(5000) },
  ];
  // Around Sevastopol and the Kerch Strait, in the app's "map units" (see annotationSpace.js).
  const drawing = [
    { id: "a1", type: "marker", x: 0.4598, y: -0.7863, label: "Sevastopol", color: "#ff5c5c", pins: [{ id: "p1", headline: "Ukrainian drones strike Black Sea Fleet ships", url: "https://example.com/a", source: "Reuters", sourceType: "independent", date: "Nov 18, 2026" }] },
    { id: "a2", type: "line", x1: 0.4598, y1: -0.7863, x2: 0.4983, y2: -0.7993, label: "Supply route" },
    { id: "a3", type: "text", x: 0.4763, y: -0.7739, text: "Strikes cluster near the naval base" },
  ];
  const posts = [
    { id: "p-1", author_id: "u-alice", kind: "map", title: "Black Sea drone strikes, week of Nov 16", body: "Where this week's drone strikes landed, from official and news reports. Pinned reports on each marker.", annotations: drawing, countries: ["ua", "ru"], copied_from: null, hidden: false, created_at: iso(90), edited_at: null },
    { id: "p-2", author_id: "u-bob", kind: "post", title: "", body: "Equinor's outage looks bigger than the first statement said. Watching the Norwegian regulator's site: https://www.nsm.no", annotations: null, countries: ["no"], copied_from: null, hidden: false, created_at: iso(240), edited_at: null },
    { id: "p-3", author_id: "u-alice", kind: "article", title: "Why the Kerch bridge keeps coming back", body: "Three reasons the bridge matters more than its size suggests.\n\nFirst, it is the only road and rail link to Crimea that doesn't run through the occupied south.\n\nSecond, every strike on it is reported by both governments within hours, which makes it a good test of how fast each side's official channel moves.\n\nThird, shipping through the strait depends on it staying open.", annotations: null, countries: ["ua", "ru"], copied_from: null, hidden: false, created_at: iso(1500), edited_at: iso(1400) },
  ];
  const follows = [];
  const comments = [{ id: "c-1", post_id: "p-1", author_id: "u-bob", body: "The line from Crimea looks right, matches the governor's statement.", hidden: false, created_at: iso(40) }];
  const reports = [];
  let user = null;
  const listeners = new Set();
  const emit = () => listeners.forEach((cb) => cb(user));
  const wait = () => new Promise((r) => setTimeout(r, 120));
  const author = (id) => users.find((u) => u.id === id) || {};
  const need = () => { if (!user) throw new Error("Please sign in again."); };
  const mine = () => users.find((u) => u.id === user?.id);
  const visible = (p) => !p.hidden || p.author_id === user?.id || admin;
  const flat = (p) => ({ ...p, username: author(p.author_id).username, display_name: author(p.author_id).display_name || "", comment_count: comments.filter((c) => c.post_id === p.id && !c.hidden).length, map_items: p.annotations ? p.annotations.length : 0, excerpt: p.body.replace(/\s+/g, " ").slice(0, 280) });
  let n = 0;
  const id = (pre) => `${pre}-${Date.now()}-${n++}`;

  return {
    fake: true,
    onAuth(cb) { listeners.add(cb); cb(user); return () => listeners.delete(cb); },
    async signIn() { await wait(); user = { id: "u-you", email: "you@example.com" }; emit(); },
    async signOut() { user = null; emit(); },
    async myProfile() { await wait(); return user ? mine() || null : null; },
    async isAdmin() { return Boolean(user) && admin; },
    async createProfile({ username, display_name }) {
      await wait(); need();
      if (users.some((u) => u.username === username)) throw new Error("That username is taken. Try another.");
      users.push({ id: user.id, username, display_name: display_name || "", bio: "", hidden: false, created_at: new Date().toISOString() });
    },
    async updateProfile(pid, f) { await wait(); need(); Object.assign(users.find((u) => u.id === pid), f); },
    async profile(username) {
      await wait();
      const p = users.find((u) => u.username === username);
      return p ? { ...p, followers: follows.filter((f) => f.followee_id === p.id).length, following: follows.filter((f) => f.follower_id === p.id).length, isFollowing: follows.some((f) => f.follower_id === user?.id && f.followee_id === p.id) } : null;
    },
    async listPosts({ scope = "latest", userId = null, before = null, country = null, limit = PAGE } = {}) {
      await wait();
      let list = posts.filter(visible).sort((a, b) => b.created_at.localeCompare(a.created_at));
      if (before) list = list.filter((p) => p.created_at < before);
      if (country) list = list.filter((p) => p.countries.includes(country));
      if (scope === "user") list = list.filter((p) => p.author_id === userId);
      else if (scope === "following") { const ids = follows.filter((f) => f.follower_id === user?.id).map((f) => f.followee_id); list = list.filter((p) => ids.includes(p.author_id)); }
      return list.slice(0, limit).map(flat).map(({ body, annotations, ...p }) => p); // eslint-disable-line no-unused-vars
    },
    async getPost(pid) {
      await wait();
      const p = posts.find((x) => x.id === pid && visible(x));
      if (!p) return null;
      const out = { ...flat(p), annotations: p.annotations ? sanitizeShared(p.annotations) : null };
      if (p.copied_from) { const o = posts.find((x) => x.id === p.copied_from); out.original = o ? { id: o.id, title: o.title, username: author(o.author_id).username } : null; }
      return out;
    },
    async createPost(row) {
      await wait(); need();
      if (!mine()) throw new Error("Pick a username first.");
      const p = { id: id("p"), author_id: user.id, title: "", body: "", annotations: null, countries: [], copied_from: null, hidden: false, created_at: new Date().toISOString(), edited_at: null, ...row };
      posts.push(p);
      return p.id;
    },
    async updatePost(pid, f) { await wait(); need(); const p = posts.find((x) => x.id === pid && x.author_id === user.id); if (p) Object.assign(p, f, { edited_at: new Date().toISOString() }); },
    async deletePost(pid) { await wait(); need(); const k = posts.findIndex((x) => x.id === pid && x.author_id === user.id); if (k >= 0) posts.splice(k, 1); },
    async comments(pid) { await wait(); return comments.filter((c) => c.post_id === pid && (!c.hidden || admin || c.author_id === user?.id)).map((c) => ({ ...c, username: author(c.author_id).username, display_name: author(c.author_id).display_name })); },
    async addComment(pid, body) { await wait(); need(); comments.push({ id: id("c"), post_id: pid, author_id: user.id, body, hidden: false, created_at: new Date().toISOString() }); },
    async deleteComment(cid) { await wait(); const k = comments.findIndex((c) => c.id === cid); if (k >= 0) comments.splice(k, 1); },
    async follow(fid) { await wait(); need(); follows.push({ follower_id: user.id, followee_id: fid }); },
    async unfollow(fid) { await wait(); const k = follows.findIndex((f) => f.follower_id === user?.id && f.followee_id === fid); if (k >= 0) follows.splice(k, 1); },
    async report(type, tid, reason) { await wait(); need(); reports.push({ id: reports.length + 1, target_type: type, target_id: tid, reason, created_at: new Date().toISOString(), reporter: mine()?.username, resolved: false }); },
    async moderate(type, tid, hide) {
      await wait();
      if (!admin) throw new Error("Only moderators can do that.");
      const list = type === "post" ? posts : type === "comment" ? comments : users;
      const t = list.find((x) => x.id === tid);
      if (t) t.hidden = hide;
      reports.forEach((r) => { if (r.target_id === tid) r.resolved = true; });
    },
    async openReports() {
      await wait();
      return reports.filter((r) => !r.resolved).map((r) => {
        const p = posts.find((x) => x.id === r.target_id), c = comments.find((x) => x.id === r.target_id);
        return { ...r, target_author: author((p || c || {}).author_id).username, target_text: p ? p.title || p.body : c ? c.body : "", target_hidden: Boolean((p || c || {}).hidden), post_id: p ? p.id : c ? c.post_id : null };
      });
    },
    async dismissReport(rid) { await wait(); const r = reports.find((x) => x.id === rid); if (r) r.resolved = true; },
    async deleteAccount() { await wait(); need(); const k = users.findIndex((u) => u.id === user.id); if (k >= 0) users.splice(k, 1); user = null; emit(); },
  };
}
