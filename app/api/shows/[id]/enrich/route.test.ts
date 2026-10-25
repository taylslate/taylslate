import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getUser, from, canEditShow, updateShowEnrichment } = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
  canEditShow: vi.fn(),
  updateShowEnrichment: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser },
    from: (...args: unknown[]) => from(...args),
  }),
}));

vi.mock("@/lib/data/queries", () => ({
  updateShowEnrichment,
  backfillShowPodscanData: vi.fn(),
}));

vi.mock("@/lib/shows/can-edit-show", () => ({
  canEditShow,
}));

vi.mock("@/lib/enrichment/podscan", () => ({
  getPodscanClientSafe: () => null,
  getPodcastDetails: vi.fn(),
  PodscanError: class PodscanError extends Error {},
}));

vi.mock("@/lib/enrichment/podscan-match", () => ({
  isVerifiedPodcastMatch: () => false,
}));

vi.mock("@/lib/enrichment/youtube", () => ({
  getYouTubeClientSafe: () => null,
}));

vi.mock("@/lib/enrichment/rephonic", () => ({
  getRephonicClientSafe: () => null,
}));

import { POST } from "./route";

function showQuery(row: Record<string, unknown> | null) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    single: async () => ({ data: row, error: row ? null : { message: "missing" } }),
  };
  from.mockReturnValue(builder);
}

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  canEditShow.mockResolvedValue(false);
  showQuery({ id: "show-1", name: "Night Desk", platform: "podcast" });
});

describe("POST /api/shows/[id]/enrich", () => {
  it("returns 401 when signed out", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(new NextRequest("http://x/api/shows/show-1/enrich", { method: "POST" }), {
      params: Promise.resolve({ id: "show-1" }),
    });
    expect(res.status).toBe(401);
    expect(canEditShow).not.toHaveBeenCalled();
  });

  it("returns 403 for a caller who cannot edit the show", async () => {
    const res = await POST(new NextRequest("http://x/api/shows/show-1/enrich", { method: "POST" }), {
      params: Promise.resolve({ id: "show-1" }),
    });
    expect(res.status).toBe(403);
    expect(updateShowEnrichment).not.toHaveBeenCalled();
    expect(canEditShow).toHaveBeenCalledWith("user-1", "show-1");
  });

  it("continues for the owner", async () => {
    canEditShow.mockResolvedValue(true);
    const res = await POST(new NextRequest("http://x/api/shows/show-1/enrich", { method: "POST" }), {
      params: Promise.resolve({ id: "show-1" }),
    });
    expect(res.status).not.toBe(403);
    expect(canEditShow).toHaveBeenCalledWith("user-1", "show-1");
  });
});
