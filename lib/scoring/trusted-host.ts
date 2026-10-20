// ============================================================
// TRUSTED HOST — first-time brands
//
// A small composite bump for a host a brand can start with: the show
// is verified, or it already has a recorded sponsor. Applied only when
// the brand has no prior campaign. The note is part of the score so
// the bump is visible. It never removes a show, and it does not run
// for a brand that has already bought.
// ============================================================

import type { Show } from "@/lib/data/types";

/** Points added to the composite. Small on purpose — a sort nudge. */
export const TRUSTED_HOST_COMPOSITE_BUMP = 2;

export const TRUSTED_HOST_NOTE =
  "Trusted host — weighted a little higher because this brand is buying its first campaign.";

export function isTrustedHost(show: Pick<Show, "is_verified" | "current_sponsors" | "past_sponsors">): boolean {
  if (show.is_verified) return true;
  return sponsorNames(show.current_sponsors).length > 0 || sponsorNames(show.past_sponsors).length > 0;
}

function sponsorNames(names: string[] | undefined): string[] {
  if (!names) return [];
  return names.filter((name) => typeof name === "string" && name.trim().length > 0);
}
