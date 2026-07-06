// Wave 14 Phase 2D — Layer C: copy-paste show-notes blurb.
//
// The one sentence a show pastes into its episode description so listeners can
// act ("Check out Sauna Box at <link> — use code HUBERMAN."). It stitches
// together Layer A (the promo code, `deals.promo_code`) and Layer B (the UTM
// tracking link, `buildTrackingLink`) into a single ready-to-paste string.
//
// DETERMINISTIC TEMPLATE — not an LLM call. Pure string assembly.
//
// GENERATED ON READ — no migration, no column, no persistence (same rationale
// as Layer B's tracking link: rendering a derived string is not a user
// decision). This helper REUSES the outputs of Layers A + B — it receives the
// already-computed promo code and tracking link as inputs and never recomputes
// `buildTrackingLink` or `normalizePromoCode` itself.
//
// TODO(backlog): the month-3-6 "show-notes value bundle" (click-through
// tracking, "shows that include the link" as a conviction signal, richer
// copy) builds on this — not built now.

export interface ShowNotesBlurbParams {
  /** Brand display name — the sentence anchor. */
  brandName?: string | null;
  /** Saved promo code (deals.promo_code, Layer A). Null when none is set. */
  promoCode?: string | null;
  /** UTM tracking link (buildTrackingLink, Layer B). Null when unavailable. */
  trackingLink?: string | null;
}

/**
 * Assemble the show-notes blurb from a brand name, promo code, and tracking
 * link. All inputs are trimmed; blank strings are treated as absent.
 *
 * Returns null when there is nothing actionable to hand the show (neither a
 * link nor a code) — callers render nothing in that case.
 *
 * Degradation (guaranteed never to emit "code null", "undefined", double
 * spaces, or dangling punctuation):
 *   link + code → "Check out {brand} at {link} — use code {CODE}."
 *   link only   → "Check out {brand} at {link}."
 *   code only   → "Check out {brand} — use code {CODE}."
 *   neither     → null
 */
export function buildShowNotesBlurb({
  brandName,
  promoCode,
  trackingLink,
}: ShowNotesBlurbParams): string | null {
  const link = trackingLink?.trim() || null;
  const code = promoCode?.trim() || null;

  // Nothing the show can act on → render nothing rather than a bare brand name.
  if (!link && !code) return null;

  // Brand name anchors the sentence; a neutral lead keeps a link/code-only
  // blurb grammatical if the name is somehow blank (page.tsx always passes one).
  const brand = brandName?.trim() || "our sponsor";

  let blurb = `Check out ${brand}`;
  if (link) blurb += ` at ${link}`;
  if (code) blurb += ` — use code ${code}`;
  blurb += ".";

  return blurb;
}
