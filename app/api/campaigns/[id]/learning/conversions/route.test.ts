import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockResolve, mockSave, mockClear } = vi.hoisted(() => ({
  mockResolve: vi.fn(),
  mockSave: vi.fn(),
  mockClear: vi.fn(),
}));

vi.mock("@/lib/learning/load", () => ({
  resolveLearningPageForRequest: (...args: unknown[]) => mockResolve(...args),
}));

vi.mock("@/lib/learning/store", () => ({
  saveConversionReport: (...args: unknown[]) => mockSave(...args),
  clearConversionReport: (...args: unknown[]) => mockClear(...args),
}));

import { POST } from "./route";

function okAccess() {
  return {
    status: "ok" as const,
    userId: "brand-1",
    access: {
      campaign: { user_id: "brand-1" },
      isAdmin: false,
      role: "brand",
      representedShowIds: [],
      bundle: {
        allowedShowIds: ["show-1"],
        allowedRingIds: [],
        dealStatus: { "deal-1": "completed", "deal-2": "planning" },
      },
    },
  };
}

function call(body: unknown) {
  return POST(
    new Request("http://x/api/campaigns/camp-1/learning/conversions", {
      method: "POST",
      body: JSON.stringify(body),
    }) as never,
    { params: Promise.resolve({ id: "camp-1" }) }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockResolve.mockResolvedValue(okAccess());
  mockSave.mockResolvedValue(undefined);
  mockClear.mockResolvedValue(undefined);
});

describe("POST /api/campaigns/[id]/learning/conversions", () => {
  it("returns 401 when signed out", async () => {
    mockResolve.mockResolvedValue({ status: "unauthenticated" });
    expect((await call({ dealId: "deal-1", conversions: 1 })).status).toBe(401);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("stores the integer the brand sent", async () => {
    const res = await call({ dealId: "deal-1", conversions: 4 });
    expect(res.status).toBe(200);
    expect(mockSave).toHaveBeenCalledWith({
      campaignId: "camp-1",
      dealId: "deal-1",
      conversions: 4,
      reportedBy: "brand-1",
    });
  });

  it("clears a report when conversions is null", async () => {
    const res = await call({ dealId: "deal-1", conversions: null });
    expect(res.status).toBe(200);
    expect(mockClear).toHaveBeenCalledWith({
      campaignId: "camp-1",
      dealId: "deal-1",
      actorId: "brand-1",
    });
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("rejects a non-integer and a deal that has not aired", async () => {
    expect((await call({ dealId: "deal-1", conversions: 2.5 })).status).toBe(400);
    expect((await call({ dealId: "deal-2", conversions: 2 })).status).toBe(400);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("does not let another user write a count", async () => {
    mockResolve.mockResolvedValue({
      ...okAccess(),
      userId: "rep-1",
      access: {
        ...okAccess().access,
        role: "agent",
        representedShowIds: ["show-1"],
      },
    });
    expect((await call({ dealId: "deal-1", conversions: 4 })).status).toBe(403);
    expect(mockSave).not.toHaveBeenCalled();
  });
});
