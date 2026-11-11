// Migration 080. Runs in PGlite. Never uses a hosted database.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const sql = readFileSync(join(__dirname, "080_airchecks_confirm_claim.sql"), "utf8");

const LINE = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const OTHER = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";

const fixture = `
create role authenticated nologin;
create role anon nologin;
create role service_role nologin bypassrls;

create table public.airchecks (
  id uuid primary key default gen_random_uuid(),
  io_line_item_id uuid not null unique,
  status text not null default 'transcribed',
  review_decision text
);
`;

const claimSql = (lineId: string, who: string) => `
update public.airchecks
set confirm_claimed_at = clock_timestamp(),
    confirm_claimed_by = '${who}'
where io_line_item_id = '${lineId}'
  and review_decision is null
  and (
    confirm_claimed_at is null
    or confirm_claimed_at < clock_timestamp() - interval '5 minutes'
  )
returning id::text
`;

describe("migration 080", () => {
  const db = new PGlite();

  beforeAll(async () => {
    await db.exec(fixture);
    await db.exec(sql);
    await db.exec(sql);
  });

  afterAll(async () => {
    await db.close();
  });

  it("is written and not applied, and names only public.airchecks", () => {
    expect(sql).toMatch(/NOT applied/);
    expect(sql).toMatch(/Chris names 080/);
    expect(sql).toMatch(/only after 079 \(and 040\) are live/);
    expect(sql).toMatch(/enable row level security/i);
    expect(sql).toMatch(
      /grant select, insert, update, delete on table public\.airchecks to service_role/i
    );
    expect(sql).toMatch(/revoke all on table public\.airchecks from anon/i);
    expect(sql).toMatch(/revoke all on table public\.airchecks from authenticated/i);
    expect(sql).toMatch(/revoke all on table public\.airchecks from public/i);
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).not.toMatch(/grant select, insert, update, delete on table public\.airchecks to authenticated/i);
    expect(sql).not.toMatch(/to anon/i);
    expect(sql).not.toContain("\u2014");

    const stripped = sql.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    const refs = [...stripped.matchAll(/public\.([a-z_][a-z0-9_]*)/g)].map((match) => match[1]);
    expect(refs.length).toBeGreaterThan(0);
    expect(new Set(refs)).toEqual(new Set(["airchecks"]));
  });

  it("adds the claim columns once, with service_role grants and no anon or authenticated privileges", async () => {
    const columns = await db.query<{ column_name: string }>(`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'airchecks'
        and column_name in ('confirm_claimed_at', 'confirm_claimed_by')
      order by column_name
    `);
    expect(columns.rows.map((row) => row.column_name)).toEqual([
      "confirm_claimed_at",
      "confirm_claimed_by",
    ]);

    const counted = await db.query<{ n: number }>(`
      select count(*)::int as n from information_schema.columns
      where table_schema = 'public' and table_name = 'airchecks'
        and column_name = 'confirm_claimed_at'
    `);
    expect(counted.rows[0].n).toBe(1);

    const rls = await db.query<{ rls: boolean }>(`
      select c.relrowsecurity as rls
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'airchecks'
    `);
    expect(rls.rows[0].rls).toBe(true);

    const policies = await db.query<{ n: number }>(`
      select count(*)::int as n from pg_policy
      where polrelid = 'public.airchecks'::regclass
    `);
    expect(policies.rows[0].n).toBe(0);

    const grants = await db.query<{ grantee: string; privilege_type: string }>(`
      select grantee, privilege_type
      from information_schema.role_table_grants
      where table_schema = 'public' and table_name = 'airchecks'
        and grantee in ('anon', 'authenticated', 'PUBLIC', 'public', 'service_role')
      order by grantee, privilege_type
    `);
    expect(grants.rows.map((row) => row.grantee)).not.toContain("anon");
    expect(grants.rows.map((row) => row.grantee)).not.toContain("authenticated");
    expect(grants.rows.map((row) => row.grantee)).not.toContain("PUBLIC");
    const service = grants.rows
      .filter((row) => row.grantee === "service_role")
      .map((row) => row.privilege_type)
      .sort();
    expect(service).toEqual(["DELETE", "INSERT", "SELECT", "UPDATE"]);
  });

  it("lets only one of two competing claims win, and a stale claim can be taken", async () => {
    await db.exec(`
      insert into public.airchecks (io_line_item_id, review_decision)
      values ('${LINE}', null), ('${OTHER}', 'rejected');
    `);

    const first = await db.query<{ id: string }>(claimSql(LINE, "first@taylslate.com"));
    const second = await db.query<{ id: string }>(claimSql(LINE, "second@taylslate.com"));
    expect(first.rows).toHaveLength(1);
    expect(second.rows).toHaveLength(0);

    const held = await db.query<{ confirm_claimed_by: string }>(`
      select confirm_claimed_by from public.airchecks where io_line_item_id = '${LINE}'
    `);
    expect(held.rows[0].confirm_claimed_by).toBe("first@taylslate.com");

    const decided = await db.query<{ id: string }>(claimSql(OTHER, "ops@taylslate.com"));
    expect(decided.rows).toHaveLength(0);

    await db.exec(`
      update public.airchecks
      set confirm_claimed_at = clock_timestamp() - interval '6 minutes',
          confirm_claimed_by = 'old@taylslate.com'
      where io_line_item_id = '${LINE}'
    `);
    const stale = await db.query<{ id: string }>(claimSql(LINE, "ops@taylslate.com"));
    expect(stale.rows).toHaveLength(1);
    const taken = await db.query<{ confirm_claimed_by: string }>(`
      select confirm_claimed_by from public.airchecks where io_line_item_id = '${LINE}'
    `);
    expect(taken.rows[0].confirm_claimed_by).toBe("ops@taylslate.com");
  });
});
