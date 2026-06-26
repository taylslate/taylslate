// ============================================================
// PORTFOLIO RECOMPUTE SERVICE (Wave 14 Phase 2C — Layer 5)
//
// The shared service behind the three discovery override controls (campaign
// spot-count, placement [campaign + per-show], per-show CPM) and reset-to-default.
// One entry point: applyPortfolioOverride(campaignId, override).
//
// It does three things, in order:
//   1. PERSIST the override INPUT (durable system-of-record): campaign-level to
//      campaigns.test_spot_count / test_placement; per-show to
//      conviction_scores.cpm_override_cents / placement_override. Inputs are
//      written FIRST so they survive even if the recompute partially fails.
//   2. RECOMPUTE the cost/tier CACHE: re-run the tier pass, which reads the now-
//      persisted campaign config (via the campaign context) + per-show overrides
//      (off each row) and rewrites tier + cost on conviction_scores. Tiers
//      reshuffle (a scale show pulled under budget by a single-spot cadence or a
//      lower CPM lands in test, and vice-versa).
//   3. EMIT portfolio.override_applied (fail-soft) so the pattern library
//      captures what the brand changed and how the split moved.
//
// REQUEST-SCOPE FOOTGUN (spec, Layer 3/5): the default tier pass loads shows via
// the cookie-based server client, which only resolves inside a request scope.
// This service injects the ADMIN show loader (getShowsByIdsAdmin) instead, so a
// recompute tiers the REAL universe regardless of caller scope — never an empty
// one. (Campaign-override + per-show persistence keep their RLS-respecting
// clients; the endpoints that call this already verified ownership.)
// ============================================================

import type { CampaignPatternRow } from "@/lib/data/types";
import {
  tierCampaignPortfolio,
  defaultTierPortfolioDeps,
  type TierPortfolioDeps,
  type TierPortfolioResult,
} from "./tier-portfolio";
import type { Placement } from "./spot-cost";
import {
  getShowsByIdsAdmin,
  updateCampaignTierOverrides,
} from "@/lib/data/queries";
import {
  getLatestCampaignPatternForCampaign,
  updatePerShowOverride,
  clearPerShowOverridesForPattern,
} from "@/lib/data/reasoning-log";
import { logEvent, type LogEventInput } from "@/lib/data/events";

/** One override action — maps 1:1 to a discovery override control. */
export type PortfolioOverride =
  | { kind: "campaign_spot_count"; spotCount: number }
  | { kind: "campaign_placement"; placement: Placement }
  | { kind: "show_cpm"; showId: string; cpmOverrideCents: number | null }
  | { kind: "show_placement"; showId: string; placementOverride: Placement | null }
  | { kind: "reset" };

export interface RecomputePortfolioDeps {
  loadPattern: (campaignId: string) => Promise<CampaignPatternRow | null>;
  persistCampaignOverrides: (
    campaignId: string,
    input: {
      testSpotCount?: number | null;
      testPlacement?: Placement | null;
    }
  ) => Promise<boolean>;
  persistShowOverride: (input: {
    campaignPatternId: string;
    showId: string;
    cpmOverrideCents?: number | null;
    placementOverride?: Placement | null;
  }) => Promise<boolean>;
  clearShowOverrides: (campaignPatternId: string) => Promise<boolean>;
  /** Re-run the tier pass for a pattern → rewrite the cost/tier cache. The
   *  default injects the ADMIN show loader (footgun) and otherwise uses the
   *  standard deps; the tier pass reads the persisted campaign config + per-show
   *  overrides itself. */
  runTierPass: (campaignPatternId: string) => Promise<TierPortfolioResult>;
  emit: (input: LogEventInput) => Promise<unknown>;
}

/** Tier-pass deps for the recompute path: admin show loader (request-scope-free)
 *  spread over the standard deps. Exported for tests that want to assert it. */
export const recomputeTierPassDeps: TierPortfolioDeps = {
  ...defaultTierPortfolioDeps,
  loadShowsByIds: async (ids) => {
    const shows = await getShowsByIdsAdmin(ids);
    return new Map(shows.map((s) => [s.id, s]));
  },
};

