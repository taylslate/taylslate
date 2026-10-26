import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { createShow, claimShow, getUserProfile, getUser, getAllShows, getShowsFiltered, isShowsAdmin, from, ties } =
  vi.hoisted(() => ({
    createShow: vi.fn(),
    claimShow: vi.fn(),
    getUserProfile: vi.fn(),
    getUser: vi.fn(),
    getAllShows: vi.fn(),
    getShowsFiltered: vi.fn(),
    isShowsAdmin: vi.fn(),
    from: vi.fn(),
    ties: vi.fn(),
  }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));

vi.mock("@/lib/data/queries", () => ({
  getShowsFiltered,
  getAllShows,
  createShow,
  claimShow,
  getUserProfile,
}));

vi.mock("@/lib/shows/can-edit-show", () => ({
  isShowsAdmin,
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: (...args: unknown[]) => from(...args) },
}));

vi.mock("@/lib/shows/apply-geography", () => ({
  getVerifiedProfileTies: (...args: unknown[]) => ties(...args),
}));

import { GET, POST } from "./route";

function call(extra: Record<string, unknown> = {}) {
  return POST(
    new NextRequest("http://x/api/shows", {
      method: "POST",
      body: JSON.stringify({
        name: "Night Desk",
        platform: "podcast",
        is_discoverable: true,
        is_verified: true,
        is_claimed: true,
        podscan_id: "pod-1",
        agent_id: "someone-else",
        ...extra,
      }),
    })
  );
}

const SHOW = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const PROFILE = "44444444-4444-4444-8444-444444444444";

function catalogShow(id: string, email: string) {
  return {
    id,
    name: id === SHOW ? "Night Desk" : "Bare",
    platform: "podcast" as const,
    audience_size: id === SHOW ? 12000 : 800,
    categories: id === SHOW ? ["News"] : [],
    image_url: id === SHOW ? "https://img.test/night.png" : "",
    description: id === SHOW ? "Evening news" : "",
    contact: { name: "Host", email, method: "email" as const },
    rate_card: { midroll_cpm: 25 },
    demographics: { hhi_50k_plus: 40 },
    current_sponsors: ["Acme"],
    available_slots: 2,
    podscan_id: "pd_secret",
    data_sources: ["show_owner"],
  };
}

function chain(result: { data: unknown; error: null }) {
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
}) {
  from.mockImplementation((table: unknown) => {
    if (table === "show_profiles") {
      return chain({ data: opts.profile ?? null, error: null });
    }
    if (table === "deals") {
      return chain({ data: opts.deals ?? [], error: null });
    }
    return chain({ data: null, error: null });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "agent-1" } } });
  getUserProfile.mockResolvedValue({ role: "agent" });
  isShowsAdmin.mockResolvedValue(false);
  createShow.mockResolvedValue({ id: "show-1", name: "Night Desk" });
  claimShow.mockResolvedValue({ id: "rel-1" });
  ties.mockResolvedValue([]);
  admin({});
});

