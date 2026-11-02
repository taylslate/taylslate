// Migration 078. Runs in PGlite. Never uses a hosted database.
// A null auth email must not raise 42501 or clear profiles.email.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const sql = readFileSync(join(__dirname, "078_auth_email_null_guard.sql"), "utf8");

const USER = "11111111-1111-4111-8111-111111111111";

const fixture = `
create role authenticated nologin;
create role anon nologin;
create schema if not exists auth;
create table auth.users (
  id uuid primary key,
  email text
);
create table public.profiles (
  id uuid primary key,
  email text not null,
  full_name text,
  role text not null
);
insert into auth.users (id, email) values ('${USER}', 'owner@example.test');
insert into public.profiles (id, email, full_name, role)
values ('${USER}', 'owner@example.test', 'Owner', 'brand');
`;

describe("migration 078", () => {
  const db = new PGlite();

  beforeAll(async () => {
    await db.exec(fixture);
    await db.exec(sql);
    await db.exec(sql);
    await db.exec(`
      drop trigger if exists auth_users_sync_profile_email on auth.users;
      create trigger auth_users_sync_profile_email
        after update of email on auth.users
        for each row
        execute function private.sync_profile_email_from_auth_user();
    `);
  });

  afterAll(async () => {
    await db.close();
  });

  it("leaves the profile email in place when the auth email is cleared", async () => {
    await db.exec(`update auth.users set email = null where id = '${USER}'`);
    const row = await db.query<{ auth_email: string | null; profile_email: string }>(`
      select u.email as auth_email, p.email as profile_email
      from auth.users u
      join public.profiles p on p.id = u.id
      where u.id = '${USER}'
    `);
    expect(row.rows[0]).toEqual({
      auth_email: null,
      profile_email: "owner@example.test",
    });

    await db.exec(`update auth.users set email = '   ' where id = '${USER}'`);
    const blank = await db.query<{ profile_email: string }>(
      `select email as profile_email from public.profiles where id = '${USER}'`,
    );
    expect(blank.rows[0]?.profile_email).toBe("owner@example.test");
  });

  it("still copies a real auth email onto the profile", async () => {
    await db.exec(`update auth.users set email = 'next@example.test' where id = '${USER}'`);
    const row = await db.query<{ email: string }>(
      `select email from public.profiles where id = '${USER}'`,
    );
    expect(row.rows[0]?.email).toBe("next@example.test");
  });
});
