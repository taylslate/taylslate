import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(join(__dirname, "097_podscan_catalog_scoring_fields.sql"), "utf8");
const statements = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

describe("migration 097 podscan catalog scoring fields", () => {
  it("adds three columns and is not applied", () => {
    expect(sql).toContain("NOT applied. The CEO must name 097 before it is applied.");
    expect(statements).toContain(
      "add column if not exists podcast_reach_score double precision"
    );
    expect(statements).toContain("add column if not exists brand_safety jsonb");
    expect(statements).toContain("add column if not exists sponsor_history jsonb");
    expect(statements).not.toMatch(/create policy/i);
    expect(statements).not.toMatch(/enable row level security/i);
    expect(statements).not.toMatch(/grant\s+/i);
    expect(statements).not.toMatch(/revoke\s+/i);
    expect(statements).not.toMatch(/create table/i);
  });
});
