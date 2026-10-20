// Static grant assertions on migration 048. Migrations are pasted into the
// Supabase SQL Editor (no local Postgres in CI), so the contract is the
// SQL text: authenticated may SELECT make_goods and must not hold a write
// grant. Approval and decline run as service_role.

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const sql = fs.readFileSync(path.join(__dirname, "048_make_goods.sql"), "utf-8");

function grantPrivileges(grantee: string): string[] {
  const lines = sql.match(/^grant\b[^;]*;/gim) ?? [];
  const line = lines.find((stmt) => new RegExp(`to\\s+${grantee}\\s*;`, "i").test(stmt));
  if (!line) return [];
  const privileges = line.match(/^grant\s+(.+?)\s+on\b/i)?.[1] ?? "";
  return privileges
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

describe("migration 048 make_goods grants", () => {
  it("asserts authenticated has no write grant", () => {
    expect(sql).toMatch(/ASSERT: authenticated has no write grant on public\.make_goods \(SELECT only\)/);
    expect(grantPrivileges("authenticated")).toEqual(["select"]);
    expect(sql).toMatch(/revoke all on public\.make_goods from authenticated/i);
    expect(sql).not.toMatch(/grant\s+(insert|update|delete|select\s*,)[^;]*to\s+authenticated/i);
  });

  it("keeps service_role writes and the two read policies", () => {
    expect(grantPrivileges("service_role").sort()).toEqual(
      ["delete", "insert", "select", "update"]
    );
    expect(sql).toMatch(/revoke all on public\.make_goods from anon/i);
    const grants = sql.match(/^grant\b[^;]*;/gim) ?? [];
    expect(grants.some((stmt) => /\bto\s+anon\b/i.test(stmt))).toBe(false);

    const created = [...sql.matchAll(/create policy\s+"([^"]+)"/gi)].map((match) => match[1]);
    expect(created).toEqual([
      "Service role manages make_goods",
      "Brand reads make-goods on own deals",
      "Show reads make-goods on own deals",
    ]);
    expect(sql).toMatch(/drop policy if exists "Brand updates make-goods on own deals"/i);
    expect(sql).not.toMatch(/create policy "Brand updates make-goods on own deals"/i);
  });
});
