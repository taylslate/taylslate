import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUser, canEditShow, getShowsNeedingEnrichment, updateShowEnrichment } = vi.hoisted(
  () => ({
    getUser: vi.fn(),
    canEditShow: vi.fn(),
    getShowsNeedingEnrichment: vi.fn(),
    updateShowEnrichment: vi.fn(),
  })
);

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));

vi.mock("@/lib/data/queries", () => ({
  getShowsNeedingEnrichment,
  updateShowEnrichment,
}));

vi.mock("@/lib/shows/can-edit-show", () => ({
  canEditShow,
}));

vi.mock("@/lib/enrichment/podscan", () => ({
  getPodscanClientSafe: () => null,
  getPodcastDetails: vi.fn(),
}));

vi.mock("@/lib/enrichment/youtube", () => ({
  getYouTubeClientSafe: () => null,
}));

import { POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "agent-1" } } });
  canEditShow.mockResolvedValue(true);
  getShowsNeedingEnrichment.mockResolvedValue([
    { id: "show-1", name: "Night Desk", platform: "podcast" },
  ]);
});

describe("POST /api/shows/enrich-batch", () => {
  it("returns 401 when signed out", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await POST();
    expect(res.status).toBe(401);
    expect(getShowsNeedingEnrichment).not.toHaveBeenCalled();
  });

  it("skips a show that fails canEditShow and does not write it", async () => {
    canEditShow.mockResolvedValue(false);
    const res = await POST();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enriched).toBe(0);
    expect(body.skipped).toBe(1);
    expect(body.details).toEqual([
      {
        show_id: "show-1",
        name: "Night Desk",
        status: "skipped",
        source: "not_permitted",
      },
    ]);
    expect(updateShowEnrichment).not.toHaveBeenCalled();
  });

  it("skips the show that fails canEditShow and still reports the rest", async () => {
    getShowsNeedingEnrichment.mockResolvedValue([
      { id: "show-1", name: "Night Desk", platform: "podcast" },
      { id: "show-2", name: "Day Desk", platform: "podcast" },
    ]);
    canEditShow.mockImplementation(async (_user: string, showId: string) => showId === "show-1");
    const res = await POST();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enriched).toBe(0);
    expect(body.skipped).toBe(2);
    expect(body.details).toEqual([
      {
        show_id: "show-1",
        name: "Night Desk",
        status: "skipped",
        source: "no_podscan_key",
      },
      {
        show_id: "show-2",
        name: "Day Desk",
        status: "skipped",
        source: "not_permitted",
      },
    ]);
    expect(updateShowEnrichment).not.toHaveBeenCalled();
  });
});
