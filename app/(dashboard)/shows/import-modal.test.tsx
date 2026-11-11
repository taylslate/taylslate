// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import ShowsClient from "./shows-client";

function listed(id: string, name: string) {
  return {
    id,
    name,
    platform: "podcast" as const,
    audience_size: 1200,
    categories: ["News"],
    rate_card: { midroll_cpm: 25 },
    description: "",
    tags: [],
    contact: { name: "", email: "", method: "email" as const },
    demographics: {},
    audience_interests: [],
    price_type: "cpm" as const,
    ad_formats: ["host_read" as const],
    episode_cadence: "weekly" as const,
    avg_episode_length_min: 40,
    current_sponsors: [],
    is_claimed: false,
    is_verified: false,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

const csv = [
  "Show Name,Hosts,Category,Channel,Unused,Ad Type,Downloads,CPM",
  "Alpha Draft,Host,News,podcast,,host-read,1000,25",
  "Beta Draft,Host,News,podcast,,host-read,2000,30",
].join("\n");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ImportShowsModal", () => {
  it("adds the returned shows and closes the modal", async () => {
    const existing = listed("show-0", "Morning Desk");
    const alpha = listed("show-a", "Alpha Desk");
    const beta = listed("show-b", "Beta Desk");
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ imported: 2, shows: [alpha, beta] }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(<ShowsClient initialShows={[existing]} />);
    fireEvent.click(screen.getByRole("button", { name: "Import Shows" }));

    expect(screen.getByRole("heading", { name: "Import Shows" })).toHaveClass(
      "text-lg",
      "font-semibold",
      "text-[var(--ts-ink-on-paper)]",
      "mb-1"
    );
    expect(screen.getByText("Upload a CSV file with your show roster.")).toBeInTheDocument();
    expect(screen.getByText("Drop CSV here or click to browse")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveClass(
      "px-4",
      "py-2",
      "rounded-[var(--ts-radius)]",
      "border",
      "border-[var(--ts-hairline-on-paper)]"
    );

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([csv], "roster.csv", { type: "text/csv" });
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText("2 shows found")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import 2 Shows" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Import 2 Shows" }));

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Import Shows" })).toBeNull();
    });
    expect(screen.queryByText("Network error. Please try again.")).toBeNull();
    expect(screen.getByRole("heading", { name: "Morning Desk" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Alpha Desk" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Beta Desk" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
