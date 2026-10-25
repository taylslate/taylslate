import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getShowById, updateShow, getUser, canEditShow, isShowsAdmin } = vi.hoisted(
  () => ({
    getShowById: vi.fn(),
    updateShow: vi.fn(),
    getUser: vi.fn(),
    canEditShow: vi.fn(),
    isShowsAdmin: vi.fn(),
  })
);

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));

vi.mock("@/lib/data/queries", () => ({
  getShowById,
  updateShow,
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

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "agent-1" } } });
  getShowById.mockResolvedValue({ id: "show-1", name: "Night Desk", is_discoverable: true });
  updateShow.mockResolvedValue({ id: "show-1", description: "updated" });
  canEditShow.mockResolvedValue(false);
  isShowsAdmin.mockResolvedValue(false);
});

describe("GET /api/shows/[id]", () => {
  it("returns 401 when signed out and does not read the show", async () => {
    getUser.mockResolvedValueOnce({ data: { user: null } });
    const res = await GET(new NextRequest("http://x/api/shows/show-1"), {
      params: Promise.resolve({ id: "show-1" }),
    });
    expect(res.status).toBe(401);
    expect(getShowById).not.toHaveBeenCalled();
  });

  it("returns contact, rates, sponsors, slots, and income for a signed-in caller", async () => {
    getShowById.mockResolvedValueOnce({
      id: "show-1",
      name: "Night Desk",
      is_discoverable: true,
      contact: { name: "Host", email: "host@show.test", method: "email" },
      rate_card: { midroll_cpm: 25 },
      demographics: { hhi_100k_plus: 12 },
      current_sponsors: ["Acme"],
      available_slots: 3,
    });
    const res = await GET(new NextRequest("http://x/api/shows/show-1"), {
      params: Promise.resolve({ id: "show-1" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      show: {
        id: "show-1",
        name: "Night Desk",
        is_discoverable: true,
        contact: { name: "Host", email: "host@show.test", method: "email" },
        rate_card: { midroll_cpm: 25 },
        demographics: { hhi_100k_plus: 12 },
        current_sponsors: ["Acme"],
        available_slots: 3,
      },
    });
    expect(isShowsAdmin).not.toHaveBeenCalled();
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

  it("returns a hidden show to the creating agent", async () => {
    const hidden = {
      id: "show-1",
      name: "Night Desk",
      is_discoverable: false,
      agent_id: "agent-1",
    };
    getShowById.mockResolvedValueOnce(hidden);
    const res = await GET(new NextRequest("http://x/api/shows/show-1"), {
      params: Promise.resolve({ id: "show-1" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ show: hidden });
    expect(isShowsAdmin).not.toHaveBeenCalled();
  });

  it("returns a hidden show to an admin who did not create it", async () => {
    const hidden = {
      id: "show-1",
      name: "Night Desk",
      is_discoverable: false,
      agent_id: "agent-9",
    };
    getShowById.mockResolvedValueOnce(hidden);
    isShowsAdmin.mockResolvedValueOnce(true);
    const res = await GET(new NextRequest("http://x/api/shows/show-1"), {
      params: Promise.resolve({ id: "show-1" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ show: hidden });
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