describe("GET /api/shows", () => {
  it("returns 401 when signed out", async () => {
    getUser.mockResolvedValueOnce({ data: { user: null } });
    const res = await GET(new NextRequest("http://x/api/shows"));
    expect(res.status).toBe(401);
    expect(getAllShows).not.toHaveBeenCalled();
    expect(ties).not.toHaveBeenCalled();
  });

  it("returns public fields only for a brand with no tie", async () => {
    getUser.mockResolvedValueOnce({ data: { user: { id: "brand-1" } } });
    getUserProfile.mockResolvedValueOnce({ role: "brand" });
    const catalog = [
      catalogShow(SHOW, "host@show.test"),
      catalogShow(OTHER, "other@show.test"),
    ];
    getAllShows.mockResolvedValueOnce(catalog);
    const res = await GET(new NextRequest("http://x/api/shows"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([
      {
        id: SHOW,
        name: "Night Desk",
        platform: "podcast",
        audience_size: 12000,
        categories: ["News"],
        image_url: "https://img.test/night.png",
        description: "Evening news",
      },
      {
        id: OTHER,
        name: "Bare",
        platform: "podcast",
        audience_size: 800,
        categories: [],
      },
    ]);
    const encoded = JSON.stringify(body);
    expect(encoded).not.toContain("host@show.test");
    expect(encoded).not.toContain("other@show.test");
    expect(encoded).not.toContain("rate_card");
    expect(encoded).not.toContain("midroll_cpm");
    expect(encoded).not.toContain("pd_secret");
    const identity = ties.mock.calls[0][0][0] as Record<string, unknown>;
    expect(identity).not.toHaveProperty("podscanId");
  });

  it("returns the full row for a show the caller owns", async () => {
    getUser.mockResolvedValueOnce({ data: { user: { id: "show-user" } } });
    getUserProfile.mockResolvedValueOnce({ role: "show" });
    const owned = catalogShow(SHOW, "host@show.test");
    const other = catalogShow(OTHER, "other@show.test");
    getAllShows.mockResolvedValueOnce([owned, other]);
    admin({ profile: { id: PROFILE } });
    ties.mockResolvedValue([{ showId: SHOW, profileId: PROFILE }]);

    const res = await GET(new NextRequest("http://x/api/shows"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body[0]).toEqual(owned);
    expect(body[0].contact.email).toBe("host@show.test");
    expect(body[0].rate_card).toEqual({ midroll_cpm: 25 });
    expect(body[1]).not.toHaveProperty("contact");
    expect(body[1]).not.toHaveProperty("rate_card");
    expect(JSON.stringify(body[1])).not.toContain("other@show.test");
  });

  it("returns the full row for a verified rep's own roster", async () => {
    getUser.mockResolvedValueOnce({ data: { user: { id: "rep-1" } } });
    getUserProfile.mockResolvedValueOnce({ role: "agent" });
    const roster = [catalogShow(SHOW, "host@show.test")];
    getShowsFiltered.mockResolvedValueOnce(roster);

    const res = await GET(new NextRequest("http://x/api/shows?limit=50"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(roster);
    expect(getShowsFiltered).toHaveBeenCalledWith(
      expect.objectContaining({ agent_id: "rep-1", limit: 50 })
    );
    expect(getAllShows).not.toHaveBeenCalled();
    expect(ties).not.toHaveBeenCalled();
  });

  it("keeps a requested limit of 50 for a brand", async () => {
    getUser.mockResolvedValueOnce({ data: { user: { id: "brand-1" } } });
    getUserProfile.mockResolvedValueOnce({ role: "brand" });
    getShowsFiltered.mockResolvedValueOnce([]);
    const res = await GET(new NextRequest("http://x/api/shows?limit=50"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
    expect(getShowsFiltered).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 50 })
    );
    expect(getShowsFiltered.mock.calls[0][0]).not.toHaveProperty("agent_id");
    expect(getAllShows).not.toHaveBeenCalled();
  });

  it("returns the full row for a show the brand already has a deal on", async () => {
    getUser.mockResolvedValueOnce({ data: { user: { id: "brand-1" } } });
    getUserProfile.mockResolvedValueOnce({ role: "brand" });
    const tied = catalogShow(SHOW, "host@show.test");
    const open = catalogShow(OTHER, "other@show.test");
    getAllShows.mockResolvedValueOnce([tied, open]);
    admin({ deals: [{ show_id: SHOW, brand_id: "brand-1" }] });

    const res = await GET(new NextRequest("http://x/api/shows"));
    const body = await res.json();
    expect(body[0]).toEqual(tied);
    expect(body[1]).not.toHaveProperty("rate_card");
    expect(body[1]).not.toHaveProperty("contact");
  });
});

describe("POST /api/shows", () => {
  it("returns 403 for a brand and does not create a show", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "brand-1" } } });
    getUserProfile.mockResolvedValue({ role: "brand" });
    const res = await call();
    expect(res.status).toBe(403);
    expect(createShow).not.toHaveBeenCalled();
    expect(claimShow).not.toHaveBeenCalled();
  });

  it("creates an agent's show as not discoverable and ignores privilege fields", async () => {
    const res = await call();
    expect(res.status).toBe(201);
    expect(createShow).toHaveBeenCalledTimes(1);
    const [payload, options] = createShow.mock.calls[0];
    expect(payload.is_discoverable).toBe(false);
    expect(payload.agent_id).toBe("agent-1");
    expect(payload).not.toHaveProperty("is_verified");
    expect(payload).not.toHaveProperty("is_claimed");
    expect(payload).not.toHaveProperty("podscan_id");
    expect(options).toEqual({ actor: { userId: "agent-1", admin: false } });
  });

  it("reports a roster-link failure instead of returning the show as created", async () => {
    claimShow.mockRejectedValue(new Error("insert failed"));
    const res = await call();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/roster link failed/i);
    expect(body.error).toMatch(/insert failed/);
    expect(body.show.id).toBe("show-1");
    expect(claimShow).toHaveBeenCalledWith("show-1", undefined);
  });
});
