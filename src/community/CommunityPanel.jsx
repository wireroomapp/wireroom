// The Community panel: posts by Wire Room users (text posts, articles and maps), comments,
// profiles and follows, plus reporting and moderation. Talks to Supabase through ./api.js;
// every rule about who may do what is enforced by the database (supabase/schema.sql).
// Everything users post is labelled ANALYST, apart from OFFICIAL and NEWS.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadCommunityApi, PAGE } from "./api.js";
import { KINDS, LIMITS, describeDrawing, friendlyError, linkParts, postProblem, postRow, timeAgo, validUsername, cleanForPublish } from "./helpers.js";
import { RulesText } from "./Rules.jsx";

const KIND_LABEL = { post: "Post", article: "Article", map: "Map" };

function Linked({ text }) {
  return linkParts(text).map((p, i) => (p.href
    ? <a key={i} href={p.href} target="_blank" rel="noopener noreferrer nofollow ugc">{p.text}</a>
    : <span key={i}>{p.text}</span>));
}

function Body({ text }) {
  const paras = String(text || "").split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  return <div className="cm-body">{paras.map((p, i) => <p key={i}><Linked text={p} /></p>)}</div>;
}

function Who({ name, username, onOpen }) {
  return (
    <button type="button" className="cm-who" onClick={(e) => { e.stopPropagation(); onOpen(username); }}>
      <b>{name || username}</b> <span>@{username}</span>
    </button>
  );
}

function Countries({ ids, names }) {
  if (!ids || !ids.length) return null;
  return <span className="cm-countries">{ids.map((c) => <span key={c} className="cm-chip">{names[c] || c.toUpperCase()}</span>)}</span>;
}

function PostCard({ post, names, onOpen, onAuthor, onShowMap, shownMapId }) {
  const open = () => onOpen(post.id);
  return (
    <article className="card cm-card" role="button" tabIndex={0} onClick={open} onKeyDown={(e) => { if (e.key === "Enter") open(); }}>
      <div className="card-meta">
        <span className="tag analyst">Analyst</span>
        <span className="cm-kind">{KIND_LABEL[post.kind]}</span>
        <Who name={post.display_name} username={post.username} onOpen={onAuthor} />
        <span>· {timeAgo(post.created_at)}{post.edited_at ? " · edited" : ""}</span>
        {post.hidden && <span className="cm-hidden-tag">Hidden</span>}
      </div>
      {post.title && <h3>{post.title}</h3>}
      {post.excerpt && <p className="cm-excerpt">{post.excerpt}{post.kind !== "post" && post.excerpt.length >= 280 ? "…" : ""}</p>}
      <div className="cm-foot">
        {post.kind === "map" && (
          <button type="button" className={`cm-btn small ${shownMapId === post.id ? "on" : ""}`} onClick={(e) => { e.stopPropagation(); onShowMap(post.id); }}>
            {shownMapId === post.id ? "On the map" : `Show map (${post.map_items})`}
          </button>
        )}
        <Countries ids={post.countries} names={names} />
        <span className="cm-count">{post.comment_count ? `${post.comment_count} comment${post.comment_count === 1 ? "" : "s"}` : "No comments yet"}</span>
      </div>
    </article>
  );
}

function PostList({ api, scope, userId, country, refreshKey, names, onOpen, onAuthor, onShowMap, shownMapId, empty }) {
  const [state, setState] = useState({ key: null, posts: [], more: false, error: "" });
  const [busy, setBusy] = useState(false);
  const key = `${scope}|${userId}|${country}|${refreshKey}`;
  useEffect(() => {
    let alive = true;
    api.listPosts({ scope, userId, country }).then(
      (rows) => { if (alive) setState({ key, posts: rows, more: rows.length === PAGE, error: "" }); },
      (e) => { if (alive) setState({ key, posts: [], more: false, error: e.message || friendlyError(e) }); },
    );
    return () => { alive = false; };
  }, [api, scope, userId, country, key]);
  const loadMore = async () => {
    const last = state.posts[state.posts.length - 1];
    if (!last) return;
    setBusy(true);
    try {
      const rows = await api.listPosts({ scope, userId, country, before: last.created_at });
      setState((s) => ({ ...s, posts: [...s.posts, ...rows], more: rows.length === PAGE }));
    } catch (e) { setState((s) => ({ ...s, error: e.message })); }
    setBusy(false);
  };
  if (state.key !== key) return <div className="loading">Loading posts…</div>;
  if (state.error) return <div className="cm-error">{state.error}</div>;
  if (!state.posts.length) return <div className="empty">{empty}</div>;
  return (
    <>
      {state.posts.map((p) => <PostCard key={p.id} post={p} names={names} onOpen={onOpen} onAuthor={onAuthor} onShowMap={onShowMap} shownMapId={shownMapId} />)}
      {state.more && <button type="button" className="cm-btn wide" disabled={busy} onClick={loadMore}>{busy ? "Loading…" : "Older posts"}</button>}
    </>
  );
}

