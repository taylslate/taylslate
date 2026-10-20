// Detection hook for make-goods.
//
// Missed: the aircheck did not find the bought spot, or a person rejected
// the line. Short: the aircheck says the spot ran, and actual downloads
// fell more than the IO make-good threshold below the guarantee. Read
// length is not a column, so a missing length check is not a short spot.
//
// make_good_enabled off means no finding. The hook never charges and
// never throws into the aircheck call that triggered it.

import type { AircheckMatchResult, AircheckReviewDecision, AircheckStatus } from "./types";

export type AircheckUnderdeliveryKind = "missed" | "short";

export interface AircheckUnderdeliveryInput {
  makeGoodEnabled: boolean;
  /** insertion_orders.make_good_threshold. 0.10 means more than 10% below. */
  makeGoodThreshold: number;
  guaranteedDownloads: number;
  actualDownloads: number | null;
  aircheck: {
    status: AircheckStatus | string;
    match_result: AircheckMatchResult | null;
    review_decision: AircheckReviewDecision | null;
    reviewReason?: string | null;
    evidenceReason?: string | null;
  } | null;
}

export interface AircheckUnderdelivery {
  kind: AircheckUnderdeliveryKind;
  reason: string;
  guaranteedDownloads: number;
  actualDownloads: number | null;
  /** (guaranteed - actual) / guaranteed. Null when actual downloads are unknown. */
  shortfallPct: number | null;
  threshold: number;
}

function thresholdOf(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value >= 1) return 0.1;
  return value;
}

function shortfallPct(guaranteed: number, actual: number | null): number | null {
  if (actual == null || !Number.isFinite(actual) || guaranteed <= 0) return null;
  return (guaranteed - actual) / guaranteed;
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/**
 * Underdelivery against the IO, using the aircheck as the evidence the
 * spot did or did not run. Null when make-good is off or the aircheck
 * does not show a missed or short spot.
 */
export function detectAircheckUnderdelivery(
  input: AircheckUnderdeliveryInput
): AircheckUnderdelivery | null {
  if (input.makeGoodEnabled === false) return null;
  const aircheck = input.aircheck;
  if (!aircheck) return null;

  const guaranteed = Number(input.guaranteedDownloads) || 0;
  const actual =
    input.actualDownloads == null || !Number.isFinite(Number(input.actualDownloads))
      ? null
      : Number(input.actualDownloads);
  const threshold = thresholdOf(input.makeGoodThreshold);
  const gap = shortfallPct(guaranteed, actual);

  const base = {
    guaranteedDownloads: guaranteed,
    actualDownloads: actual,
    shortfallPct: gap,
    threshold,
  };

  if (aircheck.review_decision === "rejected") {
    const note = aircheck.reviewReason?.trim();
    return {
      ...base,
      kind: "missed",
      reason: note
        ? `Aircheck rejected: the spot did not run. ${note}`
        : "Aircheck rejected: the spot did not run.",
    };
  }

  // A person confirmed the read. That overrides a not_matched judgment.
  if (
    aircheck.match_result === "not_matched" &&
    aircheck.review_decision !== "confirmed"
  ) {
    const note = aircheck.evidenceReason?.trim();
    return {
      ...base,
      kind: "missed",
      reason: note
        ? `Aircheck did not find the spot in the episode. ${note}`
        : "Aircheck did not find the spot in the episode.",
    };
  }

  const aired =
    aircheck.match_result === "matched" || aircheck.review_decision === "confirmed";
  if (!aired || aircheck.status === "failed" || aircheck.status === "pending") {
    return null;
  }
  if (gap == null || gap <= threshold) return null;

  return {
    ...base,
    kind: "short",
    reason: `Delivered ${actual} downloads against ${guaranteed} guaranteed (${pct(gap)} below the ${pct(threshold)} make-good threshold). The aircheck shows the spot ran. Read length is not stored on the IO.`,
  };
}

/**
 * After an aircheck is stored, matched, confirmed, or rejected, look for
 * a make-good. Failures stay in the log. They do not change the aircheck
 * result and they do not charge.
 */
export async function runMakeGoodDetectionHook(ioLineItemId: string): Promise<void> {
  try {
    const { proposeMakeGoodForLine } = await import("@/lib/make-goods/propose");
    await proposeMakeGoodForLine(ioLineItemId);
  } catch (err) {
    console.error(
      "[airchecks] make-good detection failed:",
      err instanceof Error ? err.message : err
    );
  }
}
