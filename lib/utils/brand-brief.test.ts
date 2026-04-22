import { describe, it, expect } from "vitest";
import { buildBriefFromProfile } from "./brand-brief";
import type { BrandProfile } from "@/lib/data/types";

const now = new Date().toISOString();

function make(p: Partial<BrandProfile>): BrandProfile {
  return {
    id: "bp1",
    user_id: "u1",
    content_categories: [],
    created_at: now,
    updated_at: now,
    ...p,
  };
}

describe("buildBriefFromProfile", () => {
  it("returns empty string when the profile is null", () => {
    expect(buildBriefFromProfile(null)).toBe("");
    expect(buildBriefFromProfile(undefined)).toBe("");
  });

  it("joins the fields into a natural paragraph", () => {
    const profile = make({
      brand_identity: "SaunaBox makes portable infrared saunas",
      target_customer: "health-conscious men with disposable income",
      target_age_min: 30,
      target_age_max: 45,
      target_gender: "mostly_men",
      content_categories: ["Health & Wellness", "Self-Improvement"],
      campaign_goals: ["direct_sales"],
      exclusions: "no gambling",
    });

    const brief = buildBriefFromProfile(profile);
    expect(brief).toMatch(/^SaunaBox makes portable infrared saunas\./);
    expect(brief).toContain("Our target customer: health-conscious men with disposable income.");
    expect(brief).toContain("primarily men aged 30-45");
    expect(brief).toContain("Health & Wellness, Self-Improvement");
    expect(brief).toContain("Goal: drive direct sales through promo codes");
    expect(brief).toContain("Exclusions: no gambling.");
  });

  it("joins multiple goals with a semicolon and uses plural label", () => {
    const profile = make({
      brand_identity: "A brand",
      campaign_goals: ["direct_sales", "brand_awareness"],
    });
    const brief = buildBriefFromProfile(profile);
    expect(brief).toContain(
      "Goals: drive direct sales through promo codes; build brand awareness at scale."
    );
  });

  it("uses 65+ notation when max age is unbounded", () => {
    const profile = make({
      brand_identity: "X",
      target_age_min: 55,
      target_age_max: 120,
    });
    expect(buildBriefFromProfile(profile)).toContain("aged 55+");
  });

  it("skips sections that aren't set", () => {
    const profile = make({ brand_identity: "Just a brand name" });
    const brief = buildBriefFromProfile(profile);
    expect(brief).toBe("Just a brand name.");
  });
});