function CountryPicker({ value, onChange, countries }) {
  const left = countries.filter((c) => !value.includes(c.id));
  return (
    <div className="cm-field">
      <span className="cm-label">Countries (optional, up to {LIMITS.countries})</span>
      <div className="cm-countries edit">
        {value.map((id) => {
          const c = countries.find((x) => x.id === id);
          return <button type="button" key={id} className="cm-chip" onClick={() => onChange(value.filter((x) => x !== id))} aria-label={`Remove ${c ? c.name : id}`}>{c ? c.name : id.toUpperCase()} ×</button>;
        })}
        {value.length < LIMITS.countries && (
          <select value="" onChange={(e) => { if (e.target.value) onChange([...value, e.target.value]); }} aria-label="Add a country">
            <option value="">+ Add a country</option>
            {left.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
      </div>
    </div>
  );
}

function Composer({ api, editing, getDrawing, countries, onDone, onCancel, onRules }) {
  const [kind, setKind] = useState(editing ? editing.kind : "post");
  const [title, setTitle] = useState(editing ? editing.title : "");
  const [body, setBody] = useState(editing ? editing.body : "");
  const [tags, setTags] = useState(editing ? editing.countries || [] : []);
  const [replaceMap, setReplaceMap] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const drawing = useMemo(() => (kind === "map" && (!editing || replaceMap) ? getDrawing() : editing && editing.annotations) || [], [kind, editing, replaceMap, getDrawing]);
  const limit = kind === "post" ? LIMITS.post : kind === "article" ? LIMITS.article : LIMITS.caption;
  const submit = async () => {
    const problem = postProblem({ kind, title, body, annotations: drawing, countries: tags });
    if (problem) { setError(problem); return; }
    setBusy(true); setError("");
    try {
      const row = postRow({ kind, title, body, annotations: drawing, countries: tags });
      if (editing) {
        const fields = { title: row.title, body: row.body, countries: row.countries };
        if (kind === "map" && replaceMap) fields.annotations = row.annotations;
        await api.updatePost(editing.id, fields);
        onDone(editing.id);
      } else {
        onDone(await api.createPost(row));
      }
    } catch (e) { setError(e.message || friendlyError(e)); setBusy(false); }
  };
  return (
    <div className="cm-compose">
      <h2>{editing ? `Edit ${KIND_LABEL[kind].toLowerCase()}` : "New post"}</h2>
      {!editing && (
        <div className="panel-mode cm-kinds" role="tablist">
          {KINDS.map((k) => <button type="button" key={k.id} className={kind === k.id ? "active" : ""} onClick={() => { setKind(k.id); setError(""); }} title={k.hint}>{k.label}</button>)}
        </div>
      )}
      {kind !== "post" && (
        <label className="cm-field">
          <span className="cm-label">Title</span>
          <input value={title} maxLength={LIMITS.title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === "map" ? "What does this map show?" : "Headline"} />
        </label>
      )}
      <label className="cm-field">
        <span className="cm-label">{kind === "post" ? "What's happening?" : kind === "article" ? "Article" : "Caption (optional)"}</span>
        <textarea value={body} rows={kind === "article" ? 12 : 5} maxLength={limit} onChange={(e) => setBody(e.target.value)}
          placeholder={kind === "post" ? "Share an update, a question or a take. Add links to your sources." : kind === "article" ? "Leave a blank line between paragraphs. Links to sources work." : "What should people look for on the map?"} />
        <span className={`cm-counter ${body.length > limit * 0.9 ? "warn" : ""}`}>{body.length.toLocaleString()} / {limit.toLocaleString()}</span>
      </label>
      {kind === "map" && (
        <div className="cm-mapbox">
          {editing && <label className="cm-check"><input type="checkbox" checked={replaceMap} onChange={(e) => setReplaceMap(e.target.checked)} /> Replace this map with my current drawing</label>}
          <div><b>{editing && !replaceMap ? "Map in this post:" : "Your map:"}</b> {describeDrawing(cleanForPublish(drawing))}.</div>
          <div className="cm-fine">Posted as it is now. Pinned reports keep their headline, outlet and link, not the summary.</div>
        </div>
      )}
      <CountryPicker value={tags} onChange={setTags} countries={countries} />
      {error && <div className="cm-error">{error}</div>}
      <div className="cm-actions">
        <button type="button" className="cm-btn primary" disabled={busy} onClick={submit}>{busy ? "Publishing…" : editing ? "Save" : "Publish"}</button>
        <button type="button" className="cm-btn" onClick={onCancel}>Cancel</button>
      </div>
      <p className="cm-fine">Posts are public and show your username. Follow the <button type="button" className="cm-link" onClick={onRules}>community rules</button>.</p>
    </div>
  );
}

function Comments({ api, post, me, admin, signedIn, onAuthor, onNeedAccount, onReport, notify }) {
  const [list, setList] = useState(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(() => api.comments(post.id).then(setList, (e) => setError(e.message)), [api, post.id]);
  useEffect(() => { load(); }, [load]);
  const send = async () => {
    if (!text.trim()) return;
    setBusy(true); setError("");
    try { await api.addComment(post.id, text.trim()); setText(""); await load(); } catch (e) { setError(e.message); }
    setBusy(false);
  };
  const remove = async (c) => {
    if (!window.confirm("Delete this comment?")) return;
    try { await api.deleteComment(c.id); await load(); } catch (e) { notify(e.message); }
  };
  const hide = async (c) => {
    try { await api.moderate("comment", c.id, !c.hidden); await load(); } catch (e) { notify(e.message); }
  };
  return (
    <section className="cm-comments">
      <h3>Comments{list && list.length ? ` (${list.length})` : ""}</h3>
      {!list && !error && <div className="loading">Loading comments…</div>}
      {list && !list.length && <div className="cm-fine">No comments yet.</div>}
      {list && list.map((c) => (
        <div key={c.id} className={`cm-comment ${c.hidden ? "is-hidden" : ""}`}>
          <div className="card-meta">
            <Who name={c.display_name} username={c.username} onOpen={onAuthor} />
            <span>· {timeAgo(c.created_at)}</span>
            {c.hidden && <span className="cm-hidden-tag">Hidden</span>}
          </div>
          <div className="cm-comment-body"><Linked text={c.body} /></div>
          <div className="cm-row-actions">
            {me && (c.author_id === me.id || post.author_id === me.id) && <button type="button" className="cm-link" onClick={() => remove(c)}>Delete</button>}
            {me && c.author_id !== me.id && <button type="button" className="cm-link" onClick={() => onReport("comment", c.id)}>Report</button>}
            {admin && <button type="button" className="cm-link" onClick={() => hide(c)}>{c.hidden ? "Unhide" : "Hide"}</button>}
          </div>
        </div>
      ))}
      {error && <div className="cm-error">{error}</div>}
      {me ? (
        <div className="cm-field">
          <textarea value={text} rows={3} maxLength={LIMITS.comment} onChange={(e) => setText(e.target.value)} placeholder="Add a comment" aria-label="Add a comment" />
          <div className="cm-actions"><button type="button" className="cm-btn primary" disabled={busy || !text.trim()} onClick={send}>{busy ? "Sending…" : "Comment"}</button></div>
        </div>
      ) : (
        <button type="button" className="cm-btn" onClick={onNeedAccount}>{signedIn ? "Pick a username to comment" : "Sign in to comment"}</button>
      )}
    </section>
  );
}

function PostView({ api, id, me, admin, signedIn, names, onOpen, onAuthor, onEdit, onDeleted, onShowMap, onCopyMap, shownMapId, onNeedAccount, onReport, notify }) {
  const [state, setState] = useState({ id: null, post: null, error: "" });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    api.getPost(id).then((p) => { if (alive) setState({ id, post: p, error: p ? "" : "This post isn't available. It may have been deleted or hidden." }); },
      (e) => { if (alive) setState({ id, post: null, error: e.message }); });
    return () => { alive = false; };
  }, [api, id, tick]);
  const [copied, setCopied] = useState(false);
  if (state.id !== id) return <div className="loading">Loading…</div>;
  if (!state.post) return <div className="cm-error">{state.error}</div>;
  const p = state.post;
  const mine = me && p.author_id === me.id;
  const share = async () => {
    const url = `${window.location.origin}${window.location.pathname}?post=${p.id}`;
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { window.prompt("Copy this link:", url); }
  };
  const del = async () => {
    if (!window.confirm("Delete this post? This can't be undone.")) return;
    try { await api.deletePost(p.id); onDeleted(); } catch (e) { notify(e.message); }
  };
  const hide = async () => {
    try { await api.moderate("post", p.id, !p.hidden); setTick((t) => t + 1); } catch (e) { notify(e.message); }
  };
  return (
    <div className="cm-post">
      <div className="card-meta">
        <span className="tag analyst">Analyst</span>
        <span className="cm-kind">{KIND_LABEL[p.kind]}</span>
        <Who name={p.display_name} username={p.username} onOpen={onAuthor} />
        <span>· {timeAgo(p.created_at)}{p.edited_at ? ` · edited ${timeAgo(p.edited_at)}` : ""}</span>
      </div>
      {p.hidden && <div className="cm-error">Hidden by a moderator. Only you{admin ? " (moderator)" : ""} can see it.</div>}
      {p.title && <h2 className="cm-title">{p.title}</h2>}
      <Body text={p.body} />
      {p.kind === "map" && (
        <div className="cm-mapbox">
          <div><b>Map:</b> {describeDrawing(p.annotations)}.</div>
          <div className="cm-actions">
            <button type="button" className={`cm-btn primary ${shownMapId === p.id ? "on" : ""}`} onClick={() => onShowMap(p)}>{shownMapId === p.id ? "Showing on the map" : "Show on the map"}</button>
            <button type="button" className="cm-btn" onClick={() => onCopyMap(p)}>Copy to my map</button>
          </div>
          <div className="cm-fine">Copy adds it to your own drawing, to build on. Post your version and it will say it's based on this one.</div>
        </div>
      )}
      {p.original && <p className="cm-fine">Based on <button type="button" className="cm-link" onClick={() => onOpen(p.original.id)}>@{p.original.username}'s map “{p.original.title}”</button>.</p>}
      <Countries ids={p.countries} names={names} />
      <div className="cm-row-actions">
        <button type="button" className="cm-link" onClick={share}>{copied ? "Link copied" : "Copy link"}</button>
        {mine && <button type="button" className="cm-link" onClick={() => onEdit(p)}>Edit</button>}
        {mine && <button type="button" className="cm-link" onClick={del}>Delete</button>}
        {me && !mine && <button type="button" className="cm-link" onClick={() => onReport("post", p.id)}>Report</button>}
        {admin && <button type="button" className="cm-link" onClick={hide}>{p.hidden ? "Unhide (moderator)" : "Hide (moderator)"}</button>}
      </div>
      <Comments api={api} post={p} me={me} admin={admin} signedIn={signedIn} onAuthor={onAuthor} onNeedAccount={onNeedAccount} onReport={onReport} notify={notify} />
    </div>
  );
}

function ProfileView({ api, username, me, admin, names, onOpen, onAuthor, onShowMap, shownMapId, onEditProfile, onNeedAccount, onReport, notify }) {
  const [state, setState] = useState({ username: null, profile: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    api.profile(username).then((p) => { if (alive) setState({ username, profile: p }); }, (e) => { if (alive) setState({ username, profile: null, error: e.message }); });
    return () => { alive = false; };
  }, [api, username, tick]);
  if (state.username !== username) return <div className="loading">Loading…</div>;
  const p = state.profile;
  if (!p) return <div className="cm-error">{state.error || `There's no account @${username}.`}</div>;
  const mine = me && me.id === p.id;
  const follow = async () => {
    if (!me) { onNeedAccount(); return; }
    try { await (p.isFollowing ? api.unfollow(p.id) : api.follow(p.id)); setTick((t) => t + 1); } catch (e) { notify(e.message); }
  };
  const suspend = async () => {
    if (!window.confirm(p.hidden ? `Restore @${p.username}?` : `Suspend @${p.username}? Their posts and comments are hidden and they can't post.`)) return;
    try { await api.moderate("profile", p.id, !p.hidden); setTick((t) => t + 1); } catch (e) { notify(e.message); }
  };
  return (
    <div className="cm-profile">
      <h2 className="cm-title">{p.display_name || p.username}</h2>
      <div className="cm-handle">@{p.username} · joined {new Date(p.created_at).toLocaleDateString(undefined, { month: "short", year: "numeric" })}</div>
      {p.hidden && <div className="cm-error">Suspended by a moderator.</div>}
      {p.bio && <p className="cm-bio"><Linked text={p.bio} /></p>}
      <div className="cm-stats"><b>{p.followers}</b> follower{p.followers === 1 ? "" : "s"} · <b>{p.following}</b> following</div>
      <div className="cm-actions">
        {mine ? <button type="button" className="cm-btn" onClick={onEditProfile}>Edit profile</button>
          : <button type="button" className={`cm-btn ${p.isFollowing ? "" : "primary"}`} onClick={follow}>{p.isFollowing ? "Following ✓" : "Follow"}</button>}
        {me && !mine && <button type="button" className="cm-btn" onClick={() => onReport("profile", p.id)}>Report</button>}
        {admin && !mine && <button type="button" className="cm-btn" onClick={suspend}>{p.hidden ? "Restore" : "Suspend"}</button>}
      </div>
      <h3 className="cm-section">Posts</h3>
      <PostList api={api} scope="user" userId={p.id} refreshKey={tick} names={names} onOpen={onOpen} onAuthor={onAuthor} onShowMap={onShowMap} shownMapId={shownMapId}
        empty={mine ? "You haven't posted yet." : "No posts yet."} />
    </div>
  );
}

function SetupProfile({ api, user, onDone, onRules, onSignOut }) {
  const guess = String((user && user.user_metadata && (user.user_metadata.name || user.user_metadata.full_name)) || "");
  const [username, setUsername] = useState("");
  const [name, setName] = useState(guess.slice(0, LIMITS.displayName));
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const create = async () => {
    if (!validUsername(username)) { setError("Usernames are 3–20 characters: lowercase letters, numbers and _."); return; }
    if (!agree) { setError("Please confirm you're 13 or older and agree to the community rules."); return; }
    setBusy(true); setError("");
    try { await api.createProfile({ username, display_name: name.trim() }); onDone(); } catch (e) { setError(e.message); setBusy(false); }
  };
  return (
    <div className="cm-compose">
      <h2>Pick a username</h2>
      <p className="cm-fine">It shows on everything you post, as @username, and can't be changed later. Your email isn't shown to anyone.</p>
      <label className="cm-field">
        <span className="cm-label">Username</span>
        <input value={username} maxLength={20} autoCapitalize="none" autoCorrect="off" spellCheck={false}
          onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))} placeholder="e.g. blacksea_watch" />
      </label>
      <label className="cm-field">
        <span className="cm-label">Display name (optional)</span>
        <input value={name} maxLength={LIMITS.displayName} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="cm-check">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        <span>I'm 13 or older and I agree to the <button type="button" className="cm-link" onClick={onRules}>community rules, terms and privacy notice</button>.</span>
      </label>
      {error && <div className="cm-error">{error}</div>}
      <div className="cm-actions">
        <button type="button" className="cm-btn primary" disabled={busy} onClick={create}>{busy ? "Creating…" : "Create my account"}</button>
        <button type="button" className="cm-btn" onClick={onSignOut}>Sign out</button>
      </div>
    </div>
  );
}

