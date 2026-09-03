// Shared, unit-testable helpers for the outreach send route.

import { isBriefV2 } from "@/lib/data/types";
import type { BrandProfile, Campaign } from "@/lib/data/types";
import { brandNameFromProfile } from "@/lib/brand/display-name";

/**
 * Resolve a clean brand name for the outreach from-line.
 *
 * Precedence:
 *   1. The Wave 14 2A brand-confirmed product name carried on the campaign brief
 *      (`campaign.brief.product.brand_name`) — validated at brief submit, so it's
 *      the canonical campaign-specific source.
 *   2. The durable, user-confirmed `brand_profiles.brand_name` (A6) — an explicit
 *      account-level name ranks above a parsed campaign name.
 *   3. The campaign name with its "— {Month Year}" suffix stripped (covers the
 *      returning-brand reuse path and most legacy campaigns).
 *   4. `brandNameFromProfile` — the bounded brand-identity clause / website
 *      domain fallback for un-backfilled legacy rows. This is the field whose
 *      mis-use caused paragraph-length from-names; the email template normalizes
 *      the result again, so a paragraph can never reach the wire even here.
 */
export function resolveBrandName(
  campaign: Campaign,
  brandProfile: BrandProfile
): string {
  const brief = campaign.brief;
  if (brief && isBriefV2(brief) && brief.product?.brand_name?.trim()) {
    return brief.product.brand_name.trim();
  }

  const explicit = brandProfile.brand_name?.trim();
  if (explicit) return explicit;

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

  // Last resort: bounded brand-identity clause / website domain (shared helper).
  return brandNameFromProfile(brandProfile) ?? "Sponsorship";
}
