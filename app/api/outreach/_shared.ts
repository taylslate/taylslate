// Shared, unit-testable helpers for the outreach send route.

import { isBriefV2 } from "@/lib/data/types";
import type { BrandProfile, Campaign } from "@/lib/data/types";

/**
 * Resolve a clean brand name for the outreach from-line.
 *
 * Prefers the Wave 14 2A brand-confirmed product name carried on the campaign
 * brief (`campaign.brief.product.brand_name`) — required and validated at brief
 * submit, so it's the canonical source. Falls back to the campaign name with
 * its "— {Month Year}" suffix stripped (covers the returning-brand reuse path
 * and most legacy campaigns), then, only as a last resort, the first clause of
 * the free-text brand-identity paragraph — the field whose mis-use caused
 * paragraph-length from-names in the first place. The email template normalizes
 * the result again, so a paragraph can never reach the wire even if every branch
 * here misses.
 */
export function resolveBrandName(
  campaign: Campaign,
  brandProfile: BrandProfile
): string {
  const brief = campaign.brief;
  if (brief && isBriefV2(brief) && brief.product?.brand_name?.trim()) {
    return brief.product.brand_name.trim();
  }

  // Reuse path / legacy: deriveCampaignName builds "{Brand} — {Month Year}"
  // with an em-dash, so split on that specifically (a hyphen may be part of the
  // brand name itself). Ignore the draft/no-brand placeholder names.
  const fromCampaignName = campaign.name?.split("—")[0]?.trim();
  if (
    fromCampaignName &&
    fromCampaignName !== "Campaign" &&
    fromCampaignName !== "Untitled campaign"
  ) {
    return fromCampaignName;
  }

  // Last resort: first clause of the brand-identity paragraph. Split on
  // sentence/clause punctuation and spaced dashes only — never a bare hyphen,
  // which would corrupt a legitimately hyphenated name ("Sun-Dried Tomato Co").
  const fromIdentity = brandProfile.brand_identity
    ?.split(/[.,;]|\s[—–-]\s/)[0]
    ?.trim();
  if (fromIdentity) return fromIdentity;

  return "Sponsorship";
}
