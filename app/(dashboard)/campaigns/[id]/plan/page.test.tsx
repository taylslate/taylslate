import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const CAMP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const mocks = vi.hoisted(() => ({
  getCampaignById: vi.fn(),
  listPublishedSurfacesForShows: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/lib/data/queries", () => ({
  getCampaignById: (...args: unknown[]) => mocks.getCampaignById(...args),
}));

vi.mock("@/lib/data/show-surfaces", () => ({
  listPublishedSurfacesForShows: (...args: unknown[]) =>
    mocks.listPublishedSurfacesForShows(...args),
}));

vi.mock("./media-plan-builder", () => ({
  default: () => null,
}));

vi.mock("./direct-show-search", () => ({
  default: () => null,
}));

import PlanBuilderPage from "./page";

function campaign(over: Record<string, unknown> = {}) {
  return {
    id: CAMP,
    name: "Fall",
    budget_total: 25000,
    media_plan: null,
    scored_shows: [
      { podcastId: "show-a", name: "One" },
      { podcastId: "show-b", name: "Two" },
      { podcastId: "show-c", name: "Three" },
    ],
    selected_show_ids: ["show-a", "show-c"],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCampaignById.mockResolvedValue(campaign());
  mocks.listPublishedSurfacesForShows.mockResolvedValue({});
});

describe("PlanBuilderPage", () => {
  it("redirects before loading surfaces when nothing is selected", async () => {
    mocks.getCampaignById.mockResolvedValue(campaign({ selected_show_ids: [] }));
    await expect(PlanBuilderPage({ params: Promise.resolve({ id: CAMP }) })).rejects.toThrow(
      `REDIRECT:/campaigns/${CAMP}`
    );
    expect(mocks.listPublishedSurfacesForShows).not.toHaveBeenCalled();
  });

  it("returns not found when the campaign is missing", async () => {
    mocks.getCampaignById.mockResolvedValue(null);
    await expect(PlanBuilderPage({ params: Promise.resolve({ id: CAMP }) })).rejects.toThrow(
      "NEXT_NOT_FOUND"
    );
    expect(mocks.listPublishedSurfacesForShows).not.toHaveBeenCalled();
  });

  it("renders search above the builder and remounts on the selected show ids", async () => {
    const element = (await PlanBuilderPage({
      params: Promise.resolve({ id: CAMP }),
    })) as ReactElement<{ children: ReactElement[] }>;
    const children = element.props.children;
    expect(Array.isArray(children)).toBe(true);
    expect(children[0].props).toMatchObject({ campaignId: CAMP });
    expect(children[1].key).toBe("show-a,show-c");
    const selected = (
      children[1].props as { selectedShows: Array<{ podcastId: string }> }
    ).selectedShows;
    expect(selected.map((show) => show.podcastId)).toEqual(["show-a", "show-c"]);
    expect(mocks.listPublishedSurfacesForShows).toHaveBeenCalledWith(["show-a", "show-c"]);
  });
});
