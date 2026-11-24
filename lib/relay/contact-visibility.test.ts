import { beforeEach, describe, expect, it, vi } from "vitest";

const isShowsAdmin = vi.fn();
const showEditGrantIds = vi.fn();

const tables: Record<string, Array<Record<string, unknown>>> = {};
let failTable: string | null = null;
const inSizes: number[] = [];

vi.mock("@/lib/shows/can-edit-show", () => ({
  isShowsAdmin: (...args: unknown[]) => isShowsAdmin(...args),
}));

vi.mock("@/lib/ownership/edit-rights", () => ({
  showEditGrantIds: (...args: unknown[]) => showEditGrantIds(...args),
}));

function from(table: string) {
  const filters: Array<{ op: "eq" | "in"; column: string; value: unknown }> = [];
  const run = () => {
    if (failTable === table) return { data: null, error: { code: "XX000", message: "secret host@example.test" } };
    const rows = (tables[table] ?? []).filter((row) =>
      filters.every((filter) => {
        if (filter.op === "eq") return row[filter.column] === filter.value;
        return (filter.value as unknown[]).includes(row[filter.column]);
      })
    );
    return { data: rows, error: null };
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
      inSizes.push(value.length);
      return api;
    },
    then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve(run()).then(resolve, reject);
    },
  };
  return api;
}

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: (table: string) => from(table) },
}));

import {
  attachVisibleOutreachEmails,
  attachVisibleShowContacts,
  contactVisibleShowIds,
  redactCampaignContacts,
  redactConvictionUniverse,
  redactScoredShowRecord,
  redactShowContact,
  redactTieredUniverse,
} from "./contact-visibility";

const USER = "11111111-1111-4111-8111-111111111111";
const SHOW = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";
const PROFILE = "55555555-5555-4555-8555-555555555555";

const signed = {
  show_signed_at: "2026-11-02",
  brand_signed_at: "2026-11-01",
  status: "show_signed",
};

describe("contactVisibleShowIds", () => {
  beforeEach(() => {
    isShowsAdmin.mockResolvedValue(false);
    showEditGrantIds.mockResolvedValue(new Set());
    failTable = null;
    tables.brand_profiles = [{ id: PROFILE, user_id: USER }];
    tables.agent_show_relationships = [];
    tables.deals = [];
  });

  it("shows the email to an admin, an owner, and a roster agent", async () => {
    isShowsAdmin.mockResolvedValue(true);
    expect(await contactVisibleShowIds(USER, [SHOW, OTHER])).toEqual(new Set([SHOW, OTHER]));

    isShowsAdmin.mockResolvedValue(false);
    showEditGrantIds.mockResolvedValue(new Set([SHOW]));
    expect(await contactVisibleShowIds(USER, [SHOW, OTHER])).toEqual(new Set([SHOW]));

    showEditGrantIds.mockResolvedValue(new Set());
    tables.agent_show_relationships = [{ show_id: SHOW, agent_id: USER, status: "approved" }];
    expect(await contactVisibleShowIds(USER, [SHOW])).toEqual(new Set([SHOW]));
  });

  it("unlocks only this caller's signed deal and not another show or brand", async () => {
    tables.deals = [
      { show_id: SHOW, brand_id: USER, ...signed },
      { show_id: OTHER, brand_id: USER, status: "planning", show_signed_at: null, brand_signed_at: null },
      { show_id: OTHER, brand_id: "someone-else", ...signed },
    ];
    expect(await contactVisibleShowIds(USER, [SHOW, OTHER])).toEqual(new Set([SHOW]));

    tables.deals = [{ show_id: SHOW, agency_id: USER, ...signed }];
    expect(await contactVisibleShowIds(USER, [SHOW])).toEqual(new Set([SHOW]));

    tables.deals = [{ show_id: SHOW, brand_profile_id: PROFILE, ...signed }];
    expect(await contactVisibleShowIds(USER, [SHOW])).toEqual(new Set([SHOW]));
  });

  it("hides the email for unsigned, one-sided, cancelled, and failed reads", async () => {
    const cases = [
      { show_id: SHOW, brand_id: USER, status: "planning", show_signed_at: null, brand_signed_at: null },
      { show_id: SHOW, brand_id: USER, status: "brand_signed", show_signed_at: null, brand_signed_at: "2026-11-01" },
      { show_id: SHOW, brand_id: USER, status: "show_signed", show_signed_at: "2026-11-02", brand_signed_at: null },
      { show_id: SHOW, brand_id: USER, show_signed_at: signed.show_signed_at, brand_signed_at: signed.brand_signed_at, status: "cancelled" },
    ];
    for (const row of cases) {
      tables.deals = [row];
      expect(await contactVisibleShowIds(USER, [SHOW])).toEqual(new Set());
    }
    tables.deals = [{ show_id: SHOW, brand_id: USER, ...signed }];
    failTable = "deals";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await contactVisibleShowIds(USER, [SHOW])).toEqual(new Set());
    expect(warn.mock.calls.flat().join(" ")).not.toContain("host@example.test");
    warn.mockRestore();
  });
});

