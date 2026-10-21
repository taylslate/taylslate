import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockResolve, mockSave } = vi.hoisted(() => ({
  mockResolve: vi.fn(),
  mockSave: vi.fn(),
}));

vi.mock("@/lib/learning/load", () => ({
  resolveLearningPageForRequest: (...args: unknown[]) => mockResolve(...args),
}));

vi.mock("@/lib/learning/store", () => ({
  saveLearningOverride: (...args: unknown[]) => mockSave(...args),
}));

import { POST } from "./route";

function access(over: Record<string, unknown> = {}) {
  return {
    status: "ok" as const,
    userId: "brand-1",
    access: {
      campaign: { user_id: "brand-1" },
      isAdmin: false,
      role: "brand",
      representedShowIds: [] as string[],
      bundle: {
        allowedShowIds: ["show-1"],
        allowedRingIds: ["ring-1"],
        dealStatus: {},
      },
      ...over,
    },
  };
}

function call(body: unknown) {
  return POST(
    new Request("http://x/api/campaigns/camp-1/learning/overrides", {
      method: "POST",
      body: JSON.stringify(body),
    }) as never,
    { params: Promise.resolve({ id: "camp-1" }) }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockResolve.mockResolvedValue(access());
  mockSave.mockResolvedValue(undefined);
});

describe("POST /api/campaigns/[id]/learning/overrides", () => {
  it("returns 401 when signed out", async () => {
    mockResolve.mockResolvedValue({ status: "unauthenticated" });
    expect((await call({ note: "x" })).status).toBe(401);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("returns 404 when the caller cannot see the campaign", async () => {
    mockResolve.mockResolvedValue({ status: "not_found" });
    expect((await call({ note: "x" })).status).toBe(404);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("saves a brand note", async () => {
    const res = await call({
      targetKind: "show",
      targetKey: "show-1",
      stance: "renew",
      note: "run them again",
    });
    expect(res.status).toBe(200);
    expect(mockSave).toHaveBeenCalledWith(
      expect.objectContaining({
        campaignId: "camp-1",
        authorId: "brand-1",
        authorRole: "brand",
        note: "run them again",
      })
    );
  });

  it("refuses a rep note on a show they do not represent", async () => {
    mockResolve.mockResolvedValue({
      status: "ok",
      userId: "rep-1",
      access: {
        campaign: { user_id: "brand-1" },
        isAdmin: false,
        role: "agent",
        representedShowIds: ["show-9"],
        bundle: {
          allowedShowIds: ["show-1", "show-9"],
          allowedRingIds: [],
          dealStatus: {},
        },
      },
    });
    const res = await call({
      targetKind: "show",
      targetKey: "show-1",
      stance: "test_next",
      note: "rep vouches, test one flight",
    });
    expect(res.status).toBe(403);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("rejects a target that is not a catalog show on the campaign", async () => {
    const res = await call({
      targetKind: "show",
      targetKey: "podscan-abc",
      stance: "avoid",
      note: "skip",
    });
    expect(res.status).toBe(400);
    expect(mockSave).not.toHaveBeenCalled();
  });
});
