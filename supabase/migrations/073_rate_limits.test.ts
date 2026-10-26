// Migration 073. Runs in PGlite. Never uses a hosted database.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const sql = readFileSync(join(__dirname, "073_rate_limits.sql"), "utf8");

const fixture = `
create role authenticated nologin;
create role anon nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
`;

describe("migration 073 rate limits", () => {
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

  async function hit(bucket: string, key: string, max: number, windowSeconds: number) {
    const result = await db.query<{ allowed: boolean }>(
      `select public.rate_limit_hit($1, $2, $3, $4) as allowed`,
      [bucket, key, max, windowSeconds],
    );
    return result.rows[0].allowed;
  }

  it("is security definer and documents that it is not applied", () => {
    expect(sql).toContain("NOT applied. Apply on ldtmhafewfifdizgfrnn only after merge");
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = public");
  });

  it("enables RLS and grants the table and the function to service_role only", async () => {
    const rls = await db.query<{ relrowsecurity: boolean }>(`
      select c.relrowsecurity
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = 'rate_limit_events'
    `);
    expect(rls.rows[0].relrowsecurity).toBe(true);

    const policies = await db.query(`
      select polname from pg_policy
       where polrelid = 'public.rate_limit_events'::regclass
    `);
    expect(policies.rows).toEqual([]);

    const grants = await db.query<{ grantee: string; privilege_type: string }>(`
      select grantee, privilege_type
        from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'rate_limit_events'
       order by grantee, privilege_type
    `);
    const outsiders = grants.rows.filter((row) =>
      ["anon", "authenticated", "PUBLIC"].includes(row.grantee),
    );
    expect(outsiders).toEqual([]);
    expect(grants.rows.filter((row) => row.grantee === "service_role")).toEqual([
      { grantee: "service_role", privilege_type: "DELETE" },
      { grantee: "service_role", privilege_type: "INSERT" },
      { grantee: "service_role", privilege_type: "SELECT" },
      { grantee: "service_role", privilege_type: "UPDATE" },
    ]);

    const execute = await db.query<{ grantee: string }>(`
      select grantee
        from information_schema.routine_privileges
       where routine_schema = 'public'
         and routine_name = 'rate_limit_hit'
         and privilege_type = 'EXECUTE'
       order by grantee
    `);
    expect(execute.rows.map((row) => row.grantee)).toEqual(["postgres", "service_role"]);

    const definer = await db.query<{ prosecdef: boolean; proconfig: string[] | null }>(`
      select prosecdef, proconfig
        from pg_proc
       where proname = 'rate_limit_hit'
    `);
    expect(definer.rows[0].prosecdef).toBe(true);
    expect(definer.rows[0].proconfig).toContain("search_path=public");
  });

  it("refuses anon and authenticated read, write, and execute", async () => {
    for (const role of ["anon", "authenticated"]) {
      await expect(asRole(role, "select * from public.rate_limit_events")).rejects.toThrow(
        /permission denied/i,
      );
      await expect(
        asRole(role, "insert into public.rate_limit_events (key, bucket) values ('k', 'b')"),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        asRole(role, "update public.rate_limit_events set key = 'x'"),
      ).rejects.toThrow(/permission denied/i);
      await expect(asRole(role, "delete from public.rate_limit_events")).rejects.toThrow(
        /permission denied/i,
      );
      await expect(
        asRole(role, "select public.rate_limit_hit('b', 'k', 1, 60)"),
      ).rejects.toThrow(/permission denied/i);
    }
  });

  it("lets service_role execute, trips each window, and allows a new hit after it", async () => {
    const cases = [
      ["login_code_send_email", "email-hash", 3, 15 * 60],
      ["login_code_send_ip", "203.0.113.5", 10, 60 * 60],
      ["login_code_verify_email", "verify-hash", 5, 15 * 60],
      ["outreach_send_user_hour", "user-1", 20, 60 * 60],
      ["outreach_send_user_day", "user-1", 100, 24 * 60 * 60],
      ["upload_user_hour", "user-1", 20, 60 * 60],
      ["roster_import_user_hour", "agent-1", 10, 60 * 60],
    ] as const;

    for (const [bucket, key, max, windowSeconds] of cases) {
      for (let i = 0; i < max; i++) {
        expect(await hit(bucket, key, max, windowSeconds)).toBe(true);
      }
      expect(await hit(bucket, key, max, windowSeconds)).toBe(false);
      await db.exec(
        `update public.rate_limit_events
            set created_at = now() - make_interval(secs => ${windowSeconds + 1})
          where bucket = '${bucket}' and key = '${key}'`,
      );
      expect(await hit(bucket, key, max, windowSeconds)).toBe(true);
    }

    expect(await hit("login_code_send_email", "iso-a", 1, 900)).toBe(true);
    expect(await hit("login_code_send_email", "iso-a", 1, 900)).toBe(false);
    expect(await hit("login_code_send_email", "iso-b", 1, 900)).toBe(true);
    expect(await hit("login_code_send_ip", "198.51.100.9", 1, 3600)).toBe(true);
  });

  it("prunes rows older than 2 days and still lets service_role read", async () => {
    await db.exec(`
      insert into public.rate_limit_events (key, bucket, created_at)
      values ('stale', 'login_code_send_ip', now() - interval '3 days')
    `);
    expect(await hit("login_code_send_ip", "fresh", 10, 3600)).toBe(true);
    const stale = await db.query<{ count: number }>(
      `select count(*)::int as count from public.rate_limit_events where key = 'stale'`,
    );
    expect(stale.rows[0].count).toBe(0);

    const visible = await asRole<{ key: string }>(
      "service_role",
      `select key from public.rate_limit_events where key = 'fresh'`,
    );
    expect(visible.rows.map((row) => row.key)).toEqual(["fresh"]);
  });
});
