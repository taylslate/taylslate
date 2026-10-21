// Static assertions on migration 057. Migrations are pasted into the
// Supabase SQL Editor (no local Postgres in CI), so the contract is
// the SQL text: hashed API keys, owner-only select, service_role
// writes, and a service_role-only rate window.

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const sql = fs.readFileSync(
  path.join(__dirname, "057_api_keys.sql"),
  "utf-8"
);

const statements = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

const tables = ["api_keys", "api_rate_windows"] as const;

function policy(name: string): string {
  const marker = `create policy "${name}"`;
  const start = sql.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const rest = sql.slice(start);
  const next = rest.indexOf("drop policy if exists", marker.length);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("migration 057 api keys", () => {
  it("is not applied and documents the grant and policy introspection", () => {
    expect(sql).toContain(
      "NOT applied. Apply on ldtmhafewfifdizgfrnn only after merge and Chris's OK."
    );
    expect(sql).toContain("information_schema.role_table_grants");
    expect(sql).toContain("information_schema.routine_privileges");
    expect(sql).toContain("pg_policies");
    expect(sql).toContain("relrowsecurity");
    expect(statements).not.toMatch(/migration to apply/i);
  });

  it("creates only the api key and rate window tables", () => {
    const created = [
      ...statements.matchAll(
        /create table if not exists public\.([a-z_]+)/gi
      ),
    ].map((match) => match[1]);
    expect(created).toEqual([...tables]);
    expect(statements).not.toMatch(
      /create\s+(or\s+replace\s+)?(materialized\s+)?view\b/i
    );
    expect(statements).not.toMatch(/show_profiles|podscan_id/);
  });

  it("stores a hashed key, a unique prefix, and a closed scope set", () => {
    expect(statements).toMatch(
      /brand_id\s+uuid not null references public\.profiles\(id\) on delete cascade/i
    );
    expect(statements).toMatch(/prefix\s+text not null/i);
    expect(statements).toMatch(/key_hash\s+text not null/i);
    expect(statements).toMatch(/scopes\s+text\[\] not null/i);
    expect(statements).toMatch(/name\s+text,/i);
    expect(statements).toMatch(/created_at\s+timestamptz not null default now\(\)/i);
    expect(statements).toMatch(/last_used_at\s+timestamptz/i);
    expect(statements).toMatch(/revoked_at\s+timestamptz/i);
    expect(statements).toMatch(
      /add constraint api_keys_prefix_key unique \(prefix\);/i
    );
    expect(statements).toMatch(
      /add constraint api_keys_brand_id_fkey\s+foreign key \(brand_id\) references public\.profiles\(id\) on delete cascade;/i
    );
    expect(statements).toMatch(
      /check \(\s*scopes <@ array\['read', 'write:campaigns', 'write:outreach'\]::text\[\]\s*\)/i
    );
    expect(statements).toMatch(/check \(prefix ~ '\^\[0-9a-f\]\{16\}\$'\)/i);
    expect(statements).toMatch(/check \(key_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/i);
    expect(statements).toMatch(
      /create index if not exists idx_api_keys_brand_id\s+on public\.api_keys \(brand_id\);/i
    );
  });

  it("keys rate windows by key and minute", () => {
    expect(statements).toMatch(
      /key_id\s+uuid not null references public\.api_keys\(id\) on delete cascade/i
    );
    expect(statements).toMatch(/window_start\s+timestamptz not null/i);
    expect(statements).toMatch(/count\s+int not null/i);
    expect(statements).toMatch(/primary key \(key_id, window_start\)/i);
    expect(statements).toMatch(
      /add constraint api_rate_windows_key_id_fkey\s+foreign key \(key_id\) references public\.api_keys\(id\) on delete cascade;/i
    );
    expect(statements).toMatch(/check \(count >= 0\)/i);
  });

  it("enables RLS with a select-only owner policy and no rate-window policy", () => {
    for (const table of tables) {
      expect(statements).toMatch(
        new RegExp(
          `alter table public\\.${table} enable row level security;`,
          "i"
        )
      );
    }

    const select = policy("Brand selects own api keys");
    expect(select).toMatch(/for select\s+to authenticated/i);
    expect(select).toMatch(/using \(brand_id = auth\.uid\(\)\)/);
    expect(select).not.toMatch(/with check/i);
    expect(select).not.toMatch(/for insert|for update|for delete/i);

    const names = [...sql.matchAll(/create policy "([^"]+)"/g)].map(
      (match) => match[1]
    );
    expect(names).toEqual(["Brand selects own api keys"]);
    expect(statements).not.toMatch(/on public\.api_rate_windows\s+for /i);
    expect(statements).not.toMatch(/using \(true\)/i);
    expect(statements).not.toMatch(/with check \(true\)/i);
    expect(statements).not.toMatch(/security definer/i);
  });

  it("grants DML to service_role, select to authenticated on api_keys, and revokes the rest before RLS", () => {
    const rlsAt = statements.search(
      /alter table public\.api_keys enable row level security/i
    );
    expect(rlsAt).toBeGreaterThan(-1);

    for (const table of tables) {
      const grant = `grant select, insert, update, delete on public.${table} to service_role;`;
      const grantAt = statements.toLowerCase().indexOf(grant);
      expect(grantAt).toBeGreaterThanOrEqual(0);
      expect(grantAt).toBeLessThan(rlsAt);

      expect(statements).toMatch(
        new RegExp(`revoke all on table public\\.${table} from public;`, "i")
      );
      expect(statements).toMatch(
        new RegExp(`revoke all on table public\\.${table} from anon;`, "i")
      );
      expect(statements).toMatch(
        new RegExp(
          `revoke all on table public\\.${table} from authenticated;`,
          "i"
        )
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

    const revokeKeysAuth = statements
      .toLowerCase()
      .indexOf("revoke all on table public.api_keys from authenticated;");
    const grantKeysAuth = statements
      .toLowerCase()
      .indexOf("grant select on public.api_keys to authenticated;");
    expect(revokeKeysAuth).toBeGreaterThanOrEqual(0);
    expect(grantKeysAuth).toBeGreaterThan(revokeKeysAuth);
    expect(grantKeysAuth).toBeLessThan(rlsAt);

    expect(statements).not.toMatch(
      /grant\s+[a-z,\s]+\s+on\s+(?:table\s+)?public\.api_rate_windows\s+to\s+authenticated/i
    );
    expect(statements).not.toMatch(
      /grant\s+(insert|update|delete)[^;]*on\s+(?:table\s+)?public\.api_keys\s+to\s+authenticated/i
    );
  });

  it("increments the rate window atomically and grants execute to service_role only", () => {
    expect(statements).toMatch(
      /create or replace function public\.increment_api_rate_window\(\s*p_key_id uuid,\s*p_window_start timestamptz\s*\)\s*returns integer/i
    );
    expect(statements).toMatch(/security invoker/i);
    expect(statements).toMatch(/set search_path = public/i);
    expect(statements).toMatch(
      /on conflict \(key_id, window_start\)\s*do update set count = api_rate_windows\.count \+ 1/i
    );
    expect(statements).toContain(
      "revoke all on function public.increment_api_rate_window(uuid, timestamptz) from public;"
    );
    expect(statements).toContain(
      "revoke all on function public.increment_api_rate_window(uuid, timestamptz) from anon;"
    );
    expect(statements).toContain(
      "revoke all on function public.increment_api_rate_window(uuid, timestamptz) from authenticated;"
    );
    expect(statements).toContain(
      "grant execute on function public.increment_api_rate_window(uuid, timestamptz) to service_role;"
    );
    expect(statements).not.toMatch(
      /grant execute on function public\.increment_api_rate_window\(uuid, timestamptz\) to (anon|authenticated|public)/i
    );
  });
});
