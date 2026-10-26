import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthenticatedUser, isShowsAdmin, listPendingRosterLinks } = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  isShowsAdmin: vi.fn(),
  listPendingRosterLinks: vi.fn(),
}));

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...args: unknown[]) => getAuthenticatedUser(...args),
}));
vi.mock("@/lib/shows/can-edit-show", () => ({
  isShowsAdmin: (...args: unknown[]) => isShowsAdmin(...args),
}));
vi.mock("@/lib/reps/roster-review", () => ({
  listPendingRosterLinks: (...args: unknown[]) => listPendingRosterLinks(...args),
}));

import { GET } from "./route";

beforeEach(() => {
  getAuthenticatedUser.mockReset();
  isShowsAdmin.mockReset();
  listPendingRosterLinks.mockReset();
});

describe("GET /api/admin/roster-links", () => {
  it("returns 401 when nobody is signed in", async () => {
    getAuthenticatedUser.mockResolvedValue(null);
    const response = await GET();
    expect(response.status).toBe(401);
    expect(isShowsAdmin).not.toHaveBeenCalled();
    expect(listPendingRosterLinks).not.toHaveBeenCalled();
  });

  it("returns 403 for a signed-in user who is not a shows admin", async () => {
    getAuthenticatedUser.mockResolvedValue({ id: "brand-1", email: "brand@example.com" });
    isShowsAdmin.mockResolvedValue(false);
    const response = await GET();
    expect(response.status).toBe(403);
    expect(isShowsAdmin).toHaveBeenCalledWith("brand-1");
    expect(listPendingRosterLinks).not.toHaveBeenCalled();
  });

  it("returns pending links for a shows admin", async () => {
    getAuthenticatedUser.mockResolvedValue({ id: "admin-1", email: "ops@taylslate.com" });
    isShowsAdmin.mockResolvedValue(true);
    listPendingRosterLinks.mockResolvedValue([
      { id: "rel-1", showName: "Odd Lots", status: "pending" },
    ]);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      links: [{ id: "rel-1", showName: "Odd Lots", status: "pending" }],
    });
  });

  it("returns 500 when the list fails", async () => {
    getAuthenticatedUser.mockResolvedValue({ id: "admin-1" });
    isShowsAdmin.mockResolvedValue(true);
    listPendingRosterLinks.mockRejectedValue(new Error("db down"));
    const response = await GET();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Couldn't load roster requests" });
  });
});
