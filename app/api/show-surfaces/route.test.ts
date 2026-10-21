import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthenticatedUser = vi.fn();
const ensureProfile = vi.fn();
const getShowProfileByUserId = vi.fn();
const listOwnerSurfaces = vi.fn();
const replaceOwnerSurfaces = vi.fn();

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...args: unknown[]) => getAuthenticatedUser(...args),
  ensureProfile: (...args: unknown[]) => ensureProfile(...args),
  getShowProfileByUserId: (...args: unknown[]) => getShowProfileByUserId(...args),
}));

vi.mock("@/lib/data/show-surfaces", () => ({
  listOwnerSurfaces: (...args: unknown[]) => listOwnerSurfaces(...args),
  replaceOwnerSurfaces: (...args: unknown[]) => replaceOwnerSurfaces(...args),
}));

import { GET, PUT } from "./route";

function put(body: unknown): Request {
  return new Request("http://localhost/api/show-surfaces", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getAuthenticatedUser.mockResolvedValue({ id: "user-1", email: "host@show.test" });
  ensureProfile.mockResolvedValue({ id: "user-1" });
  getShowProfileByUserId.mockResolvedValue({
    id: "sp-1",
    user_id: "user-1",
    show_name: "The Daily Briefing",
    podscan_id: "pd_1",
  });
});

describe("GET /api/show-surfaces", () => {
  it("rejects a signed-out request", async () => {
    getAuthenticatedUser.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns the creator's surfaces", async () => {
    listOwnerSurfaces.mockResolvedValue([{ id: "s1", type: "newsletter" }]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ surfaces: [{ id: "s1", type: "newsletter" }] });
    expect(listOwnerSurfaces).toHaveBeenCalledWith("user-1");
  });
});

describe("PUT /api/show-surfaces", () => {
  it("rejects a signed-out request", async () => {
    getAuthenticatedUser.mockResolvedValue(null);
    const res = await PUT(put({ surfaces: [] }) as never);
    expect(res.status).toBe(401);
    expect(replaceOwnerSurfaces).not.toHaveBeenCalled();
  });

  it("requires a show profile", async () => {
    getShowProfileByUserId.mockResolvedValue(null);
    const res = await PUT(put({ surfaces: [{ type: "newsletter" }] }) as never);
    expect(res.status).toBe(400);
    expect(replaceOwnerSurfaces).not.toHaveBeenCalled();
  });

  it("saves a sanitized list and drops an unknown type", async () => {
    replaceOwnerSurfaces.mockResolvedValue([{ id: "saved", type: "newsletter" }]);
    const res = await PUT(
      put({
        surfaces: [
          { type: "newsletter", price: 400, posting_owner: "creator", published: true },
          { type: "billboard", price: 9999 },
        ],
      }) as never
    );
    expect(res.status).toBe(200);
    const drafts = replaceOwnerSurfaces.mock.calls[0][3];
    expect(drafts).toEqual([
      expect.objectContaining({ type: "newsletter", price: 400, published: true }),
    ]);
    expect(await res.json()).toEqual({ surfaces: [{ id: "saved", type: "newsletter" }] });
  });

  it("returns 500 when the write fails", async () => {
    replaceOwnerSurfaces.mockResolvedValue(null);
    const res = await PUT(put({ surfaces: [] }) as never);
    expect(res.status).toBe(500);
  });
});
