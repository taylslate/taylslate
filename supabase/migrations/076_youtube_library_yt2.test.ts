// Migration 076. Runs in PGlite after 074. Never uses a hosted database.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const previous = readFileSync(join(__dirname, "074_youtube_channels.sql"), "utf8");
const sql = readFileSync(join(__dirname, "076_youtube_library_yt2.sql"), "utf8");

const fixture = `
create role authenticated nologin;
create role anon nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
create table public.shows (
  id uuid primary key,
  platform text,
  youtube_channel_id text,
  surfaces jsonb
);
`;

describe("migration 076 youtube library yt2", () => {
  const db = new PGlite();

  beforeAll(async () => {
    await db.exec(fixture);
    await db.exec(previous);
    await db.exec(sql);
    await db.exec(sql);
  });

  afterAll(async () => {
    await db.close();
  });

  async function asRole<T extends Record<string, unknown>>(role: string, statement: string) {
    await db.exec(`set role ${role}`);
    try {
      return await db.query<T>(statement);
    } finally {
      await db.exec("reset role");
    }
  }

  it("documents that it is not applied", () => {
    expect(sql).toContain("NOT applied. Apply on ldtmhafewfifdizgfrnn only after merge");
    expect(sql).toContain("Chris's own-words OK");
    expect(sql).not.toMatch(/service_role key|eyJ/i);
  });

  it("enables RLS and grants the new tables to service_role only", async () => {
    for (const table of ["youtube_channel_emails", "youtube_quota_days", "youtube_quota_log"]) {
      const rls = await db.query<{ relrowsecurity: boolean }>(`
        select c.relrowsecurity
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname = '${table}'
      `);
      expect(rls.rows[0].relrowsecurity).toBe(true);
      const policies = await db.query(`
        select polname from pg_policy where polrelid = 'public.${table}'::regclass
      `);
      expect(policies.rows).toEqual([]);
      const grants = await db.query<{ grantee: string; privilege_type: string }>(`
        select grantee, privilege_type
          from information_schema.role_table_grants
         where table_schema = 'public' and table_name = '${table}'
         order by grantee, privilege_type
      `);
      expect(grants.rows.filter((row) => ["anon", "authenticated", "PUBLIC"].includes(row.grantee))).toEqual(
        []
      );
      expect(grants.rows.filter((row) => row.grantee === "service_role").map((row) => row.privilege_type).sort()).toEqual(
        ["DELETE", "INSERT", "SELECT", "UPDATE"]
      );
    }

    const indexes = await db.query<{ indexname: string }>(`
      select indexname from pg_indexes
       where schemaname = 'public' and tablename = 'youtube_pull_queue'
    `);
    const names = indexes.rows.map((row) => row.indexname);
    expect(names).toContain("youtube_pull_queue_kind_value_page_uidx");
    expect(names).not.toContain("youtube_pull_queue_kind_value_uidx");
  });

  it("stores an email once per source, pages a query, and caps the quota", async () => {
    await db.exec(`
      insert into public.youtube_channels (channel_id, source)
      values ('UCaaaaaaaaaaaaaaaaaaaaaa', 'category');
    `);
    await db.exec(`
      insert into public.youtube_channel_emails (channel_id, email, source, found_at)
      values ('UCaaaaaaaaaaaaaaaaaaaaaa', 'ads@show.com', 'channel_description', '2026-11-02T18:00:00Z');
    `);
    await db.exec(`
      insert into public.youtube_channel_emails (channel_id, email, source)
      values ('UCaaaaaaaaaaaaaaaaaaaaaa', 'ads@show.com', 'about_link');
    `);
    await expect(
      db.exec(`
        insert into public.youtube_channel_emails (channel_id, email, source)
        values ('UCaaaaaaaaaaaaaaaaaaaaaa', 'ads@show.com', 'channel_description');
      `)
    ).rejects.toThrow(/duplicate key|unique/i);
    await expect(
      db.exec(`
        insert into public.youtube_channel_emails (channel_id, email, source)
        values ('UCaaaaaaaaaaaaaaaaaaaaaa', 'ADS@show.com', 'video_description');
      `)
    ).rejects.toThrow(/youtube_channel_emails_email_check|check constraint/i);

    await db.exec(`delete from public.youtube_channels where channel_id = 'UCaaaaaaaaaaaaaaaaaaaaaa'`);
    const gone = await db.query(`select count(*)::int as n from public.youtube_channel_emails`);
    expect(gone.rows[0]).toMatchObject({ n: 0 });

    await db.exec(`
      insert into public.youtube_pull_queue (kind, value, page_token)
      values ('category_query', 'home workout', '');
    `);
    await db.exec(`
      insert into public.youtube_pull_queue (kind, value, page_token)
      values ('category_query', 'home workout', 'page:NEXT');
    `);
    await expect(
      db.exec(`
        insert into public.youtube_pull_queue (kind, value, page_token)
        values ('category_query', 'home workout', 'page:NEXT');
      `)
    ).rejects.toThrow(/duplicate key|unique/i);

    const first = await asRole<{ youtube_quota_commit: { accepted: number; total: number } }>(
      "service_role",
      `select public.youtube_quota_commit('2026-11-02', 100, 'pull', 150) as youtube_quota_commit`
    );
    const second = await asRole<{ youtube_quota_commit: { accepted: number; total: number } }>(
      "service_role",
      `select public.youtube_quota_commit('2026-11-02', 100, 'pull', 150) as youtube_quota_commit`
    );
    expect(first.rows[0].youtube_quota_commit).toMatchObject({ accepted: 100, total: 100 });
    expect(second.rows[0].youtube_quota_commit).toMatchObject({ accepted: 50, total: 150 });
    const logged = await db.query<{ units: number }>(
      `select units from public.youtube_quota_log where pacific_day = '2026-11-02' order by created_at`
    );
    expect(logged.rows.map((row) => row.units)).toEqual([100, 50]);

    await expect(asRole("anon", "select * from public.youtube_channel_emails")).rejects.toThrow(
      /permission denied/i
    );
    await expect(
      asRole("authenticated", "select * from public.youtube_quota_days")
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asRole(
        "anon",
        `select public.youtube_quota_commit('2026-11-03', 1, 'pull', 10)`
      )
    ).rejects.toThrow(/permission denied/i);
  });
});
