import { beforeEach, describe, expect, it, vi } from "vitest";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const SHOW = "33333333-3333-4333-8333-333333333333";
const CAMPAIGN = "44444444-4444-4444-8444-444444444444";

const tables: Record<string, Array<Record<string, unknown>>> = {};

function from(table: string) {
  const filters: Array<[string, unknown]> = [];
  const run = () => {
    const rows = (tables[table] ?? []).filter((row) =>
      filters.every(([column, value]) => row[column] === value)
    );
    return { data: rows[0] ?? null, error: null };
  };
  const api = {
    select() {
      return api;
    },
    eq(column: string, value: unknown) {
      filters.push([column, value]);
      return api;
    },
    maybeSingle: async () => run(),
  };
  return api;
}

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: (table: string) => from(table) },
}));

import { canReachOut, resolveOutreachRecipient } from "./recipient";

describe("resolveOutreachRecipient", () => {
  beforeEach(() => {
    tables.shows = [{ id: SHOW, contact_email: "host@example.test" }];
    tables.campaigns = [
      {
        id: CAMPAIGN,
        user_id: USER,
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
});
