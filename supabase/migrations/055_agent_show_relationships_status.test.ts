// Static assertions on migration 055. Migrations are pasted into the
// Supabase SQL Editor (no local Postgres in CI), so the contract is
// the SQL text: roster links gain a pending/approved status, agents
// lose self-serve insert and delete, and authenticated keeps select.

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const sql = fs.readFileSync(
  path.join(__dirname, "055_agent_show_relationships_status.sql"),
  "utf-8"
);

const statements = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

describe("migration 055 agent_show_relationships status", () => {
  it("is marked not applied until merge and Chris's OK", () => {
    expect(sql).toMatch(/NOT applied/i);
    expect(sql).toMatch(/Chris says OK/);
  });

  it("adds status, source, approved_by, and approved_at with the stated defaults", () => {
    expect(statements).toMatch(
      /add column if not exists status text not null default 'approved'/i
    );
    expect(statements).toMatch(
      /add column if not exists source text not null default 'admin'/i
    );
    expect(statements).toMatch(/add column if not exists approved_by uuid/i);
    expect(statements).toMatch(/add column if not exists approved_at timestamptz/i);
    expect(statements).not.toMatch(/approved_by uuid not null/i);
    expect(statements).not.toMatch(/approved_at timestamptz not null/i);
    expect(statements).not.toMatch(/\bpodscan_id\b/i);
  });

  it("checks status and source and points approved_by at profiles", () => {
    expect(statements).toMatch(
      /drop constraint if exists agent_show_relationships_status_check/i
    );
    expect(statements).toMatch(
      /add constraint agent_show_relationships_status_check\s+check \(status in \('pending', 'approved', 'rejected'\)\)/i
    );
    expect(statements).toMatch(
      /drop constraint if exists agent_show_relationships_source_check/i
    );
    expect(statements).toMatch(
      /add constraint agent_show_relationships_source_check\s+check \(source in \('admin', 'import', 'claim'\)\)/i
    );
    expect(statements).toMatch(
      /drop constraint if exists agent_show_relationships_approved_by_fkey/i
    );
    expect(statements).toMatch(
      /foreign key \(approved_by\) references public\.profiles \(id\) on delete set null/i
    );
  });

  it("indexes (agent_id, status) and does not rewrite rows", () => {
    expect(statements).toMatch(
      /create index if not exists idx_agent_shows_agent_status\s+on public\.agent_show_relationships \(agent_id, status\)/i
    );
    expect(statements).not.toMatch(/\bupdate\s+public\.agent_show_relationships\b/i);
    expect(statements).not.toMatch(/\bdelete\s+from\s+public\.agent_show_relationships\b/i);
  });

  it("drops agent insert and delete policies and keeps the read-own policy", () => {
    expect(statements).toMatch(
      /drop policy if exists "Agents insert own relationships" on public\.agent_show_relationships/i
    );
    expect(statements).toMatch(
      /drop policy if exists "Agents delete own relationships" on public\.agent_show_relationships/i
    );
    expect(statements).not.toMatch(/create policy "Agents insert own relationships"/i);
    expect(statements).not.toMatch(/create policy "Agents delete own relationships"/i);

    expect(statements).toMatch(
      /drop policy if exists "Agents read own relationships" on public\.agent_show_relationships/i
    );
    expect(statements).toMatch(/create policy "Agents read own relationships"/i);
    expect(statements).toMatch(/for select/i);
    expect(statements).toMatch(/using \(auth\.uid\(\) = agent_id\)/i);
    expect(statements).toMatch(
      /alter table public\.agent_show_relationships enable row level security/i
    );
  });

  it("grants service_role DML, select only to authenticated, and revokes the rest", () => {
    expect(statements).toMatch(
      /revoke all on table public\.agent_show_relationships from anon;/i
    );
    expect(statements).toMatch(
      /revoke all on table public\.agent_show_relationships from public;/i
    );
    expect(statements).toMatch(
      /grant select, insert, update, delete on table public\.agent_show_relationships to service_role;/i
    );
    expect(statements).toMatch(
      /grant select on table public\.agent_show_relationships to authenticated;/i
    );
    expect(statements).toMatch(
      /revoke insert, update, delete, truncate, references, trigger\s+on table public\.agent_show_relationships from authenticated;/i
    );

    const grants = statements.match(/grant\b[^;]*;/gi) ?? [];
    expect(grants).toHaveLength(2);
    expect(grants.some((stmt) => /\bto\s+anon\b/i.test(stmt))).toBe(false);
    expect(grants.some((stmt) => /\bto\s+public\b/i.test(stmt))).toBe(false);
    const authenticated = grants.find((stmt) => /\bto\s+authenticated\b/i.test(stmt)) ?? "";
    expect(authenticated).toMatch(/^grant select on table /i);
    expect(statements).not.toMatch(/learning_overrides|deal_conversion_reports|repMayWrite/i);
  });
});
