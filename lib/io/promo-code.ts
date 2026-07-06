// Wave 14 Phase 2D — Layer A: per-deal promo code.
//
// A promo code is the word a show reads on air for attribution
// ("get 20% off, code HUBERMAN"). By podcasting convention it matches the
// show name ~99% of the time, so the deal page prefills a show-name slug and
// the brand edits or clears it. `normalizePromoCode` is the single source of
// truth for the slug rules — both the prefill default (`derivePromoCode`) and
// the persist endpoint call it, so the two can never drift.

/** Max stored length. Promo codes are short single words; cap defensively. */
export const MAX_PROMO_CODE_LENGTH = 24;

// A leading article carries no meaning in a promo code ("The Daily" → DAILY).
// Requires trailing whitespace so a one-word name like "The" is left intact.
const LEADING_ARTICLE = /^(the|a|an)\s+/i;

/**
 * Canonicalize any raw string into a promo-code slug: trim, drop a leading
 * article, take the first token, keep [A-Z0-9] only, uppercase, cap length.
 * Returns null when nothing usable remains (empty / whitespace / punctuation).
 *
 * Shared by `derivePromoCode` (show-name default) and the PATCH endpoint
 * (brand input), so both apply identical rules.
 */
export function normalizePromoCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const withoutArticle = raw.trim().replace(LEADING_ARTICLE, "");
  const firstToken = withoutArticle.trim().split(/\s+/)[0] ?? "";
  const slug = firstToken
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase()
    .slice(0, MAX_PROMO_CODE_LENGTH);
  return slug.length > 0 ? slug : null;
}

/**
 * The prefilled default for a deal's promo code, derived from the show name.
 * Display-only: prefilling the input does not persist anything — only an
 * explicit Save writes `deals.promo_code`.
 *
 * TODO(backlog): default may later come from a show's `preferred_promo_code`
 * ahead of the name slug (not built now).
 */
export function derivePromoCode(showName: string | null | undefined): string | null {
  return normalizePromoCode(showName);
}
