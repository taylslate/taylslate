// ============================================================
// SPONSOR RETENTION SCORING (20% default weight)
// Scores 0-100 based on repeat sponsor data from
// GET /podcasts/{id}/analysis. High repeat counts = the show
// converts, which is the strongest proxy until Taylslate has
// its own transaction data.
// ============================================================

import type { PodscanAnalysisResponse } from "@/lib/podscan/types";

/**
 * Score sponsor retention for a podcast.
 * Returns 0-100. Returns null if no analysis data available.
 *
 * Scoring factors:
 * - Max sponsor episode count (35 points) — highest-retention sponsor
 * - Number of repeat sponsors (35 points) — sponsors appearing 3+ times
 * - Total unique sponsors (30 points) — breadth of advertiser interest
 */
export function scoreSponsorRetention(
  analysis: PodscanAnalysisResponse | null
): number | null {
  if (!analysis) return null;

  const sponsors = analysis.sponsors;
  if (!sponsors || sponsors.length === 0) return null;

  let score = 0;

  // --- Max sponsor episode count (35 points) ---
  score += scoreMaxRetention(sponsors);

  // --- Repeat sponsors count (35 points) ---
  score += scoreRepeatCount(sponsors);

  // --- Total unique sponsors (30 points) ---
  score += scoreSponsorBreadth(sponsors);

  return Math.round(Math.min(100, Math.max(0, score)));
}

function scoreMaxRetention(
  sponsors: { episode_count: number }[]
): number {
  const maxEps = Math.max(...sponsors.map((s) => s.episode_count));

  // A sponsor appearing 10+ times is a strong conversion signal
  if (maxEps >= 15) return 35;
  if (maxEps >= 10) return 30;
  if (maxEps >= 7) return 25;
  if (maxEps >= 5) return 20;
  if (maxEps >= 3) return 15;
  if (maxEps >= 2) return 10;
  return 5; // all sponsors appeared once — no retention signal
}

function scoreRepeatCount(
  sponsors: { episode_count: number }[]
): number {
  const repeats = sponsors.filter((s) => s.episode_count >= 3).length;

  // Multiple repeat sponsors = strong ad platform
  if (repeats >= 8) return 35;
  if (repeats >= 5) return 30;
  if (repeats >= 3) return 24;
  if (repeats >= 2) return 18;
  if (repeats >= 1) return 12;
  return 5;
}

function scoreSponsorBreadth(
  sponsors: { episode_count: number }[]
): number {
  const total = sponsors.length;

  // More unique sponsors = broader advertiser interest
  if (total >= 20) return 30;
  if (total >= 15) return 26;
  if (total >= 10) return 22;
  if (total >= 5) return 16;
  if (total >= 3) return 12;
  if (total >= 1) return 8;
  return 3;
}
