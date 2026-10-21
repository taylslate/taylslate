// ============================================================
// SIMULCAST SURFACES + MEDIUM PRIORS
//
// One show can be a podcast and a long-form YouTube channel. Discovery may
// return both as separate Show records; mergeSimulcasts folds them into one
// and asks this module for the per-medium payload.
//
// surfaces  — only on a merged simulcast. Per medium: audience, CPM range,
//             links. The primary row keeps the podcast audience. The two
//             audiences are never added together (that would double-count
//             reach and double-charge the brand).
// medium_priors — on every show. CPM range, engagement weight, frequency.
//             Launch engagement weight is 1. Nothing in scoring reads it as
//             a filter. Scores guide; medium does not gate.
// ============================================================

import type {
  MediumPrior,
  Show,
  ShowCpmRange,
  ShowMediumPriors,
  ShowRateCard,
  ShowSurface,
  ShowSurfaces,
} from "@/lib/data/types";
import { DEFAULT_SPOT_COUNT } from "./spot-cost";

/** Recorded, not applied. A later scorer may read it; launch does not. */
export const LAUNCH_ENGAGEMENT_WEIGHT = 1;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Placement CPMs on a podcast rate card, in dollars. */
export function cpmRangeFromRateCard(
  card: ShowRateCard | undefined
): ShowCpmRange | undefined {
  if (!card) return undefined;
  const vals = [card.preroll_cpm, card.midroll_cpm, card.postroll_cpm].filter(
    (n): n is number => typeof n === "number" && Number.isFinite(n) && n > 0
  );
  if (vals.length === 0) return undefined;
  return { min: Math.min(...vals), max: Math.max(...vals) };
}

/**
 * Implied CPM band for a YouTube flat fee. Width matches the discovery card
 * (half to double the point estimate) — a range, not a settled rate.
 * Undefined when audience is missing: a CPM from a flat fee needs reach.
 */
export function impliedYouTubeCpmRange(
  flatRate: number | undefined,
  audienceSize: number | undefined
): ShowCpmRange | undefined {
  if (flatRate == null || !Number.isFinite(flatRate) || flatRate <= 0) {
    return undefined;
  }
  if (
    audienceSize == null ||
    !Number.isFinite(audienceSize) ||
    audienceSize <= 0
  ) {
    return undefined;
  }
  const implied = flatRate / (audienceSize / 1000);
  return { min: round2(implied * 0.5), max: round2(implied * 2) };
}

export function podcastSurfaceFromShow(show: Show): ShowSurface {
  const range = cpmRangeFromRateCard(show.rate_card);
  const rss = show.rss_url?.trim();
  return {
    rss_url: show.rss_url,
    audience_size: show.audience_size,
    rate_card: show.rate_card,
    ...(range ? { cpm_range: range } : {}),
    ...(rss ? { links: { rss } } : {}),
  };
}

export function youtubeSurfaceFromShow(show: Show): ShowSurface {
  const range = impliedYouTubeCpmRange(
    show.rate_card?.flat_rate,
    show.audience_size
  );
  const channelId = show.youtube_channel_id?.trim();
  return {
    youtube_channel_id: show.youtube_channel_id,
    audience_size: show.audience_size,
    rate_card: show.rate_card,
    ...(range ? { cpm_range: range } : {}),
    ...(channelId
      ? { links: { channel: `https://www.youtube.com/channel/${channelId}` } }
      : {}),
  };
}

function priorFromRange(range: ShowCpmRange | undefined): MediumPrior {
  return {
    ...(range ? { cpm_min: range.min, cpm_max: range.max } : {}),
    engagement_weight: LAUNCH_ENGAGEMENT_WEIGHT,
    frequency_spots: DEFAULT_SPOT_COUNT,
  };
}

/**
 * Priors for the mediums this show actually occupies. A simulcast passes the
 * merged `surfaces` so each medium's range comes from that surface, not from
 * the primary row's rate card alone.
 */
export function mediumPriorsForShow(
  show: Show,
  surfaces?: ShowSurfaces
): ShowMediumPriors {
  const hasPodcast = show.platform === "podcast" || !!surfaces?.podcast;
  const hasYoutube = show.platform === "youtube" || !!surfaces?.youtube;
  const priors: ShowMediumPriors = {};
  if (hasPodcast) {
    const range =
      surfaces?.podcast?.cpm_range ??
      (show.platform === "podcast"
        ? cpmRangeFromRateCard(show.rate_card)
        : undefined);
    priors.podcast = priorFromRange(range);
  }
  if (hasYoutube) {
    const range =
      surfaces?.youtube?.cpm_range ??
      (show.platform === "youtube"
        ? impliedYouTubeCpmRange(show.rate_card?.flat_rate, show.audience_size)
        : undefined);
    priors.youtube = priorFromRange(range);
  }
  return priors;
}

/**
 * Phrase the reasoning text uses. A simulcast names both surfaces. This is
 * a label for the brand, not a score and not a reason to drop the show.
 */
export function describeShowMedium(
  show: Pick<Show, "platform" | "surfaces">
): string {
  const hasPodcast = show.platform === "podcast" || !!show.surfaces?.podcast;
  const hasYoutube = show.platform === "youtube" || !!show.surfaces?.youtube;
  if (hasPodcast && hasYoutube) return "podcast and YouTube";
  if (hasYoutube) return "YouTube";
  return "podcast";
}
