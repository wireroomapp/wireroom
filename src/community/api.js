// The community server (Supabase): sign-in, profiles, posts, comments, follows, reports,
// moderation. Every rule about who may read or change what lives in the database
// (supabase/schema.sql); this file only asks. The Supabase code loads only when the Community
// panel is used. Without a project set up (config/community.json, or VITE_SUPABASE_URL and
// VITE_SUPABASE_PUBLISHABLE_KEY), the Community panel doesn't show at all; with "enabled": false
// it shows only on links with ?communityPreview (for testing before launch).
import cfg from "../../config/community.json";
import { friendlyError, groupConversations, sanitizeShared } from "./helpers.js";

const URL_ = import.meta.env.VITE_SUPABASE_URL || cfg.url || "";
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || cfg.publishableKey || "";

const ENABLED = cfg.enabled !== false || import.meta.env.VITE_COMMUNITY_ENABLED === "1";
const hasParam = (name) => {
  try { return new URLSearchParams(window.location.search).has(name); } catch { return false; }
};
const fakeWanted = () => hasParam("fakeCommunity");
export const communityConfigured = (Boolean(URL_ && KEY) && (ENABLED || hasParam("communityPreview"))) || Boolean(import.meta.env.DEV && fakeWanted());

let apiPromise = null;
export function loadCommunityApi() {
  if (!communityConfigured) return Promise.resolve(null);
  if (!apiPromise) {
    // Trying the screens locally without a server: ?fakeCommunity (development builds only).
    apiPromise = (import.meta.env.DEV && fakeWanted()
      ? import("./fake.js").then((m) => m.makeFakeApi())
      : import("@supabase/supabase-js").then(({ createClient }) => makeApi(createClient(URL_, KEY, {
        auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      })))).catch((e) => { apiPromise = null; throw e; });
  }
  return apiPromise;
}

// Feed rows leave out the full text and the drawing (loaded when a post is opened).
const POST_LIST = "id, author_id, kind, title, excerpt, countries, map_items, copied_from, hidden, created_at, edited_at, author:profiles(username, display_name), comments(count)";
const POST_FULL = "id, author_id, kind, title, body, annotations, countries, map_items, copied_from, hidden, created_at, edited_at, author:profiles(username, display_name), comments(count)";
const PROFILE = "id, username, display_name, bio, hidden, created_at";
export const PAGE = 20;

export function flatPost(p) {
  if (!p) return p;
  const count = Array.isArray(p.comments) ? (p.comments[0] && p.comments[0].count) || 0 : p.comment_count || 0;
  const { author, comments, ...rest } = p; // eslint-disable-line no-unused-vars
  return { ...rest, username: author ? author.username : p.username || "", display_name: author ? author.display_name : p.display_name || "", comment_count: count };
}

async function run(q) {
  const { data, error } = await q;
  if (error) { const e = new Error(friendlyError(error)); e.cause = error; throw e; }
  return data;
}

