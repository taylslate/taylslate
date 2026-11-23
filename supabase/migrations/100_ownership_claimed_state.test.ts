import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(join(__dirname, "100_ownership_claimed_state.sql"), "utf8");
const statements = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

describe("migration 100 claimed ownership state", () => {
  it("is named for Chris and is not applied from the app", () => {
    expect(sql).toContain("NOT APPLIED LIVE, CHRIS MUST NAME IT");
    expect(sql).toContain("Do not run this from the app");
  });

  it("widens the check to unclaimed, claimed, and verified", () => {
    expect(statements).toMatch(/drop constraint if exists shows_ownership_status_check/i);
    expect(statements).toMatch(
      /check \(ownership_status in \('unclaimed', 'claimed', 'verified'\)\)/i
    );
  });

  it("backfills claimed only for a sourced show action or a server owner slug", () => {
    expect(statements).toMatch(/set ownership_status = 'claimed'/i);
    expect(statements).toMatch(/ownership_status is distinct from 'verified'/i);
    expect(statements).toMatch(/email_confirmed_at is not null/i);
    expect(statements).toMatch(/show_contacts/i);
    expect(statements).toMatch(/source in \('podscan', 'apple_rss'\)/i);
    expect(statements).toMatch(/response_status is distinct from 'declined'/i);
    expect(statements).toMatch(/response_status = 'accepted' or d\.show_signed_at is not null/i);
    expect(statements).toMatch(/event_type in \('deal.created', 'io.show_signed', 'io.counter_accepted'\)/i);
    expect(statements).toMatch(/s\.slug = 'owner-' \|\| sp\.user_id::text/i);
    expect(statements).not.toMatch(/set ownership_status = 'unclaimed'/i);
    expect(statements).not.toMatch(/set ownership_status = 'verified'/i);
  });

  it("does not grant, revoke, or add a function", () => {
    expect(statements).not.toMatch(/\bgrant\b/i);
    expect(statements).not.toMatch(/\brevoke\b/i);
    expect(statements).not.toMatch(/\bcreate\s+(or\s+replace\s+)?function\b/i);
    expect(statements).not.toMatch(/\bpolicy\b/i);
    expect(statements).not.toMatch(/row level security/i);
  });

  it("does not treat is_claimed or a podscan id as the rule", () => {
    expect(statements).not.toMatch(/is_claimed\s*=/i);
    expect(statements).not.toMatch(/podscan_id/i);
  });
});