function EditProfile({ api, me, onDone, onSignOut, onDeleted }) {
  const [name, setName] = useState(me.display_name || "");
  const [bio, setBio] = useState(me.bio || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setBusy(true); setError("");
    try { await api.updateProfile(me.id, { display_name: name.trim(), bio: bio.trim() }); onDone(); } catch (e) { setError(e.message); setBusy(false); }
  };
  const del = async () => {
    const typed = window.prompt(`This deletes your account and everything you posted, for good. Type your username (${me.username}) to confirm:`);
    if (typed === null) return;
    if (typed.trim().replace(/^@/, "") !== me.username) { setError("The username didn't match, so nothing was deleted."); return; }
    try { await api.deleteAccount(); onDeleted(); } catch (e) { setError(e.message); }
  };
  return (
    <div className="cm-compose">
      <h2>Edit profile</h2>
      <label className="cm-field"><span className="cm-label">Display name</span><input value={name} maxLength={LIMITS.displayName} onChange={(e) => setName(e.target.value)} /></label>
      <label className="cm-field">
        <span className="cm-label">Bio</span>
        <textarea value={bio} rows={3} maxLength={LIMITS.bio} onChange={(e) => setBio(e.target.value)} placeholder="What you follow or study" />
        <span className="cm-counter">{bio.length} / {LIMITS.bio}</span>
      </label>
      {error && <div className="cm-error">{error}</div>}
      <div className="cm-actions">
        <button type="button" className="cm-btn primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>
        <button type="button" className="cm-btn" onClick={onSignOut}>Sign out</button>
      </div>
      <h3 className="cm-section">Delete account</h3>
      <p className="cm-fine">Deletes your profile, posts, comments and follows. It can't be undone.</p>
      <button type="button" className="cm-btn danger" onClick={del}>Delete my account</button>
    </div>
  );
}