function makeApi(sb) {
  const me = async () => (await sb.auth.getSession()).data.session?.user || null;
  return {
    onAuth(cb) {
      const { data } = sb.auth.onAuthStateChange((_event, session) => cb(session?.user || null));
      sb.auth.getSession().then(({ data: d }) => cb(d.session?.user || null));
      return () => data.subscription.unsubscribe();
    },
    async signIn() {
      // Come back to the same page with the Community panel open.
      const back = new URL(window.location.href);
      for (const k of ["code", "error", "error_code", "error_description"]) back.searchParams.delete(k);
      back.searchParams.set("community", "1");
      const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: back.toString() } });
      if (error) throw new Error(friendlyError(error));
    },
    async signOut() { await sb.auth.signOut(); },

    async myProfile() {
      const u = await me();
      if (!u) return null;
      const rows = await run(sb.from("profiles").select(PROFILE).eq("id", u.id).limit(1));
      return rows[0] || null;
    },
    async isAdmin() {
      if (!(await me())) return false;
      try { return Boolean(await run(sb.rpc("am_admin"))); } catch { return false; }
    },
    async createProfile({ username, display_name }) {
      const u = await me();
      if (!u) throw new Error("Please sign in first.");
      await run(sb.from("profiles").insert({ id: u.id, username, display_name: display_name || "" }));
    },
    async updateProfile(id, { display_name, bio }) { await run(sb.from("profiles").update({ display_name, bio }).eq("id", id)); },
    async profile(username) {
      const rows = await run(sb.from("profiles").select(PROFILE).eq("username", username).limit(1));
      const p = rows[0];
      if (!p) return null;
      const count = async (q) => (await q).count || 0;
      const u = await me();
      const [followers, following, mine] = await Promise.all([
        count(sb.from("follows").select("follower_id", { count: "exact", head: true }).eq("followee_id", p.id)),
        count(sb.from("follows").select("followee_id", { count: "exact", head: true }).eq("follower_id", p.id)),
        u ? sb.from("follows").select("followee_id").eq("follower_id", u.id).eq("followee_id", p.id).limit(1) : { data: [] },
      ]);
      return { ...p, followers, following, isFollowing: Boolean(mine.data && mine.data.length) };
    },

    // scope: "latest" | "following" | "user"; before: created_at of the last post shown (paging)
    async listPosts({ scope = "latest", userId = null, before = null, country = null, limit = PAGE } = {}) {
      let q = sb.from("posts").select(POST_LIST).order("created_at", { ascending: false }).limit(limit);
      if (before) q = q.lt("created_at", before);
      if (country) q = q.contains("countries", [country]);
      if (scope === "user") q = q.eq("author_id", userId);
      else if (scope === "following") {
        const u = await me();
        if (!u) return [];
        const ids = (await run(sb.from("follows").select("followee_id").eq("follower_id", u.id).limit(1000))).map((r) => r.followee_id);
        if (!ids.length) return [];
        q = q.in("author_id", ids);
      }
      return (await run(q)).map(flatPost);
    },
    async getPost(id) {
      const rows = await run(sb.from("posts").select(POST_FULL).eq("id", id).limit(1));
      const p = flatPost(rows[0]);
      if (!p) return null;
      if (p.annotations) p.annotations = sanitizeShared(p.annotations);
      if (p.copied_from) {
        const o = (await run(sb.from("posts").select("id, title, author:profiles(username)").eq("id", p.copied_from).limit(1)))[0];
        p.original = o ? { id: o.id, title: o.title, username: o.author ? o.author.username : "" } : null;
      }
      return p;
    },
    async createPost(row) { return (await run(sb.from("posts").insert(row).select("id")))[0].id; },
    async updatePost(id, fields) { await run(sb.from("posts").update(fields).eq("id", id)); },
    async deletePost(id) { await run(sb.from("posts").delete().eq("id", id)); },

    async comments(postId) {
      const rows = await run(sb.from("comments").select("id, post_id, author_id, body, annotations, hidden, created_at, author:profiles(username, display_name)")
        .eq("post_id", postId).order("created_at", { ascending: true }).limit(500));
      return rows.map((c) => ({ ...c, annotations: c.annotations ? sanitizeShared(c.annotations) : null, username: c.author ? c.author.username : "", display_name: c.author ? c.author.display_name : "" }));
    },
    // annotations: a map attached to the comment (cleanForPublish'd), or null
    async addComment(postId, body, annotations = null) { await run(sb.from("comments").insert({ post_id: postId, body, ...(annotations ? { annotations } : {}) })); },
    async deleteComment(id) { await run(sb.from("comments").delete().eq("id", id)); },

    async follow(id) { await run(sb.from("follows").insert({ followee_id: id })); },
    async unfollow(id) {
      const u = await me();
      if (u) await run(sb.from("follows").delete().eq("follower_id", u.id).eq("followee_id", id));
    },
    async report(type, id, reason) { await run(sb.from("reports").insert({ target_type: type, target_id: id, reason: reason || "" })); },
    async moderate(type, id, hide) { await run(sb.rpc("moderate", { p_type: type, p_id: id, p_hide: hide })); },
    async openReports() { return (await run(sb.rpc("open_reports"))) || []; },
    async dismissReport(id) { await run(sb.rpc("dismiss_report", { p_id: id })); },
    // Direct messages. Only the two people in a conversation can read it (database rules).
    async conversations() {
      const u = await me();
      if (!u) return [];
      const rows = await run(sb.from("messages")
        .select("id, sender_id, recipient_id, body, read_at, created_at, sender:profiles!messages_sender_fk(username, display_name), recipient:profiles!messages_recipient_fk(username, display_name)")
        .or(`sender_id.eq.${u.id},recipient_id.eq.${u.id}`).order("created_at", { ascending: false }).limit(300));
      return groupConversations(rows, u.id);
    },
    async thread(otherId) {
      const u = await me();
      if (!u) return [];
      const rows = await run(sb.from("messages").select("id, sender_id, recipient_id, body, annotations, read_at, created_at")
        .or(`and(sender_id.eq.${u.id},recipient_id.eq.${otherId}),and(sender_id.eq.${otherId},recipient_id.eq.${u.id})`)
        .order("created_at", { ascending: false }).limit(200));
      return rows.reverse().map((m) => ({ ...m, mine: m.sender_id === u.id, annotations: m.annotations ? sanitizeShared(m.annotations) : null }));
    },
    async sendMessage(otherId, body, annotations = null) {
      try {
        await run(sb.from("messages").insert({ recipient_id: otherId, body, ...(annotations ? { annotations } : {}) }));
      } catch (e) {
        if (/row-level security/i.test((e.cause && e.cause.message) || "")) throw new Error("Not sent: one of you has blocked the other, or one account is suspended.", { cause: e });
        throw e;
      }
    },
    async markRead(otherId) {
      const u = await me();
      if (u) await run(sb.from("messages").update({ read_at: new Date().toISOString() }).eq("recipient_id", u.id).eq("sender_id", otherId).is("read_at", null));
    },
    async unsend(id) { await run(sb.from("messages").delete().eq("id", id)); },
    async unreadCount() {
      const u = await me();
      if (!u) return 0;
      const { count, error } = await sb.from("messages").select("id", { count: "exact", head: true }).eq("recipient_id", u.id).is("read_at", null);
      if (error) throw new Error(friendlyError(error));
      return count || 0;
    },
    async myBlocks() { return (await run(sb.from("blocks").select("blocked_id"))).map((r) => r.blocked_id); },
    async block(id) { await run(sb.from("blocks").insert({ blocked_id: id })); },
    async unblock(id) {
      const u = await me();
      if (u) await run(sb.from("blocks").delete().eq("blocker_id", u.id).eq("blocked_id", id));
    },
    async deleteAccount() { await run(sb.rpc("delete_my_account")); await sb.auth.signOut(); },
  };
}
