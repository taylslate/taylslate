// Migration 081. Runs in PGlite on a 075 fixture. Never uses a hosted database.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const disputes = readFileSync(join(__dirname, "075_roster_link_disputes.sql"), "utf8");
const sql = readFileSync(join(__dirname, "081_roster_dispute_block.sql"), "utf8");

const LINK_OPEN = "11111111-1111-4111-8111-111111111111";
const LINK_CLEAR = "22222222-2222-4222-8222-222222222222";
const LINK_RESOLVED = "33333333-3333-4333-8333-333333333333";
const LINK_REJECT = "44444444-4444-4444-8444-444444444444";
const LINK_OTHER = "55555555-5555-4555-8555-555555555555";
const LINK_NOTICE = "66666666-6666-4666-8666-666666666666";
const OWNER = "77777777-7777-4777-8777-777777777777";
const ADMIN = "88888888-8888-4888-8888-888888888888";
const PROOF = "99999999-9999-4999-8999-999999999999";
const PROOF_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const fixture = `
create role authenticated nologin;
create role anon nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
create table public.profiles (
  id uuid primary key
);
create table public.agent_show_relationships (
  id uuid primary key,
  status text not null default 'pending',
  source text,
  created_at timestamptz not null default now()
);
create table public.show_ownership_proofs (
  id uuid primary key,
  show_id uuid not null,
  user_id uuid not null,
  status text not null default 'pending'
);
insert into public.profiles (id) values ('${OWNER}'), ('${ADMIN}');
insert into public.agent_show_relationships (id, status) values
  ('${LINK_OPEN}', 'pending'),
  ('${LINK_CLEAR}', 'pending'),
  ('${LINK_RESOLVED}', 'pending'),
  ('${LINK_REJECT}', 'pending'),
  ('${LINK_OTHER}', 'pending'),
  ('${LINK_NOTICE}', 'pending');
insert into public.show_ownership_proofs (id, show_id, user_id, status) values
  ('${PROOF}', '${LINK_NOTICE}', '${OWNER}', 'verified'),
  ('${PROOF_B}', '${LINK_CLEAR}', '${OWNER}', 'verified');
grant select, update on public.agent_show_relationships to service_role;
grant select, insert on public.show_ownership_proofs to service_role;
`;

