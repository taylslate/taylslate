// Static assertions on migration 056. Migrations are pasted into the
// Supabase SQL Editor (no local Postgres in CI), so the contract is
// the SQL text: the three 047 learning_overrides policies that read
// agent_show_relationships require status 'approved'.

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

const sql = fs.readFileSync(
  path.join(__dirname, "056_rep_policies_require_approved.sql"),
  "utf-8"
);

const statements = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

describe("migration 056 rep policies require approved", () => {
  it("is marked not applied until 055 and Chris's OK", () => {
    expect(sql).toMatch(/NOT applied/i);
    expect(sql).toMatch(/after 055/i);
    expect(sql).toMatch(/Chris says OK/);
  });

  it("recreates the three policies and requires an approved roster link", () => {
    for (const name of [
      "Campaign readers select learning overrides",
      "Rep inserts own learning overrides",
      "Author updates own learning overrides",
    ]) {
      expect(statements).toMatch(
        new RegExp(`drop policy if exists "${name}"`, "i")
      );
      expect(statements).toMatch(new RegExp(`create policy "${name}"`, "i"));
    }

    const onDealShow = statements.match(
      /from public\.agent_show_relationships a\s+where a\.agent_id = auth\.uid\(\)\s+and a\.show_id = d\.show_id\s+and a\.status = 'approved'/gi
    );
    const onTarget = statements.match(
      /from public\.agent_show_relationships a\s+where a\.agent_id = auth\.uid\(\)\s+and a\.show_id::text = learning_overrides\.target_key\s+and a\.status = 'approved'/gi
    );
    expect(onDealShow).toHaveLength(3);
    expect(onTarget).toHaveLength(2);
    expect(statements).toMatch(/d\.agent_id = auth\.uid\(\)/);
    expect(statements).not.toMatch(/\bpodscan_id\b/i);
    expect(statements).not.toMatch(/\bgrant\b/i);
    expect(statements).not.toMatch(/\bupdate\s+public\./i);
  });
});
