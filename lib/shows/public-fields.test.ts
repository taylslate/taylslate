import { beforeEach, describe, expect, it, vi } from "vitest";

const { from, ties } = vi.hoisted(() => ({
  from: vi.fn(),
  ties: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: (...args: unknown[]) => from(...args) },
}));

vi.mock("@/lib/shows/apply-geography", () => ({
  getVerifiedProfileTies: (...args: unknown[]) => ties(...args),
}));

import {
  fullShowIdsForCaller,
  projectShows,
  PUBLIC_SHOW_FIELDS,
  toPublicShowFields,
} from "./public-fields";

const USER = "11111111-1111-4111-8111-111111111111";
const SHOW = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const PROFILE = "44444444-4444-4444-8444-444444444444";

const secretShow = {
  id: SHOW,
  name: "Night Desk",
  platform: "podcast" as const,
  audience_size: 12000,
  categories: ["News", 3],
  image_url: "https://img.test/night.png",
  description: "Evening news",
  contact: { name: "Host", email: "host@show.test", method: "email" },
  rate_card: { midroll_cpm: 25 },
  demographics: { hhi_50k_plus: 40 },
  current_sponsors: ["Acme"],
  available_slots: 2,
  agent_id: "agent-secret",
  podscan_id: "pd_secret",
  data_sources: ["show_owner"],
  price_type: "cpm",
  min_buy: 500,
};

function chain(result: { data: unknown; error: { message: string } | null }) {
  const builder: Record<string, unknown> = {};
  const self = () => builder;
  builder.select = self;
  builder.eq = self;
  builder.in = self;
  builder.maybeSingle = async () => result;
  builder.then = (
    resolve: (value: unknown) => unknown,
    reject?: (reason: unknown) => unknown
  ) => Promise.resolve(result).then(resolve, reject);
  return builder;
}

function admin(opts: {
  profile?: { id: string } | null;
  deals?: Array<{ show_id: string; brand_id?: string; agency_id?: string }>;
  roster?: Array<{ show_id: string; status: string }>;
}) {
  from.mockImplementation((table: unknown) => {
    if (table === "show_profiles") {
      return chain({ data: opts.profile ?? null, error: null });
    }
    if (table === "deals") {
      return chain({ data: opts.deals ?? [], error: null });
    }
    if (table === "agent_show_relationships") {
      return chain({ data: opts.roster ?? [], error: null });
    }
    return chain({ data: null, error: null });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  ties.mockResolvedValue([]);
  admin({});
});

describe("toPublicShowFields", () => {
  it("returns the allowlist and drops contact and rate card", () => {
    const pub = toPublicShowFields(secretShow);
    expect(Object.keys(pub).sort()).toEqual(
      [...PUBLIC_SHOW_FIELDS, "description", "image_url"].sort()
    );
    expect(pub).toEqual({
      id: SHOW,
      name: "Night Desk",
      platform: "podcast",
      audience_size: 12000,
      categories: ["News"],
      image_url: "https://img.test/night.png",
      description: "Evening news",
    });
    expect(JSON.stringify(pub)).not.toContain("host@show.test");
    expect(JSON.stringify(pub)).not.toContain("midroll_cpm");
    expect(JSON.stringify(pub)).not.toContain("pd_secret");
  });

  it("omits image and description when they are missing or blank", () => {
    const pub = toPublicShowFields({
      id: OTHER,
      name: "Bare",
      platform: "youtube",
      audience_size: 40,
      categories: [],
      description: "   ",
      image_url: "",
      rate_card: { flat_rate: 900 },
      contact: { email: "other@show.test" },
    });
    expect(pub).toEqual({
      id: OTHER,
      name: "Bare",
      platform: "youtube",
      audience_size: 40,
      categories: [],
    });
    expect(pub).not.toHaveProperty("image_url");
    expect(pub).not.toHaveProperty("description");
    expect(pub).not.toHaveProperty("rate_card");
    expect(pub).not.toHaveProperty("contact");
  });
});

describe("projectShows", () => {
  it("returns the original show only for ids in the full set", () => {
    const other = { ...secretShow, id: OTHER, name: "Bare", image_url: "", description: "" };
    const projected = projectShows([secretShow, other], new Set([SHOW]));
    expect(projected[0]).toBe(secretShow);
    expect(projected[1]).toEqual({
      id: OTHER,
      name: "Bare",
      platform: "podcast",
      audience_size: 12000,
      categories: ["News"],
    });
  });
});

describe("fullShowIdsForCaller", () => {
  it("returns nothing for a brand with no tie and does not pass podscan id", async () => {
    const ids = await fullShowIdsForCaller(USER, [secretShow]);
    expect(ids).toEqual(new Set());
    expect(ties).toHaveBeenCalledTimes(1);
    const identity = ties.mock.calls[0][0][0] as Record<string, unknown>;
    expect(identity).toEqual({
      showId: SHOW,
      contactEmail: "host@show.test",
      dataSources: ["show_owner"],
    });
    expect(identity).not.toHaveProperty("podscanId");
    expect(identity).not.toHaveProperty("podscan_id");
    expect(JSON.stringify(ties.mock.calls)).not.toContain("pd_secret");
  });

  it("includes the show when the caller's show profile is the verified tie", async () => {
    admin({ profile: { id: PROFILE } });
    ties.mockResolvedValue([{ showId: SHOW, profileId: PROFILE }]);
    expect(await fullShowIdsForCaller(USER, [secretShow])).toEqual(new Set([SHOW]));

    ties.mockResolvedValue([{ showId: SHOW, profileId: "someone-else" }]);
    expect(await fullShowIdsForCaller(USER, [secretShow])).toEqual(new Set());
  });

  it("includes a show the brand or agency already has a deal on", async () => {
    admin({
      deals: [{ show_id: SHOW, brand_id: USER }],
    });
    expect(await fullShowIdsForCaller(USER, [secretShow])).toEqual(new Set([SHOW]));

    admin({
      deals: [{ show_id: SHOW, agency_id: USER }],
    });
    expect(await fullShowIdsForCaller(USER, [secretShow])).toEqual(new Set([SHOW]));

    admin({
      deals: [{ show_id: SHOW, brand_id: "other-brand" }],
    });
    expect(await fullShowIdsForCaller(USER, [secretShow])).toEqual(new Set());
  });

  it("includes an approved roster show and skips a pending link", async () => {
    admin({
      roster: [
        { show_id: SHOW, status: "approved" },
        { show_id: OTHER, status: "pending" },
      ],
    });
    expect(
      await fullShowIdsForCaller(USER, [secretShow, { ...secretShow, id: OTHER }])
    ).toEqual(new Set([SHOW]));
  });
});