export const defaultRecomputeDeps: RecomputePortfolioDeps = {
  loadPattern: getLatestCampaignPatternForCampaign,
  persistCampaignOverrides: updateCampaignTierOverrides,
  persistShowOverride: updatePerShowOverride,
  clearShowOverrides: clearPerShowOverridesForPattern,
  runTierPass: (patternId) =>
    tierCampaignPortfolio(patternId, recomputeTierPassDeps),
  emit: logEvent,
};

export interface RecomputeResult {
  ok: boolean;
  campaignPatternId: string | null;
  /** The re-tiered counts (test/scale/dropped, underfilled) after the override. */
  tier: TierPortfolioResult | null;
  errors: string[];
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Apply one override, persist it, recompute the split, and emit the event.
 * Fail-soft: collects errors, never throws. ok=false only when there's no
 * discovery pattern to recompute against (the brand hasn't run discovery yet)
 * or the input persist hard-failed — the caller surfaces that to the brand.
 */
export async function applyPortfolioOverride(
  campaignId: string,
  override: PortfolioOverride,
  deps: RecomputePortfolioDeps = defaultRecomputeDeps
): Promise<RecomputeResult> {
  const errors: string[] = [];

  let pattern: CampaignPatternRow | null = null;
  try {
    pattern = await deps.loadPattern(campaignId);
  } catch (err) {
    errors.push(`loadPattern failed: ${msg(err)}`);
  }
  if (!pattern) {
    return {
      ok: false,
      campaignPatternId: null,
      tier: null,
      errors: [...errors, "No discovery pattern for this campaign."],
    };
  }

  // 1. Persist the override INPUT first (durable, survives a failed recompute).
  let persisted = true;
  try {
    switch (override.kind) {
      case "campaign_spot_count":
        persisted = await deps.persistCampaignOverrides(campaignId, {
          testSpotCount: override.spotCount,
        });
        break;
      case "campaign_placement":
        persisted = await deps.persistCampaignOverrides(campaignId, {
          testPlacement: override.placement,
        });
        break;
      case "show_cpm":
        persisted = await deps.persistShowOverride({
          campaignPatternId: pattern.id,
          showId: override.showId,
          cpmOverrideCents: override.cpmOverrideCents,
        });
        break;
      case "show_placement":
        persisted = await deps.persistShowOverride({
          campaignPatternId: pattern.id,
          showId: override.showId,
          placementOverride: override.placementOverride,
        });
        break;
      case "reset": {
        // Clear BOTH layers: campaign config back to default, every per-show
        // override wiped → next recompute derives at mid-roll / 3 spots.
        const campaignCleared = await deps.persistCampaignOverrides(campaignId, {
          testSpotCount: null,
          testPlacement: null,
        });
        const showsCleared = await deps.clearShowOverrides(pattern.id);
        persisted = campaignCleared && showsCleared;
        break;
      }
    }
  } catch (err) {
    persisted = false;
    errors.push(`persist override failed: ${msg(err)}`);
  }
  if (!persisted) {
    errors.push("Override input did not persist; tiers were not recomputed.");
    return { ok: false, campaignPatternId: pattern.id, tier: null, errors };
  }

  // 2. Recompute the cost/tier cache from the now-persisted inputs.
  let tier: TierPortfolioResult | null = null;
  try {
    tier = await deps.runTierPass(pattern.id);
    errors.push(...tier.errors);
  } catch (err) {
    errors.push(`recompute (tier pass) failed: ${msg(err)}`);
  }

  // 3. Emit portfolio.override_applied (fail-soft — never blocks the response).
  try {
    await deps.emit({
      eventType: "portfolio.override_applied",
      entityType: "campaign",
      entityId: campaignId,
      payload: {
        campaignPatternId: pattern.id,
        override,
        testCount: tier?.testCount ?? null,
        scaleCount: tier?.scaleCount ?? null,
        droppedCount: tier?.droppedCount ?? null,
        testUnderfilled: tier?.testUnderfilled ?? null,
      },
    });
  } catch (err) {
    errors.push(`emit portfolio.override_applied failed: ${msg(err)}`);
  }

  return { ok: true, campaignPatternId: pattern.id, tier, errors };
}
