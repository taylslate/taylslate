// Static assertions on migration 052. Migrations are pasted into the
// Supabase SQL Editor (no local Postgres in CI), so the contract is
// the SQL text: only truncate, references, and trigger are revoked
// from anon and authenticated. service_role and the DML grants stay
// untouched.

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const sql = fs.readFileSync(
  path.join(__dirname, "052_revoke_excess_table_privileges.sql"),
  "utf-8"
);

const statements = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

const tables = [
  "learning_overrides",
  "deal_conversion_reports",
  "show_surfaces",
] as const;

describe("migration 052 revoke excess table privileges", () => {
  it("revokes truncate, references, and trigger from anon and authenticated", () => {
    for (const table of tables) {
      expect(statements).toMatch(
        new RegExp(
          `revoke truncate, references, trigger on table public\\.${table} from anon;`,
          "i"
        )
      );
      expect(statements).toMatch(
        new RegExp(
          `revoke truncate, references, trigger on table public\\.${table} from authenticated;`,
          "i"
        )
      );
    }
  });

  it("does not grant, and does not touch service_role or DML privileges", () => {
    expect(statements).not.toMatch(/\bgrant\b/i);
    expect(statements).not.toMatch(/\bservice_role\b/i);
    expect(statements).not.toMatch(/\b(select|insert|update|delete)\b/i);
    expect(statements).not.toMatch(/\bfrom public\b/i);
    expect(statements).not.toMatch(/\bto anon\b/i);
    expect(statements).not.toMatch(/\bto authenticated\b/i);
  });
});
