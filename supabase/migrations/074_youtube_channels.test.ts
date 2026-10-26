// Migration 074. Runs in PGlite. Never uses a hosted database.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const sql = readFileSync(join(__dirname, "074_youtube_channels.sql"), "utf8");

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

describe("migration 074 youtube channels", () => {
  const db = new PGlite();

  beforeAll(async () => {
    await db.exec(fixture);
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

  it("enables RLS with no policies and grants both tables to service_role only", async () => {
    for (const table of ["youtube_channels", "youtube_pull_queue"]) {
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
      const outsiders = grants.rows.filter((row) =>
        ["anon", "authenticated", "PUBLIC"].includes(row.grantee)
      );
      expect(outsiders).toEqual([]);
      expect(grants.rows.filter((row) => row.grantee === "service_role")).toEqual([
        { grantee: "service_role", privilege_type: "DELETE" },
        { grantee: "service_role", privilege_type: "INSERT" },
        { grantee: "service_role", privilege_type: "SELECT" },
        { grantee: "service_role", privilege_type: "UPDATE" },
      ]);
    }

    const indexes = await db.query<{ indexname: string }>(`
      select indexname from pg_indexes
       where schemaname = 'public'
         and tablename in ('youtube_channels', 'youtube_pull_queue')
    `);
    const names = indexes.rows.map((row) => row.indexname);
    expect(names).toContain("idx_youtube_channels_stats_refreshed_at");
    expect(names).toContain("idx_youtube_channels_show_id");
    expect(names).toContain("idx_youtube_channels_niche_tags");
    expect(names).toContain("idx_youtube_pull_queue_status");
    expect(names).toContain("youtube_pull_queue_kind_value_uidx");
  });

  it("refuses anon and authenticated read and write", async () => {
    for (const role of ["anon", "authenticated"]) {
      await expect(asRole(role, "select * from public.youtube_channels")).rejects.toThrow(
        /permission denied/i
      );
      await expect(
        asRole(role, "insert into public.youtube_channels (channel_id, source) values ('UCx', 'seed')")
      ).rejects.toThrow(/permission denied/i);
      await expect(
        asRole(role, "update public.youtube_channels set title = 'x'")
      ).rejects.toThrow(/permission denied/i);
      await expect(asRole(role, "delete from public.youtube_channels")).rejects.toThrow(
        /permission denied/i
      );
      await expect(asRole(role, "select * from public.youtube_pull_queue")).rejects.toThrow(
        /permission denied/i
      );
      await expect(
        asRole(
          role,
          "insert into public.youtube_pull_queue (kind, value) values ('category_query', 'health')"
        )
      ).rejects.toThrow(/permission denied/i);
    }
  });

  it("lets service_role write, keeps a unique queue, and nulls show_id when the show is deleted", async () => {
    const showId = "11111111-1111-4111-8111-111111111111";
    await db.exec(`insert into public.shows (id, platform) values ('${showId}', 'podcast')`);

    const inserted = await asRole(
      "service_role",
      `insert into public.youtube_channels (channel_id, source, show_id, niche_tags)
       values ('UCaaaaaaaaaaaaaaaaaaaaaa', 'category', '${showId}', '{fitness}')
       returning channel_id, show_id`
    );
    expect(inserted.rows[0]).toMatchObject({
      channel_id: "UCaaaaaaaaaaaaaaaaaaaaaa",
      show_id: showId,
    });

    await db.exec(`delete from public.shows where id = '${showId}'`);
    const after = await db.query<{ show_id: string | null }>(
      `select show_id from public.youtube_channels where channel_id = 'UCaaaaaaaaaaaaaaaaaaaaaa'`
    );
    expect(after.rows[0].show_id).toBeNull();

    await db.exec(`
      insert into public.youtube_pull_queue (kind, value) values ('category_query', 'health tips');
    `);
    await expect(
      db.exec(`
        insert into public.youtube_pull_queue (kind, value) values ('category_query', 'health tips');
      `)
    ).rejects.toThrow(/duplicate key|unique/i);

    await expect(
      db.exec(`insert into public.youtube_channels (channel_id, source) values ('UCbad', 'nope')`)
    ).rejects.toThrow(/youtube_channels_source_check|check constraint/i);
  });
});
