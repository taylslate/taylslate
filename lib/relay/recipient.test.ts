import { beforeEach, describe, expect, it, vi } from "vitest";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const SHOW = "33333333-3333-4333-8333-333333333333";
const CAMPAIGN = "44444444-4444-4444-8444-444444444444";

const tables: Record<string, Array<Record<string, unknown>>> = {};
const reads: string[] = [];

function matches(row: Record<string, unknown>, filters: Array<{ op: "eq" | "in"; column: string; value: unknown }>) {
  return filters.every((filter) => {
    if (filter.op === "eq") return row[filter.column] === filter.value;
    return (filter.value as unknown[]).includes(row[filter.column]);
  });
}

function from(table: string) {
  reads.push(table);
  const filters: Array<{ op: "eq" | "in"; column: string; value: unknown }> = [];
  const rows = () => (tables[table] ?? []).filter((row) => matches(row, filters));
  const api = {
    select() {
      return api;
    },
    eq(column: string, value: unknown) {
      filters.push({ op: "eq", column, value });
      return api;
    },
    in(column: string, value: unknown[]) {
      filters.push({ op: "in", column, value });
      return api;
    },
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve({ data: rows(), error: null }).then(resolve, reject);
    },
  };
  return api;
}

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: (table: string) => from(table) },
}));

import { canReachOut, canReachOutMany, resolveOutreachRecipient } from "./recipient";

describe("resolveOutreachRecipient", () => {
  beforeEach(() => {
    reads.length = 0;
    tables.shows = [
      { id: SHOW, contact_email: "host@example.test", is_discoverable: true },
      {
        id: "66666666-6666-4666-8666-666666666666",
        contact_email: "hidden@example.test",
        is_discoverable: false,
      },
    ];
    tables.campaigns = [
      {
        id: CAMPAIGN,
        user_id: USER,
        selected_show_ids: [SHOW],
        scored_shows: [{ podcastId: "pod-1", contactEmail: "scored@example.test" }],
        recommendations: [{ show_id: "rec-1", contact_email: "rec@example.test" }],
        youtube_recommendations: [],
        expansion_opportunities: [],
      },
    ];
  });

  it("resolves a catalog uuid before the campaign lists", async () => {
    const resolved = await resolveOutreachRecipient({
      userId: USER,
      campaignId: CAMPAIGN,
      showId: SHOW,
    });
    expect(resolved).toEqual({ ok: true, email: "host@example.test", catalogShowId: SHOW });
  });

  it("falls through to the campaign's own scored shows and recommendations", async () => {
    expect(
      await resolveOutreachRecipient({ userId: USER, campaignId: CAMPAIGN, podscanId: "pod-1" })
    ).toEqual({ ok: true, email: "scored@example.test", catalogShowId: null });
    expect(
      await resolveOutreachRecipient({ userId: USER, campaignId: CAMPAIGN, showId: "rec-1" })
    ).toEqual({ ok: true, email: "rec@example.test", catalogShowId: null });
  });

  it("returns not_found for another user's campaign and no_contact with no address", async () => {
    expect(
      await resolveOutreachRecipient({ userId: OTHER, campaignId: CAMPAIGN, showId: SHOW })
    ).toEqual({ ok: false, reason: "not_found" });
    expect(
      await resolveOutreachRecipient({ userId: USER, campaignId: CAMPAIGN, showId: "missing" })
    ).toEqual({ ok: false, reason: "no_contact" });
    expect(await canReachOut({ userId: USER, campaignId: CAMPAIGN, showId: "missing" })).toBe(false);
    expect(await canReachOut({ userId: USER, campaignId: CAMPAIGN, showId: SHOW })).toBe(true);
  });

  it("does not resolve a catalog show that is not on the campaign", async () => {
    const hidden = "66666666-6666-4666-8666-666666666666";
    reads.length = 0;
    const resolved = await resolveOutreachRecipient({
      userId: USER,
      campaignId: CAMPAIGN,
      showId: hidden,
    });
    expect(resolved).toEqual({ ok: false, reason: "not_found" });
    expect(reads.filter((table) => table === "shows")).toHaveLength(0);
    expect(JSON.stringify(resolved)).not.toContain("hidden@example.test");
  });

  it("loads the campaign once for many shows", async () => {
    reads.length = 0;
    const flags = await canReachOutMany({
      userId: USER,
      campaignId: CAMPAIGN,
      shows: [{ showId: SHOW }, { showId: "rec-1" }, { podscanId: "pod-1" }],
    });
    expect(flags).toEqual([true, true, true]);
    expect(reads.filter((table) => table === "campaigns")).toHaveLength(1);
  });
});
