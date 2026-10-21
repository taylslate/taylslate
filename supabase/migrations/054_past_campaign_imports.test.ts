// Static assertions on migration 054. Migrations are pasted into the
// Supabase SQL Editor (no local Postgres in CI), so the contract is
// the SQL text: brand-private imports, owner-only RLS, DML grants,
// and no anon, pooled, or aggregate relation.

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const sql = fs.readFileSync(
  path.join(__dirname, "054_past_campaign_imports.sql"),
  "utf-8"
);

const statements = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

const tables = ["past_campaign_imports", "past_campaign_records"] as const;

function policy(name: string): string {
  const marker = `create policy "${name}"`;
  const start = sql.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const rest = sql.slice(start);
  const next = rest.indexOf("drop policy if exists", marker.length);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("migration 054 past campaign imports", () => {
  it("is not applied and documents the grant and policy introspection", () => {
    expect(sql).toContain("NOT applied. Apply after merge and Chris's OK.");
    expect(sql).toContain("information_schema.role_table_grants");
    expect(sql).toContain("pg_policies");
  });

  it("creates only the two brand-private tables", () => {
    const created = [
      ...statements.matchAll(
        /create table if not exists public\.([a-z_]+)/gi
      ),
    ].map((match) => match[1]);
    expect(created).toEqual([...tables]);
    expect(statements).not.toMatch(
      /create\s+(or\s+replace\s+)?(materialized\s+)?view\b/i
    );
    expect(created.join(" ")).not.toMatch(/pool|aggregate/i);
    expect(statements).not.toMatch(/\b(pooled_|aggregate_|past_campaign_pool)\w*/i);
    expect(statements).not.toMatch(/show_profiles|podscan_id/);
  });

  it("keeps imports and records private to the owning brand", () => {
    expect(statements).toMatch(
      /brand_id\s+uuid not null references public\.profiles\(id\) on delete cascade/i
    );
    expect(statements).toMatch(/import_id\s+uuid not null,/i);
    expect(statements).toMatch(
      /matched_show_id\s+uuid references public\.shows\(id\) on delete set null/i
    );
    expect(statements).toMatch(/source_kind\s+text not null/i);
    expect(statements).toMatch(/file_name\s+text,/i);
    expect(statements).not.toMatch(/file_name\s+text not null/i);
    expect(statements).toMatch(
      /alter column source_kind set not null/i
    );
    expect(statements).toMatch(
      /pooling_consent\s+boolean not null default false/i
    );
    expect(statements).toMatch(/status\s+text not null default 'parsed'/i);
    expect(statements).toMatch(
      /check \(source_kind in \('csv', 'xlsx', 'pdf'\)\)/i
    );
    expect(statements).not.toMatch(/source_kind is null or/i);
    expect(statements).toMatch(
      /check \(status in \('parsed', 'confirmed', 'discarded'\)\)/i
    );
    expect(statements).toMatch(
      /check \(price_type is null or price_type in \('cpm', 'flat'\)\)/i
    );
  });

  it("ties a record to an import only when both share brand_id", () => {
    expect(statements).toMatch(
      /drop constraint if exists past_campaign_records_import_id_fkey;/i
    );
    expect(statements).toMatch(
      /drop constraint if exists past_campaign_records_import_brand_fkey;/i
    );
    expect(statements).toMatch(
      /add constraint past_campaign_imports_id_brand_key\s+unique \(id, brand_id\);/i
    );
    expect(statements).toMatch(
      /add constraint past_campaign_records_import_brand_fkey\s+foreign key \(import_id, brand_id\)\s+references public\.past_campaign_imports \(id, brand_id\)\s+on delete cascade;/i
    );
    expect(statements).not.toMatch(
      /import_id\s+uuid not null references public\.past_campaign_imports/i
    );
    expect(statements).toMatch(
      /matched_show_id\s+uuid references public\.shows\(id\) on delete set null/i
    );
  });

  it("indexes brand_id and import_id", () => {
    expect(statements).toMatch(
      /create index if not exists idx_past_campaign_imports_brand\s+on public\.past_campaign_imports \(brand_id\);/i
    );
    expect(statements).toMatch(
      /create index if not exists idx_past_campaign_records_brand\s+on public\.past_campaign_records \(brand_id\);/i
    );
    expect(statements).toMatch(
      /create index if not exists idx_past_campaign_records_import\s+on public\.past_campaign_records \(import_id\);/i
    );
  });

  it("enables RLS and owner-only policies with a matching WITH CHECK", () => {
    for (const table of tables) {
      expect(statements).toMatch(
        new RegExp(
          `alter table public\\.${table} enable row level security;`,
          "i"
        )
      );
    }

    const labels = ["imports", "records"] as const;
    for (const label of labels) {
      const select = policy(`Brand selects own past campaign ${label}`);
      const insert = policy(`Brand inserts own past campaign ${label}`);
      const update = policy(`Brand updates own past campaign ${label}`);
      const remove = policy(`Brand deletes own past campaign ${label}`);

      expect(select).toMatch(/for select\s+to authenticated/i);
      expect(select).toMatch(/using \(brand_id = auth\.uid\(\)\)/);
      expect(select).not.toMatch(/with check/i);

      expect(insert).toMatch(/for insert\s+to authenticated/i);
      expect(insert).toMatch(/with check \(brand_id = auth\.uid\(\)\)/);

      expect(update).toMatch(/for update\s+to authenticated/i);
      expect(update).toMatch(/using \(brand_id = auth\.uid\(\)\)/);
      expect(update).toMatch(/with check \(brand_id = auth\.uid\(\)\)/);

      expect(remove).toMatch(/for delete\s+to authenticated/i);
      expect(remove).toMatch(/using \(brand_id = auth\.uid\(\)\)/);
    }

    expect(statements).not.toMatch(/using \(true\)/i);
    expect(statements).not.toMatch(/with check \(true\)/i);
    const names = [...sql.matchAll(/create policy "([^"]+)"/g)].map(
      (match) => match[1]
    );
    expect(names).toEqual([
      "Brand selects own past campaign imports",
      "Brand inserts own past campaign imports",
      "Brand updates own past campaign imports",
      "Brand deletes own past campaign imports",
      "Brand selects own past campaign records",
      "Brand inserts own past campaign records",
      "Brand updates own past campaign records",
      "Brand deletes own past campaign records",
    ]);
  });

  it("grants DML to service_role and authenticated, and revokes anon, public, and excess privileges", () => {
    for (const table of tables) {
      expect(statements).toMatch(
        new RegExp(
          `grant select, insert, update, delete on public\\.${table} to service_role;`,
          "i"
        )
      );
      expect(statements).toMatch(
        new RegExp(
          `grant select, insert, update, delete on public\\.${table} to authenticated;`,
          "i"
        )
      );
      expect(statements).toMatch(
        new RegExp(`revoke all on table public\\.${table} from public;`, "i")
      );
      expect(statements).toMatch(
        new RegExp(`revoke all on table public\\.${table} from anon;`, "i")
      );
      expect(statements).toMatch(
        new RegExp(
          `revoke truncate, references, trigger on table public\\.${table} from authenticated;`,
          "i"
        )
      );
      expect(statements).not.toMatch(
        new RegExp(
          `grant\\s+[a-z,\\s]+\\s+on\\s+(?:table\\s+)?public\\.${table}\\s+to\\s+anon\\b`,
          "i"
        )
      );
      expect(statements).not.toMatch(
        new RegExp(
          `grant\\s+[a-z,\\s]+\\s+on\\s+(?:table\\s+)?public\\.${table}\\s+to\\s+public\\b`,
          "i"
        )
      );
    }
  });
});