function ReportsView({ api, onOpen, notify }) {
  const [list, setList] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    api.openReports().then((r) => { if (alive) setList(r); }, (e) => { if (alive) { setList([]); notify(e.message); } });
    return () => { alive = false; };
  }, [api, tick, notify]);
  if (!list) return <div className="loading">Loading reports…</div>;
  const act = async (fn) => { try { await fn(); setTick((t) => t + 1); } catch (e) { notify(e.message); } };
  return (
    <div>
      <h2 className="cm-title">Reports</h2>
      {!list.length && <div className="empty">No open reports.</div>}
      {list.map((r) => (
        <div key={r.id} className="card cm-card">
          <div className="card-meta"><span className="cm-kind">{r.target_type}</span><span>by @{r.target_author || "?"}</span><span>· reported {timeAgo(r.created_at)} by @{r.reporter || "deleted account"}</span>{r.target_hidden && <span className="cm-hidden-tag">Hidden</span>}</div>
          <p className="cm-excerpt">“{r.target_text || "(empty)"}”</p>
          {r.reason && <p className="cm-fine">Reason: {r.reason}</p>}
          <div className="cm-row-actions">
            {r.post_id && <button type="button" className="cm-link" onClick={() => onOpen(r.post_id)}>Open</button>}
            {!r.target_hidden && <button type="button" className="cm-link" onClick={() => act(() => api.moderate(r.target_type, r.target_id, true))}>{r.target_type === "profile" ? "Suspend" : "Hide"}</button>}
            <button type="button" className="cm-link" onClick={() => act(() => api.dismissReport(r.id))}>Dismiss</button>
          </div>
        </div>
      ))}
    </div>
  );
}

