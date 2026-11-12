import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(join(__dirname, "092_mcp_oauth.sql"), "utf8");
const statements = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

const TABLES = [
  "mcp_oauth_clients",
  "mcp_oauth_requests",
  "mcp_oauth_codes",
  "mcp_oauth_tokens",
] as const;

describe("migration 092 mcp oauth", () => {
  it("creates four service-only tables and is not applied", () => {
    expect(sql).toContain("NOT applied. Apply only after merge and Chris's OK.");
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
      expect(statements).toContain(`revoke truncate, references, trigger on table public.${table} from anon`);
      expect(statements).toContain(`revoke truncate, references, trigger on table public.${table} from public`);
    }
    expect(statements).toContain("client_id ~ '^tsc_[0-9a-f]{32}$'");
    expect(statements).toContain("code_hash ~ '^[0-9a-f]{64}$'");
    expect(statements).toContain("token_hash ~ '^[0-9a-f]{64}$'");
    expect(statements).toContain("code_challenge ~ '^[A-Za-z0-9_-]{43}$'");
    expect(statements).toContain("on delete cascade");
    expect(statements).not.toMatch(/create policy/i);
    expect(statements).not.toMatch(/create\s+(or\s+replace\s+)?function/i);
    expect(statements).not.toMatch(/create\s+(or\s+replace\s+)?view/i);
    expect(statements).not.toMatch(/grant\s+[a-z_,\s]+\son\s+table\s+public\.mcp_oauth_[a-z_]+\s+to\s+anon\b/i);
    expect(statements).not.toMatch(
      /grant\s+[a-z_,\s]+\son\s+table\s+public\.mcp_oauth_[a-z_]+\s+to\s+authenticated\b/i
    );
  });
});
