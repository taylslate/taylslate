import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getShowById, updateShow, getUser, canEditShow, isShowsAdmin, from, ties } =
  vi.hoisted(() => ({
    getShowById: vi.fn(),
    updateShow: vi.fn(),
    getUser: vi.fn(),
    canEditShow: vi.fn(),
    isShowsAdmin: vi.fn(),
    from: vi.fn(),
    ties: vi.fn(),
  }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));

vi.mock("@/lib/data/queries", () => ({
  getShowById,
  updateShow,
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: (...args: unknown[]) => from(...args) },
}));

vi.mock("@/lib/shows/apply-geography", () => ({
  getVerifiedProfileTies: (...args: unknown[]) => ties(...args),
}));

vi.mock("@/lib/shows/can-edit-show", () => ({
  canEditShow,
  isShowsAdmin,
  showWritePatch: (body: Record<string, unknown>, admin: boolean) => {
    const next = { ...body };
    delete next.id;
    delete next.created_at;
    if (!admin) {
      for (const field of [
        "agent_id",
        "is_verified",
        "is_claimed",
        "podscan_id",
        "is_discoverable",
      ]) {
        delete next[field];
      }
    }
    return next;
  },
}));

import { GET, PATCH } from "./route";

function call() {
  return PATCH(
    new NextRequest("http://x/api/shows/show-1", {
      method: "PATCH",
      body: JSON.stringify({ description: "updated" }),
    }),
    { params: Promise.resolve({ id: "show-1" }) }
  );
}

const SHOW = "22222222-2222-4222-8222-222222222222";
const PROFILE = "44444444-4444-4444-8444-444444444444";

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
  roster?: Array<{ show_id: string; status: string }>;
}) {
  from.mockImplementation((table: unknown) => {
    if (table === "show_profiles") return chain({ data: opts.profile ?? null, error: null });
    if (table === "deals") return chain({ data: opts.deals ?? [], error: null });
    if (table === "agent_show_relationships") {
      return chain({ data: opts.roster ?? [], error: null });
    }
    return chain({ data: null, error: null });
  });
}

function catalogShow() {
  return {
    id: SHOW,
    name: "Night Desk",
    platform: "podcast" as const,
    audience_size: 12000,
    categories: ["News"],
    image_url: "https://img.test/night.png",
    description: "Evening news",
    is_discoverable: true,
    contact: { name: "Host", email: "host@show.test", method: "email" as const },
    rate_card: { midroll_cpm: 25 },
    demographics: { hhi_100k_plus: 12 },
    current_sponsors: ["Acme"],
    available_slots: 3,
    podscan_id: "pd_secret",
    data_sources: ["show_owner"],
  };
}

function getShow() {
  return GET(new NextRequest(`http://x/api/shows/${SHOW}`), {
    params: Promise.resolve({ id: SHOW }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "agent-1" } } });
  getShowById.mockResolvedValue({ id: "show-1", name: "Night Desk", is_discoverable: true });
  updateShow.mockResolvedValue({ id: "show-1", description: "updated" });
  canEditShow.mockResolvedValue(false);
  isShowsAdmin.mockResolvedValue(false);
  ties.mockResolvedValue([]);
  admin({});
});

