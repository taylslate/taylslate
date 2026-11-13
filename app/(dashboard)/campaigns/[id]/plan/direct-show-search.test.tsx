// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const CAMP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SHOW_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}));

import DirectShowSearch from "./direct-show-search";

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body };
}

beforeEach(() => {
  vi.useFakeTimers();
  refresh.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function open() {
  render(<DirectShowSearch campaignId={CAMP} />);
  fireEvent.click(screen.getByRole("button", { name: "Add a show by name" }));
  return screen.getByLabelText("Search shows by name");
}

describe("DirectShowSearch", () => {
  it("waits 300ms, shows Searching, then the empty state", async () => {
    let resolveSearch: (value: unknown) => void = () => {};
    const fetchMock = vi.fn(
      (url: string) =>
        new Promise((resolve) => {
          if (url.includes("q=A") && !url.includes("q=Ac")) {
            throw new Error("short query was fetched");
          }
          resolveSearch = resolve;
        })
    );
    vi.stubGlobal("fetch", fetchMock);

    const input = open();
    fireEvent.change(input, { target: { value: "A" } });
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "Ac" } });
    await act(async () => {
      vi.advanceTimersByTime(299);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      `/api/campaigns/${CAMP}/show-search?q=Ac`
    );
    expect(screen.getByText("Searching...")).toBeInTheDocument();

    await act(async () => {
      resolveSearch(jsonResponse({ results: [], podscanAvailable: true }));
    });
    expect(screen.getByText("No shows match that name.")).toBeInTheDocument();
  });

  it("shows a fixed error and never renders database text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "secret-db-text" }, false))
    );
    const { container } = render(<DirectShowSearch campaignId={CAMP} />);
    fireEvent.click(screen.getByRole("button", { name: "Add a show by name" }));
    fireEvent.change(screen.getByLabelText("Search shows by name"), {
      target: { value: "Acquired" },
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByText("Search failed. Try again.")).toBeInTheDocument();
    expect(container.innerHTML).not.toContain("secret-db-text");
    expect(container.innerHTML).not.toContain("--brand-");
    expect(container.innerHTML).not.toContain("animate-");
    expect(container.innerHTML).not.toContain("transition");
  });

  it("shows the Podscan-unavailable line and a disabled In plan button", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          podscanAvailable: false,
          results: [
            {
              key: `show:${SHOW_ID}`,
              name: "Acquired",
              platform: "podcast",
              audienceSize: 200000,
              categories: ["Business", "Tech"],
              imageUrl: "https://img.example/acquired.jpg",
              origin: "taylslate",
              inPlan: true,
            },
            {
              key: "podscan:pd_Other999",
              name: "Other Show",
              platform: "podcast",
              audienceSize: 100000,
              categories: ["Comedy"],
              imageUrl: null,
              origin: "podscan",
              inPlan: false,
            },
          ],
        })
      )
    );
    const { container } = render(<DirectShowSearch campaignId={CAMP} />);
    fireEvent.click(screen.getByRole("button", { name: "Add a show by name" }));
    fireEvent.change(screen.getByLabelText("Search shows by name"), {
      target: { value: "Acquired" },
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByText("Podscan results are unavailable right now.")).toBeInTheDocument();
    expect(screen.getByText("From Podscan")).toBeInTheDocument();
    expect(container.textContent).toContain("100,000 est.");
    expect(container.textContent).toContain("Business, Tech");
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "https://img.example/acquired.jpg"
    );
    expect(screen.getByRole("button", { name: "In plan" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add to plan" })).toBeEnabled();
    expect(container.innerHTML).not.toContain("--brand-");
    expect(container.innerHTML).not.toContain("animate-");
  });

  it("posts the show key and refreshes after a successful add", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/add")) {
        if (init?.method !== "POST") throw new Error("add was not a POST");
        return jsonResponse({ ok: true, showId: SHOW_ID, alreadyInPlan: false });
      }
      return jsonResponse({
        podscanAvailable: true,
        results: [
          {
            key: `show:${SHOW_ID}`,
            name: "Acquired",
            platform: "podcast",
            audienceSize: 200000,
            categories: ["Business"],
            imageUrl: null,
            origin: "taylslate",
            inPlan: false,
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<DirectShowSearch campaignId={CAMP} />);
    fireEvent.click(screen.getByRole("button", { name: "Add a show by name" }));
    fireEvent.change(screen.getByLabelText("Search shows by name"), {
      target: { value: "Acquired" },
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    fireEvent.click(screen.getByRole("button", { name: "Add to plan" }));
    await act(async () => {});
    const addCall = fetchMock.mock.calls.find((call) => String(call[0]).includes("/add"));
    expect(addCall?.[1]?.method).toBe("POST");
    expect(JSON.parse(String(addCall?.[1]?.body))).toEqual({ key: `show:${SHOW_ID}` });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "In plan" })).toBeDisabled();
  });

  it("shows a known add error and hides any other server text", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          podscanAvailable: true,
          results: [
            {
              key: `show:${SHOW_ID}`,
              name: "Acquired",
              platform: "podcast",
              audienceSize: 200000,
              categories: [],
              imageUrl: null,
              origin: "taylslate",
              inPlan: false,
            },
          ],
        })
      )
      .mockResolvedValueOnce(jsonResponse({ error: "secret-db-text" }, false));
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<DirectShowSearch campaignId={CAMP} />);
    fireEvent.click(screen.getByRole("button", { name: "Add a show by name" }));
    fireEvent.change(screen.getByLabelText("Search shows by name"), {
      target: { value: "Acquired" },
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    fireEvent.click(screen.getByRole("button", { name: "Add to plan" }));
    await act(async () => {});
    expect(screen.getByText("Search failed. Try again.")).toBeInTheDocument();
    expect(container.innerHTML).not.toContain("secret-db-text");
  });
});
