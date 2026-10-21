import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  claimShow,
  getAgentShowRelationshipAnyStatus,
  getShowById,
  getUserProfile,
  getUser,
} = vi.hoisted(() => ({
  claimShow: vi.fn(),
  getAgentShowRelationshipAnyStatus: vi.fn(),
  getShowById: vi.fn(),
  getUserProfile: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));

vi.mock("@/lib/data/queries", () => ({
  claimShow,
  getAgentShowRelationshipAnyStatus,
  getShowById,
  getUserProfile,
}));

import { POST } from "./route";

function call() {
  return POST(new NextRequest("http://x/api/shows/show-1/claim", { method: "POST" }), {
    params: Promise.resolve({ id: "show-1" }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "agent-1" } } });
  getUserProfile.mockResolvedValue({ role: "agent" });
  getShowById.mockResolvedValue({ id: "show-1", name: "Night Desk" });
  getAgentShowRelationshipAnyStatus.mockResolvedValue(null);
});

describe("POST /api/shows/[id]/claim", () => {
  it("returns 500 when the roster insert fails", async () => {
    claimShow.mockRejectedValue(new Error("insert failed"));
    const res = await call();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/Failed to claim show/);
  });

  it("returns 201 with pending status when the claim is stored", async () => {
    claimShow.mockResolvedValue({
      id: "rel-1",
      agent_id: "agent-1",
      show_id: "show-1",
      status: "pending",
      source: "claim",
    });
    const res = await call();
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe("pending");
    expect(body.relationship.status).toBe("pending");
    expect(claimShow).toHaveBeenCalledWith("show-1", undefined);
  });

  it("returns 409 when a row already exists in any status", async () => {
    getAgentShowRelationshipAnyStatus.mockResolvedValue({
      id: "rel-pending",
      status: "pending",
      agent_id: "agent-1",
      show_id: "show-1",
    });
    const res = await call();
    expect(res.status).toBe(409);
    expect(claimShow).not.toHaveBeenCalled();
  });
});
