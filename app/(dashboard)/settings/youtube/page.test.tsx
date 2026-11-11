// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "11111111-1111-4111-8111-111111111111" } as { id: string } | null,
  profile: { role: "show" } as { role: string } | null,
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: async () => mocks.user,
  getUserProfile: async () => mocks.profile,
}));

vi.mock("@/lib/youtube-oauth/store", () => ({
  readYoutubeStatus: async () => ({
    connected: false,
    channel_id: null,
    channel_title: null,
    status: null,
    analytics_enabled: false,
  }),
}));

import YoutubeSettingsPage from "./page";

describe("/settings/youtube", () => {
  beforeEach(() => {
    mocks.user = { id: "11111111-1111-4111-8111-111111111111" };
    mocks.profile = { role: "show" };
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the connect consent for a show", async () => {
    const page = await YoutubeSettingsPage({ searchParams: Promise.resolve({}) });
    render(page);
    expect(screen.getByRole("link", { name: "Connect YouTube" })).toHaveAttribute("href", "/api/youtube/connect");
    expect(screen.getByText(/caption tracks of/i)).toBeInTheDocument();
    expect(screen.getByText(/Nothing is posted or changed on YouTube/i)).toBeInTheDocument();
    expect(screen.getByText(/Taylslate staff review ad-read excerpts/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "YouTube Terms of Service" })).toHaveAttribute(
      "href",
      "https://www.youtube.com/t/terms"
    );
    expect(screen.getByRole("link", { name: "https://policies.google.com/privacy" })).toBeInTheDocument();
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("command agent");
    expect(text).not.toContain("\u2014");
  });

  it("redirects a signed-out user", async () => {
    mocks.user = null;
    await expect(YoutubeSettingsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      "REDIRECT:/login?next=/settings/youtube"
    );
  });

  it("does not render for a brand", async () => {
    mocks.profile = { role: "brand" };
    await expect(YoutubeSettingsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NOT_FOUND");
  });
});
