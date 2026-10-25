import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { createShow, claimShow, getUserProfile, getUser, getAllShows, getShowsFiltered, isShowsAdmin } =
  vi.hoisted(() => ({
    createShow: vi.fn(),
    claimShow: vi.fn(),
    getUserProfile: vi.fn(),
    getUser: vi.fn(),
    getAllShows: vi.fn(),
    getShowsFiltered: vi.fn(),
    isShowsAdmin: vi.fn(),
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

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "agent-1" } } });
  getUserProfile.mockResolvedValue({ role: "agent" });
  isShowsAdmin.mockResolvedValue(false);
  createShow.mockResolvedValue({ id: "show-1", name: "Night Desk" });
  claimShow.mockResolvedValue({ id: "rel-1" });
});

describe("GET /api/shows", () => {
  it("returns 401 when signed out", async () => {
    getUser.mockResolvedValueOnce({ data: { user: null } });
    const res = await GET(new NextRequest("http://x/api/shows"));
    expect(res.status).toBe(401);
    expect(getAllShows).not.toHaveBeenCalled();
  });

  it("returns the full catalog, including contact and rate card, for a brand", async () => {
    getUser.mockResolvedValueOnce({ data: { user: { id: "brand-1" } } });
    getUserProfile.mockResolvedValueOnce({ role: "brand" });
    const catalog = [
      {
        id: "show-1",
        name: "Night Desk",
        contact: { name: "Host", email: "host@show.test", method: "email" },
        rate_card: { midroll_cpm: 25 },
        demographics: { hhi_50k_plus: 40 },
        current_sponsors: ["Acme"],
        available_slots: 2,
      },
    ];
    getAllShows.mockResolvedValueOnce(catalog);
    const res = await GET(new NextRequest("http://x/api/shows"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(catalog);
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
