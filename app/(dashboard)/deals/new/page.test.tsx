// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import NewDealPage from "./page";

const SHOW = "22222222-2222-4222-8222-222222222222";

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => jsonResponse({ error: "unused" }, false))
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mockShows(shows: unknown[]) {
  vi.mocked(fetch).mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("/api/shows")) return jsonResponse(shows);
    return jsonResponse({ error: "unused" }, false);
  });
}

describe("New Deal", () => {
  it("renders for a brand with no rate card and leaves the rate empty", async () => {
    mockShows([
      {
        id: SHOW,
        name: "Night Desk",
        platform: "podcast",
        audience_size: 12000,
        categories: ["News"],
      },
    ]);

    render(<NewDealPage />);
    expect(await screen.findByRole("heading", { name: "New Deal" })).toBeInTheDocument();
    const select = await screen.findByRole("combobox");
    await waitFor(() => {
      expect(screen.getByRole("option", { name: /Night Desk/ })).toBeInTheDocument();
    });

    expect(() => {
      fireEvent.change(select, { target: { value: SHOW } });
    }).not.toThrow();
    expect(screen.getByPlaceholderText("25")).toHaveValue(null);
  });

  it("fills the rate when the show includes a rate card", async () => {
    mockShows([
      {
        id: SHOW,
        name: "Night Desk",
        platform: "podcast",
        audience_size: 12000,
        categories: ["News"],
        rate_card: { midroll_cpm: 25 },
      },
    ]);

    render(<NewDealPage />);
    const select = await screen.findByRole("combobox");
    await waitFor(() => {
      expect(screen.getByRole("option", { name: /Night Desk/ })).toBeInTheDocument();
    });
    fireEvent.change(select, { target: { value: SHOW } });
    expect(screen.getByPlaceholderText("25")).toHaveValue(25);
  });
});
