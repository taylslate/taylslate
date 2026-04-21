// ============================================================
// Pricing utilities for the media plan builder.
// Single source of truth for placement multipliers and derived
// financials so the discovery list, plan table, and IO generator
// all compute the same numbers.
// ============================================================

import type { Placement, PlanSpacing } from "@/lib/data/types";

// Per CLAUDE.md: pre-roll +10%, mid-roll standard, post-roll -25%.
export const PLACEMENT_MULTIPLIERS: Record<Placement, number> = {
  "pre-roll": 1.1,
  "mid-roll": 1.0,
  "post-roll": 0.75,
};

const SPACING_DAYS: Record<PlanSpacing, number> = {
  weekly: 7,
  biweekly: 14,
  monthly: 30,
};

/** Adjusted CPM for a given placement. */
export function adjustedCpm(baseCpm: number, placement: Placement): number {
  return baseCpm * PLACEMENT_MULTIPLIERS[placement];
}

/** Spot price per episode: (downloads / 1000) × CPM × placement multiplier. */
export function spotPrice(
  audienceSize: number,
  baseCpm: number,
  placement: Placement
): number {
  return (audienceSize / 1000) * adjustedCpm(baseCpm, placement);
}

/** Line total = spot price × episodes. */
export function lineTotal(
  audienceSize: number,
  baseCpm: number,
  placement: Placement,
  episodes: number
): number {
  return spotPrice(audienceSize, baseCpm, placement) * episodes;
}

/** Total impressions across a plan = Σ audience × episodes. */
export function totalImpressions(
  items: { audienceSize: number; episodes: number }[]
): number {
  return items.reduce((sum, it) => sum + it.audienceSize * it.episodes, 0);
}

/** Blended CPM = totalSpend / (totalImpressions / 1000). */
export function blendedCpm(totalSpend: number, impressions: number): number {
  if (impressions <= 0) return 0;
  return totalSpend / (impressions / 1000);
}

/**
 * Campaign length in weeks, based on the max number of episodes on any line
 * item and the chosen spacing. A 6-episode biweekly cadence runs 12 weeks;
 * the plan lasts as long as the longest-running line item.
 */
export function campaignLengthWeeks(
  maxEpisodes: number,
  spacing: PlanSpacing
): number {
  if (maxEpisodes <= 0) return 0;
  const days = (maxEpisodes - 1) * SPACING_DAYS[spacing] + SPACING_DAYS[spacing];
  return Math.max(1, Math.round(days / 7));
}

/** Human-readable length ("6 weeks", "3 months") from weeks. */
export function formatCampaignLength(weeks: number): string {
  if (weeks <= 0) return "—";
  if (weeks < 8) return `${weeks} week${weeks === 1 ? "" : "s"}`;
  const months = Math.round(weeks / 4);
  return `${months} month${months === 1 ? "" : "s"}`;
}
