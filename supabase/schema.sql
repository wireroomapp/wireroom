-- Wire Room community: accounts, posts (text posts, articles, maps), comments, follows, reports.
--
-- Applied by .github/workflows/community-db.yml (scripts/community-db.mjs) whenever this file
-- changes, inside one transaction, so a mistake leaves nothing half-done. Safe to run again: it
-- creates what's missing and replaces rules and functions; it never deletes data.
--
-- How it is kept safe: the website talks to the database directly with Supabase's public
-- (publishable) key, so these rules are the only thing deciding who may read or change what:
--   - anyone can read posts, comments, profiles and follows that aren't hidden
--   - you can only create, change or delete your own profile, posts, follows and comments
--   - a post's author can also delete comments on it
--   - reports can be sent but only admins can read them (in the app, or the dashboard)
--   - "hidden" (moderation) can only be set by an admin, through moderate()
--   - text only: no image or file uploads (nothing to scan for illegal images)
-- Tested in tests/community-db.test.mjs (PGlite) and against the real database by the workflow.

-- ---------- Tables ----------
create schema if not exists private; -- not reachable through the website's API
revoke all on schema private from public;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text not null default '' check (char_length(display_name) <= 40),
  bio text not null default '' check (char_length(bio) <= 280),
  accepted_terms_at timestamptz not null default now(), -- 13+ and the community rules, ticked at sign-up
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('post', 'article', 'map')),
  title text not null default '' check (char_length(title) <= 120),
  body text not null default '' check (char_length(body) <= 20000),
  -- A map post's drawing: markers, lines, shapes, notes and pinned reports (link + headline only).
  annotations jsonb check (annotations is null or (jsonb_typeof(annotations) = 'array'
    and jsonb_array_length(annotations) between 1 and 500 and octet_length(annotations::text) <= 300000)),
  countries text[] not null default '{}' check (cardinality(countries) <= 5 and array_to_string(countries, ',') ~ '^([a-z]{2}(,[a-z]{2})*)?$'),
  copied_from uuid references public.posts(id) on delete set null, -- "based on" another map post
  excerpt text generated always as (left(regexp_replace(body, '\s+', ' ', 'g'), 280)) stored, -- for the feed
  map_items int generated always as (case when jsonb_typeof(annotations) = 'array' then jsonb_array_length(annotations) else 0 end) stored,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  constraint post_shape check (
    (kind = 'post' and title = '' and annotations is null and char_length(btrim(body)) between 1 and 1000)
    or (kind = 'article' and char_length(btrim(title)) >= 1 and annotations is null and char_length(btrim(body)) >= 1)
    or (kind = 'map' and char_length(btrim(title)) >= 1 and annotations is not null and char_length(body) <= 2000)
  )
);
create index if not exists posts_latest on public.posts (created_at desc) where not hidden;
create index if not exists posts_by_author on public.posts (author_id, created_at desc);
create index if not exists posts_by_country on public.posts using gin (countries);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists comments_by_post on public.comments (post_id, created_at);

