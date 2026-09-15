// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import type { BrandProfile, Outreach } from "@/lib/data/types";
import { brandNameFromProfile } from "@/lib/brand/display-name";
import PitchClient from "./pitch-client";

afterEach(() => {
  cleanup();
});

const IDENTITY_PARAGRAPH =
  "we are a nutrition company that sells a nutrition supplement powder";

const outreach = {
  id: "out_1",
  brand_profile_id: "bp_1",
  campaign_id: "camp_1",
  show_name: "Ottoman History Podcast",
  proposed_cpm: 28.5,
  proposed_episode_count: 3,
  proposed_placement: "mid-roll",
  proposed_flight_start: "2026-05-01",
  proposed_flight_end: "2026-05-30",
  pitch_body: "We think this is a strong fit.\n\nHappy to share more.",
  sent_to_email: "host@example.com",
  response_status: "pending",
  token: "tok",
  created_at: "2026-05-01T00:00:00Z",
  updated_at: "2026-05-01T00:00:00Z",
} as Outreach;

describe("public pitch headline", () => {
  it("identity paragraph must not appear in the headline", () => {
    // Same resolution the pitch page uses (brandNameFromProfile + "A brand").
    const brandName =
      brandNameFromProfile({
        brand_name: "SaunaBox",
        brand_identity: IDENTITY_PARAGRAPH,
        brand_website: "https://saunabox.com",
      } as BrandProfile) ?? "A brand";

    render(
      <PitchClient
        token="tok"
        outreach={outreach}
        brand={{ brand_name: brandName, brand_url: "https://saunabox.com" }}
        isOnboarded
        showStandardCpm={null}
      />
    );

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent(
      "SaunaBox wants to work with Ottoman History Podcast"
    );
    expect(heading.textContent).not.toContain(IDENTITY_PARAGRAPH);
    expect(heading.textContent).not.toContain("nutrition company");
    expect(heading.textContent).not.toContain("supplement powder");
  });

  it("falls back to a short safe label, never the identity paragraph", () => {
    const brandName =
      brandNameFromProfile({
        brand_name: null,
        brand_identity: null,
        brand_website: null,
      } as BrandProfile) ?? "A brand";

    render(
      <PitchClient
        token="tok"
        outreach={outreach}
        brand={{ brand_name: brandName, brand_url: null }}
        isOnboarded
        showStandardCpm={null}
      />
    );

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent(
      "A brand wants to work with Ottoman History Podcast"
    );
    expect(heading.textContent).not.toContain(IDENTITY_PARAGRAPH);
  });
});
