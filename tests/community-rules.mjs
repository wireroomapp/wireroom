// The community database rules, as checks that run in two places:
//   - tests/community-db.test.mjs: on PGlite (Postgres in-process) with a stand-in for Supabase
//   - scripts/community-db.mjs: on the real Supabase database, inside a transaction that is
//     rolled back, so nothing is left behind
// Each check runs SQL as a visitor: as(null, ...) = signed out, as(A, ...) = user A,
// as("admin", ...) = the dashboard (no rules apply).
import assert from "node:assert/strict";

export const A = "00000000-0000-4000-8000-00000000000a"; // alice, becomes a moderator
export const B = "00000000-0000-4000-8000-00000000000b"; // bob
export const C = "00000000-0000-4000-8000-00000000000c"; // carol, deletes her account at the end
export const D = "00000000-0000-4000-8000-00000000000d"; // dave, gets hidden (banned)
export const USERS = [A, B, C, D];

const drawing = JSON.stringify([{ id: "m1", type: "marker", x: 0.1, y: -0.2, label: "Port", pins: [{ headline: "Strike on port", url: "https://example.com/a", source: "AP" }] }]);

export const SECTIONS = [
  ["profiles: you can only make and change your own", async ({ as, fails, post, s }) => {
    await as(A, "insert into profiles (id, username, display_name) values ($1, 'alice', 'Alice')", [A]);
    await as(B, "insert into profiles (id, username) values ($1, 'bob')", [B]);
    await as(C, "insert into profiles (id, username) values ($1, 'carol')", [C]);
    await as(D, "insert into profiles (id, username) values ($1, 'dave')", [D]);
    await fails(as(B, "insert into profiles (id, username) values ($1, 'evil')", [C]), /row-level security|duplicate/);
    await fails(as(A, "update profiles set username = 'Bad Name!' where id = $1", [A]), /permission denied/);
    await fails(as(A, "update profiles set hidden = true where id = $1", [A]), /permission denied/);
    await as(B, "update profiles set bio = 'hacked' where id = $1", [A]);
    assert.equal((await as(null, "select bio from profiles where id = $1", [A]))[0].bio, "", "bob can't edit alice's profile");
    await as(A, "update profiles set bio = 'Black Sea watcher' where id = $1", [A]);
    assert.equal((await as(null, "select bio from profiles where id = $1", [A]))[0].bio, "Black Sea watcher");
    await fails(as(null, "insert into profiles (id, username) values ($1, 'anon1')", [C]), /permission denied/);
    await fails(as(D, "insert into profiles (id, username) values (gen_random_uuid(), 'Bad Name!')"), /permission denied|check|row-level/);
  }],

  ["posts: three kinds, each with its own shape", async ({ as, fails, post, s }) => {
    [s.note] = await post(B, "post", { body: "Watching the Kerch bridge tonight.", countries: ["ua", "ru"] });
    [s.article] = await post(A, "article", { title: "Why the Red Sea matters", body: "Long read.\n\nSecond paragraph." });
    [s.map] = await post(A, "map", { title: "Black Sea strikes", body: "This week's strikes.", annotations: drawing, countries: ["ua"] });
    const rows = await as(null, "select id, kind, excerpt, map_items from posts where author_id = any($1::uuid[])", [USERS]);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    assert.deepEqual([byId[s.note.id].kind, byId[s.article.id].kind, byId[s.map.id].kind], ["post", "article", "map"]);
    assert.equal(byId[s.article.id].excerpt, "Long read. Second paragraph.", "the feed's excerpt flattens line breaks");
    assert.equal(byId[s.map.id].map_items, 1);
    // Wrong shapes are refused by the database, whatever the website sends.
    await fails(post(B, "post", { body: "" }), /post_shape/);
    await fails(post(B, "post", { title: "Titles are for articles", body: "x" }), /post_shape/);
    await fails(post(B, "post", { body: "x".repeat(1001) }), /post_shape/);
    await fails(post(B, "post", { body: "x", annotations: drawing }), /post_shape/);
    await fails(post(B, "article", { title: "No body" }), /post_shape/);
    await fails(post(B, "map", { title: "No drawing", body: "x" }), /post_shape/);
    await fails(post(B, "map", { title: "Empty", annotations: "[]" }), /check/);
    await fails(post(B, "map", { title: "Not a list", annotations: "{}" }), /check/);
    await fails(post(B, "post", { body: "x", countries: ["UA"] }), /check/);
    await fails(post(B, "post", { body: "x", countries: ["ua", "ru", "us", "gb", "fr", "de"] }), /check/);
    await fails(post(B, "video", { body: "x" }), /check/);
  }],

  ["posts: anyone reads them; only the author changes or deletes them", async ({ as, fails, post, s }) => {
    assert.equal((await as(null, "select id from posts where author_id = any($1::uuid[])", [USERS])).length, 3, "signed-out visitors can read");
    await fails(as(null, "insert into posts (kind, body) values ('post', 'x')"), /permission denied/);
    await fails(as(B, "insert into posts (author_id, kind, body) values ($1, 'post', 'as alice')", [A]), /permission denied/);
    await fails(as(A, "update posts set hidden = false where id = $1", [s.map.id]), /permission denied/);
    await fails(as(A, "update posts set kind = 'article' where id = $1", [s.map.id]), /permission denied/);
    await as(B, "update posts set title = 'pwned' where id = $1", [s.map.id]);
    await as(B, "delete from posts where id = $1", [s.map.id]);
    assert.equal((await as(null, "select title from posts where id = $1", [s.map.id]))[0].title, "Black Sea strikes");
    // The author can edit; the post is marked edited.
    assert.equal((await as(null, "select edited_at from posts where id = $1", [s.map.id]))[0].edited_at, null);
    await as(A, "update posts set body = 'Updated with Friday''s strikes.' where id = $1", [s.map.id]);
    const [m] = await as(null, "select body, edited_at from posts where id = $1", [s.map.id]);
    assert.equal(m.body, "Updated with Friday's strikes.");
    assert.ok(m.edited_at);
  }],

  ["map copies credit the original only when it can be opened", async ({ as, fails, post, s }) => {
    const [copy] = await post(B, "map", { title: "My take", annotations: drawing, copied_from: s.map.id });
    assert.ok(copy.id);
    await fails(post(B, "map", { title: "x", annotations: drawing, copied_from: "00000000-0000-4000-8000-0000000000ff" }), /violates|row-level/);
    await as(B, "delete from posts where id = $1", [copy.id]);
  }],

  ["comments: on open posts only; authors and the post's author can delete", async ({ as, fails, post, s }) => {
    const [c1] = await as(B, "insert into comments (post_id, body) values ($1, 'Nice map') returning id", [s.map.id]);
    await as(C, "insert into comments (post_id, body) values ($1, 'Agreed')", [s.map.id]);
    assert.equal((await as(null, "select body from comments where post_id = $1", [s.map.id])).length, 2);
    await fails(as(B, "insert into comments (post_id, author_id, body) values ($1, $2, 'as alice')", [s.map.id, A]), /permission denied/);
    await fails(as(B, "insert into comments (post_id, body) values ($1, '   ')", [s.map.id]), /check/);
    await fails(as(null, "insert into comments (post_id, body) values ($1, 'anon')", [s.map.id]), /permission denied/);
    await as(C, "delete from comments where id = $1", [c1.id]);
    assert.equal((await as(null, "select id from comments where post_id = $1", [s.map.id])).length, 2, "a stranger can't delete it");
    await as(A, "delete from comments where id = $1", [c1.id]);
    assert.equal((await as(null, "select id from comments where post_id = $1", [s.map.id])).length, 1, "the post's author can");
  }],

  ["follows: follow and unfollow only as yourself", async ({ as, fails, post, s }) => {
    await as(B, "insert into follows (followee_id) values ($1)", [A]);
    await as(C, "insert into follows (followee_id) values ($1)", [A]);
    assert.equal((await as(null, "select count(*)::int n from follows where followee_id = $1", [A]))[0].n, 2);
    await fails(as(A, "insert into follows (followee_id) values ($1)", [A]), /check/);
    await fails(as(B, "insert into follows (follower_id, followee_id) values ($1, $2)", [C, B]), /permission denied/);
    await as(B, "delete from follows where followee_id = $1 and follower_id = $2", [A, C]);
    assert.equal((await as(null, "select count(*)::int n from follows where followee_id = $1", [A]))[0].n, 2, "bob can't unfollow for carol");
    await as(B, "delete from follows where followee_id = $1", [A]);
    assert.equal((await as(null, "select count(*)::int n from follows where followee_id = $1", [A]))[0].n, 1);
  }],

  ["reports: anyone signed in can send one; only moderators read them", async ({ as, fails, post, s }) => {
    await as(B, "insert into reports (target_type, target_id, reason) values ('post', $1, 'spam')", [s.article.id]);
    await fails(as(B, "select * from reports"), /permission denied/);
    await fails(as(null, "insert into reports (target_type, target_id) values ('post', $1)", [s.article.id]), /permission denied/);
    await fails(as(B, "select * from open_reports()"), /Only moderators/);
    await fails(as(B, "select * from private.admins"), /permission denied/);
    assert.equal((await as(B, "select am_admin() a"))[0].a, false);
    await as("admin", "insert into private.admins (user_id) values ($1)", [A]);
    assert.equal((await as(A, "select am_admin() a"))[0].a, true);
    const [r] = (await as(A, "select * from open_reports()")).filter((x) => x.target_id === s.article.id);
    assert.deepEqual([r.reporter, r.target_author, r.target_text, r.reason, r.post_id], ["bob", "alice", "Why the Red Sea matters", "spam", s.article.id]);
    await as(A, "select dismiss_report($1)", [r.id]);
    assert.equal((await as(A, "select * from open_reports()")).filter((x) => x.target_id === s.article.id).length, 0);
  }],

  ["moderation: hidden for everyone but the author and moderators; only moderators hide", async ({ as, fails, post, s }) => {
    await as(C, "insert into reports (target_type, target_id, reason) values ('post', $1, 'off topic')", [s.note.id]);
    await fails(as(B, "select moderate('post', $1, true)", [s.note.id]), /Only moderators/);
    await as(A, "select moderate('post', $1, true)", [s.note.id]);
    assert.equal((await as(null, "select id from posts where id = $1", [s.note.id])).length, 0, "gone for visitors");
    assert.equal((await as(C, "select id from posts where id = $1", [s.note.id])).length, 0);
    assert.equal((await as(B, "select hidden from posts where id = $1", [s.note.id]))[0].hidden, true, "the author still sees it, marked hidden");
    assert.equal((await as(A, "select id from posts where id = $1", [s.note.id])).length, 1, "moderators see it, to undo");
    assert.equal((await as(A, "select * from open_reports()")).filter((x) => x.target_id === s.note.id).length, 0, "hiding closes its reports");
    await fails(as(C, "insert into comments (post_id, body) values ($1, 'hi')", [s.note.id]), /row-level security/);
    await as(A, "select moderate('post', $1, false)", [s.note.id]);
    assert.equal((await as(null, "select id from posts where id = $1", [s.note.id])).length, 1);
    // A hidden (banned) profile hides its posts and comments.
    await post(D, "post", { body: "spam spam" });
    await as(D, "insert into comments (post_id, body) values ($1, 'spam')", [s.map.id]);
    await as(A, "select moderate('profile', $1, true)", [D]);
    assert.equal((await as(null, "select id from posts where author_id = $1", [D])).length, 0);
    assert.equal((await as(null, "select id from comments where author_id = $1", [D])).length, 0);
    assert.equal((await as(null, "select id from profiles where id = $1", [D])).length, 0);
    await fails(post(D, "post", { body: "still here?" }), /row-level security/, "a banned account can't post");
    await fails(as(D, "insert into comments (post_id, body) values ($1, 'or comment')", [s.map.id]), /row-level security/);
    await fails(as(D, "insert into follows (followee_id) values ($1)", [A]), /row-level security/);
  }],

  ["rate limit: 10 posts an hour", async ({ as, fails, post, s }) => {
    for (let k = 0; k < 10; k++) await post(C, "post", { body: `update ${k}` });
    await fails(post(C, "post", { body: "one more" }), /Too many/);
  }],

  ["delete my account removes my profile, posts, comments and follows", async ({ as, fails, post, s }) => {
    await as(C, "select delete_my_account()");
    for (const [t, col] of [["profiles", "id"], ["posts", "author_id"], ["comments", "author_id"], ["follows", "follower_id"]]) {
      assert.equal((await as("admin", `select count(*)::int n from ${t} where ${col} = $1`, [C]))[0].n, 0, t);
    }
    await fails(as(null, "select delete_my_account()"), /permission denied/);
  }],
];
