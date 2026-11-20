import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(join(__dirname, "093_podscan_import.sql"), "utf8");
const statements = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

const TABLES = ["podscan_catalog", "show_contacts"] as const;

describe("migration 093 podscan import", () => {
  it("creates two service-only tables and records the apply", () => {
    expect(sql).toContain("Applied 2026-11-20 by apply_migration.");
    expect(sql).not.toContain("NOT applied");
    for (const table of TABLES) {
      expect(statements).toContain(`create table if not exists public.${table}`);
      expect(statements).toContain(`alter table public.${table} enable row level security`);
      expect(statements).toContain(`revoke all on table public.${table} from public`);
      expect(statements).toContain(`revoke all on table public.${table} from anon`);
      expect(statements).toContain(`revoke all on table public.${table} from authenticated`);
      expect(statements).toContain(
        `grant select, insert, update, delete on table public.${table} to service_role`
      );
      expect(statements).toContain(
        `revoke truncate, references, trigger on table public.${table} from authenticated`
      );
      expect(statements).toContain(
        `revoke truncate, references, trigger on table public.${table} from anon`
      );
      expect(statements).toContain(
        `revoke truncate, references, trigger on table public.${table} from public`
      );
    }
    expect(statements).toContain("check (keep_reason in ('sponsored', 'floor'))");
    expect(statements).toContain("check (contact_status in ('ok', 'needs_manual_lookup'))");
    expect(statements).toContain("check (source in ('podscan', 'apple_rss'))");
    expect(statements).toContain("check (status in ('ok', 'needs_manual_lookup'))");
    expect(statements).toContain(
      "check (email = lower(btrim(email)) and length(email) <= 254)"
    );
    expect(statements).toContain("unique (podscan_id, source, email)");
    expect(statements).toContain("on delete cascade");
    expect(statements).toContain("on delete set null");
    expect(statements).toContain(
      "Internal estimate only, never shown, not downloads."
    );
    expect(statements).not.toMatch(/create policy/i);
    expect(statements).not.toMatch(/create\s+(or\s+replace\s+)?function/i);
    expect(statements).not.toMatch(/create\s+(or\s+replace\s+)?view/i);
    expect(statements).not.toMatch(
      /grant\s+[a-z_,\s]+\son\s+table\s+public\.(?:podscan_catalog|show_contacts)\s+to\s+anon\b/i
    );
    expect(statements).not.toMatch(
      /grant\s+[a-z_,\s]+\son\s+table\s+public\.(?:podscan_catalog|show_contacts)\s+to\s+authenticated\b/i
    );
  });
});
