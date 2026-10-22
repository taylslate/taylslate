// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import type { Deal, UserRole } from "@/lib/data";
import DealsClient from "./deals-client";

const SHOW = "8f3c1a20-4b6e-4c11-9a2d-111111111111";

function sampleDeal(
  overrides: Partial<Deal> & { show_name?: string; show_id?: string | null } = {},
): Deal & { show_name?: string; show_id?: string | null } {
  return {
    id: "deal-1",
    show_id: SHOW,
    brand_id: "brand-1",
    status: "planning",
    num_episodes: 3,
    placement: "mid-roll",
    ad_format: "host_read",
    price_type: "cpm",
    cpm_rate: 25,
    guaranteed_downloads: 10000,
    net_per_episode: 250,
    total_net: 750,
    is_scripted: false,
    is_personal_experience: false,
    reader_type: "host_read",
    content_type: "evergreen",
    pixel_required: false,
    competitor_exclusion: [],
    exclusivity_days: 90,
    rofr_days: 30,
    flight_start: "2026-03-02",
    flight_end: "2026-04-13",
    created_at: "2026-03-01T00:00:00.000Z",
    updated_at: "2026-03-01T00:00:00.000Z",
    show_name: "Acquired",
    ...overrides,
  };
}

function renderDeals(role?: UserRole | null, deal = sampleDeal()) {
  return render(<DealsClient initialDeals={[deal]} viewerRole={role} />);
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("Deals list show name", () => {
  it("links the show name to CRM for a brand or agency with a show id", () => {
    for (const role of ["brand", "agency"] as const) {
      cleanup();
      renderDeals(role);
      const link = screen.getByRole("link", { name: "Acquired" });
      expect(link).toHaveAttribute("href", `/crm/${SHOW}`);
      expect(link.className).toContain("truncate");
      expect(link.className).toContain("text-sm");
      expect(link.className).toContain("font-medium");
    }
  });

  it("keeps the deal link for a show user, an agent, and a deal with no show id", () => {
    renderDeals("show");
    expect(screen.getByRole("link", { name: "Acquired" })).toHaveAttribute("href", "/deals/deal-1");
    cleanup();

    renderDeals("agent");
    expect(screen.getByRole("link", { name: "Acquired" })).toHaveAttribute("href", "/deals/deal-1");
    cleanup();

    renderDeals("brand", sampleDeal({ show_id: "" }));
    expect(screen.getByRole("link", { name: "Acquired" })).toHaveAttribute("href", "/deals/deal-1");
    expect(screen.queryByRole("link", { name: "Acquired" })).not.toHaveAttribute("href", `/crm/${SHOW}`);
  });

  it("follows the CRM nav item when no role is passed", async () => {
    const nav = document.createElement("nav");
    const anchor = document.createElement("a");
    anchor.setAttribute("href", "/crm");
    anchor.textContent = "CRM";
    nav.appendChild(anchor);
    document.body.appendChild(nav);

    render(<DealsClient initialDeals={[sampleDeal()]} />);
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Acquired" })).toHaveAttribute("href", `/crm/${SHOW}`);
    });
  });
});
