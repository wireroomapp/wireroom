// Sets up and checks the community database on Supabase. Run by .github/workflows/community-db.yml.
//   1. Applies supabase/schema.sql in one transaction (safe to repeat; it never deletes data).
//   2. Runs the same rule checks as the unit tests (tests/community-rules.mjs) on the real
//      database, as four made-up users, inside a transaction that is rolled back: nothing stays.
//   3. Optional: makes a username a moderator (workflow input "make_admin").
// Needs the GitHub secret SUPABASE_DB_URL (the "Session pooler" connection string from
// Supabase's Connect dialog). Without it, it says so and stops; nothing fails.
// Prints counts only, never anyone's posts or account details.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import pg from "pg";
import { SECTIONS, USERS } from "../tests/community-rules.mjs";

const url = String(process.env.SUPABASE_DB_URL || "").trim();
if (!url) {
  console.log("::notice::SUPABASE_DB_URL isn't set yet, so the community database wasn't set up. See the setup steps in README.md (Community).");
  process.exit(0);
}
let shape;
try {
  const u = new URL(url);
  shape = `${u.protocol}//${u.username}:***@${u.hostname}:${u.port || 5432}${u.pathname}`;
  if (!/^postgres(ql)?:$/.test(u.protocol)) throw new Error("not a postgres:// address");
  if (u.password === "[YOUR-PASSWORD]" || u.password === "%5BYOUR-PASSWORD%5D") throw new Error("the password placeholder wasn't replaced");
} catch (e) {
  console.log(`::error::SUPABASE_DB_URL doesn't look right (${e.message}). Copy the "Session pooler" string from Supabase's Connect dialog and put your database password in place of [YOUR-PASSWORD].`);
  process.exit(1);
}
console.log(`Connecting to ${shape}`);

// Supabase requires encryption; its certificate is signed by Supabase's own authority.
const client = new pg.Client({ connectionString: url.replace(/[?&]sslmode=[^&]*/, ""), ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20000 });
try {
  await client.connect();
} catch (e) {
  console.log(`::error::Couldn't connect to the database: ${e.message}. ${/ENOTFOUND|ENETUNREACH|EHOSTUNREACH/.test(e.message) ? 'Use the "Session pooler" string (the direct one needs IPv6, which GitHub doesn\'t have).' : /password|auth/i.test(e.message) ? "The password in the secret may be wrong." : ""}`);
  process.exit(1);
}

let failed = 0;
try {
  // 1. The schema.
  const schema = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf-8");
  await client.query("begin");
  try {
    await client.query(schema);
    await client.query("commit");
    console.log("Schema applied (supabase/schema.sql).");
  } catch (e) {
    await client.query("rollback");
    console.log(`::error::Schema not applied, nothing changed: ${e.message}`);
    process.exit(1);
  }

  // 2. The rule checks, on the real database, rolled back at the end.
  await client.query("begin");
  try {
    let canMakeUsers = true;
    await client.query("savepoint users");
    try {
      for (const id of USERS) {
        await client.query("insert into auth.users (id, aud, role, email, created_at, updated_at) values ($1, 'authenticated', 'authenticated', $2, now(), now())", [id, `check-${id.slice(-4)}@example.invalid`]);
      }
    } catch (e) {
      canMakeUsers = false;
      await client.query("rollback to savepoint users");
      console.log(`::warning::Couldn't add test users (${e.message}); only the signed-out checks ran.`);
    }
    // Each step in its own savepoint, so an expected refusal doesn't end the transaction.
    let n = 0;
    const as = async (who, sql, params = []) => {
      const sp = `s${n++}`;
      await client.query(`savepoint ${sp}`);
      try {
        const sub = who && who !== "admin" ? who : "";
        await client.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)",
          [sub, sub ? JSON.stringify({ sub, role: "authenticated" }) : ""]);
        await client.query(who === "admin" ? "reset role" : `set local role ${who ? "authenticated" : "anon"}`);
        const res = await client.query(sql, params);
        await client.query("reset role");
        await client.query(`release savepoint ${sp}`);
        return res.rows;
      } catch (e) {
        await client.query(`rollback to savepoint ${sp}`);
        throw e;
      }
    };
    const fails = (p, re, msg) => assert.rejects(p, re, msg);
    const post = (who, kind, f = {}) => as(who,
      "insert into posts (kind, title, body, annotations, countries, copied_from) values ($1, $2, $3, $4::jsonb, $5::text[], $6) returning id",
      [kind, f.title ?? "", f.body ?? "", f.annotations ?? null, f.countries ?? [], f.copied_from ?? null]);
    const s = {};
    if (canMakeUsers) {
      for (const [name, run] of SECTIONS) {
        try {
          await run({ as, fails, post, s });
          console.log(`  ok    ${name}`);
        } catch (e) {
          failed++;
          console.log(`::error::Rule check failed: ${name}: ${e.message}`);
        }
      }
    }
    // Signed-out visitors can read but never write.
    try {
      await as(null, "select id from posts limit 1");
      await fails(as(null, "insert into posts (kind, body) values ('post', 'x')"), /permission denied/);
      await fails(as(null, "select * from reports"), /permission denied/);
      console.log("  ok    signed-out visitors: read only");
    } catch (e) {
      failed++;
      console.log(`::error::Rule check failed: signed-out visitors: ${e.message}`);
    }
  } finally {
    await client.query("rollback"); // nothing from the checks stays
  }

  // 3. Make a moderator.
  const who = String(process.env.MAKE_ADMIN || "").trim().toLowerCase().replace(/^@/, "");
  if (who) {
    if (!/^[a-z0-9_]{3,20}$/.test(who)) console.log(`::error::"${who}" isn't a valid username.`);
    else {
      const res = await client.query("insert into private.admins (user_id) select id from public.profiles where username = $1 on conflict do nothing returning user_id", [who]);
      const exists = (await client.query("select 1 from public.profiles where username = $1", [who])).rowCount > 0;
      console.log(!exists ? `::error::No account with the username ${who} yet. Sign in on the site and pick it first.`
        : res.rowCount ? `${who} is now a moderator.` : `${who} was already a moderator.`);
    }
  }

  // Counts only.
  const c = (await client.query(`select (select count(*) from public.profiles)::int profiles, (select count(*) from public.posts)::int posts,
    (select count(*) from public.comments)::int comments, (select count(*) from public.reports where not resolved)::int open_reports,
    (select count(*) from private.admins)::int moderators`)).rows[0];
  console.log(`Community now: ${c.profiles} accounts, ${c.posts} posts, ${c.comments} comments, ${c.open_reports} open reports, ${c.moderators} moderators.`);
} finally {
  await client.end();
}
if (failed) {
  console.log(`::error::${failed} rule check(s) failed. The schema is applied, but fix the rules before relying on them.`);
  process.exit(1);
}
