// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ONBOARDING_ROLES, SHOW_SIGNUP_OPTION } from "./roles";

const { mockPush, mockRefresh, getUser, signOut } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockRefresh: vi.fn(),
  getUser: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getUser, signOut } }),
}));

import OnboardingPage from "./page";

const fetchMock = vi.fn();

beforeEach(() => {
  mockPush.mockReset();
  mockRefresh.mockReset();
  getUser.mockReset();
  signOut.mockReset();
  getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  signOut.mockResolvedValue({ error: null });
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ONBOARDING_ROLES", () => {
  it("excludes show/creator (shows self-sign-up at /signup/show, never the role route)", () => {
    expect(ONBOARDING_ROLES.some((r) => r.id === "show")).toBe(false);
    expect(ONBOARDING_ROLES.some((r) => r.id === SHOW_SIGNUP_OPTION.id)).toBe(false);
  });

  it("offers exactly brand, agency, agent", () => {
    expect(ONBOARDING_ROLES.map((r) => r.id)).toEqual(["brand", "agency", "agent"]);
  });
});

describe("SHOW_SIGNUP_OPTION", () => {
  it("is the Show / Creator card", () => {
    expect(SHOW_SIGNUP_OPTION.title).toBe("Show / Creator");
    expect(SHOW_SIGNUP_OPTION.description).toBe("I own or host a show");
  });
});

describe("OnboardingPage role picker", () => {
  it("shows the Show / Creator card with the email-code line", async () => {
    render(<OnboardingPage />);
    expect(
      await screen.findByRole("button", { name: /Show \/ Creator/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Shows sign up with an email code. Use the email you want on your show account.",
      ),
    ).toBeInTheDocument();
  });

  it("signs out and goes to /signup/show without calling the role route", async () => {
    render(<OnboardingPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Show \/ Creator/ }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/signup/show"));
    expect(signOut).toHaveBeenCalledTimes(1);
    const roleCalls = fetchMock.mock.calls.filter(
      (call) => call[0] === "/api/onboarding/role",
    );
    expect(roleCalls).toHaveLength(0);
  });

  it("still posts only the brand role and routes to brand onboarding", async () => {
    render(<OnboardingPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Brand \/ Advertiser/ }),
    );
    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith("/onboarding/brand/welcome"),
    );
    const roleCalls = fetchMock.mock.calls.filter(
      (call) => call[0] === "/api/onboarding/role",
    );
    expect(roleCalls).toHaveLength(1);
    expect(JSON.parse(roleCalls[0][1].body as string)).toEqual({ role: "brand" });
    expect(signOut).not.toHaveBeenCalled();
  });
});
