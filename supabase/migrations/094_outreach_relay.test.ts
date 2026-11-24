// Static assertions on migration 094. The file is not applied here.

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const sql = fs.readFileSync(path.join(__dirname, "094_outreach_relay.sql"), "utf-8");

const statements = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

const tables = [
  "relay_threads",
  "relay_messages",
  "relay_inbound_events",
  "brand_crm_shows",
] as const;

describe("migration 094 outreach relay", () => {
  it("is named for Chris and is not applied from the app", () => {
    expect(sql).toContain("NOT APPLIED LIVE, CHRIS MUST NAME IT");
    expect(sql).toContain("Do not run this from the app");
    expect(sql).toMatch(/information_schema\.role_table_grants/);
    expect(sql).toMatch(/relrowsecurity/);
    expect(sql).toMatch(/pg_policies/);
    expect(sql).not.toMatch(/\u2014/);
  });

  it("creates the four tables and the token check", () => {
    for (const table of tables) {
      expect(statements).toMatch(
        new RegExp(`create table if not exists public\\.${table}`, "i")
      );
    }
    expect(statements).toMatch(/address_token ~ '\^\[a-z2-7\]\{26\}\$'/);
    expect(statements).toMatch(/direction in \('brand_to_show', 'show_to_brand'\)/);
    expect(statements).toMatch(/source in \('outreach'\)/);
    expect(statements).toMatch(/unique \(brand_id, show_id\)/);
    expect(statements).toMatch(
      /create index if not exists idx_relay_messages_thread_id\s+on public\.relay_messages \(thread_id\);/i
    );
    expect(statements).not.toMatch(/brand_crm_shows[\s\S]{0,400}\bemail\b/i);
    const crm = statements.slice(statements.indexOf("create table if not exists public.brand_crm_shows"));
    const crmTable = crm.slice(0, crm.indexOf("alter table public.brand_crm_shows"));
    expect(crmTable).not.toMatch(/\bemail\b/i);
    expect(crmTable).not.toMatch(/\bphone\b/i);
  });

  it("grants service_role on every table and select on brand_crm_shows only", () => {
    for (const table of tables) {
      expect(statements).toMatch(
        new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated;`, "i")
      );
      expect(statements).toMatch(
        new RegExp(
          `grant select, insert, update, delete on table public\\.${table} to service_role;`,
          "i"
        )
      );
    }
    expect(statements).toMatch(/grant select on table public\.brand_crm_shows to authenticated;/i);
    expect(statements).toMatch(
      /revoke truncate, references, trigger on table public\.brand_crm_shows from authenticated;/i
    );
    expect(statements).not.toMatch(/grant\s+[a-z,\s]+\s+on\s+table\s+public\.\w+\s+to\s+anon/i);
    expect(statements).not.toMatch(
      /grant\s+[a-z,\s]+\s+on\s+table\s+public\.relay_(?:threads|messages|inbound_events)\s+to\s+authenticated/i
    );
  });

  it("enables RLS and has one authenticated select policy", () => {
    for (const table of tables) {
      expect(statements).toMatch(
        new RegExp(`alter table public\\.${table} enable row level security;`, "i")
      );
    }
    const policies = statements.match(/create policy/gi) ?? [];
    expect(policies).toHaveLength(1);
    expect(statements).toMatch(/for select\s+to authenticated\s+using \(brand_id = \(select auth\.uid\(\)\)\)/i);
    expect(statements).not.toMatch(/create policy[\s\S]*?\bto anon\b/i);
  });
});
