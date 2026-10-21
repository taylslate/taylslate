import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { createShow, claimShow, getUserProfile, getUser } = vi.hoisted(() => ({
  createShow: vi.fn(),
  claimShow: vi.fn(),
  getUserProfile: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));

vi.mock("@/lib/data/queries", () => ({
  getShowsFiltered: vi.fn(),
  getAllShows: vi.fn(),
  createShow,
  claimShow,
  getUserProfile,
}));

import { POST } from "./route";

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