describe("migration 081 roster dispute block", () => {
  const db = new PGlite();

  beforeAll(async () => {
    await db.exec(fixture);
    await db.exec(disputes);
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

  it("documents that it is not applied and names its dependencies", () => {
    expect(sql).toContain("NOT applied. Apply on ldtmhafewfifdizgfrnn only after merge");
    expect(sql).toContain("Chris's OK naming 081");
    expect(sql).toContain("075");
    expect(sql).toContain("055");
    expect(sql).toContain("061");
    expect(sql).toContain("067");
    expect(sql).not.toMatch(/service_role key|eyJ/i);
  });

  it("is a no-op when run again", async () => {
    await db.exec(sql);
    const triggers = await db.query<{ count: string }>(`
      select count(*)::text as count
        from pg_trigger
       where tgname = 'roster_link_block_approve_on_dispute'
         and not tgisinternal
    `);
    expect(triggers.rows[0].count).toBe("1");
    const checks = await db.query<{ conname: string }>(`
      select conname
        from pg_constraint
       where conname in (
         'roster_link_disputes_resolution_note_check',
         'roster_link_disputes_resolved_state_check',
         'roster_owner_verified_notices_link_proof_key'
       )
    `);
    expect(checks.rows).toHaveLength(3);
  });

  it("enables RLS with no policies and grants service_role only on notices", async () => {
    const rls = await db.query<{ relrowsecurity: boolean }>(`
      select c.relrowsecurity
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = 'roster_owner_verified_notices'
    `);
    expect(rls.rows[0].relrowsecurity).toBe(true);

    const policies = await db.query(`
      select polname from pg_policy
       where polrelid = 'public.roster_owner_verified_notices'::regclass
    `);
    expect(policies.rows).toEqual([]);

    const grants = await db.query<{ grantee: string; privilege_type: string }>(`
      select grantee, privilege_type
        from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'roster_owner_verified_notices'
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

    const execute = await db.query<{ anon: boolean; authenticated: boolean; service_role: boolean }>(`
      select has_function_privilege('anon', 'public.roster_link_block_approve_on_dispute()', 'execute') as anon,
             has_function_privilege('authenticated', 'public.roster_link_block_approve_on_dispute()', 'execute') as authenticated,
             has_function_privilege('service_role', 'public.roster_link_block_approve_on_dispute()', 'execute') as service_role
    `);
    expect(execute.rows[0]).toEqual({ anon: false, authenticated: false, service_role: true });
  });

  it("refuses anon and authenticated access to notices", async () => {
    for (const role of ["anon", "authenticated"]) {
      await expect(
        asRole(role, "select * from public.roster_owner_verified_notices")
      ).rejects.toThrow(/permission denied/i);
      await expect(
        asRole(
          role,
          `insert into public.roster_owner_verified_notices (link_id, proof_id, rep_user_id, trigger)
           values ('${LINK_NOTICE}', '${PROOF}', '${OWNER}', 'import')`
        )
      ).rejects.toThrow(/permission denied/i);
    }
  });

  it("blocks approve only while a dispute is open", async () => {
    await asRole(
      "service_role",
      `update public.agent_show_relationships set status = 'approved' where id = '${LINK_CLEAR}'`
    );
    const cleared = await db.query<{ status: string }>(
      `select status from public.agent_show_relationships where id = '${LINK_CLEAR}'`
    );
    expect(cleared.rows[0].status).toBe("approved");

    await asRole(
      "service_role",
      `insert into public.roster_link_disputes (link_id, show_id, owner_user_id, status)
       values ('${LINK_OPEN}', '${LINK_OPEN}', '${OWNER}', 'open')`
    );
    await expect(
      asRole(
        "service_role",
        `update public.agent_show_relationships set status = 'approved' where id = '${LINK_OPEN}'`
      )
    ).rejects.toThrow(/open dispute/i);
    const blocked = await db.query<{ status: string }>(
      `select status from public.agent_show_relationships where id = '${LINK_OPEN}'`
    );
    expect(blocked.rows[0].status).toBe("pending");

    await asRole(
      "service_role",
      `insert into public.roster_link_disputes (link_id, show_id, owner_user_id, status)
       values ('${LINK_REJECT}', '${LINK_REJECT}', '${OWNER}', 'open')`
    );
    await asRole(
      "service_role",
      `update public.agent_show_relationships set status = 'rejected' where id = '${LINK_REJECT}'`
    );
    const rejected = await db.query<{ status: string }>(
      `select status from public.agent_show_relationships where id = '${LINK_REJECT}'`
    );
    expect(rejected.rows[0].status).toBe("rejected");

    await asRole(
      "service_role",
      `insert into public.roster_link_disputes (link_id, show_id, owner_user_id, status)
       values ('${LINK_OTHER}', '${LINK_OTHER}', '${OWNER}', 'open')`
    );
    await asRole(
      "service_role",
      `update public.agent_show_relationships set source = 'import' where id = '${LINK_OTHER}'`
    );
    const other = await db.query<{ status: string; source: string }>(
      `select status, source from public.agent_show_relationships where id = '${LINK_OTHER}'`
    );
    expect(other.rows[0]).toEqual({ status: "pending", source: "import" });

    await asRole(
      "service_role",
      `insert into public.roster_link_disputes (link_id, show_id, owner_user_id, status, resolved_at, resolved_by)
       values ('${LINK_RESOLVED}', '${LINK_RESOLVED}', '${OWNER}', 'resolved', now(), '${ADMIN}')`
    );
    await asRole(
      "service_role",
      `update public.agent_show_relationships set status = 'approved' where id = '${LINK_RESOLVED}'`
    );
    const resolved = await db.query<{ status: string }>(
      `select status from public.agent_show_relationships where id = '${LINK_RESOLVED}'`
    );
    expect(resolved.rows[0].status).toBe("approved");
  });

  it("checks the resolution note, the resolved state, and the notice unique key", async () => {
    await expect(
      asRole(
        "service_role",
        `update public.roster_link_disputes
            set resolution_note = '${"n".repeat(501)}'
          where link_id = '${LINK_OPEN}'`
      )
    ).rejects.toThrow(/resolution_note_check|check constraint/i);

    await expect(
      asRole(
        "service_role",
        `update public.roster_link_disputes
            set resolution_note = ''
          where link_id = '${LINK_OPEN}'`
      )
    ).rejects.toThrow(/resolution_note_check|check constraint/i);

    await expect(
      asRole(
        "service_role",
        `update public.roster_link_disputes
            set status = 'resolved'
          where link_id = '${LINK_OPEN}'`
      )
    ).rejects.toThrow(/resolved_state_check|check constraint/i);

    const noted = await asRole<{ resolution_note: string }>(
      "service_role",
      `update public.roster_link_disputes
          set resolution_note = '${"n".repeat(500)}'
        where link_id = '${LINK_OPEN}'
        returning resolution_note`
    );
    expect(noted.rows[0].resolution_note).toHaveLength(500);

    await asRole(
      "service_role",
      `insert into public.roster_owner_verified_notices (link_id, proof_id, rep_user_id, trigger)
       values ('${LINK_NOTICE}', '${PROOF}', '${OWNER}', 'import')`
    );
    await expect(
      asRole(
        "service_role",
        `insert into public.roster_owner_verified_notices (link_id, proof_id, rep_user_id, trigger)
         values ('${LINK_NOTICE}', '${PROOF}', '${ADMIN}', 'verified_later')`
      )
    ).rejects.toThrow(/roster_owner_verified_notices_link_proof_key|duplicate key|unique/i);

    await db.exec(`delete from public.agent_show_relationships where id = '${LINK_NOTICE}'`);
    const gone = await db.query<{ count: string }>(`
      select count(*)::text as count
        from public.roster_owner_verified_notices
       where link_id = '${LINK_NOTICE}'
    `);
    expect(gone.rows[0].count).toBe("0");
  });
});
