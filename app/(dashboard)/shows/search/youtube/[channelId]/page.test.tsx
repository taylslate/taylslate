// @vitest-environment jsdom

import type { ReactElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const CHANNEL = "UCabcdefghijklmnopqrstuv";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  getEffectiveRole: vi.fn(),
  getLibraryCreator: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => mocks.redirect(url),
  notFound: () => mocks.notFound(),
}));

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: (...args: unknown[]) => mocks.getAuthenticatedUser(...args),
  getEffectiveRole: (...args: unknown[]) => mocks.getEffectiveRole(...args),
}));

vi.mock("@/lib/youtube-library/brand-read", () => ({
  getLibraryCreator: (...args: unknown[]) => mocks.getLibraryCreator(...args),
}));

import LibraryCreatorPage from "./page";

const profile = {
  channelId: CHANNEL,
  title: "Sauna Lab",
  thumbnailUrl: "https://i.ytimg.com/vi/lab/hqdefault.jpg",
  country: "US",
  subscriberCount: 12000,
  videoCount: 40,
  averageViews: 22000,
  averageViewsLabel: "recent" as const,
  nicheTags: ["Health", "Home"],
  youtubeUrl: `https://www.youtube.com/channel/${CHANNEL}`,
  description: `${"A".repeat(300)}SECRET_TAIL`,
  contact_address: "hidden@creator.test",
  brand_flag: "seller",
  show_id: "show-1",
  source: "category",
  keywords: ["secret-keyword"],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("LibraryCreatorPage", () => {
  it("sends a signed-out visitor to login", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(null);
    await expect(
      LibraryCreatorPage({ params: Promise.resolve({ channelId: CHANNEL }) })
    ).rejects.toThrow("REDIRECT:/login");
    expect(mocks.getLibraryCreator).not.toHaveBeenCalled();
  });

  it("sends a show and an agent back to the dashboard", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ id: "user-1" });
    for (const role of ["show", "agent"]) {
      mocks.getEffectiveRole.mockResolvedValueOnce({ effectiveRole: role });
      await expect(
        LibraryCreatorPage({ params: Promise.resolve({ channelId: CHANNEL }) })
      ).rejects.toThrow("REDIRECT:/dashboard");
    }
    expect(mocks.getLibraryCreator).not.toHaveBeenCalled();
  });

  it("returns not found when the channel is ineligible", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ id: "user-1" });
    mocks.getEffectiveRole.mockResolvedValue({ effectiveRole: "brand" });
    mocks.getLibraryCreator.mockResolvedValue(null);
    await expect(
      LibraryCreatorPage({ params: Promise.resolve({ channelId: CHANNEL }) })
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });

  it("renders the public fields and the attribution", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ id: "user-1" });
    mocks.getEffectiveRole.mockResolvedValue({ effectiveRole: "brand" });
    mocks.getLibraryCreator.mockResolvedValue(profile);
    const view = render(
      (await LibraryCreatorPage({
        params: Promise.resolve({ channelId: CHANNEL }),
      })) as ReactElement
    );

    expect(screen.getByRole("heading", { name: "Sauna Lab" })).toBeInTheDocument();
    expect(screen.getByText("US")).toBeInTheDocument();
    expect(screen.getByText("12,000 subscribers")).toBeInTheDocument();
    expect(screen.getByText("40 videos")).toBeInTheDocument();
    expect(screen.getByText("22,000 recent views")).toBeInTheDocument();
    expect(screen.getByText("Health, Home")).toBeInTheDocument();
    expect(screen.getByText("A".repeat(300))).toBeInTheDocument();
    expect(view.container.innerHTML).not.toContain("SECRET_TAIL");
    expect(view.container.querySelector("img")).toHaveAttribute(
      "src",
      "https://i.ytimg.com/vi/lab/hqdefault.jpg"
    );

    const link = screen.getByRole("link", { name: "View on YouTube" });
    expect(link).toHaveAttribute("href", `https://www.youtube.com/channel/${CHANNEL}`);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(screen.getByText("Channel data from YouTube")).toBeInTheDocument();

    expect(view.container.innerHTML).not.toContain("hidden@creator.test");
    expect(view.container.innerHTML.toLowerCase()).not.toContain("email");
    expect(view.container.innerHTML).not.toContain("secret-keyword");
    expect(view.container.innerHTML).not.toContain("seller");
    expect(view.container.innerHTML).not.toContain("\u2014");
    expect(view.container.innerHTML).not.toContain("--brand-");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
