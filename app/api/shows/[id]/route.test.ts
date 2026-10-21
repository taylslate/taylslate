import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getShowById, updateShow, getAgentShowRelationship, getUserProfile, getUser } =
  vi.hoisted(() => ({
    getShowById: vi.fn(),
    updateShow: vi.fn(),
    getAgentShowRelationship: vi.fn(),
    getUserProfile: vi.fn(),
    getUser: vi.fn(),
  }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));

vi.mock("@/lib/data/queries", () => ({
  getShowById,
  updateShow,
  getAgentShowRelationship,
  getUserProfile,
}));

import { PATCH } from "./route";

function call() {
  return PATCH(
    new NextRequest("http://x/api/shows/show-1", {
      method: "PATCH",
      body: JSON.stringify({ description: "updated" }),
    }),
    { params: Promise.resolve({ id: "show-1" }) }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "agent-1" } } });
  getUserProfile.mockResolvedValue({ role: "agent" });
  getShowById.mockResolvedValue({ id: "show-1", name: "Night Desk" });
  updateShow.mockResolvedValue({ id: "show-1", description: "updated" });
});

describe("PATCH /api/shows/[id]", () => {
  it("rejects an agent whose only link is pending", async () => {
    // getAgentShowRelationship is the approved-only read. A pending row
    // comes back as no relationship, so the edit is refused.
    getAgentShowRelationship.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(403);
    expect(updateShow).not.toHaveBeenCalled();
    expect(getAgentShowRelationship).toHaveBeenCalledWith("agent-1", "show-1");
  });
});
