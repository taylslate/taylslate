// Migration 075. Runs in PGlite. Never uses a hosted database.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const sql = readFileSync(join(__dirname, "075_roster_link_disputes.sql"), "utf8");

const LINK = "11111111-1111-4111-8111-111111111111";
const LINK_B = "22222222-2222-4222-8222-222222222222";
const OWNER = "33333333-3333-4333-8333-333333333333";
const OWNER_B = "44444444-4444-4444-8444-444444444444";
const ADMIN = "55555555-5555-4555-8555-555555555555";

const fixture = `
create role authenticated nologin;
create role anon nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
create table public.profiles (
  id uuid primary key
);
create table public.agent_show_relationships (
  id uuid primary key
);
insert into public.profiles (id) values
  ('${OWNER}'),
  ('${OWNER_B}'),
  ('${ADMIN}');
insert into public.agent_show_relationships (id) values
  ('${LINK}'),
  ('${LINK_B}');
`;

describe("migration 075 roster link disputes", () => {
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
    expect(sql).toContain("Chris's OK naming 075");
    expect(sql).not.toMatch(/service_role key|eyJ/i);
  });

  it("enables RLS with no policies and grants service_role only", async () => {
    const rls = await db.query<{ relrowsecurity: boolean }>(`
      select c.relrowsecurity
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = 'roster_link_disputes'
    `);
    expect(rls.rows[0].relrowsecurity).toBe(true);

    const policies = await db.query(`
      select polname from pg_policy
       where polrelid = 'public.roster_link_disputes'::regclass
    `);
    expect(policies.rows).toEqual([]);

    const grants = await db.query<{ grantee: string; privilege_type: string }>(`
      select grantee, privilege_type
        from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'roster_link_disputes'
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

    const unique = await db.query<{ conname: string }>(`
      select conname
        from pg_constraint
       where conrelid = 'public.roster_link_disputes'::regclass
         and contype = 'u'
    `);
    expect(unique.rows.map((row) => row.conname)).toContain("roster_link_disputes_link_owner_key");
  });

  it("refuses anon and authenticated read and write", async () => {
    for (const role of ["anon", "authenticated"]) {
      await expect(asRole(role, "select * from public.roster_link_disputes")).rejects.toThrow(
        /permission denied/i
      );
      await expect(
        asRole(
          role,
          `insert into public.roster_link_disputes (link_id, show_id, owner_user_id)
           values ('${LINK}', '${LINK}', '${OWNER}')`
        )
      ).rejects.toThrow(/permission denied/i);
      await expect(
        asRole(role, "update public.roster_link_disputes set status = 'resolved'")
      ).rejects.toThrow(/permission denied/i);
      await expect(asRole(role, "delete from public.roster_link_disputes")).rejects.toThrow(
        /permission denied/i
      );
    }
  });

  it("checks the note, the unique pair, and cascade deletes", async () => {
    const inserted = await asRole(
      "service_role",
      `insert into public.roster_link_disputes (link_id, show_id, owner_user_id, note)
       values ('${LINK}', '${LINK}', '${OWNER}', '${"n".repeat(500)}')
       returning status, note`
    );
    expect(inserted.rows[0]).toMatchObject({ status: "open" });
    expect((inserted.rows[0].note as string).length).toBe(500);

    await asRole(
      "service_role",
      `insert into public.roster_link_disputes (link_id, show_id, owner_user_id, note, resolved_by)
       values ('${LINK}', '${LINK}', '${OWNER_B}', null, '${ADMIN}')`
    );

    await expect(
      asRole(
        "service_role",
        `insert into public.roster_link_disputes (link_id, show_id, owner_user_id)
         values ('${LINK}', '${LINK}', '${OWNER}')`
      )
    ).rejects.toThrow(/roster_link_disputes_link_owner_key|duplicate key|unique/i);

    await expect(
      asRole(
        "service_role",
        `insert into public.roster_link_disputes (link_id, show_id, owner_user_id, note)
         values ('${LINK_B}', '${LINK_B}', '${OWNER}', '${"x".repeat(501)}')`
      )
    ).rejects.toThrow(/roster_link_disputes_note_check|check constraint/i);

    await expect(
      asRole(
        "service_role",
        `insert into public.roster_link_disputes (link_id, show_id, owner_user_id, note)
         values ('${LINK_B}', '${LINK_B}', '${OWNER}', '')`
      )
    ).rejects.toThrow(/roster_link_disputes_note_check|check constraint/i);

    await db.exec(`delete from public.profiles where id = '${ADMIN}'`);
    const cleared = await db.query<{ resolved_by: string | null }>(`
      select resolved_by from public.roster_link_disputes where owner_user_id = '${OWNER_B}'
    `);
    expect(cleared.rows[0].resolved_by).toBeNull();

    await db.exec(`delete from public.agent_show_relationships where id = '${LINK}'`);
    const left = await db.query<{ count: string }>(`
      select count(*)::text as count from public.roster_link_disputes where link_id = '${LINK}'
    `);
    expect(left.rows[0].count).toBe("0");

    await db.exec(`delete from public.profiles where id = '${OWNER_B}'`);
    const ownerGone = await db.query<{ count: string }>(`
      select count(*)::text as count from public.roster_link_disputes where owner_user_id = '${OWNER_B}'
    `);
    expect(ownerGone.rows[0].count).toBe("0");
  });
});
