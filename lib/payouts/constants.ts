// Pay-as-delivers payout constants. Every percentage that touches money
// lives here so it is swappable in one place — never hardcode a fee
// number in a route or webhook handler.

/**
 * Fee withheld when a show requests early payout — i.e. transfer of
 * funds before the brand charge has cleared end-to-end (still inside
 * the settled-but-not-aged window). Stored as a fraction (0.025 = 2.5%).
 */
export const EARLY_PAYOUT_FEE_PERCENTAGE = 0.025;
