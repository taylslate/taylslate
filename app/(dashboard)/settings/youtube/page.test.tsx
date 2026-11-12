// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "11111111-1111-4111-8111-111111111111" } as { id: string } | null,
  profile: { role: "show" } as { role: string } | null,
  showProfile: { ok: true as boolean, showProfileId: "profile-1" },
  statusError: false,
  refresh: vi.fn(),
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
  useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: async () => mocks.user,
  getUserProfile: async () => mocks.profile,
}));

vi.mock("@/lib/youtube-oauth/store", () => ({
  requireShowProfile: async () => mocks.showProfile,
  readYoutubeStatus: async () => {
    if (mocks.statusError) throw new Error("youtube status failed");
    return {
      connected: false,
      channel_id: null,
      channel_title: null,
      status: null,
      analytics_enabled: false,
    };
  },
}));

import YoutubeSettingsPage from "./page";
import YoutubeConnectClient from "./youtube-connect-client";

describe("/settings/youtube", () => {
  beforeEach(() => {
    mocks.user = { id: "11111111-1111-4111-8111-111111111111" };
    mocks.profile = { role: "show" };
    mocks.showProfile = { ok: true, showProfileId: "profile-1" };
    mocks.statusError = false;
    mocks.refresh.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the connect consent for a show", async () => {
    const page = await YoutubeSettingsPage({ searchParams: Promise.resolve({}) });
    render(page);
    expect(screen.getByRole("link", { name: "Connect YouTube" })).toHaveAttribute("href", "/api/youtube/connect");
    expect(screen.getByText(/caption tracks of/i)).toBeInTheDocument();
    expect(screen.queryByText(/Nothing is posted or changed on YouTube/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Analytics values are kept while your channel stays connected/i)).toBeInTheDocument();
    expect(
      screen.getByText(
        /If you remove Taylslate at Google, we treat that as a lapsed authorization and delete your tokens when our daily check detects it/i
      )
    ).toBeInTheDocument();
    expect(screen.getByText(/We check the grant every day/i)).toBeInTheDocument();
    expect(screen.queryByText(/or a refresh fails/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Taylslate staff review sponsor-read excerpts/i)).toBeInTheDocument();
    expect(screen.getByText(/never uploads, edits, deletes, or posts/i)).toBeInTheDocument();
    expect(screen.getByText(/do not use it to train AI models or in pooled data/i)).toBeInTheDocument();
    expect(screen.getByText(/We store your channel ID and title/i)).toBeInTheDocument();
    expect(screen.getByText(/Disconnect revokes Taylslate at Google/i)).toBeInTheDocument();
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

  it("does not render for a show role without a show profile", async () => {
    mocks.showProfile = { ok: false, showProfileId: "" };
    await expect(YoutubeSettingsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("NOT_FOUND");
  });

  it("shows a load error and hides connect and disconnect", async () => {
    mocks.statusError = true;
    const page = await YoutubeSettingsPage({ searchParams: Promise.resolve({}) });
    render(page);
    expect(
      screen.getByText("We could not load your YouTube connection. Refresh to try again.")
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Connect YouTube" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Disconnect" })).not.toBeInTheDocument();
    expect(screen.queryByText("No YouTube channel is connected.")).not.toBeInTheDocument();
    expect(screen.getByText(/Disconnect revokes Taylslate at Google/i)).toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toContain("\u2014");
  });

  it("shows the Google permissions line when revoke fails", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, google_revoke: "failed" }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <YoutubeConnectClient
        status={{
          connected: true,
          channel_id: "UCchannel",
          channel_title: "The Show",
          status: "active",
          analytics_enabled: true,
        }}
        notice={{}}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    const notice = await screen.findByText(/Disconnected\. To finish, remove Taylslate from your/i);
    expect(notice).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Google Account permissions" });
    expect(link).toHaveAttribute("href", "https://myaccount.google.com/permissions");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel") ?? "").toContain("noopener");
    expect(screen.queryByRole("button", { name: "Disconnect" })).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
