// ============================================================
// REACH SCORING (10% default weight)
// Scores 0-100 based on audience size and Podscan Reach Score (PRS).
// Intentionally the lowest weight — per the Taylslate thesis,
// a 5K-download show with 95% audience fit should surface
// alongside a 450K-download show with 80% fit.
// ============================================================

/**
 * Score reach based on audience size and PRS.
 * Returns 0-100. Always returns a value (audience size of 0 = score of 10).
 *
 * Scoring factors:
 * - Audience size tier (60 points) — logarithmic scale so small shows aren't crushed
 * - PRS score (40 points) — Podscan's composite reach metric
 */
export function scoreReach(
  audienceSize: number,
  prsScore: number | null | undefined
): number {
  let score = 0;

  // --- Audience size (60 points, logarithmic) ---
  score += scoreAudienceSize(audienceSize);

  // --- PRS (40 points) ---
  score += scorePRS(prsScore);

  return Math.round(Math.min(100, Math.max(0, score)));
}

/**
 * Logarithmic audience scoring so that the jump from 5K to 50K
 * isn't 10x the jump from 50K to 500K. This prevents large shows
 * from dominating the composite score.
 *
 * Tiers:
 *   500K+  = 60 pts
 *   200K+  = 52 pts
 *   100K+  = 46 pts
 *   50K+   = 40 pts
 *   25K+   = 34 pts
 *   10K+   = 28 pts
 *   5K+    = 22 pts
 *   1K+    = 16 pts
 *   <1K    = 10 pts
 */
function scoreAudienceSize(size: number): number {
  if (size >= 500000) return 60;
  if (size >= 200000) return 52;
  if (size >= 100000) return 46;
  if (size >= 50000) return 40;
  if (size >= 25000) return 34;
  if (size >= 10000) return 28;
  if (size >= 5000) return 22;
  if (size >= 1000) return 16;
  return 10;
}

/**
 * PRS is 0-100 from Podscan. Map to 40-point scale.
 */
function scorePRS(prs: number | null | undefined): number {
  if (prs == null) return 20; // neutral if no PRS

  // Direct mapping: PRS 0-100 → 0-40 points
  return Math.round((prs / 100) * 40);
}