create table if not exists public.follows (
  follower_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  followee_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index if not exists follows_followee on public.follows (followee_id);

create table if not exists public.reports (
  id bigint generated always as identity primary key,
  reporter_id uuid default auth.uid() references public.profiles(id) on delete set null,
  target_type text not null check (target_type in ('post', 'comment', 'profile')),
  target_id uuid not null,
  reason text not null default '' check (char_length(reason) <= 500),
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists reports_open on public.reports (created_at desc) where not resolved;

-- Moderators. Added by the workflow (input "make_admin") or in the dashboard; never from the website.
create table if not exists private.admins (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  added_at timestamptz not null default now()
);

-- ---------- Who may write which columns ----------
-- (Supabase lets the public roles write every column by default; narrow that.)
revoke insert, update, delete on public.profiles, public.posts, public.comments, public.follows, public.reports from anon, authenticated;
revoke select on public.reports from anon, authenticated;
grant insert (id, username, display_name, bio) on public.profiles to authenticated;
grant update (display_name, bio) on public.profiles to authenticated;
grant insert (kind, title, body, annotations, countries, copied_from) on public.posts to authenticated;
grant update (title, body, annotations, countries) on public.posts to authenticated;
grant delete on public.posts to authenticated;
grant insert (post_id, body) on public.comments to authenticated;
grant delete on public.comments to authenticated;
grant insert (followee_id) on public.follows to authenticated;
grant delete on public.follows to authenticated;
grant insert (target_type, target_id, reason) on public.reports to authenticated;
grant select on public.profiles, public.posts, public.comments, public.follows to anon, authenticated;

-- ---------- Helpers ----------
create or replace function public.am_admin() returns boolean
language sql stable security definer set search_path = public, private as $$
  select exists (select 1 from private.admins where user_id = auth.uid());
$$;

-- Signed in with a profile that isn't hidden (banned): needed to post, comment or follow.
create or replace function public.in_good_standing() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and not hidden);
$$;

-- Can this post be seen and answered? (not hidden, author not hidden)
create or replace function public.post_is_open(p_post uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.posts t join public.profiles p on p.id = t.author_id
    where t.id = p_post and not t.hidden and not p.hidden
  );
$$;

-- Admins: hide or show a post, comment or profile, and close the reports about it.
create or replace function public.moderate(p_type text, p_id uuid, p_hide boolean) returns void
language plpgsql security definer set search_path = public, private as $$
begin
  if not public.am_admin() then raise exception 'Only moderators can do that.' using errcode = '42501'; end if;
  if p_type = 'post' then update public.posts set hidden = p_hide where id = p_id;
  elsif p_type = 'comment' then update public.comments set hidden = p_hide where id = p_id;
  elsif p_type = 'profile' then update public.profiles set hidden = p_hide where id = p_id;
  else raise exception 'Unknown type %', p_type;
  end if;
  update public.reports set resolved = true where target_type = p_type and target_id = p_id and not resolved;
end; $$;

-- Admins: open reports, newest first, with what was reported.
create or replace function public.open_reports()
returns table (id bigint, target_type text, target_id uuid, reason text, created_at timestamptz,
  reporter text, target_author text, target_text text, target_hidden boolean, post_id uuid)
language plpgsql stable security definer set search_path = public, private as $$
#variable_conflict use_column
begin
  if not public.am_admin() then raise exception 'Only moderators can do that.' using errcode = '42501'; end if;
  return query
  select r.id, r.target_type, r.target_id, r.reason, r.created_at, rp.username,
    coalesce(tp.username, cp.username, pp.username),
    left(coalesce(nullif(t.title, ''), t.body, c.body, pp.display_name || ' ' || pp.bio, ''), 300),
    coalesce(t.hidden, c.hidden, pp.hidden, false),
    coalesce(t.id, c.post_id)
  from public.reports r
  left join public.profiles rp on rp.id = r.reporter_id
  left join public.posts t on r.target_type = 'post' and t.id = r.target_id
  left join public.profiles tp on tp.id = t.author_id
  left join public.comments c on r.target_type = 'comment' and c.id = r.target_id
  left join public.profiles cp on cp.id = c.author_id
  left join public.profiles pp on r.target_type = 'profile' and pp.id = r.target_id
  where not r.resolved
  order by r.created_at desc
  limit 200;
end; $$;

create or replace function public.dismiss_report(p_id bigint) returns void
language plpgsql security definer set search_path = public, private as $$
begin
  if not public.am_admin() then raise exception 'Only moderators can do that.' using errcode = '42501'; end if;
  update public.reports set resolved = true where id = p_id;
end; $$;

-- Delete my account and everything I posted (posts, comments, follows). Reports I sent stay, unnamed.
create or replace function public.delete_my_account() returns void
language sql security definer set search_path = public, auth as $$
  delete from auth.users where id = auth.uid();
$$;

-- edited_at on every change to a post's words or drawing
create or replace function public.mark_edited() returns trigger language plpgsql as $$
begin
  if (new.title, new.body, new.annotations, new.countries) is distinct from (old.title, old.body, old.annotations, old.countries) then
    new.edited_at := now();
  end if;
  return new;
end; $$;
drop trigger if exists posts_edited on public.posts;
create trigger posts_edited before update on public.posts for each row execute function public.mark_edited();

-- Rate limits (spam protection on the free plan): at most N new rows per user per time window.
create or replace function public.rate_limit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  n int;
  who uuid := auth.uid();
  max_n int := tg_argv[1]::int;
  win interval := tg_argv[2]::interval;
begin
  if who is null then return new; end if; -- dashboard / maintenance work isn't limited
  execute format('select count(*) from public.%I where %I = $1 and created_at > now() - $2', tg_table_name, tg_argv[0]) into n using who, win;
  if n >= max_n then
    raise exception 'Too many in a short time. Please try again later.' using errcode = 'P0001';
  end if;
  return new;
end; $$;
drop trigger if exists posts_rate_hour on public.posts;
create trigger posts_rate_hour before insert on public.posts for each row execute function public.rate_limit('author_id', '10', '1 hour');
drop trigger if exists posts_rate_day on public.posts;
create trigger posts_rate_day before insert on public.posts for each row execute function public.rate_limit('author_id', '30', '1 day');
drop trigger if exists comments_rate_short on public.comments;
create trigger comments_rate_short before insert on public.comments for each row execute function public.rate_limit('author_id', '10', '5 minutes');
drop trigger if exists comments_rate_day on public.comments;
create trigger comments_rate_day before insert on public.comments for each row execute function public.rate_limit('author_id', '200', '1 day');
drop trigger if exists follows_rate on public.follows;
create trigger follows_rate before insert on public.follows for each row execute function public.rate_limit('follower_id', '200', '1 day');
drop trigger if exists reports_rate on public.reports;
create trigger reports_rate before insert on public.reports for each row execute function public.rate_limit('reporter_id', '20', '1 day');

-- (Supabase lets everyone run new functions by default; take that back, then allow what's needed.)
revoke all on function public.am_admin(), public.in_good_standing(), public.post_is_open(uuid), public.moderate(text, uuid, boolean),
  public.open_reports(), public.dismiss_report(bigint), public.delete_my_account(), public.mark_edited(), public.rate_limit()
  from public, anon, authenticated;
grant execute on function public.am_admin(), public.in_good_standing(), public.post_is_open(uuid) to anon, authenticated;
grant execute on function public.moderate(text, uuid, boolean), public.open_reports(), public.dismiss_report(bigint), public.delete_my_account() to authenticated;

-- ---------- Row-level security ----------
alter table public.profiles enable row level security;
alter table public.posts enable row level security;
alter table public.comments enable row level security;
alter table public.follows enable row level security;
alter table public.reports enable row level security;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select using (not hidden or id = (select auth.uid()) or (select public.am_admin()));
drop policy if exists profiles_create on public.profiles;
create policy profiles_create on public.profiles for insert to authenticated with check (id = (select auth.uid()));
drop policy if exists profiles_edit on public.profiles;
create policy profiles_edit on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Admins see hidden posts too (marked hidden in the app), so they can show them again.
drop policy if exists posts_read on public.posts;
create policy posts_read on public.posts for select using (
  author_id = (select auth.uid())
  or (select public.am_admin())
  or (not hidden and exists (select 1 from public.profiles p where p.id = author_id and not p.hidden))
);
drop policy if exists posts_create on public.posts;
create policy posts_create on public.posts for insert to authenticated with check (
  author_id = (select auth.uid()) and (select public.in_good_standing()) and (copied_from is null or public.post_is_open(copied_from))
);
drop policy if exists posts_edit on public.posts;
create policy posts_edit on public.posts for update to authenticated using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()));
drop policy if exists posts_delete on public.posts;
create policy posts_delete on public.posts for delete to authenticated using (author_id = (select auth.uid()));

