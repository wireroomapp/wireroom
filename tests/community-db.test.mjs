// Tests the community database rules (supabase/schema.sql) on a real Postgres engine (PGlite),
// with a stand-in for the bits Supabase provides: the auth.users table, auth.uid() (who is
// signed in) and the anon / authenticated roles with Supabase's default rights. The checks
// themselves are in tests/community-rules.mjs; the same checks run on the real database
// (scripts/community-db.mjs, GitHub workflow "Community database").
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { SECTIONS, USERS } from "./community-rules.mjs";

const SCHEMA = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf-8");
let db;

// Supabase's auth.uid() reads the signed-in user from the request's token claims.
const SUPABASE_STANDIN = `
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;
  insert into auth.users values ${USERS.map((u) => `('${u}')`).join(", ")};
`;

// Run SQL as a visitor: null = signed out (anon), else that user id; "admin" = the dashboard.
async function as(who, sql, params = []) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [who && who !== "admin" ? who : ""]);
  if (who !== "admin") await db.exec(`set role ${who ? "authenticated" : "anon"}`);
  try { return (await db.query(sql, params)).rows; } finally { await db.exec("reset role"); }
}
const fails = (p, re, msg) => assert.rejects(p, re, msg);
const post = (who, kind, f = {}) => as(who,
  "insert into posts (kind, title, body, annotations, countries, copied_from) values ($1, $2, $3, $4::jsonb, $5::text[], $6) returning id",
  [kind, f.title ?? "", f.body ?? "", f.annotations ?? null, f.countries ?? [], f.copied_from ?? null]);

before(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STANDIN);
  await db.exec(SCHEMA);
  await db.exec(SCHEMA); // safe to run again
});

const s = {}; // posts made by earlier checks, used by later ones
for (const [name, run] of SECTIONS) test(name, () => run({ as, fails, post, s }));
