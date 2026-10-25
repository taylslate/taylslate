import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { createShow, claimShow, getUserProfile, getUser, getAllShows, getShowsFiltered } =
  vi.hoisted(() => ({
    createShow: vi.fn(),
    claimShow: vi.fn(),
    getUserProfile: vi.fn(),
    getUser: vi.fn(),
    getAllShows: vi.fn(),
    getShowsFiltered: vi.fn(),
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

import { GET, POST } from "./route";

function call() {
  return POST(
    new NextRequest("http://x/api/shows", {
      method: "POST",
      body: JSON.stringify({ name: "Night Desk", platform: "podcast" }),
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "agent-1" } } });
  getUserProfile.mockResolvedValue({ role: "agent" });
  createShow.mockResolvedValue({ id: "show-1", name: "Night Desk" });
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