const REPORT_REASONS = ["Spam or ads", "Harassment or hate", "Threats or violence", "Private information (doxxing)", "False or misleading", "Illegal content", "Other"];

function ReportForm({ api, target, onDone, onCancel }) {
  const [reason, setReason] = useState(REPORT_REASONS[0]);
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const send = async () => {
    setBusy(true); setError("");
    try { await api.report(target.type, target.id, `${reason}${detail.trim() ? `: ${detail.trim()}` : ""}`.slice(0, 500)); onDone(); } catch (e) { setError(e.message); setBusy(false); }
  };
  return (
    <div className="cm-compose">
      <h2>Report this {target.type === "profile" ? "account" : target.type}</h2>
      <p className="cm-fine">A moderator will look at it. The person you report isn't told who reported them.</p>
      <div className="cm-field">
        {REPORT_REASONS.map((r) => <label key={r} className="cm-check"><input type="radio" name="reason" checked={reason === r} onChange={() => setReason(r)} /> {r}</label>)}
      </div>
      <label className="cm-field"><span className="cm-label">Details (optional)</span><textarea value={detail} rows={3} maxLength={400} onChange={(e) => setDetail(e.target.value)} /></label>
      {error && <div className="cm-error">{error}</div>}
      <div className="cm-actions">
        <button type="button" className="cm-btn primary" disabled={busy} onClick={send}>{busy ? "Sending…" : "Send report"}</button>
        <button type="button" className="cm-btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// Screens: feed | post | profile | compose | setup | edit-profile | report | reports | rules
export default function CommunityPanel({ initialPostId = null, onClose, onPostChange, getDrawing, onShowMap, onCopyMap, shownMapId, countries }) {
  const [api, setApi] = useState(null);
  const [apiError, setApiError] = useState("");
  const [user, setUser] = useState(undefined); // undefined = still checking
  const [me, setMe] = useState(undefined); // my profile; null = signed in without one yet
  const [admin, setAdmin] = useState(false);
  const [stack, setStack] = useState(() => [initialPostId ? { name: "post", id: initialPostId } : { name: "feed" }]);
  const [tab, setTab] = useState("latest");
  const [country, setCountry] = useState("");
  const [feedKey, setFeedKey] = useState(0);
  const [note, setNote] = useState("");
  const noteTimer = useRef(null);
  const screen = stack[stack.length - 1];
  const names = useMemo(() => Object.fromEntries(countries.map((c) => [c.id, c.name])), [countries]);

  const notify = useCallback((msg) => {
    setNote(msg);
    clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(""), 4000);
  }, []);
  useEffect(() => () => clearTimeout(noteTimer.current), []);

  useEffect(() => {
    let alive = true;
    loadCommunityApi().then((a) => { if (alive) setApi(a); }, (e) => { if (alive) setApiError(friendlyError(e)); });
    return () => { alive = false; };
  }, []);

  // Sign-in state. Coming back from Google, the address has ?code=… (or ?error=…): tidy it away.
  useEffect(() => {
    if (!api) return undefined;
    // Token refreshes (about hourly) report the same person again: keep the same user object.
    const off = api.onAuth((u) => setUser((prev) => (prev && u && prev.id === u.id ? prev : u)));
    const keys = ["code", "error", "error_code", "error_description"];
    let timer = null;
    try {
      const params = new URLSearchParams(window.location.search);
      const err = params.get("error_description") || params.get("error");
      if (err) timer = setTimeout(() => notify(`Sign-in didn't finish: ${err.slice(0, 120)}`), 0);
      if (keys.some((k) => params.has(k))) {
        setTimeout(() => { // after Supabase has read the code; reads the address again in case it changed since
          try {
            const url = new URL(window.location.href);
            keys.forEach((k) => url.searchParams.delete(k));
            window.history.replaceState(null, "", url.toString());
          } catch { /* leave it */ }
        }, 1500);
      }
    } catch { /* no address to tidy */ }
    return () => { off(); clearTimeout(timer); };
  }, [api, notify]);

  // My profile and whether I'm a moderator, whenever who's signed in changes.
  useEffect(() => {
    if (!api || user === undefined) return undefined;
    let alive = true;
    Promise.all([user ? api.myProfile() : null, user ? api.isAdmin() : false]).then(([p, a]) => {
      if (!alive) return;
      setMe(p);
      setAdmin(Boolean(a));
      if (user && !p) setStack((s) => (s[s.length - 1].name === "setup" || s[s.length - 1].name === "rules" ? s : [...s, { name: "setup" }]));
    }, (e) => { if (alive) { setMe(null); notify(e.message); } });
    return () => { alive = false; };
  }, [api, user, notify]);

  // Let the app know which post is open (for the ?post= link).
  const openPostId = screen.name === "post" ? screen.id : null;
  useEffect(() => { if (onPostChange) onPostChange(openPostId); }, [openPostId, onPostChange]);

  const go = (s) => setStack((st) => [...st, s]);
  const back = () => setStack((st) => (st.length > 1 ? st.slice(0, -1) : [{ name: "feed" }]));
  const home = () => { setStack([{ name: "feed" }]); setFeedKey((k) => k + 1); };
  const openPost = (id) => go({ name: "post", id });
  const openAuthor = (username) => go({ name: "profile", username });
  const signIn = async () => { try { await api.signIn(); } catch (e) { notify(e.message); } };
  const signOut = async () => { await api.signOut(); setMe(null); setAdmin(false); home(); };
  const needAccount = () => { if (!user) signIn(); else go({ name: "setup" }); };
  const report = (type, id) => { if (!me) needAccount(); else go({ name: "report", target: { type, id } }); };
  const showMap = async (postOrId) => {
    try {
      const p = typeof postOrId === "string" ? await api.getPost(postOrId) : postOrId;
      if (p) onShowMap(p);
    } catch (e) { notify(e.message); }
  };
  const copyMap = (p) => { onCopyMap(p); notify("Added to your map. Tap Draw to edit it; post it as a Map to share your version."); };
  const reloadMe = async () => { setMe(await api.myProfile()); };

  const common = { api, me, admin, names, onOpen: openPost, onAuthor: openAuthor, onShowMap: showMap, shownMapId, notify };

  let content;
  if (apiError) content = <div className="cm-error">{apiError}</div>;
  else if (!api || user === undefined) content = <div className="loading">Connecting…</div>;
  else if (screen.name === "rules") content = <RulesText />;
  else if (screen.name === "setup") {
    content = user ? <SetupProfile api={api} user={user} onRules={() => go({ name: "rules" })} onSignOut={signOut} onDone={async () => { await reloadMe(); notify("Welcome! You can post now."); setStack((s) => s.filter((x) => x.name !== "setup").concat(s.length === 1 ? [{ name: "feed" }] : [])); }} />
      : <div className="empty">Sign in first.</div>;
  } else if (screen.name === "compose") {
    content = <Composer api={api} editing={screen.editing || null} getDrawing={getDrawing} countries={countries} onRules={() => go({ name: "rules" })} onCancel={back}
      onDone={(id) => { notify(screen.editing ? "Saved." : "Posted."); setFeedKey((k) => k + 1); setStack((s) => [...s.slice(0, -1).filter((x) => !(x.name === "post" && x.id === id)), { name: "post", id }]); }} />;
  } else if (screen.name === "post") {
    content = <PostView key={screen.id} {...common} id={screen.id} signedIn={Boolean(user)} onCopyMap={copyMap} onNeedAccount={needAccount} onReport={report}
      onEdit={(p) => go({ name: "compose", editing: p })} onDeleted={() => { notify("Deleted."); home(); }} />;
  } else if (screen.name === "profile") {
    content = <ProfileView key={screen.username} {...common} username={screen.username} onNeedAccount={needAccount} onReport={report} onEditProfile={() => go({ name: "edit-profile" })} />;
  } else if (screen.name === "edit-profile" && me) {
    content = <EditProfile api={api} me={me} onSignOut={signOut} onDone={async () => { await reloadMe(); notify("Saved."); back(); }} onDeleted={() => { setMe(null); setUser(null); notify("Your account was deleted."); home(); }} />;
  } else if (screen.name === "report") {
    content = <ReportForm api={api} target={screen.target} onCancel={back} onDone={() => { notify("Thanks. A moderator will look at it."); back(); }} />;
  } else if (screen.name === "reports" && admin) {
    content = <ReportsView api={api} onOpen={openPost} notify={notify} />;
  } else {
    content = (
      <>
        <div className="cm-feedbar">
          <div className="panel-mode cm-tabs">
            <button type="button" className={tab === "latest" ? "active" : ""} onClick={() => setTab("latest")}>Latest</button>
            <button type="button" className={tab === "following" ? "active" : ""} onClick={() => setTab("following")}>Following</button>
          </div>
          <select className="cm-country" value={country} onChange={(e) => setCountry(e.target.value)} aria-label="Filter by country">
            <option value="">All countries</option>
            {countries.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        {tab === "following" && !me ? (
          <div className="empty">{user ? "Pick a username, then follow people to see their posts here." : "Sign in and follow people to see their posts here."}</div>
        ) : (
          <PostList api={api} scope={tab} country={country || null} refreshKey={feedKey} names={names} onOpen={openPost} onAuthor={openAuthor} onShowMap={showMap} shownMapId={shownMapId}
            empty={tab === "following" ? "Nobody you follow has posted yet. Open someone's profile to follow them." : country ? "No posts about this country yet." : "No posts yet. Be the first: share a map of what you're tracking."} />
        )}
      </>
    );
  }

  return (
    <div className="cm-panel">
      <style>{CM_CSS}</style>
      <div className="panel-head">
        <div>
          <div className="eyebrow">Community</div>
          <h1>{screen.name === "feed" ? "Analyst posts" : <button type="button" className="cm-back" onClick={back}>← Back</button>}</h1>
          {screen.name === "feed" && <p>Posts, articles and maps by Wire Room users. Their analysis, not verified by Wire Room.</p>}
        </div>
        <div className="panel-actions">
          <button type="button" onClick={onClose} aria-label="Close panel">×</button>
        </div>
      </div>
      {api && user !== undefined && (
        <div className="cm-account">
          {!user && <><button type="button" className="cm-btn primary" onClick={signIn}>Sign in with Google</button><span className="cm-fine">to post, comment and follow. Reading is open to all.</span></>}
          {user && me && (
            <>
              <button type="button" className="cm-btn primary" onClick={() => go({ name: "compose" })}>New post</button>
              <button type="button" className="cm-link" onClick={() => openAuthor(me.username)}>@{me.username}</button>
              {admin && <button type="button" className="cm-link" onClick={() => go({ name: "reports" })}>Reports</button>}
            </>
          )}
          {user && me === null && screen.name !== "setup" && <button type="button" className="cm-btn primary" onClick={() => go({ name: "setup" })}>Pick a username to start posting</button>}
          <button type="button" className="cm-link cm-rules-link" onClick={() => go({ name: "rules" })}>Rules</button>
        </div>
      )}
      {note && <div className="cm-note" role="status">{note}</div>}
      <div className="cm-content">{content}</div>
    </div>
  );
}

const CM_CSS = `
.cm-panel{display:flex;flex-direction:column;min-height:0}
.cm-panel .panel-head h1 .cm-back{background:none;border:0;padding:0;height:auto;color:var(--accent);font:600 16px var(--font);cursor:pointer}
.cm-account{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 14px}
.cm-rules-link{margin-left:auto}
.cm-btn{height:34px;padding:0 14px;border:1px solid var(--line-2);border-radius:8px;background:var(--surface);color:var(--text);font:500 13px var(--font);cursor:pointer}
.cm-btn:hover:not(:disabled){border-color:var(--accent)}
.cm-btn:disabled{opacity:.55;cursor:default}
.cm-btn.primary{background:var(--text);color:var(--bg);border-color:var(--text);font-weight:600}
.cm-btn.primary.on,.cm-btn.on{background:var(--accent-soft);color:var(--accent);border-color:var(--accent)}
.cm-btn.small{height:28px;padding:0 10px;font-size:12px}
.cm-btn.wide{width:100%;margin:4px 0 12px}
.cm-btn.danger{color:var(--danger);border-color:var(--danger-line)}
.cm-link{background:none;border:0;padding:0;color:var(--accent);font:500 13px var(--font);cursor:pointer}
.cm-link:hover{text-decoration:underline}
.cm-note{background:var(--accent-soft);color:var(--text);border-radius:8px;padding:9px 12px;font:13px var(--font);margin:0 0 12px}
.cm-error{background:var(--danger-bg);color:var(--danger);border:1px solid var(--danger-line);border-radius:8px;padding:9px 12px;font:13px/1.45 var(--font);margin:8px 0}
.cm-fine{font:12px/1.5 var(--font);color:var(--muted);margin:6px 0}
.cm-feedbar{display:flex;gap:8px;align-items:center;margin:0 0 12px;flex-wrap:wrap}
.cm-tabs{flex:1;min-width:180px;margin:0;display:flex}
.cm-tabs button{flex:1}
.cm-country{height:36px;border-radius:8px;background:var(--surface-2);border:1px solid var(--line);color:var(--text);font:13px var(--font);padding:0 8px;max-width:150px}
.cm-card{cursor:pointer;margin-bottom:10px}
.cm-card:hover{border-color:var(--line-2)}
.cm-card h3{margin:0 0 6px}
.tag.analyst{color:var(--analyst);background:var(--analyst-soft)}
.cm-kind{font:600 12px var(--font);color:var(--text-2)}
.cm-who{background:none;border:0;padding:0;font:12px var(--font);color:var(--text-2);cursor:pointer}
.cm-who b{color:var(--text);font-weight:600}
.cm-who span{color:var(--muted)}
.cm-who:hover b{text-decoration:underline}
.cm-hidden-tag{font:600 11px var(--font);color:var(--danger);border:1px solid var(--danger-line);border-radius:999px;padding:1px 7px}
.cm-excerpt{white-space:pre-wrap;overflow-wrap:anywhere;margin:0 0 8px}
.cm-foot{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font:12px var(--font);color:var(--muted)}
.cm-count{margin-left:auto}
.cm-countries{display:inline-flex;gap:5px;flex-wrap:wrap;align-items:center}
.cm-countries.edit{display:flex}
.cm-chip{font:500 12px var(--font);color:var(--text-2);background:var(--surface-2);border:1px solid var(--line);border-radius:999px;padding:2px 9px}
button.cm-chip{cursor:pointer}
.cm-countries select{height:28px;border-radius:999px;background:var(--surface);border:1px dashed var(--line-2);color:var(--text-2);font:12px var(--font);padding:0 8px}
.cm-title{font:700 20px/1.3 var(--font);margin:8px 0 10px;overflow-wrap:anywhere}
.cm-body p{font:14px/1.6 var(--font);color:var(--text);margin:0 0 12px;white-space:pre-wrap;overflow-wrap:anywhere}
.cm-body a,.cm-comment-body a,.cm-bio a{color:var(--accent);overflow-wrap:anywhere}
.cm-mapbox{border:1px solid var(--line);background:var(--surface-2);border-radius:10px;padding:12px;margin:8px 0 12px;font:13px/1.5 var(--font);color:var(--text-2);display:flex;flex-direction:column;gap:8px}
.cm-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.cm-row-actions{display:flex;gap:14px;flex-wrap:wrap;margin:10px 0}
.cm-comments{border-top:1px solid var(--line);margin-top:12px;padding-top:12px}
.cm-comments h3,.cm-section{font:600 14px var(--font);margin:6px 0 10px}
.cm-comment{border-bottom:1px solid var(--line);padding:8px 0}
.cm-comment.is-hidden{opacity:.6}
.cm-comment .card-meta{margin-bottom:4px}
.cm-comment-body{font:13px/1.5 var(--font);color:var(--text);white-space:pre-wrap;overflow-wrap:anywhere}
.cm-comment .cm-row-actions{margin:4px 0 0}
.cm-compose h2{font:700 18px var(--font);margin:0 0 12px}
.cm-kinds{margin:0 0 12px;display:flex}
.cm-kinds button{flex:1}
.cm-field{display:flex;flex-direction:column;gap:5px;margin:0 0 12px;position:relative}
.cm-label{font:600 12px var(--font);color:var(--text-2)}
.cm-field input,.cm-field textarea{background:var(--surface-2);border:1px solid var(--line);border-radius:8px;color:var(--text);font:14px/1.5 var(--font);padding:9px 11px;width:100%;resize:vertical}
.cm-field input:focus,.cm-field textarea:focus{outline:2px solid var(--accent-soft);border-color:var(--accent)}
.cm-counter{align-self:flex-end;font:11px var(--font);color:var(--muted)}
.cm-counter.warn{color:var(--danger)}
.cm-check{display:flex;gap:8px;align-items:flex-start;font:13px/1.45 var(--font);color:var(--text-2);margin:4px 0}
.cm-check input{margin-top:3px}
.cm-handle{font:13px var(--font);color:var(--muted);margin:-4px 0 8px}
.cm-bio{font:14px/1.5 var(--font);color:var(--text-2);margin:0 0 8px;white-space:pre-wrap}
.cm-stats{font:13px var(--font);color:var(--muted);margin:0 0 10px}
.cm-stats b{color:var(--text)}
.cm-rules h2{font:700 18px var(--font);margin:0 0 6px}
.cm-rules h3{font:600 14px var(--font);margin:16px 0 6px}
.cm-rules p,.cm-rules li{font:13px/1.55 var(--font);color:var(--text-2)}
.cm-rules ul{padding-left:18px;margin:0 0 8px}
`;
