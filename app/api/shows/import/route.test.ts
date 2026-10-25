import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getUser, getUserProfile, importShows, isShowsAdmin } = vi.hoisted(() => ({
  getUser: vi.fn(),
  getUserProfile: vi.fn(),
  importShows: vi.fn(),
  isShowsAdmin: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));

vi.mock("@/lib/data/queries", () => ({
  getUserProfile,
  importShows,
}));

vi.mock("@/lib/shows/can-edit-show", () => ({
  isShowsAdmin,
}));

import { POST } from "./route";

function call() {
  return POST(
    new NextRequest("http://x/api/shows/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        shows: [{ name: "Night Desk", platform: "podcast" }],
      }),
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  getUserProfile.mockResolvedValue({ role: "brand", email: "brand@taylslate.com" });
  isShowsAdmin.mockResolvedValue(false);
  importShows.mockResolvedValue({ imported: [], skipped: [], errors: [] });
});

describe("POST /api/shows/import", () => {
  it("returns 401 when signed out", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await call();
    expect(res.status).toBe(401);
    expect(importShows).not.toHaveBeenCalled();
  });

  it("returns 403 for a brand and allows an agent or an admin", async () => {
    const brand = await call();
    expect(brand.status).toBe(403);
    expect(importShows).not.toHaveBeenCalled();

    getUserProfile.mockResolvedValue({ role: "agent", email: "rep@taylslate.com" });
    const agent = await call();
    expect(agent.status).toBe(200);
    expect(importShows).toHaveBeenCalledTimes(1);

    getUserProfile.mockResolvedValue({ role: "brand", email: "ops@taylslate.com" });
    isShowsAdmin.mockResolvedValue(true);
    const admin = await call();
    expect(admin.status).toBe(200);
    expect(importShows).toHaveBeenCalledTimes(2);
  });
});