drop policy if exists comments_read on public.comments;
create policy comments_read on public.comments for select using (
  author_id = (select auth.uid())
  or (select public.am_admin())
  or (not hidden and public.post_is_open(post_id) and exists (select 1 from public.profiles p where p.id = author_id and not p.hidden))
);
drop policy if exists comments_create on public.comments;
create policy comments_create on public.comments for insert to authenticated with check (
  author_id = (select auth.uid()) and (select public.in_good_standing()) and public.post_is_open(post_id)
);
drop policy if exists comments_delete on public.comments;
create policy comments_delete on public.comments for delete to authenticated using (
  author_id = (select auth.uid()) or exists (select 1 from public.posts t where t.id = post_id and t.author_id = (select auth.uid()))
);

drop policy if exists follows_read on public.follows;
create policy follows_read on public.follows for select using (true);
drop policy if exists follows_create on public.follows;
create policy follows_create on public.follows for insert to authenticated with check (follower_id = (select auth.uid()) and (select public.in_good_standing()));
drop policy if exists follows_delete on public.follows;
create policy follows_delete on public.follows for delete to authenticated using (follower_id = (select auth.uid()));

drop policy if exists reports_create on public.reports;
create policy reports_create on public.reports for insert to authenticated with check (reporter_id = (select auth.uid()));
