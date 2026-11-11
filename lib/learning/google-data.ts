// Google Limited Use
// (https://developers.google.com/terms/api-services-user-data-policy)
// bars transferring or using Google user data beyond the user-facing
// feature it was granted for. LG2 states: "Results from Google data are
// not used in pooled anonymized data or to improve Taylslate for other
// users."
//
// Providers listed here are airchecks produced from a creator's own
// YouTube captions (AC-YT). Those rows must not enter lib/learning or
// any pooled job. Match is exact and case-sensitive. Null or missing
// is not Google-derived: those rows predate a transcript source or came
// from the default path, and they still count.

export const GOOGLE_DERIVED_AIRCHECK_PROVIDERS = ["youtube-captions"] as const;

export function isGoogleDerivedAircheck(row: {
  provider?: string | null;
}): boolean {
  if (row.provider == null) return false;
  return (GOOGLE_DERIVED_AIRCHECK_PROVIDERS as readonly string[]).includes(
    row.provider
  );
}
