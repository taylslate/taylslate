// Static assertions on migration 053. Migrations are pasted into the
// Supabase SQL Editor (no local Postgres in CI), so the contract is
// the SQL text.

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const sql = fs.readFileSync(
  path.join(__dirname, "053_brand_show_crm.sql"),
  "utf-8"
);

const statements = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

const tables = ["brand_show_contacts", "brand_show_notes"] as const;

function policy(name: string): string {
  const marker = `create policy "${name}"`;
  const start = sql.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  const rest = sql.slice(start);
  const end = rest.indexOf("drop policy if exists");
  return end === -1 ? rest : rest.slice(0, end);
}

describe("migration 053 brand show CRM", () => {
  it("says it is not applied until after merge and Chris's OK", () => {
    expect(sql).toMatch(/NOT applied/i);
    expect(sql).toMatch(/after merge and Chris's OK/i);
    expect(sql).toMatch(/information_schema\.role_table_grants/);
    expect(sql).toMatch(/pg_policy/);
    expect(sql).toMatch(/pg_indexes/);
  });

  it("creates both tables, the body check, and brand/show indexes", () => {
    expect(statements).toMatch(
      /create table if not exists public\.brand_show_contacts/i
    );
    expect(statements).toMatch(
      /create table if not exists public\.brand_show_notes/i
    );
    expect(statements).toMatch(
      /brand_id\s+uuid not null references public\.profiles\(id\) on delete cascade/i
    );
    expect(statements).toMatch(
      /show_id\s+uuid not null references public\.shows\(id\) on delete cascade/i
    );
    expect(statements).toMatch(
      /check \(length\(body\) between 1 and 2000\)/i
    );
    expect(statements).toMatch(
      /create index if not exists idx_brand_show_contacts_brand_show\s+on public\.brand_show_contacts \(brand_id, show_id\)/i
    );
    expect(statements).toMatch(
      /create index if not exists idx_brand_show_notes_brand_show\s+on public\.brand_show_notes \(brand_id, show_id\)/i
    );
    expect(sql).toMatch(/not show_profiles\.podscan_id/i);
    expect(statements).not.toMatch(/\bfrom public\.show_profiles\b/i);
    expect(statements).not.toMatch(/\bjoin public\.show_profiles\b/i);
    expect(statements).not.toMatch(/references public\.show_profiles/i);
  });

  it("revokes anon and public, and grants DML only to service_role and authenticated", () => {
    for (const table of tables) {
      expect(statements).toMatch(
        new RegExp(`revoke all on table public\\.${table} from public;`, "i")
      );
      expect(statements).toMatch(
        new RegExp(`revoke all on table public\\.${table} from anon;`, "i")
      );
      expect(statements).toMatch(
        new RegExp(
          `grant select, insert, update, delete on table public\\.${table} to service_role;`,
          "i"
        )
      );
      expect(statements).toMatch(
        new RegExp(
          `grant select, insert, update, delete on table public\\.${table} to authenticated;`,
          "i"
        )
      );
      expect(statements).toMatch(
        new RegExp(
          `revoke truncate, references, trigger on table public\\.${table} from authenticated;`,
          "i"
        )
      );
      expect(statements).toMatch(
        new RegExp(
          `revoke truncate, references, trigger on table public\\.${table} from anon;`,
          "i"
        )
      );
    }
    expect(statements).not.toMatch(
      /grant\s+[a-z,\s]+\s+on\s+(?:table\s+)?public\.(?:brand_show_contacts|brand_show_notes)\s+to\s+anon/i
    );
    expect(statements).not.toMatch(
      /grant\s+[a-z,\s]+\s+on\s+(?:table\s+)?public\.(?:brand_show_contacts|brand_show_notes)\s+to\s+public/i
    );
  });

  it("enables owner-only RLS with WITH CHECK on insert and update", () => {
    for (const table of tables) {
      expect(statements).toMatch(
        new RegExp(
          `alter table public\\.${table} enable row level security;`,
          "i"
        )
      );
    }

    const names = [
      ["Brand selects own show contacts", "select"],
      ["Brand inserts own show contacts", "insert"],
      ["Brand updates own show contacts", "update"],
      ["Brand deletes own show contacts", "delete"],
      ["Brand selects own show notes", "select"],
      ["Brand inserts own show notes", "insert"],
      ["Brand updates own show notes", "update"],
      ["Brand deletes own show notes", "delete"],
    ] as const;

    for (const [name, command] of names) {
      const body = policy(name);
      expect(body).toMatch(new RegExp(`for ${command}\\s+to authenticated`, "i"));
      expect(body).toMatch(/brand_id = auth\.uid\(\)/);
      expect(body).not.toMatch(/\bto anon\b/i);
      expect(body).not.toMatch(/\bto public\b/i);
      expect(body).not.toMatch(/\bto service_role\b/i);
      if (command === "insert" || command === "update") {
        expect(body).toMatch(/with check \(brand_id = auth\.uid\(\)\)/i);
      }
      if (command === "select" || command === "update" || command === "delete") {
        expect(body).toMatch(/using \(brand_id = auth\.uid\(\)\)/i);
      }
    }

    expect(statements).not.toMatch(/create policy[\s\S]*?\bto anon\b/i);
  });
});
