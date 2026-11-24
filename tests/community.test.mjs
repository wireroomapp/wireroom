// The Community panel's helpers (src/community/helpers.js): what a posted map carries, post
// limits, credit for copied maps, links in text.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanForPublish, copyForMe, copiedFrom, postProblem, postRow, linkParts, describeDrawing, friendlyError, LIMITS } from "../src/community/helpers.js";

const marker = { id: "m1", type: "marker", x: 0.46, y: -0.79, label: "Port", color: "#ff5c5c",
  pins: [{ id: "r1", headline: "Drone strike near port", summary: "The outlet's own paragraph.", url: "https://example.com/a", source: "AP", sourceType: "independent", date: "Nov 18", lat: 44.6, lon: 33.5, pinnedAt: "2026-11-18T10:00:00Z" }] };

test("a posted map keeps headlines and links, never the outlets' summaries", () => {
  const [m] = cleanForPublish([marker]);
  assert.equal(m.pins[0].headline, "Drone strike near port");
  assert.equal(m.pins[0].url, "https://example.com/a");
  assert.ok(!("summary" in m.pins[0]));
  assert.ok(!("pinnedAt" in m.pins[0]) && !("lat" in m.pins[0]));
});

test("someone else's map is cleaned before it is shown", () => {
  const out = cleanForPublish([
    { type: "marker", x: 1, y: 2, label: "<img src=x onerror=alert(1)>", color: "red;background:url(x)", pins: [{ headline: "h", url: "javascript:alert(1)" }] },
    { type: "script", x: 0, y: 0 },
    { type: "line", x1: 0, y1: 0, x2: "a", y2: 1 },
    { type: "text", x: 0, y: 0, text: "x".repeat(900) },
  ]);
  assert.equal(out.length, 2, "unknown types and broken shapes are dropped");
  assert.equal(out[0].color, undefined, "only #hex colors");
  assert.equal(out[0].pins[0].url, "", "only http(s) links");
  assert.equal(out[1].text.length, 500);
});

test("copying a map gives fresh ids and remembers where it came from", () => {
  let n = 0;
  const copy = copyForMe([marker, { type: "text", x: 0, y: 0, text: "note" }], "post-1", () => `id${n++}`);
  assert.deepEqual(copy.map((a) => a.id), ["id0", "id1"]);
  assert.ok(copy.every((a) => a.from === "post-1"));
  assert.equal(copiedFrom([...copy, { type: "marker", x: 0, y: 0, label: "mine" }]), "post-1");
  assert.equal(copiedFrom([marker]), null);
  const row = postRow({ kind: "map", title: " My take ", body: "", annotations: copy, countries: ["ua"] });
  assert.equal(row.copied_from, "post-1", "a map posted from a copy credits the original");
  assert.equal(row.title, "My take");
  assert.ok(row.annotations.every((a) => !("from" in a)), "the note itself isn't published");
});

test("post limits match the database", () => {
  assert.equal(postProblem({ kind: "post", body: "  " }), "Write something first.");
  assert.match(postProblem({ kind: "post", body: "x".repeat(LIMITS.post + 1) }), /up to 1000/);
  assert.equal(postProblem({ kind: "post", body: "Watching the bridge." }), null);
  assert.match(postProblem({ kind: "article", title: "", body: "x" }), /title/);
  assert.equal(postProblem({ kind: "article", title: "T", body: "x" }), null);
  assert.match(postProblem({ kind: "map", title: "T", body: "", annotations: [] }), /empty/);
  assert.equal(postProblem({ kind: "map", title: "T", body: "", annotations: [marker] }), null);
  assert.match(postProblem({ kind: "post", body: "x", countries: ["a", "b", "c", "d", "e", "f"] }), /up to 5/);
  assert.equal(postRow({ kind: "post", title: "ignored", body: " hi ", countries: [] }).title, "", "posts have no title");
});

test("links in text become links; nothing else is treated as markup", () => {
  assert.deepEqual(linkParts("See https://example.com/a. And <b>this</b>"), [
    { text: "See " }, { text: "https://example.com/a", href: "https://example.com/a" }, { text: ". And <b>this</b>" },
  ]);
  assert.deepEqual(linkParts("javascript:alert(1)"), [{ text: "javascript:alert(1)" }]);
  assert.deepEqual(linkParts(""), []);
});

test("describes a drawing and explains errors in plain words", () => {
  assert.equal(describeDrawing([marker, { type: "line" }, { type: "text" }]), "1 marker, 1 line, 1 note, 1 pinned report");
  assert.equal(describeDrawing([]), "nothing drawn yet");
  assert.match(friendlyError({ message: 'duplicate key value violates unique constraint "profiles_username_key"' }), /taken/);
  assert.match(friendlyError({ message: "Too many in a short time. Please try again later." }), /wait/);
  assert.match(friendlyError({ message: "new row violates row-level security policy" }), /isn't allowed/);
  assert.match(friendlyError(new TypeError("Failed to fetch")), /Couldn't reach/);
});

test("messages group into one conversation per person, with unread counts", async () => {
  const { groupConversations } = await import("../src/community/helpers.js");
  const me = "u-me";
  const rows = [ // newest first, as the server returns them
    { id: "3", sender_id: "u-a", recipient_id: me, body: "and another", read_at: null, created_at: "2026-11-24T10:03:00Z", sender: { username: "alice" } },
    { id: "2", sender_id: me, recipient_id: "u-b", body: "hi bob", read_at: null, created_at: "2026-11-24T10:02:00Z", recipient: { username: "bob" } },
    { id: "1", sender_id: "u-a", recipient_id: me, body: "hello", read_at: null, created_at: "2026-11-24T10:01:00Z", sender: { username: "alice" } },
  ];
  const out = groupConversations(rows, me);
  assert.deepEqual(out.map((c) => [c.other.username, c.last.id, c.unread]), [["alice", "3", 2], ["bob", "2", 0]], "my own unread messages to bob don't count");
});
