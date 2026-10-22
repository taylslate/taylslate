import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUser, getUserProfile, listRoster } = vi.hoisted(() => ({
  getUser: vi.fn(),
  getUserProfile: vi.fn(),
  listRoster: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));

vi.mock("@/lib/data/queries", () => ({
  getUserProfile: (...args: unknown[]) => getUserProfile(...args),
}));

vi.mock("@/lib/reps/store", () => ({
  listRoster: (...args: unknown[]) => listRoster(...args),
}));

import { GET } from "./route";

const SESSION = "agent-session";

function requestFor(agentId: string) {
  return new Request(`http://x/api/reps/roster?agentId=${agentId}`, {
    headers: { "x-agent-id": agentId },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/reps/roster", () => {
  it("returns 401 when nobody is signed in", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await GET(requestFor("other-agent"));
    expect(res.status).toBe(401);
    expect(listRoster).not.toHaveBeenCalled();
  });

  it("returns 403 when the signed-in user is not an agent", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "brand-1" } } });
    getUserProfile.mockResolvedValue({ id: "brand-1", role: "brand" });
    const res = await GET(requestFor("brand-1"));
    expect(res.status).toBe(403);
    expect(listRoster).not.toHaveBeenCalled();
  });

  it("lists the session agent's roster and ignores a caller-supplied agent id", async () => {
    getUser.mockResolvedValue({ data: { user: { id: SESSION } } });
    getUserProfile.mockResolvedValue({ id: SESSION, role: "agent" });
    listRoster.mockResolvedValue([
      {
        id: "rel-1",
        show_id: "show-1",
        show_name: "Night Desk",
        status: "pending",
        source: "import",
        commission_rate: null,
        is_exclusive: true,
      },
    ]);

    const res = await GET(requestFor("other-agent"));
    expect(res.status).toBe(200);
    expect(listRoster).toHaveBeenCalledTimes(1);
    expect(listRoster).toHaveBeenCalledWith(SESSION);
    const body = await res.json();
    expect(body.roster[0].show_name).toBe("Night Desk");
    expect(body.roster[0].is_exclusive).toBe(true);
  });
});
