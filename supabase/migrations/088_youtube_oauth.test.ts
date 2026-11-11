// Migration 088 on PGlite. Loads 001 through 087 that exist on disk,
// then 088 twice. Never uses a hosted database.
// 059, 062, 063, 064, and 080 are absent. That gap is expected.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const sqlPath = join(__dirname, "088_youtube_oauth.sql");
const sql = readFileSync(sqlPath, "utf8");
const statements = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const CHANNEL = "UCaaaaaaaaaaaaaaaaaaaaaa";

function migrationFiles(max: number): string[] {
  return readdirSync(__dirname)
    .filter((name) => /^\d{3}_.+\.sql$/.test(name))
    .map((name) => ({ name, n: Number(name.slice(0, 3)) }))
    .filter((row) => row.n >= 1 && row.n <= max)
    .sort((a, b) => a.n - b.n || a.name.localeCompare(b.name))
    .map((row) => join(__dirname, row.name));
}

describe("migration 088 youtube oauth", () => {
  it("documents the grant, retention, and quota rules and is not applied", () => {
    expect(sql).toContain("NOT applied. Apply only after merge and Chris's OK.");
    expect(sql).toContain("aircheck_captions");
    expect(sql).toContain("youtube_quota_set_reserve");
    expect(sql).toContain("30 days");
    expect(sql).toContain("7 days");
    expect(statements).not.toMatch(/create policy/i);
    expect(statements).not.toMatch(/\bto anon\b/i);
    expect(statements).not.toMatch(/grant select, insert, update, delete on table public\.youtube_oauth_connections to authenticated/i);
    expect(statements).toMatch(/refresh_token_enc = null/i);
    expect(statements).not.toMatch(/match_result\s*=/i);
  });
});

const prelude = `
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key,
  email text
);
create or replace function auth.uid()
returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create or replace function auth.role()
returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon')
$$;
create schema if not exists storage;
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text
);
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    create role supabase_admin nologin bypassrls;
  end if;
end $$;
create table if not exists public.show_claims (id uuid primary key default gen_random_uuid());
create table if not exists public.outcomes (id uuid primary key default gen_random_uuid());
`;

