import { describe, it, expect } from "vitest";
import {
  buildBriefFromProfile,
  mergeProfileWithOverrides,
} from "./brand-brief";
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

describe("mergeProfileWithOverrides", () => {
  const base = make({
    brand_identity: "SaunaBox makes portable infrared saunas",
    target_customer: "Health-conscious men 30-45",
    content_categories: ["Health & Wellness", "Fitness"],
    campaign_goals: ["direct_sales"],
  });

  it("returns null when profile is null", () => {
    expect(mergeProfileWithOverrides(null, { target_customer: "x" })).toBeNull();
  });

  it("returns the profile unchanged when overrides is null or empty", () => {
    expect(mergeProfileWithOverrides(base, null)).toEqual(base);
    expect(mergeProfileWithOverrides(base, {})).toEqual(base);
  });

  it("replaces target_customer when override is non-empty", () => {
    const merged = mergeProfileWithOverrides(base, { target_customer: "College athletes 18-22" });
    expect(merged?.target_customer).toBe("College athletes 18-22");
    // Other fields untouched
    expect(merged?.content_categories).toEqual(["Health & Wellness", "Fitness"]);
    expect(merged?.campaign_goals).toEqual(["direct_sales"]);
  });

  it("does NOT replace when override is whitespace-only", () => {
    const merged = mergeProfileWithOverrides(base, { target_customer: "   " });
    expect(merged?.target_customer).toBe("Health-conscious men 30-45");
  });

  it("replaces categories when override array is non-empty", () => {
    const merged = mergeProfileWithOverrides(base, {
      content_categories: ["Sports", "Comedy"],
    });
    expect(merged?.content_categories).toEqual(["Sports", "Comedy"]);
  });

  it("does NOT replace when override array is empty", () => {
    const merged = mergeProfileWithOverrides(base, { content_categories: [] });
    expect(merged?.content_categories).toEqual(["Health & Wellness", "Fitness"]);
  });

  it("replaces goals when override is non-empty", () => {
    const merged = mergeProfileWithOverrides(base, {
      campaign_goals: ["brand_awareness", "new_product"],
    });
    expect(merged?.campaign_goals).toEqual(["brand_awareness", "new_product"]);
  });

  it("stacks multiple overrides at once", () => {
    const merged = mergeProfileWithOverrides(base, {
      target_customer: "New audience",
      content_categories: ["Business & Finance"],
      campaign_goals: ["test_podcast"],
    });
    expect(merged?.target_customer).toBe("New audience");
    expect(merged?.content_categories).toEqual(["Business & Finance"]);
    expect(merged?.campaign_goals).toEqual(["test_podcast"]);
    // Non-overridden fields preserved
    expect(merged?.brand_identity).toBe("SaunaBox makes portable infrared saunas");
  });

  it("does not mutate the source profile", () => {
    const snapshot = JSON.parse(JSON.stringify(base));
    mergeProfileWithOverrides(base, {
      target_customer: "mutated?",
      content_categories: ["Sports"],
    });
    expect(base).toEqual(snapshot);
  });

  it("produces a brief that reflects the overrides when piped through buildBriefFromProfile", () => {
    const merged = mergeProfileWithOverrides(base, {
      target_customer: "College athletes 18-22",
      campaign_goals: ["brand_awareness"],
    });
    const brief = buildBriefFromProfile(merged);
    expect(brief).toContain("College athletes 18-22");
    expect(brief).toContain("build brand awareness at scale");
    // Original goal replaced, not additive
    expect(brief).not.toContain("drive direct sales through promo codes");
  });
});
