// Single source of truth for deriving a short brand name from a brand profile.
//
// Historically each consumer (outreach From: line, IO advertiser name, pitch
// drafts, response/cron emails) re-implemented the same fragile split of the
// free-text `brand_identity` paragraph. On a paragraph with no early
// punctuation that leaked prose where a name belongs (the A6 bug). This helper
// centralizes the logic and prefers the durable, user-confirmed `brand_name`
// field, so the paragraph split survives only as a bounded legacy fallback.

import type { BrandProfile } from "@/lib/data/types";

// The identity-clause fallback derives from a free-text paragraph. Splitting on
// clause punctuation yields the whole string when the paragraph has no early
// punctuation, so bound it to a name-length cap at a word boundary — otherwise a
// paragraph leaks into any consumer that doesn't re-normalize (IO PDF advertiser
// name, pitch drafts, cron/response emails). The outreach From: line normalizes
// again downstream; this makes the leak structurally impossible everywhere else.
const MAX_FALLBACK_NAME_LENGTH = 60;

function boundedIdentityClause(identity: string): string {
  // Split on sentence/clause punctuation and spaced dashes ONLY, never a bare
  // hyphen (so "Sun-Dried Tomato Co" survives; Codex-hardened).
  const clause = identity.split(/[.,;]|\s[—–-]\s/)[0]?.trim() ?? "";
  if (clause.length <= MAX_FALLBACK_NAME_LENGTH) return clause;
  const capped = clause.slice(0, MAX_FALLBACK_NAME_LENGTH);
  const lastSpace = capped.lastIndexOf(" ");
  return (lastSpace > 0 ? capped.slice(0, lastSpace) : capped).trim();
}

/**
 * Resolve a short brand name from a brand profile, or null if none can be
 * derived. Precedence:
 *   1. brand_name — durable, user-confirmed (captured in onboarding).
 *   2. First (bounded) clause of brand_identity — legacy fallback for
 *      un-backfilled rows.
 *   3. brand_website domain — last resort.
 * Callers supply their own final fallback string (e.g. "Advertiser").
 */
export function brandNameFromProfile(bp: BrandProfile): string | null {
  const explicit = bp.brand_name?.trim();
  if (explicit) return explicit;

  if (bp.brand_identity) {
    const clause = boundedIdentityClause(bp.brand_identity);
    if (clause) return clause;
  }

  const domain = bp.brand_website
    ?.replace(/^https?:\/\/(www\.)?/, "")
    .split("/")[0]
    ?.trim();
  return domain || null;
}
