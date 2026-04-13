// ============================================================
// AD ENGAGEMENT SCORING (30% default weight)
// Scores 0-100 based on listener engagement with ads:
// mid-roll engagement rate, completion rate, and placement details.
// Uses podcast-level engagement from the listener engagement add-on.
// ============================================================

import type { PodscanPodcastEngagement } from "@/lib/podscan/types";

/**
 * Score ad engagement for a podcast.
 * Returns 0-100. Returns null if no engagement data available.
 *
 * Scoring factors:
 * - Mid-roll ad engagement rate (40 points) — primary signal
 * - Average completion rate (30 points) — listeners who finish episodes hear more ads
 * - Overall ad engagement rate (20 points) — blended across placements
 * - Pre/post roll engagement bonus (10 points)
 */
export function scoreAdEngagement(
  engagement: PodscanPodcastEngagement | null
): number | null {
  if (!engagement) return null;

  let score = 0;

  // --- Mid-roll ad engagement (40 points) ---
  // Mid-roll is the standard placement and most valuable
  score += scoreMidRoll(engagement);

  // --- Completion rate (30 points) ---
  score += scoreCompletion(engagement);

  // --- Overall ad engagement (20 points) ---
  score += scoreOverallAdEngagement(engagement);

  // --- Pre/post roll bonus (10 points) ---
  score += scorePlacementBonus(engagement);

  return Math.round(Math.min(100, Math.max(0, score)));
}

function scoreMidRoll(engagement: PodscanPodcastEngagement): number {
  const rate = engagement.avg_mid_roll_ad_engagement_rate;
  if (rate == null || rate === 0) {
    // Fall back to placement details if available
    const midRoll = engagement.placement_details?.mid_roll;
    if (midRoll?.engagement_rate != null) {
      return mapRate(midRoll.engagement_rate, 40);
    }
    return 20; // neutral if no mid-roll data
  }
  return mapRate(rate, 40);
}

function scoreCompletion(engagement: PodscanPodcastEngagement): number {
  const rate = engagement.avg_completion_rate;
  if (rate == null || rate === 0) return 15; // neutral

  // Completion rate is 0-1. 0.7+ is excellent for podcasts.
  if (rate >= 0.8) return 30;
  if (rate >= 0.7) return 26;
  if (rate >= 0.6) return 22;
  if (rate >= 0.5) return 18;
  if (rate >= 0.4) return 14;
  return 8;
}

function scoreOverallAdEngagement(engagement: PodscanPodcastEngagement): number {
  const rate = engagement.avg_ad_engagement_rate;
  if (rate == null || rate === 0) return 10; // neutral
  return mapRate(rate, 20);
}

function scorePlacementBonus(engagement: PodscanPodcastEngagement): number {
  let bonus = 0;
  const details = engagement.placement_details;
  if (!details) return 5;

  // Pre-roll engagement above 0.6 is good (listeners don't skip the intro ad)
  const preRate = details.pre_roll?.engagement_rate ??
    (engagement.avg_pre_roll_ad_engagement_rate || null);
  if (preRate != null && preRate >= 0.6) bonus += 4;
  else if (preRate != null && preRate >= 0.4) bonus += 2;

  // Post-roll engagement above 0.4 is notable (most listeners have dropped off)
  const postRate = details.post_roll?.engagement_rate ??
    (engagement.avg_post_roll_ad_engagement_rate || null);
  if (postRate != null && postRate >= 0.4) bonus += 6;
  else if (postRate != null && postRate >= 0.25) bonus += 3;

  return Math.min(10, bonus);
}

/**
 * Maps a 0-1 engagement rate to points on a scale.
 * Ad engagement rates:
 *   0.8+ = exceptional (few skips)
 *   0.6-0.8 = good
 *   0.4-0.6 = average
 *   <0.4 = below average
 */
function mapRate(rate: number, maxPoints: number): number {
  if (rate >= 0.85) return maxPoints;
  if (rate >= 0.75) return Math.round(maxPoints * 0.88);
  if (rate >= 0.65) return Math.round(maxPoints * 0.75);
  if (rate >= 0.55) return Math.round(maxPoints * 0.62);
  if (rate >= 0.45) return Math.round(maxPoints * 0.50);
  if (rate >= 0.35) return Math.round(maxPoints * 0.38);
  return Math.round(maxPoints * 0.25);
}
