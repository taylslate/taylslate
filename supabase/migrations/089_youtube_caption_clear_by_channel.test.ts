// Migration 089 on PGlite. Loads 001 through 088 that exist on disk,
// then 089 twice. Never uses a hosted database.
// 059, 062, 063, and 064 are absent. That gap is expected.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const sqlPath = join(__dirname, "089_youtube_caption_clear_by_channel.sql");
const sql = readFileSync(sqlPath, "utf8");
const statements = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const PROFILE = "44444444-4444-4444-8444-444444444444";

const SHOW_OLD = "a1111111-1111-4111-8111-111111111111";
const SHOW_NEW = "a2222222-2222-4222-8222-222222222222";
const SHOW_LIB = "a3333333-3333-4333-8333-333333333333";
const SHOW_NULL = "a4444444-4444-4444-8444-444444444444";

const DEAL_OLD = "b1111111-1111-4111-8111-111111111111";
const DEAL_NEW = "b2222222-2222-4222-8222-222222222222";
const DEAL_LIB = "b3333333-3333-4333-8333-333333333333";
const DEAL_NULL = "b4444444-4444-4444-8444-444444444444";

const IO_OLD = "c1111111-1111-4111-8111-111111111111";
const IO_NEW = "c2222222-2222-4222-8222-222222222222";
const IO_LIB = "c3333333-3333-4333-8333-333333333333";
const IO_NULL = "c4444444-4444-4444-8444-444444444444";

const LINE_OLD = "d1111111-1111-4111-8111-111111111111";
const LINE_NEW = "d2222222-2222-4222-8222-222222222222";
const LINE_LIB = "d3333333-3333-4333-8333-333333333333";
const LINE_NULL = "d4444444-4444-4444-8444-444444444444";
const LINE_AGED = "d5555555-5555-4555-8555-555555555555";

const CONN_REVOKED = "e1111111-1111-4111-8111-111111111111";
const CONN_ACTIVE = "e2222222-2222-4222-8222-222222222222";
const CONN_REAUTH = "e3333333-3333-4333-8333-333333333333";
const CONN_REVOKED_AGAIN = "e4444444-4444-4444-8444-444444444444";
const CONN_BACK = "e5555555-5555-4555-8555-555555555555";

const SCOPE = "https://www.googleapis.com/auth/youtube.force-ssl";

function migrationFiles(max: number): string[] {
  return readdirSync(__dirname)
    .filter((name) => /^\d{3}_.+\.sql$/.test(name))
    .map((name) => ({ name, n: Number(name.slice(0, 3)) }))
    .filter((row) => row.n >= 1 && row.n <= max)
    .sort((a, b) => a.n - b.n || a.name.localeCompare(b.name))
    .map((row) => join(__dirname, row.name));
}

