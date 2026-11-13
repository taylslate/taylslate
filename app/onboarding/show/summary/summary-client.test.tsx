// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ShowProfile } from "@/lib/data/types";

const { mockPush } = vi.hoisted(() => ({
  mockPush: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("next/image", () => ({
  default: () => null,
}));

import SummaryClient from "./summary-client";

const fetchMock = vi.fn();
const assignMock = vi.fn();

const profile = {
  show_name: "Test Show",
  audience_size: 5000,
  expected_cpm: 25,
} as unknown as ShowProfile;

beforeEach(() => {
  mockPush.mockReset();
  assignMock.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("location", { href: "http://localhost/onboarding/show/summary", assign: assignMock });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function finish() {
  fireEvent.click(
    screen.getByRole("button", { name: /prove you own the show/ }),
  );
}

describe("SummaryClient complete()", () => {
  it("pushes /settings/ownership when there is no redirect_to", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ show_profile: {} }),
    });
    render(<SummaryClient profile={profile} />);
    finish();
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/settings/ownership"));
    expect(assignMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith("/api/show-profile/complete", {
      method: "POST",
    });
  });

  it("still hard-navigates to the pitch redirect_to when present", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ show_profile: {}, redirect_to: "/outreach/pitch-token" }),
    });
    render(<SummaryClient profile={profile} />);
    finish();
    await waitFor(() => expect(assignMock).toHaveBeenCalledWith("/outreach/pitch-token"));
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("shows the error and stays put when completing fails", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Couldn't complete onboarding" }),
    });
    render(<SummaryClient profile={profile} />);
    finish();
    await screen.findByText("Couldn't complete onboarding");
    expect(mockPush).not.toHaveBeenCalled();
    expect(assignMock).not.toHaveBeenCalled();
  });
});
