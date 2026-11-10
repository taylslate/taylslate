import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAuthenticatedUser, isShowsAdmin, sweepOwnerVerificationNotices } = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  isShowsAdmin: vi.fn(),
  sweepOwnerVerificationNotices: vi.fn(),
}));

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...args: unknown[]) => getAuthenticatedUser(...args),
}));
vi.mock("@/lib/shows/can-edit-show", () => ({
  isShowsAdmin: (...args: unknown[]) => isShowsAdmin(...args),
}));
vi.mock("@/lib/reps/roster-notify", () => ({
  sweepOwnerVerificationNotices: (...args: unknown[]) => sweepOwnerVerificationNotices(...args),
}));

import { POST } from "./route";

describe("POST /api/admin/roster-links/owner-notices", () => {
  beforeEach(() => {
    getAuthenticatedUser.mockReset();
    isShowsAdmin.mockReset();
    sweepOwnerVerificationNotices.mockReset();
    sweepOwnerVerificationNotices.mockResolvedValue({ sent: 0, already: 0, skipped: 0 });
  });

  it("returns 401 when nobody is signed in", async () => {
    getAuthenticatedUser.mockResolvedValue(null);
    const response = await POST();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(isShowsAdmin).not.toHaveBeenCalled();
    expect(sweepOwnerVerificationNotices).not.toHaveBeenCalled();
  });

  it("returns 403 for a signed-in user who is not a shows admin", async () => {
    getAuthenticatedUser.mockResolvedValue({ id: "brand-1" });
    isShowsAdmin.mockResolvedValue(false);
    const response = await POST();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden" });
    expect(isShowsAdmin).toHaveBeenCalledWith("brand-1");
    expect(sweepOwnerVerificationNotices).not.toHaveBeenCalled();
  });

  it("returns the sweep counts for a shows admin", async () => {
    getAuthenticatedUser.mockResolvedValue({ id: "admin-1" });
    isShowsAdmin.mockResolvedValue(true);
    sweepOwnerVerificationNotices.mockResolvedValue({ sent: 2, already: 1, skipped: 3 });
    const response = await POST();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sent: 2, already: 1, skipped: 3 });
    expect(sweepOwnerVerificationNotices).toHaveBeenCalledOnce();
  });
});
