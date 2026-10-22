// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Deal, UserRole } from "@/lib/data";
import LegacyDealClient from "./legacy-client";

const SHOW = "8f3c1a20-4b6e-4c11-9a2d-111111111111";
const DEAL = "deal-1";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

function fixture(
  overrides: Partial<Deal> & { show_name?: string; brand_name?: string; show_id?: string | null } = {},
) {
  return {
    id: DEAL,
    show_id: SHOW,
    brand_id: "brand-1",
    status: "planning" as const,
    num_episodes: 3,
    placement: "mid-roll" as const,
    ad_format: "host_read" as const,
    price_type: "cpm" as const,
    cpm_rate: 25,
    guaranteed_downloads: 10000,
    net_per_episode: 250,
    total_net: 750,
    is_scripted: false,
    is_personal_experience: false,
    reader_type: "host_read" as const,
    content_type: "evergreen" as const,
    pixel_required: false,
    competitor_exclusion: [],
    exclusivity_days: 90,
    rofr_days: 30,
    flight_start: "2026-03-02",
    flight_end: "2026-04-13",
    created_at: "2026-03-01T00:00:00.000Z",
    updated_at: "2026-03-01T00:00:00.000Z",
    show_name: "Acquired",
    brand_name: "Sauna Box",
    ...overrides,
  };
}

function renderDeal(
  role?: UserRole | null,
  deal = fixture(),
) {
  return render(
    <LegacyDealClient dealId={DEAL} viewerRole={role} initialDeal={deal} />,
  );
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ make_goods: [], can_approve: false }) })),
  );
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("Legacy deal detail show name", () => {
  it("links the show name to CRM for a brand with a show id", () => {
    renderDeal("brand");
    const links = screen.getAllByRole("link", { name: "Acquired" });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).toHaveAttribute("href", `/crm/${SHOW}`);
      expect(link.className).toContain("hover:underline");
    }
    expect(screen.getByRole("heading", { name: "Acquired" })).toBeInTheDocument();
  });

  it("renders plain text for a show user, an agent, and a deal with no show id", () => {
    renderDeal("show");
    expect(screen.getByRole("heading", { name: "Acquired" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Acquired" })).not.toBeInTheDocument();
    cleanup();

    renderDeal("agent");
    expect(screen.queryByRole("link", { name: "Acquired" })).not.toBeInTheDocument();
    cleanup();

    renderDeal("brand", fixture({ show_id: "" }));
    expect(screen.getByRole("heading", { name: "Acquired" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Acquired" })).not.toBeInTheDocument();
  });

  it("follows the CRM nav item when no role is passed", async () => {
    const nav = document.createElement("nav");
    const anchor = document.createElement("a");
    anchor.setAttribute("href", "/crm");
    anchor.textContent = "CRM";
    nav.appendChild(anchor);
    document.body.appendChild(nav);

    render(<LegacyDealClient dealId={DEAL} initialDeal={fixture()} />);
    await waitFor(() => {
      expect(screen.getAllByRole("link", { name: "Acquired" })[0]).toHaveAttribute(
        "href",
        `/crm/${SHOW}`,
      );
    });
  });
});
