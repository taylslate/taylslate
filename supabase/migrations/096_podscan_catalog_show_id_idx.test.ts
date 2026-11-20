import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(join(__dirname, "096_podscan_catalog_show_id_idx.sql"), "utf8");
const statements = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

describe("migration 096 podscan catalog show id index", () => {
  it("adds a partial show_id index and is not applied", () => {
    expect(sql).toContain("NOT applied. Apply only after merge and Chris's OK.");
    expect(statements).toContain("create index if not exists podscan_catalog_show_id_idx");
    expect(statements).toContain("on public.podscan_catalog (show_id)");
    expect(statements).toContain("where show_id is not null");
    expect(statements).not.toMatch(/create table/i);
    expect(statements).not.toMatch(/create policy/i);
    expect(statements).not.toMatch(/create\s+(or\s+replace\s+)?function/i);
    expect(statements).not.toMatch(/grant\s+/i);
    expect(statements).not.toMatch(/alter table/i);
  });
});