describe("migration 088 on PGlite", () => {
  const db = new PGlite();

  async function attempt(role: string, statement: string): Promise<string> {
    await db.exec(`set role ${role}`);
    try {
      await db.exec(statement);
      return "allowed";
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    } finally {
      await db.exec("reset role");
    }
  }

  beforeAll(async () => {
    await db.exec(prelude);
    for (const path of migrationFiles(87)) {
      if (path.endsWith("068_past_campaign_show_match.sql")) {
        await db.exec("alter table public.shows add column if not exists agent_id uuid;");
      }
      try {
        await db.exec(readFileSync(path, "utf8"));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`${path}\n${message}`);
      }
    }
    await db.exec(sql);
    await db.exec(sql);
    await db.exec(`insert into auth.users (id, email) values ('${USER}', 'show@example.com'), ('${OTHER}', 'other@example.com')`);
  }, 300_000);

  afterAll(async () => {
    await db.close();
  });

  it("denies anon and authenticated, and lets service_role do all four", async () => {
    for (const table of ["youtube_oauth_connections", "youtube_aircheck_metrics"]) {
      for (const role of ["anon", "authenticated"]) {
        expect(await attempt(role, `select * from public.${table}`)).toMatch(/permission denied/i);
        expect(await attempt(role, `insert into public.${table} default values`)).toMatch(/permission denied/i);
      }
      const rls = await db.query<{ relrowsecurity: boolean }>(
        `select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname = '${table}'`
      );
      expect(rls.rows[0]?.relrowsecurity).toBe(true);
    }
    const policies = await db.query<{ count: string }>(
      `select count(*)::text as count from pg_policies
        where schemaname = 'public'
          and tablename in ('youtube_oauth_connections', 'youtube_aircheck_metrics')`
    );
    expect(policies.rows[0]?.count).toBe("0");

    expect(
      await attempt(
        "service_role",
        `insert into public.youtube_oauth_connections
          (user_id, channel_id, scopes, refresh_token_enc, status)
         values ('${USER}', '${CHANNEL}', array['https://www.googleapis.com/auth/youtube.force-ssl'], 'v1.cipher', 'active')`
      )
    ).toBe("allowed");
    expect(await attempt("service_role", `select channel_id from public.youtube_oauth_connections`)).toBe("allowed");
    expect(
      await attempt(
        "service_role",
        `update public.youtube_oauth_connections set channel_title = 'Show' where user_id = '${USER}'`
      )
    ).toBe("allowed");
  });

  it("allows only one active connection per channel", async () => {
    const second = await attempt(
      "service_role",
      `insert into public.youtube_oauth_connections
        (user_id, channel_id, scopes, refresh_token_enc, status)
       values ('${OTHER}', '${CHANNEL}', array['https://www.googleapis.com/auth/youtube.force-ssl'], 'v1.other', 'active')`
    );
    expect(second).toMatch(/duplicate key|unique/i);
  });

  it("accepts the caption job, rejects an unknown job, and keeps reserve service_role only", async () => {
    const accepted = await db.query<{ value: string }>(
      `select public.youtube_quota_commit('2026-11-11', 250, 'aircheck_captions', 9800)->>'accepted' as value`
    );
    expect(accepted.rows[0]?.value).toBe("250");
    const rejected = await attempt(
      "service_role",
      `select public.youtube_quota_commit('2026-11-11', 1, 'other', 9800)`
    );
    expect(rejected).toMatch(/unknown job/i);

    const reserve = await db.query<{ aircheck_reserve: number }>(
      `select count(*)::int as aircheck_reserve from information_schema.columns
        where table_schema = 'public' and table_name = 'youtube_quota_days' and column_name = 'aircheck_reserve'`
    );
    expect(Number(reserve.rows[0]?.aircheck_reserve)).toBe(1);
    expect(await attempt("anon", `select public.youtube_quota_set_reserve('2026-11-12', 1800)`)).toMatch(/permission denied/i);
    expect(await attempt("authenticated", `select public.youtube_quota_set_reserve('2026-11-12', 1800)`)).toMatch(
      /permission denied/i
    );
    expect(await attempt("service_role", `select public.youtube_quota_set_reserve('2026-11-12', 1800)`)).toBe("allowed");
    const tooHigh = await attempt("service_role", `select public.youtube_quota_set_reserve('2026-11-12', 4001)`);
    expect(tooHigh).toMatch(/0 to 4000|check constraint/i);
    const row = await db.query<{ units: number; aircheck_reserve: number }>(
      `select units, aircheck_reserve from public.youtube_quota_days where pacific_day = '2026-11-12'`
    );
    expect(row.rows[0]?.units).toBe(0);
    expect(row.rows[0]?.aircheck_reserve).toBe(1800);
    expect(await attempt("service_role", `select public.youtube_quota_set_reserve('2026-11-12', 1800)`)).toBe("allowed");
  });

  it("lets service_role delete a connection row", async () => {
    expect(
      await attempt("service_role", `delete from public.youtube_oauth_connections where user_id = '${USER}'`)
    ).toBe("allowed");
  });

  it("denies anon and authenticated on the oauth functions and allows service_role", async () => {
    for (const role of ["anon", "authenticated"]) {
      expect(await attempt(role, `select public.youtube_oauth_disconnect('${USER}')`)).toMatch(/permission denied/i);
      expect(await attempt(role, `select public.youtube_oauth_housekeeping(now())`)).toMatch(/permission denied/i);
      expect(await attempt(role, `select public.youtube_oauth_clear_captions('{}'::uuid[])`)).toMatch(
        /permission denied/i
      );
    }
    expect(await attempt("service_role", `select public.youtube_oauth_housekeeping(now())`)).toBe("allowed");
    expect(await attempt("service_role", `select public.youtube_oauth_clear_captions('{}'::uuid[])`)).toBe("allowed");
  });

  it("purges captions from created_at, disconnects, and deletes lapsed and revoked rows", async () => {
    const show = "33333333-3333-4333-8333-333333333333";
    const profile = "44444444-4444-4444-8444-444444444444";
    const deal = "55555555-5555-4555-8555-555555555555";
    const io = "66666666-6666-4666-8666-666666666666";
    const line = "77777777-7777-4777-8777-777777777777";
    const lineReauth = "88888888-8888-4888-8888-888888888888";
    const lineRevoked = "99999999-9999-4999-8999-999999999999";
    const ioReauth = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const ioRevoked = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const dealReauth = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const dealRevoked = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const conn = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const connReauth = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const connRevoked = "12121212-1212-4212-8212-121212121212";

    await db.exec(`
      insert into public.profiles (id, email, role) values ('${USER}', 'show@example.com', 'show');
      insert into public.shows (id, name, platform) values ('${show}', 'Show', 'youtube');
      insert into public.show_profiles (id, user_id) values ('${profile}', '${USER}');
      insert into public.deals (
        id, show_id, brand_id, show_profile_id, status, num_episodes, placement, ad_format,
        price_type, cpm_rate, guaranteed_downloads, net_per_episode, total_net, flight_start, flight_end
      ) values
        ('${deal}', '${show}', '${USER}', '${profile}', 'signed', 1, 'mid-roll', 'host_read', 'flat_rate', 25, 1000, 100, 100, '2026-11-01', '2026-11-30'),
        ('${dealReauth}', '${show}', '${USER}', '${profile}', 'signed', 1, 'mid-roll', 'host_read', 'flat_rate', 25, 1000, 100, 100, '2026-11-01', '2026-11-30'),
        ('${dealRevoked}', '${show}', '${USER}', '${profile}', 'signed', 1, 'mid-roll', 'host_read', 'flat_rate', 25, 1000, 100, 100, '2026-11-01', '2026-11-30');
      insert into public.insertion_orders (
        id, io_number, deal_id, advertiser_name, publisher_name, publisher_contact_name,
        publisher_contact_email, total_downloads, total_gross, total_net
      ) values
        ('${io}', 'IO-1', '${deal}', 'Brand', 'Show', 'Host', 'show@example.com', 1000, 100, 100),
        ('${ioReauth}', 'IO-2', '${dealReauth}', 'Brand', 'Show', 'Host', 'show@example.com', 1000, 100, 100),
        ('${ioRevoked}', 'IO-3', '${dealRevoked}', 'Brand', 'Show', 'Host', 'show@example.com', 1000, 100, 100);
      insert into public.io_line_items (
        id, io_id, format, post_date, guaranteed_downloads, show_name, placement, gross_rate, gross_cpm, price_type, net_due
      ) values
        ('${line}', '${io}', 'youtube', '2026-10-01', 1000, 'Show', 'mid-roll', 100, 25, 'flat_rate', 100),
        ('${lineReauth}', '${ioReauth}', 'youtube', '2026-10-01', 1000, 'Show', 'mid-roll', 100, 25, 'flat_rate', 100),
        ('${lineRevoked}', '${ioRevoked}', 'youtube', '2026-10-01', 1000, 'Show', 'mid-roll', 100, 25, 'flat_rate', 100);
      insert into public.airchecks (
        io_line_item_id, provider, status, transcript_text, transcript_segments, match_result, confidence,
        ad_start_seconds, ad_end_seconds, match_reasons, match_evidence, created_at, updated_at
      ) values
        (
          '${line}', 'youtube-captions', 'transcribed', 'secret caption', '[]'::jsonb, 'matched', 0.9,
          40, 50, '["Brand found."]'::jsonb, '{"excerpt":"secret caption","brand":"found"}'::jsonb,
          now() - interval '31 days', now() - interval '1 day'
        ),
        (
          '${lineReauth}', 'youtube-captions', 'transcribed', 'reauth caption', '[]'::jsonb, 'matched', 0.8,
          10, 20, '["Kept."]'::jsonb, '{"excerpt":"reauth caption","brand":"found"}'::jsonb,
          now() - interval '1 day', now()
        ),
        (
          '${lineRevoked}', 'youtube-captions', 'transcribed', 'revoked caption', '[]'::jsonb, 'not_matched', 0.2,
          1, 2, '["Kept."]'::jsonb, '{"excerpt":"revoked caption","brand":"missing"}'::jsonb,
          now() - interval '1 day', now()
        );
      insert into public.youtube_oauth_connections (
        id, user_id, show_profile_id, channel_id, channel_title, scopes, refresh_token_enc, access_token_enc, status
      ) values (
        '${conn}', '${USER}', '${profile}', 'UCkeep', 'Keep', array['https://www.googleapis.com/auth/youtube.force-ssl'],
        'v1.keep', 'v1.access', 'active'
      );
    `);

    expect(await attempt("service_role", `select public.youtube_oauth_housekeeping(now())`)).toBe("allowed");
    const purged = await db.query<{
      transcript_text: string | null;
      segments: string | null;
      excerpt: string | null;
      match_result: string;
      confidence: string;
      ad_start_seconds: number;
      match_reasons: string;
    }>(`
      select transcript_text, transcript_segments::text as segments, match_evidence->>'excerpt' as excerpt,
             match_result, confidence::text, ad_start_seconds, match_reasons::text
        from public.airchecks where io_line_item_id = '${line}'
    `);
    expect(purged.rows[0]?.transcript_text).toBeNull();
    expect(purged.rows[0]?.segments).toBeNull();
    expect(purged.rows[0]?.excerpt).toBeNull();
    expect(purged.rows[0]?.match_result).toBe("matched");
    expect(Number(purged.rows[0]?.confidence)).toBeCloseTo(0.9);
    expect(Number(purged.rows[0]?.ad_start_seconds)).toBe(40);
    expect(purged.rows[0]?.match_reasons).toContain("Brand found.");

    expect(await attempt("service_role", `select public.youtube_oauth_disconnect('${USER}')`)).toBe("allowed");
    const disconnected = await db.query<{
      status: string;
      refresh_token_enc: string | null;
      access_token_enc: string | null;
    }>(`select status, refresh_token_enc, access_token_enc from public.youtube_oauth_connections where id = '${conn}'`);
    expect(disconnected.rows[0]?.status).toBe("revoked");
    expect(disconnected.rows[0]?.refresh_token_enc).toBeNull();
    expect(disconnected.rows[0]?.access_token_enc).toBeNull();

    await db.exec(`
      insert into public.youtube_oauth_connections (
        id, user_id, show_profile_id, channel_id, channel_title, scopes, status, reauth_required_at
      ) values (
        '${connReauth}', '${USER}', '${profile}', 'UCreauth', 'Old title', array['https://www.googleapis.com/auth/youtube.force-ssl'],
        'reauth_required', now() - interval '31 days'
      );
      insert into public.youtube_aircheck_metrics (io_line_item_id, connection_id, video_id, views, attempts)
      values ('${lineReauth}', '${connReauth}', 'abcdefghijk', 10, 1);
      insert into public.youtube_oauth_connections (
        id, user_id, show_profile_id, channel_id, channel_title, scopes, status, revoked_at
      ) values (
        '${connRevoked}', '${OTHER}', '${profile}', 'UCrevoked', 'Gone', array['https://www.googleapis.com/auth/youtube.force-ssl'],
        'revoked', now() - interval '8 days'
      );
      insert into public.youtube_aircheck_metrics (io_line_item_id, connection_id, video_id, views, attempts)
      values ('${lineRevoked}', '${connRevoked}', 'bbcdefghijk', 4, 1);
    `);
    expect(await attempt("service_role", `select public.youtube_oauth_housekeeping(now())`)).toBe("allowed");

    const reauthGone = await db.query<{ count: string }>(
      `select count(*)::text as count from public.youtube_oauth_connections where id = '${connReauth}'`
    );
    expect(reauthGone.rows[0]?.count).toBe("0");
    const reauthMetrics = await db.query<{ count: string }>(
      `select count(*)::text as count from public.youtube_aircheck_metrics where connection_id = '${connReauth}'`
    );
    expect(reauthMetrics.rows[0]?.count).toBe("0");
    const reauthCaption = await db.query<{ transcript_text: string | null; match_result: string }>(
      `select transcript_text, match_result from public.airchecks where io_line_item_id = '${lineReauth}'`
    );
    expect(reauthCaption.rows[0]?.transcript_text).toBeNull();
    expect(reauthCaption.rows[0]?.match_result).toBe("matched");

    const revokedGone = await db.query<{ count: string }>(
      `select count(*)::text as count from public.youtube_oauth_connections where id = '${connRevoked}'`
    );
    expect(revokedGone.rows[0]?.count).toBe("0");
    const revokedCaption = await db.query<{ transcript_text: string | null; match_result: string }>(
      `select transcript_text, match_result from public.airchecks where io_line_item_id = '${lineRevoked}'`
    );
    expect(revokedCaption.rows[0]?.transcript_text).toBeNull();
    expect(revokedCaption.rows[0]?.match_result).toBe("not_matched");

    const secondLive = await attempt(
      "service_role",
      `insert into public.youtube_oauth_connections
        (user_id, show_profile_id, channel_id, scopes, refresh_token_enc, status)
       values ('${USER}', '${profile}', 'UCone', array['https://www.googleapis.com/auth/youtube.force-ssl'], 'v1.a', 'active'),
              ('${USER}', '${profile}', 'UCtwo', array['https://www.googleapis.com/auth/youtube.force-ssl'], 'v1.b', 'reauth_required')`
    );
    expect(secondLive).toMatch(/duplicate key|unique/i);
  });
});
