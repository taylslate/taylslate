import { beforeEach, describe, expect, it, vi } from "vitest";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const SHOW = "33333333-3333-4333-8333-333333333333";
const CAMPAIGN = "44444444-4444-4444-8444-444444444444";
const HIDDEN = "66666666-6666-4666-8666-666666666666";
const PROFILE = "55555555-5555-4555-8555-555555555555";

const tables: Record<string, Array<Record<string, unknown>>> = {};
const reads: string[] = [];
let failTable: string | null = null;

function matches(
  row: Record<string, unknown>,
  filters: Array<{ op: "eq" | "in" | "not"; column: string; value: unknown }>
) {
  return filters.every((filter) => {
    if (filter.op === "eq") return row[filter.column] === filter.value;
    if (filter.op === "not") return row[filter.column] != null;
    return (filter.value as unknown[]).includes(row[filter.column]);
  });
}

function from(table: string) {
  reads.push(table);
  const filters: Array<{ op: "eq" | "in" | "not"; column: string; value: unknown }> = [];
  const rows = () => {
    if (failTable === table) return null;
    return (tables[table] ?? []).filter((row) => matches(row, filters));
  };
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
    not(column: string, _op: string, value: unknown) {
      filters.push({ op: "not", column, value });
      return api;
    },
    maybeSingle: async () => {
      const found = rows();
      if (found == null) return { data: null, error: { code: "XX000", message: "secret host@example.test" } };
      return { data: found[0] ?? null, error: null };
    },
    then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
      const found = rows();
      if (found == null) {
        return Promise.resolve({ data: null, error: { code: "XX000", message: "secret host@example.test" } }).then(resolve, reject);
      }
      return Promise.resolve({ data: found, error: null }).then(resolve, reject);
    },
  };
  return api;
}

const sendEmail = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: (table: string) => from(table) },
}));
vi.mock("@/lib/email/send", () => ({
  sendEmail: (...args: unknown[]) => sendEmail(...args),
}));

import { canReachOut, canReachOutMany, pitchableShowIds, resolveOutreachRecipient } from "./recipient";

describe("resolveOutreachRecipient", () => {
  beforeEach(() => {
    reads.length = 0;
    failTable = null;
    sendEmail.mockClear();
    tables.shows = [
      { id: SHOW, contact_email: "host@example.test", is_discoverable: true, podscan_id: "pd_open" },
      {
        id: HIDDEN,
        contact_email: "hidden@example.test",
        is_discoverable: false,
        podscan_id: "pd_hidden",
      },
    ];
    tables.campaigns = [
      {
        id: CAMPAIGN,
        user_id: USER,
        selected_show_ids: [SHOW],
        scored_shows: [{ podcastId: "pod-1", contactEmail: "scored@example.test" }, { podcastId: HIDDEN, contactEmail: "planted@example.test" }],
        recommendations: [{ show_id: "rec-1", contact_email: "rec@example.test" }],
        youtube_recommendations: [{ show_id: "pd_open", contact_email: "yt@example.test" }],
        expansion_opportunities: [],
      },
    ];
    tables.agent_show_relationships = [];
    tables.deals = [];
    tables.brand_profiles = [{ id: PROFILE, user_id: USER }];
  });

  it("resolves a catalog uuid and ignores planted campaign addresses", async () => {
    const resolved = await resolveOutreachRecipient({
      userId: USER,
      campaignId: CAMPAIGN,
      showId: SHOW,
    });
    expect(resolved).toEqual({ ok: true, email: "host@example.test", catalogShowId: SHOW });
    expect(
      await resolveOutreachRecipient({ userId: USER, campaignId: CAMPAIGN, podscanId: "pod-1" })
    ).toEqual({ ok: false, reason: "no_contact" });
    expect(
      await resolveOutreachRecipient({ userId: USER, campaignId: CAMPAIGN, showId: "rec-1" })
    ).toEqual({ ok: false, reason: "no_contact" });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("resolves a podscan id through shows.podscan_id", async () => {
    const resolved = await resolveOutreachRecipient({
      userId: USER,
      campaignId: CAMPAIGN,
      podscanId: "pd_open",
    });
    expect(resolved).toEqual({ ok: true, email: "host@example.test", catalogShowId: SHOW });
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
    reads.length = 0;
    const resolved = await resolveOutreachRecipient({
      userId: USER,
      campaignId: CAMPAIGN,
      showId: "77777777-7777-4777-8777-777777777777",
    });
    expect(resolved).toEqual({ ok: false, reason: "not_found" });
    expect(reads.filter((table) => table === "shows")).toHaveLength(0);
    expect(JSON.stringify(resolved)).not.toContain("hidden@example.test");
  });

  it("refuses a hidden show unless the caller has a real tie", async () => {
    const bare = await resolveOutreachRecipient({
      userId: USER,
      campaignId: CAMPAIGN,
      showId: HIDDEN,
    });
    expect(bare).toEqual({ ok: false, reason: "not_found" });

    tables.deals = [{ show_id: HIDDEN, outreach_id: null, brand_id: USER }];
    expect(
      await resolveOutreachRecipient({ userId: USER, campaignId: CAMPAIGN, showId: HIDDEN })
    ).toEqual({ ok: false, reason: "not_found" });

    tables.deals = [
      { show_id: HIDDEN, outreach_id: "outreach-1", brand_id: OTHER, agency_id: OTHER, brand_profile_id: "other-profile" },
    ];
    expect(
      await resolveOutreachRecipient({ userId: USER, campaignId: CAMPAIGN, showId: HIDDEN })
    ).toEqual({ ok: false, reason: "not_found" });

    tables.agent_show_relationships = [{ show_id: HIDDEN, agent_id: USER, status: "approved" }];
    expect(
      await resolveOutreachRecipient({ userId: USER, campaignId: CAMPAIGN, showId: HIDDEN })
    ).toEqual({ ok: true, email: "hidden@example.test", catalogShowId: HIDDEN });

    tables.agent_show_relationships = [];
    tables.deals = [{ show_id: HIDDEN, outreach_id: "outreach-1", brand_id: USER }];
    expect(
      await resolveOutreachRecipient({ userId: USER, campaignId: CAMPAIGN, showId: HIDDEN })
    ).toEqual({ ok: true, email: "hidden@example.test", catalogShowId: HIDDEN });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("fails closed when a catalog read errors", async () => {
    failTable = "shows";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const resolved = await resolveOutreachRecipient({
      userId: USER,
      campaignId: CAMPAIGN,
      showId: SHOW,
    });
    expect(resolved).toEqual({ ok: false, reason: "no_contact" });
    expect(warn.mock.calls.flat().join(" ")).toContain("XX000");
    expect(warn.mock.calls.flat().join(" ")).not.toContain("host@example.test");
    warn.mockRestore();
  });

  it("loads the campaign once for many shows", async () => {
    reads.length = 0;
    const flags = await canReachOutMany({
      userId: USER,
      campaignId: CAMPAIGN,
      shows: [{ showId: SHOW }, { showId: "rec-1" }, { podscanId: "pod-1" }],
    });
    expect(flags).toEqual([true, false, false]);
    expect(reads.filter((table) => table === "campaigns")).toHaveLength(1);
    expect(await pitchableShowIds(USER, [SHOW, "not-a-uuid"])).toEqual(new Set([SHOW]));
  });
});