describe("GET /api/shows/[id]", () => {
  it("returns 401 when signed out and does not read the show", async () => {
    getUser.mockResolvedValueOnce({ data: { user: null } });
    const res = await GET(new NextRequest("http://x/api/shows/show-1"), {
      params: Promise.resolve({ id: "show-1" }),
    });
    expect(res.status).toBe(401);
    expect(getShowById).not.toHaveBeenCalled();
    expect(ties).not.toHaveBeenCalled();
  });

  it("returns public fields for a brand with no tie", async () => {
    getUser.mockResolvedValueOnce({ data: { user: { id: "brand-1" } } });
    const show = catalogShow();
    getShowById.mockResolvedValueOnce(show);
    const res = await getShow();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      show: {
        id: SHOW,
        name: "Night Desk",
        platform: "podcast",
        audience_size: 12000,
        categories: ["News"],
        image_url: "https://img.test/night.png",
        description: "Evening news",
      },
    });
    const identity = ties.mock.calls[0][0][0] as Record<string, unknown>;
    expect(identity).not.toHaveProperty("podscanId");
    expect(identity).not.toHaveProperty("podscan_id");
  });

  it("returns the full row for the owner", async () => {
    getUser.mockResolvedValueOnce({ data: { user: { id: "show-user" } } });
    const show = catalogShow();
    getShowById.mockResolvedValueOnce(show);
    admin({ profile: { id: PROFILE } });
    ties.mockResolvedValue([{ showId: SHOW, profileId: PROFILE }]);
    const res = await getShow();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ show });
  });

  it("returns the full row for a verified rep", async () => {
    getUser.mockResolvedValueOnce({ data: { user: { id: "rep-1" } } });
    const show = catalogShow();
    getShowById.mockResolvedValueOnce(show);
    admin({ roster: [{ show_id: SHOW, status: "approved" }] });
    const res = await getShow();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ show });
  });

  it("returns 404 for a hidden show when the caller is not the creator or an admin", async () => {
    getShowById.mockResolvedValueOnce({
      id: "show-1",
      name: "Night Desk",
      is_discoverable: false,
      agent_id: "agent-9",
    });
    const res = await GET(new NextRequest("http://x/api/shows/show-1"), {
      params: Promise.resolve({ id: "show-1" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns a hidden show to the creating agent as public fields without a tie", async () => {
    const hidden = {
      id: "show-1",
      name: "Night Desk",
      is_discoverable: false,
      agent_id: "agent-1",
      contact: { email: "hidden@show.test" },
      rate_card: { midroll_cpm: 30 },
    };
    getShowById.mockResolvedValueOnce(hidden);
    const res = await GET(new NextRequest("http://x/api/shows/show-1"), {
      params: Promise.resolve({ id: "show-1" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      show: {
        id: "show-1",
        name: "Night Desk",
        platform: "podcast",
        audience_size: 0,
        categories: [],
      },
    });
    expect(JSON.stringify(body)).not.toContain("hidden@show.test");
    expect(JSON.stringify(body)).not.toContain("midroll_cpm");
    expect(isShowsAdmin).not.toHaveBeenCalled();
  });

  it("returns a hidden show to an admin who did not create it as public fields", async () => {
    const hidden = {
      id: "show-1",
      name: "Night Desk",
      is_discoverable: false,
      agent_id: "agent-9",
      contact: { email: "hidden@show.test" },
      rate_card: { midroll_cpm: 30 },
    };
    getShowById.mockResolvedValueOnce(hidden);
    isShowsAdmin.mockResolvedValueOnce(true);
    const res = await GET(new NextRequest("http://x/api/shows/show-1"), {
      params: Promise.resolve({ id: "show-1" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      show: {
        id: "show-1",
        name: "Night Desk",
        platform: "podcast",
        audience_size: 0,
        categories: [],
      },
    });
    expect(JSON.stringify(body)).not.toContain("hidden@show.test");
    expect(isShowsAdmin).toHaveBeenCalledWith("agent-1");
  });
});

describe("PATCH /api/shows/[id]", () => {
  it("rejects a caller who does not own the show", async () => {
    const res = await call();
    expect(res.status).toBe(403);
    expect(updateShow).not.toHaveBeenCalled();
    expect(canEditShow).toHaveBeenCalledWith("agent-1", "show-1");
  });

  it("updates for the owner and drops admin-only columns", async () => {
    canEditShow.mockResolvedValue(true);
    const res = await PATCH(
      new NextRequest("http://x/api/shows/show-1", {
        method: "PATCH",
        body: JSON.stringify({
          description: "updated",
          agent_id: "other",
          is_discoverable: false,
          id: "nope",
        }),
      }),
      { params: Promise.resolve({ id: "show-1" }) }
    );
    expect(res.status).toBe(200);
    expect(updateShow).toHaveBeenCalledWith("show-1", { description: "updated" });
  });

  it("keeps admin-only columns for an admin", async () => {
    canEditShow.mockResolvedValue(true);
    isShowsAdmin.mockResolvedValue(true);
    const res = await PATCH(
      new NextRequest("http://x/api/shows/show-1", {
        method: "PATCH",
        body: JSON.stringify({ description: "updated", agent_id: "other" }),
      }),
      { params: Promise.resolve({ id: "show-1" }) }
    );
    expect(res.status).toBe(200);
    expect(updateShow).toHaveBeenCalledWith("show-1", {
      description: "updated",
      agent_id: "other",
    });
  });
});