describe("redaction helpers", () => {
  const show = { id: SHOW, contact: { name: "Ada", email: "host@example.test", method: "email" } };

  it("blanks contact email and keeps name and method", () => {
    expect(redactShowContact(show).contact).toEqual({ name: "Ada", email: "", method: "email" });
    expect(redactScoredShowRecord({ podcastId: SHOW, contactEmail: "host@example.test" }).contactEmail).toBeNull();
    const campaign = redactCampaignContacts({
      recommendations: [{ show_id: SHOW, contact_email: "host@example.test", show_name: "Daily" }],
      youtube_recommendations: [],
      expansion_opportunities: [{ contact_email: "host@example.test" }],
      outreach_drafts: [{ contact_email: "host@example.test", subject: "Hi" }],
      scored_shows: [{ podcastId: SHOW, contactEmail: "host@example.test", name: "Daily" }],
      name: "Spring",
    });
    expect(JSON.stringify(campaign)).not.toContain("host@example.test");
    expect(campaign.name).toBe("Spring");
    expect(campaign.recommendations[0].show_name).toBe("Daily");
  });

  it("redacts nested shows that are not visible", () => {
    const tiered = redactTieredUniverse(
      {
        test: [{ showId: SHOW, show }],
        scale: [{ showId: OTHER, show: { ...show, id: OTHER } }],
        bench: [],
      },
      new Set([SHOW])
    );
    expect(tiered.test[0].show?.contact?.email).toBe("host@example.test");
    expect(tiered.scale[0].show?.contact?.email).toBe("");
    const universe = redactConvictionUniverse(
      { groups: [{ shows: [{ show }] }] },
      new Set()
    );
    expect(universe.groups[0].shows[0].show?.contact?.email).toBe("");
  });
});

describe("attachVisibleShowContacts", () => {
  beforeEach(() => {
    failTable = null;
    inSizes.length = 0;
    tables.shows = [];
    tables.outreaches = [];
  });

  function show(id: string, email = "") {
    return { id, contact: { name: "Ada", email, method: "email" as const } };
  }

  it("fills only visible ids and ignores non-uuids", async () => {
    tables.shows = [
      { id: SHOW, contact_email: "host@example.test" },
      { id: OTHER, contact_email: "other@example.test" },
    ];
    const input = [show(SHOW), show(OTHER, ""), show("not-a-uuid", "")];
    const out = await attachVisibleShowContacts(input, new Set([SHOW, "not-a-uuid"]));
    expect(out[0].contact.email).toBe("host@example.test");
    expect(out[1].contact.email).toBe("");
    expect(out[2].contact.email).toBe("");
    expect(input[0].contact.email).toBe("");
    expect(inSizes).toEqual([1]);
  });

  it("returns the input unchanged and logs only the code when the read fails", async () => {
    failTable = "shows";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const input = [show(SHOW, "")];
    const out = await attachVisibleShowContacts(input, new Set([SHOW]));
    expect(out).toBe(input);
    expect(out[0].contact.email).toBe("");
    const logged = warn.mock.calls.flat().join(" ");
    expect(logged).toContain("[relay] attach contact");
    expect(logged).toContain("XX000");
    expect(logged).not.toContain("host@example.test");
    warn.mockRestore();
  });

  it("chunks ids past 80", async () => {
    const ids = Array.from({ length: 81 }, (_, index) => {
      const tail = index.toString(16).padStart(12, "0");
      return `11111111-1111-4111-8111-${tail}`;
    });
    tables.shows = ids.map((id) => ({ id, contact_email: "host@example.test" }));
    const out = await attachVisibleShowContacts(
      ids.map((id) => show(id)),
      new Set(ids)
    );
    expect(inSizes).toEqual([80, 1]);
    expect(out[0].contact.email).toBe("host@example.test");
    expect(out[80].contact.email).toBe("host@example.test");
  });

  it("fills sent_to_email only for visible outreach rows", async () => {
    tables.outreaches = [
      { id: SHOW, sent_to_email: "host@example.test" },
      { id: OTHER, sent_to_email: "other@example.test" },
    ];
    const out = await attachVisibleOutreachEmails(
      [{ id: SHOW }, { id: OTHER }],
      new Set([SHOW])
    );
    expect(out[0]).toMatchObject({ id: SHOW, sent_to_email: "host@example.test" });
    expect(out[1]).toEqual({ id: OTHER });
  });
});
