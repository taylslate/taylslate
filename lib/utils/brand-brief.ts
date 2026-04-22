// Builds a plain-English brief from a brand profile so the campaign/new
// textarea starts prefilled. Users can edit before submitting — the score
// endpoint then parses this through Claude like any other brief.

import type { BrandProfile, BrandCampaignGoal, BrandTargetGender } from "@/lib/data/types";

const GOAL_PHRASES: Record<BrandCampaignGoal, string> = {
  direct_sales: "drive direct sales through promo codes",
  brand_awareness: "build brand awareness at scale",
  new_product: "launch a new product and generate buzz",
  test_podcast: "test podcast advertising and learn what converts",
};

const GENDER_PHRASES: Record<BrandTargetGender, string> = {
  mostly_men: "primarily men",
  mostly_women: "primarily women",
  mixed: "a balanced audience of men and women",
  no_preference: "a broad audience",
};

function formatAgeRange(min?: number | null, max?: number | null): string {
  if (min == null) return "";
  if (max == null || max >= 65) return `${min}+`;
  return `${min}-${max}`;
}

export function buildBriefFromProfile(profile: BrandProfile | null | undefined): string {
  if (!profile) return "";

  const sentences: string[] = [];

  if (profile.brand_identity) {
    sentences.push(profile.brand_identity.trim().replace(/\.$/, "") + ".");
  }

  if (profile.target_customer) {
    sentences.push(
      `Our target customer: ${profile.target_customer.trim().replace(/\.$/, "")}.`
    );
  }

  const ageRange = formatAgeRange(profile.target_age_min, profile.target_age_max);
  const gender = profile.target_gender ? GENDER_PHRASES[profile.target_gender] : null;
  if (ageRange && gender) {
    sentences.push(`We're targeting ${gender} aged ${ageRange}.`);
  } else if (ageRange) {
    sentences.push(`We're targeting people aged ${ageRange}.`);
  } else if (gender) {
    sentences.push(`We're targeting ${gender}.`);
  }

  if (profile.content_categories && profile.content_categories.length > 0) {
    sentences.push(
      `Strong fits include shows in ${profile.content_categories.join(", ")}.`
    );
  }

  if (profile.campaign_goals && profile.campaign_goals.length > 0) {
    const phrases = profile.campaign_goals.map((g) => GOAL_PHRASES[g]);
    const label = profile.campaign_goals.length === 1 ? "Goal" : "Goals";
    sentences.push(`${label}: ${phrases.join("; ")}.`);
  }

  if (profile.exclusions?.trim()) {
    sentences.push(`Exclusions: ${profile.exclusions.trim().replace(/\.$/, "")}.`);
  }

  return sentences.join(" ");
}
