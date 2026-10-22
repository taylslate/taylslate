import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUser, getUserProfile, listRepDeals } = vi.hoisted(() => ({
  getUser: vi.fn(),
  getUserProfile: vi.fn(),
  listRepDeals: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));

vi.mock("@/lib/data/queries", () => ({
  getUserProfile: (...args: unknown[]) => getUserProfile(...args),
}));

vi.mock("@/lib/reps/store", () => ({
  listRepDeals: (...args: unknown[]) => listRepDeals(...args),
}));

import { GET } from "./route";

const SESSION = "agent-session";

function requestFor(agentId: string) {
  return new Request(`http://x/api/reps/deals?agentId=${agentId}`, {
    headers: { "x-agent-id": agentId },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/reps/deals", () => {
  it("returns 401 when nobody is signed in", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await GET(requestFor("other-agent"));
    expect(res.status).toBe(401);
    expect(listRepDeals).not.toHaveBeenCalled();
  });

  it("returns 403 when the signed-in user is not an agent", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "brand-1" } } });
    getUserProfile.mockResolvedValue({ id: "brand-1", role: "show" });
    const res = await GET(requestFor("brand-1"));
    expect(res.status).toBe(403);
    expect(listRepDeals).not.toHaveBeenCalled();
  });

  it("returns the session agent's participant deals and ignores a caller-supplied agent id", async () => {
    getUser.mockResolvedValue({ data: { user: { id: SESSION } } });
    getUserProfile.mockResolvedValue({ id: SESSION, role: "agent" });
    listRepDeals.mockResolvedValue([
      { id: "deal-9", agent_id: SESSION, status: "live", cpm_rate: 25, total_net: 750 },
    ]);

    const res = await GET(requestFor("other-agent"));
    expect(res.status).toBe(200);
    expect(listRepDeals).toHaveBeenCalledTimes(1);
    expect(listRepDeals).toHaveBeenCalledWith(SESSION);
    const body = await res.json();
    expect(body.deals[0].cpm_rate).toBe(25);
    expect(body.deals[0].agent_id).toBe(SESSION);
  });
});
