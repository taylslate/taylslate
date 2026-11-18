// Migration 095. Runs in PGlite. Never uses a hosted database.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const previous = readFileSync(join(__dirname, "074_youtube_channels.sql"), "utf8");
const sql = readFileSync(join(__dirname, "095_youtube_made_for_kids.sql"), "utf8");

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

describe("migration 095 youtube made for kids", () => {
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

  it("documents that it is not applied and does not change privileges", () => {
    expect(sql).toContain("NOT applied. Apply on ldtmhafewfifdizgfrnn only after merge");
    expect(sql).toContain("Chris's own-words OK");
    expect(sql).toContain("094 is reserved for RELAY1");
    expect(sql).not.toMatch(/\bgrant\b/i);
    expect(sql).not.toMatch(/\bcreate policy\b/i);
    expect(sql).not.toMatch(/\benable row level security\b/i);
    expect(sql).not.toMatch(/service_role key|eyJ/i);
  });

  it("adds a nullable boolean and a partial index, and leaves grants on service_role", async () => {
    const column = await db.query<{ data_type: string; is_nullable: string }>(`
      select data_type, is_nullable
        from information_schema.columns
       where table_schema = 'public'
         and table_name = 'youtube_channels'
         and column_name = 'made_for_kids'
    `);
    expect(column.rows).toEqual([{ data_type: "boolean", is_nullable: "YES" }]);

    const index = await db.query<{ indexdef: string }>(`
      select indexdef
        from pg_indexes
       where schemaname = 'public'
         and indexname = 'idx_youtube_channels_made_for_kids_true'
    `);
    expect(index.rows).toHaveLength(1);
    expect(index.rows[0].indexdef.toLowerCase()).toContain("where (made_for_kids is true)");

    const policies = await db.query(`
      select polname from pg_policy where polrelid = 'public.youtube_channels'::regclass
    `);
    expect(policies.rows).toEqual([]);

    const grants = await db.query<{ grantee: string; privilege_type: string }>(`
      select grantee, privilege_type
        from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'youtube_channels'
       order by grantee, privilege_type
    `);
    const outsiders = grants.rows.filter((row) => ["anon", "authenticated", "PUBLIC"].includes(row.grantee));
    expect(outsiders).toEqual([]);
    expect(grants.rows.filter((row) => row.grantee === "service_role")).toEqual([
      { grantee: "service_role", privilege_type: "DELETE" },
      { grantee: "service_role", privilege_type: "INSERT" },
      { grantee: "service_role", privilege_type: "SELECT" },
      { grantee: "service_role", privilege_type: "UPDATE" },
    ]);
  });

  it("stores null, true, and false", async () => {
    await db.exec(`
      insert into public.youtube_channels (channel_id, source, made_for_kids) values
        ('UCkidsnullaaaaaaaaaaaaaa', 'seed', null),
        ('UCkidstrueaaaaaaaaaaaaaa', 'seed', true),
        ('UCkidsfalseaaaaaaaaaaaaa', 'seed', false)
    `);
    const rows = await db.query<{ channel_id: string; made_for_kids: boolean | null }>(`
      select channel_id, made_for_kids
        from public.youtube_channels
       where channel_id like 'UCkids%'
       order by channel_id
    `);
    expect(rows.rows).toEqual([
      { channel_id: "UCkidsfalseaaaaaaaaaaaaa", made_for_kids: false },
      { channel_id: "UCkidsnullaaaaaaaaaaaaaa", made_for_kids: null },
      { channel_id: "UCkidstrueaaaaaaaaaaaaaa", made_for_kids: true },
    ]);
  });
});