describe("migration 089 caption clear by channel", () => {
  it("replaces housekeeping only and does not grant anon", () => {
    expect(sql).toContain("NOT applied. Apply only after merge and Chris's OK.");
    expect(sql).toContain("after 088");
    expect(statements).toMatch(/create or replace function public\.youtube_oauth_housekeeping\(p_now timestamptz\)/);
    expect(statements).toMatch(/security invoker/);
    expect(statements).toMatch(/set search_path = public/);
    expect(statements).toMatch(/nullif\(trim\(s\.youtube_channel_id\), ''\)/);
    expect(statements).toMatch(/order by yc\.channel_id/);
    expect(statements).toMatch(/l\.channel_id = c\.channel_id/);
    expect(statements).toMatch(/c\.show_profile_id = d\.show_profile_id/);
    expect(statements).toMatch(/a\.provider = 'youtube-captions'/);
    expect(statements).toMatch(/created_at < v_caption_before/);
    expect(statements).not.toMatch(/l\.show_profile_id = c\.show_profile_id/);
    expect(statements).not.toMatch(/youtube_oauth_disconnect/i);
    expect(statements).not.toMatch(/create table/i);
    expect(statements).not.toMatch(/add column/i);
    expect(statements).not.toMatch(/create policy/i);
    expect(statements).not.toMatch(/\bto anon\b/i);
    expect(statements).toMatch(
      /grant execute on function public\.youtube_oauth_housekeeping\(timestamptz\) to service_role/
    );
    expect(statements.match(/perform public\.youtube_oauth_clear_captions/g)).toHaveLength(3);
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

interface CaptionRow {
  io_line_item_id: string;
  transcript_text: string | null;
  segments: string | null;
  excerpt: string | null;
  brand: string | null;
  match_result: string;
  confidence: string;
  ad_start_seconds: string;
  ad_end_seconds: string;
  match_reasons: string;
}

describe("migration 089 on PGlite", () => {
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

  async function captions(): Promise<Map<string, CaptionRow>> {
    const result = await db.query<CaptionRow>(`
      select io_line_item_id::text,
             transcript_text,
             transcript_segments::text as segments,
             match_evidence->>'excerpt' as excerpt,
             match_evidence->>'brand' as brand,
             match_result,
             confidence::text,
             ad_start_seconds::text,
             ad_end_seconds::text,
             match_reasons::text
        from public.airchecks
    `);
    return new Map(result.rows.map((row) => [row.io_line_item_id, row]));
  }

  function expectCleared(
    row: CaptionRow | undefined,
    judgment: { match_result: string; confidence: number; start: number; end: number; reason: string }
  ) {
    expect(row?.transcript_text).toBeNull();
    expect(row?.segments).toBeNull();
    expect(row?.excerpt).toBeNull();
    expect(row?.brand).toBe("found");
    expect(row?.match_result).toBe(judgment.match_result);
    expect(Number(row?.confidence)).toBeCloseTo(judgment.confidence);
    expect(Number(row?.ad_start_seconds)).toBe(judgment.start);
    expect(Number(row?.ad_end_seconds)).toBe(judgment.end);
    expect(row?.match_reasons).toContain(judgment.reason);
  }

  function expectKept(
    row: CaptionRow | undefined,
    text: string,
    judgment: { match_result: string; confidence: number; start: number; end: number; reason: string }
  ) {
    expect(row?.transcript_text).toBe(text);
    expect(row?.segments).toBe("[]");
    expect(row?.excerpt).toBe(text);
    expect(row?.brand).toBe("found");
    expect(row?.match_result).toBe(judgment.match_result);
    expect(Number(row?.confidence)).toBeCloseTo(judgment.confidence);
    expect(Number(row?.ad_start_seconds)).toBe(judgment.start);
    expect(Number(row?.ad_end_seconds)).toBe(judgment.end);
    expect(row?.match_reasons).toContain(judgment.reason);
  }

  beforeAll(async () => {
    await db.exec(prelude);
    for (const path of migrationFiles(88)) {
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
    await db.exec(
      `insert into auth.users (id, email) values ('${USER}', 'show@example.com'), ('${OTHER}', 'other@example.com')`
    );
  }, 300_000);

  afterAll(async () => {
    await db.close();
  });

  it("denies anon and authenticated and lets service_role execute housekeeping", async () => {
    const def = await db.query<{ per_channel: boolean }>(`
      select pg_get_functiondef('public.youtube_oauth_housekeeping(timestamptz)'::regprocedure)
        like '%l.channel_id = c.channel_id%' as per_channel
    `);
    expect(def.rows[0]?.per_channel).toBe(true);

    for (const role of ["anon", "authenticated"]) {
      expect(await attempt(role, `select public.youtube_oauth_housekeeping(now())`)).toMatch(/permission denied/i);
    }
    expect(await attempt("service_role", `select public.youtube_oauth_housekeeping(now())`)).toBe("allowed");
  });

  it("clears the retired channel after a switch and keeps the connected channel", async () => {
    const oldJudgment = { match_result: "matched", confidence: 0.91, start: 40, end: 50, reason: "Old kept." };
    const newJudgment = { match_result: "matched", confidence: 0.82, start: 11, end: 21, reason: "New kept." };
    const libJudgment = { match_result: "matched", confidence: 0.77, start: 15, end: 25, reason: "Lib kept." };
    const nullJudgment = { match_result: "not_matched", confidence: 0.2, start: 1, end: 2, reason: "Null kept." };
    const agedJudgment = { match_result: "matched", confidence: 0.55, start: 3, end: 8, reason: "Aged kept." };

    await db.exec(`
      insert into public.profiles (id, email, role) values ('${USER}', 'show@example.com', 'show');
      insert into public.shows (id, name, platform, youtube_channel_id) values
        ('${SHOW_OLD}', 'Old channel', 'youtube', '  UCold  '),
        ('${SHOW_NEW}', 'New channel', 'youtube', null),
        ('${SHOW_LIB}', 'Library channel', 'youtube', ''),
        ('${SHOW_NULL}', 'No channel', 'youtube', null);
      insert into public.show_profiles (id, user_id) values ('${PROFILE}', '${USER}');
      insert into public.youtube_channels (channel_id, source, show_id) values
        ('UClib', 'seed', '${SHOW_OLD}'),
        ('UCnew', 'seed', '${SHOW_NEW}'),
        ('UCold', 'seed', '${SHOW_LIB}');
      insert into public.deals (
        id, show_id, brand_id, show_profile_id, status, num_episodes, placement, ad_format,
        price_type, cpm_rate, guaranteed_downloads, net_per_episode, total_net, flight_start, flight_end
      ) values
        ('${DEAL_OLD}', '${SHOW_OLD}', '${USER}', '${PROFILE}', 'signed', 1, 'mid-roll', 'host_read', 'flat_rate', 25, 1000, 100, 100, '2026-11-01', '2026-11-30'),
        ('${DEAL_NEW}', '${SHOW_NEW}', '${USER}', '${PROFILE}', 'signed', 1, 'mid-roll', 'host_read', 'flat_rate', 25, 1000, 100, 100, '2026-11-01', '2026-11-30'),
        ('${DEAL_LIB}', '${SHOW_LIB}', '${USER}', '${PROFILE}', 'signed', 1, 'mid-roll', 'host_read', 'flat_rate', 25, 1000, 100, 100, '2026-11-01', '2026-11-30'),
        ('${DEAL_NULL}', '${SHOW_NULL}', '${USER}', '${PROFILE}', 'signed', 1, 'mid-roll', 'host_read', 'flat_rate', 25, 1000, 100, 100, '2026-11-01', '2026-11-30');
      insert into public.insertion_orders (
        id, io_number, deal_id, advertiser_name, publisher_name, publisher_contact_name,
        publisher_contact_email, total_downloads, total_gross, total_net
      ) values
        ('${IO_OLD}', 'IO-089-1', '${DEAL_OLD}', 'Brand', 'Show', 'Host', 'show@example.com', 1000, 100, 100),
        ('${IO_NEW}', 'IO-089-2', '${DEAL_NEW}', 'Brand', 'Show', 'Host', 'show@example.com', 1000, 100, 100),
        ('${IO_LIB}', 'IO-089-3', '${DEAL_LIB}', 'Brand', 'Show', 'Host', 'show@example.com', 1000, 100, 100),
        ('${IO_NULL}', 'IO-089-4', '${DEAL_NULL}', 'Brand', 'Show', 'Host', 'show@example.com', 1000, 100, 100);
      insert into public.io_line_items (
        id, io_id, format, post_date, guaranteed_downloads, show_name, placement, gross_rate, gross_cpm, price_type, net_due
      ) values
        ('${LINE_OLD}', '${IO_OLD}', 'youtube', '2026-10-01', 1000, 'Old channel', 'mid-roll', 100, 25, 'flat_rate', 100),
        ('${LINE_NEW}', '${IO_NEW}', 'youtube', '2026-10-01', 1000, 'New channel', 'mid-roll', 100, 25, 'flat_rate', 100),
        ('${LINE_LIB}', '${IO_LIB}', 'youtube', '2026-10-01', 1000, 'Library channel', 'mid-roll', 100, 25, 'flat_rate', 100),
        ('${LINE_NULL}', '${IO_NULL}', 'youtube', '2026-10-01', 1000, 'No channel', 'mid-roll', 100, 25, 'flat_rate', 100),
        ('${LINE_AGED}', '${IO_NEW}', 'youtube', '2026-09-01', 1000, 'New channel', 'mid-roll', 100, 25, 'flat_rate', 100);
      insert into public.airchecks (
        io_line_item_id, provider, status, transcript_text, transcript_segments, match_result, confidence,
        ad_start_seconds, ad_end_seconds, match_reasons, match_evidence, created_at, updated_at
      ) values
        (
          '${LINE_OLD}', 'youtube-captions', 'transcribed', 'old caption', '[]'::jsonb, 'matched', 0.91,
          40, 50, '["Old kept."]'::jsonb, '{"excerpt":"old caption","brand":"found"}'::jsonb,
          now() - interval '2 days', now()
        ),
        (
          '${LINE_NEW}', 'youtube-captions', 'transcribed', 'new caption', '[]'::jsonb, 'matched', 0.82,
          11, 21, '["New kept."]'::jsonb, '{"excerpt":"new caption","brand":"found"}'::jsonb,
          now() - interval '2 days', now()
        ),
        (
          '${LINE_LIB}', 'youtube-captions', 'transcribed', 'lib caption', '[]'::jsonb, 'matched', 0.77,
          15, 25, '["Lib kept."]'::jsonb, '{"excerpt":"lib caption","brand":"found"}'::jsonb,
          now() - interval '2 days', now()
        ),
        (
          '${LINE_NULL}', 'youtube-captions', 'transcribed', 'null caption', '[]'::jsonb, 'not_matched', 0.2,
          1, 2, '["Null kept."]'::jsonb, '{"excerpt":"null caption","brand":"found"}'::jsonb,
          now() - interval '2 days', now()
        ),
        (
          '${LINE_AGED}', 'youtube-captions', 'transcribed', 'aged caption', '[]'::jsonb, 'matched', 0.55,
          3, 8, '["Aged kept."]'::jsonb, '{"excerpt":"aged caption","brand":"found"}'::jsonb,
          now() - interval '31 days', now() - interval '1 day'
        );
      insert into public.youtube_oauth_connections (
        id, user_id, show_profile_id, channel_id, channel_title, scopes, status, revoked_at
      ) values (
        '${CONN_REVOKED}', '${USER}', '${PROFILE}', 'UCold', 'Old', array['${SCOPE}'],
        'revoked', now() - interval '8 days'
      );
      insert into public.youtube_oauth_connections (
        id, user_id, show_profile_id, channel_id, channel_title, scopes, refresh_token_enc, status
      ) values (
        '${CONN_ACTIVE}', '${USER}', '${PROFILE}', 'UCnew', 'New', array['${SCOPE}'],
        'v1.live', 'active'
      );
      insert into public.youtube_aircheck_metrics (io_line_item_id, connection_id, video_id, views, attempts)
      values
        ('${LINE_OLD}', '${CONN_REVOKED}', 'abcdefghijk', 4, 1),
        ('${LINE_NEW}', '${CONN_ACTIVE}', 'bbcdefghijk', 9, 1);
    `);

    expect(await attempt("service_role", `select public.youtube_oauth_housekeeping(now())`)).toBe("allowed");

    let rows = await captions();
    expectCleared(rows.get(LINE_OLD), oldJudgment);
    expectKept(rows.get(LINE_NEW), "new caption", newJudgment);
    expectCleared(rows.get(LINE_LIB), libJudgment);
    expectKept(rows.get(LINE_NULL), "null caption", nullJudgment);
    expectCleared(rows.get(LINE_AGED), agedJudgment);

    const revokedGone = await db.query<{ count: string }>(
      `select count(*)::text as count from public.youtube_oauth_connections where id = '${CONN_REVOKED}'`
    );
    expect(revokedGone.rows[0]?.count).toBe("0");
    const revokedMetrics = await db.query<{ count: string }>(
      `select count(*)::text as count from public.youtube_aircheck_metrics where connection_id = '${CONN_REVOKED}'`
    );
    expect(revokedMetrics.rows[0]?.count).toBe("0");
    const activeLeft = await db.query<{ status: string; metrics: string }>(`
      select c.status, count(m.io_line_item_id)::text as metrics
        from public.youtube_oauth_connections c
        left join public.youtube_aircheck_metrics m on m.connection_id = c.id
       where c.id = '${CONN_ACTIVE}'
       group by c.status
    `);
    expect(activeLeft.rows[0]?.status).toBe("active");
    expect(activeLeft.rows[0]?.metrics).toBe("1");

    await db.exec(`
      update public.airchecks
         set transcript_text = case io_line_item_id
               when '${LINE_OLD}' then 'old caption'
               when '${LINE_LIB}' then 'lib caption'
             end,
             transcript_segments = '[]'::jsonb,
             match_evidence = case io_line_item_id
               when '${LINE_OLD}' then '{"excerpt":"old caption","brand":"found"}'::jsonb
               when '${LINE_LIB}' then '{"excerpt":"lib caption","brand":"found"}'::jsonb
             end
       where io_line_item_id in ('${LINE_OLD}', '${LINE_LIB}');
      insert into public.youtube_oauth_connections (
        id, user_id, show_profile_id, channel_id, channel_title, scopes, status, reauth_required_at
      ) values (
        '${CONN_REAUTH}', '${OTHER}', '${PROFILE}', 'UCold', 'Lapsed', array['${SCOPE}'],
        'reauth_required', now() - interval '31 days'
      );
      insert into public.youtube_aircheck_metrics (io_line_item_id, connection_id, video_id, views, attempts)
      values ('${LINE_OLD}', '${CONN_REAUTH}', 'abcdefghijk', 4, 1);
    `);

    expect(await attempt("service_role", `select public.youtube_oauth_housekeeping(now())`)).toBe("allowed");

    rows = await captions();
    expectCleared(rows.get(LINE_OLD), oldJudgment);
    expectKept(rows.get(LINE_NEW), "new caption", newJudgment);
    expectCleared(rows.get(LINE_LIB), libJudgment);
    expectKept(rows.get(LINE_NULL), "null caption", nullJudgment);
    expectCleared(rows.get(LINE_AGED), agedJudgment);

    const reauthGone = await db.query<{ count: string }>(
      `select count(*)::text as count from public.youtube_oauth_connections where id = '${CONN_REAUTH}'`
    );
    expect(reauthGone.rows[0]?.count).toBe("0");
    const reauthMetrics = await db.query<{ count: string }>(
      `select count(*)::text as count from public.youtube_aircheck_metrics where connection_id = '${CONN_REAUTH}'`
    );
    expect(reauthMetrics.rows[0]?.count).toBe("0");

    await db.exec(`
      update public.airchecks
         set transcript_text = case io_line_item_id
               when '${LINE_OLD}' then 'old caption'
               when '${LINE_LIB}' then 'lib caption'
             end,
             transcript_segments = '[]'::jsonb,
             match_evidence = case io_line_item_id
               when '${LINE_OLD}' then '{"excerpt":"old caption","brand":"found"}'::jsonb
               when '${LINE_LIB}' then '{"excerpt":"lib caption","brand":"found"}'::jsonb
             end
       where io_line_item_id in ('${LINE_OLD}', '${LINE_LIB}');
      update public.youtube_oauth_connections
         set status = 'revoked',
             refresh_token_enc = null,
             access_token_enc = null,
             revoked_at = now()
       where id = '${CONN_ACTIVE}';
      insert into public.youtube_oauth_connections (
        id, user_id, show_profile_id, channel_id, channel_title, scopes, refresh_token_enc, status
      ) values (
        '${CONN_BACK}', '${USER}', '${PROFILE}', 'UCold', 'Back', array['${SCOPE}'],
        'v1.back', 'active'
      );
      insert into public.youtube_oauth_connections (
        id, user_id, show_profile_id, channel_id, channel_title, scopes, status, revoked_at
      ) values (
        '${CONN_REVOKED_AGAIN}', '${OTHER}', '${PROFILE}', 'UCold', 'Gone', array['${SCOPE}'],
        'revoked', now() - interval '8 days'
      );
      insert into public.youtube_aircheck_metrics (io_line_item_id, connection_id, video_id, views, attempts)
      values ('${LINE_LIB}', '${CONN_REVOKED_AGAIN}', 'ccccccccccc', 2, 1);
    `);

    expect(await attempt("service_role", `select public.youtube_oauth_housekeeping(now())`)).toBe("allowed");

    rows = await captions();
    expectKept(rows.get(LINE_OLD), "old caption", oldJudgment);
    expectKept(rows.get(LINE_NEW), "new caption", newJudgment);
    expectKept(rows.get(LINE_LIB), "lib caption", libJudgment);
    expectKept(rows.get(LINE_NULL), "null caption", nullJudgment);
    expectCleared(rows.get(LINE_AGED), agedJudgment);

    const blockedGone = await db.query<{ count: string }>(
      `select count(*)::text as count from public.youtube_oauth_connections where id = '${CONN_REVOKED_AGAIN}'`
    );
    expect(blockedGone.rows[0]?.count).toBe("0");
    const blockedMetrics = await db.query<{ count: string }>(
      `select count(*)::text as count from public.youtube_aircheck_metrics where connection_id = '${CONN_REVOKED_AGAIN}'`
    );
    expect(blockedMetrics.rows[0]?.count).toBe("0");
    const back = await db.query<{ status: string }>(
      `select status from public.youtube_oauth_connections where id = '${CONN_BACK}'`
    );
    expect(back.rows[0]?.status).toBe("active");
    const recentRevoke = await db.query<{ status: string }>(
      `select status from public.youtube_oauth_connections where id = '${CONN_ACTIVE}'`
    );
    expect(recentRevoke.rows[0]?.status).toBe("revoked");
  });
});
