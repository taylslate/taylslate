// @vitest-environment jsdom

import type { ReactElement } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import {
  SHOW_SEARCH_DEBOUNCE_MS,
  SHOW_SEARCH_LIMIT,
  sanitizeShowSearch,
  showSearchPath,
  toPublicShow,
} from "./search-client";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  getEffectiveRole: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/data/queries", () => ({
  getAuthenticatedUser: mocks.getAuthenticatedUser,
  getEffectiveRole: mocks.getEffectiveRole,
}));

import ShowSearchPage from "./page";
import ShowSearchClient from "./search-client";

const VISIBLE_ID = "8f3c1a20-4b6e-4c11-9a2d-111111111111";
const HIDDEN_ID = "8f3c1a20-4b6e-4c11-9a2d-222222222222";

const visibleShow = {
  id: VISIBLE_ID,
  name: "Acquired",
  platform: "podcast",
  audience_size: 12400,
  categories: ["Business", "Technology"],
  is_discoverable: true,
  contact: { name: "Host", email: "host@show.test", method: "email" },
  rate_card: { midroll_cpm: 25 },
};

const hiddenShow = {
  id: HIDDEN_ID,
  name: "Secret Show",
  platform: "youtube",
  audience_size: 90000,
  categories: ["News"],
  is_discoverable: false,
  contact: { name: "Hidden", email: "hidden@show.test", method: "email" },
  rate_card: { flat_rate: 8000 },
};

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })
  );
}

function expectNoEmDash(container: HTMLElement) {
  expect(container.textContent ?? "").not.toContain("\u2014");
  expect(container.innerHTML).not.toContain("\u2014");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("sanitizeShowSearch", () => {
  it("trims, caps at 100 characters, and escapes LIKE wildcards", () => {
    expect(sanitizeShowSearch("  100%_growth\\  ")).toBe("100\\%\\_growth\\\\");
    expect(sanitizeShowSearch(`  ${"a".repeat(150)}  `)).toBe("a".repeat(100));
    expect(sanitizeShowSearch("   ")).toBe("");
  });

  it("puts the escaped search and a 50 row cap on the request", () => {
    const path = showSearchPath("100%_off");
    expect(path).not.toBeNull();
    const url = new URL(path!, "http://localhost");
    expect(url.pathname).toBe("/api/shows");
    expect(url.searchParams.get("search")).toBe("100\\%\\_off");
    expect(url.searchParams.get("limit")).toBe(String(SHOW_SEARCH_LIMIT));
    expect(SHOW_SEARCH_LIMIT).toBe(50);
  });
});

describe("toPublicShow", () => {
  it("drops a hidden show and keeps a discoverable show without contact or rates", () => {
    expect(toPublicShow(hiddenShow)).toBeNull();
    expect(toPublicShow(visibleShow)).toEqual({
      id: VISIBLE_ID,
      name: "Acquired",
      platform: "podcast",
      audienceSize: 12400,
      categories: ["Business", "Technology"],
    });
  });
});

describe("ShowSearchPage", () => {
  it("sends a signed-out visitor to login", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(null);
    await expect(ShowSearchPage()).rejects.toThrow("REDIRECT:/login");
    expect(mocks.getEffectiveRole).not.toHaveBeenCalled();
  });

  it("sends a role-less account to onboarding", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ id: "user-1" });
    mocks.getEffectiveRole.mockResolvedValue(null);
    await expect(ShowSearchPage()).rejects.toThrow("REDIRECT:/onboarding");
  });

  it("renders search for a brand and for an agency", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ id: "user-1" });
    for (const role of ["brand", "agency"]) {
      mocks.getEffectiveRole.mockResolvedValueOnce({ effectiveRole: role });
      const view = render((await ShowSearchPage()) as ReactElement);
      expect(screen.getByRole("searchbox", { name: "Search shows" })).toBeInTheDocument();
      expectNoEmDash(view.container);
      cleanup();
    }
  });

  it("sends an agent and a show back to the dashboard", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue({ id: "user-1" });
    for (const role of ["agent", "show"]) {
      mocks.getEffectiveRole.mockResolvedValueOnce({ effectiveRole: role });
      await expect(ShowSearchPage()).rejects.toThrow("REDIRECT:/dashboard");
    }
  });
});

describe("ShowSearchClient", () => {
  it("asks for a name before it calls the API", () => {
    render(<ShowSearchClient />);
    expect(screen.getByText("Type a show name.")).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows a brand the matching discoverable show and links to its CRM page", async () => {
    vi.mocked(fetch).mockImplementation(() => jsonResponse([visibleShow, hiddenShow]));
    const user = userEvent.setup();
    const view = render(<ShowSearchClient />);
    await user.type(screen.getByRole("searchbox", { name: "Search shows" }), "Acquired");

    expect(await screen.findByRole("link", { name: /Acquired/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Acquired/ })).toHaveAttribute(
      "href",
      `/crm/${VISIBLE_ID}`
    );
    expect(screen.getByText("podcast")).toBeInTheDocument();
    expect(screen.getByText(/12,400 downloads/)).toBeInTheDocument();
    expect(screen.getByText(/Business, Technology/)).toBeInTheDocument();
    expect(screen.queryByText("Secret Show")).not.toBeInTheDocument();
    expect(screen.queryByText("host@show.test")).not.toBeInTheDocument();
    expect(screen.queryByText("hidden@show.test")).not.toBeInTheDocument();
    expect(screen.queryByText("$25")).not.toBeInTheDocument();
    expect(screen.queryByText("8000")).not.toBeInTheDocument();
    expectNoEmDash(view.container);

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const url = new URL(String(vi.mocked(fetch).mock.calls.at(-1)?.[0]), "http://localhost");
    expect(url.searchParams.get("search")).toBe("Acquired");
    expect(url.searchParams.get("limit")).toBe("50");
  });

  it("escapes wildcards on the request a brand sends", async () => {
    vi.mocked(fetch).mockImplementation(() => jsonResponse([]));
    const user = userEvent.setup();
    render(<ShowSearchClient />);
    await user.type(screen.getByRole("searchbox", { name: "Search shows" }), "100%_off");

    await waitFor(() => expect(fetch).toHaveBeenCalled(), {
      timeout: SHOW_SEARCH_DEBOUNCE_MS + 1000,
    });
    const url = new URL(String(vi.mocked(fetch).mock.calls.at(-1)?.[0]), "http://localhost");
    expect(url.searchParams.get("search")).toBe("100\\%\\_off");
    expect(await screen.findByText("No shows match that search.")).toBeInTheDocument();
  });

  it("shows an error when the call is unauthorized", async () => {
    vi.mocked(fetch).mockImplementation(() =>
      jsonResponse({ error: "Unauthorized" }, 401)
    );
    const user = userEvent.setup();
    render(<ShowSearchClient />);
    await user.type(screen.getByRole("searchbox", { name: "Search shows" }), "Acquired");

    expect(await screen.findByRole("alert")).toHaveTextContent("Sign in to search shows.");
    expect(screen.queryByRole("link", { name: /Acquired/ })).not.toBeInTheDocument();
  });

  it("shows an error when the search fails", async () => {
    vi.mocked(fetch).mockImplementation(() => jsonResponse({ error: "Failed" }, 500));
    const user = userEvent.setup();
    render(<ShowSearchClient />);
    await user.type(screen.getByRole("searchbox", { name: "Search shows" }), "Acquired");
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load shows.");
  });
});
