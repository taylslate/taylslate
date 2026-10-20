// Post-air score lift.
//
// A show that has a real reported conversion count above zero is lifted
// by a bounded amount so the next discovery sort guides toward it. The
// lift never lowers a score, never invents a score when the composite is
// missing, and never removes a show from a list. Callers must keep the
// show on screen either way. An explicit zero is not a penalty.

/** Points added when a show has reported conversions. Hard ceiling below. */
export const POST_AIR_LIFT_POINTS = 8;

/** Adjusted composites never pass this. */
export const POST_AIR_SCORE_CAP = 100;

export interface PostAirLift {
  /** Points actually added. Zero when there is nothing to apply. */
  delta: number;
  /**
   * Composite after the lift. Null when the original composite is missing
   * — a conversion count does not become a score.
   */
  adjusted: number | null;
  /** Shown next to the score. Null when nothing was learned. */
  reasoningLine: string | null;
}

/**
 * Apply the post-air lift to one composite.
 *
 * `reportedConversions` null means nobody reported a count. Zero means
 * they reported none. Only a positive count lifts.
 */
export function applyPostAirLift(
  composite: number | null,
  reportedConversions: number | null
): PostAirLift {
  const count = finiteCount(reportedConversions);
  if (count == null || count <= 0) {
    return {
      delta: 0,
      adjusted: finiteScore(composite),
      reasoningLine: null,
    };
  }

  const base = finiteScore(composite);
  if (base == null) {
    return { delta: 0, adjusted: null, reasoningLine: null };
  }

  const room = Math.max(0, POST_AIR_SCORE_CAP - base);
  const delta = Math.min(POST_AIR_LIFT_POINTS, room);
  const adjusted = base + delta;
  const noun = count === 1 ? "conversion" : "conversions";
  const reasoningLine =
    delta > 0
      ? `Post-air: ${count} reported ${noun}. Score lifted +${delta}.`
      : `Post-air: ${count} reported ${noun}. Score held at ${base}; the lift is capped.`;

  return { delta, adjusted, reasoningLine };
}

function finiteCount(value: number | null): number | null {
  if (value == null || !Number.isFinite(value) || value < 0) return null;
  return Math.trunc(value);
}

function finiteScore(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return value;
}
