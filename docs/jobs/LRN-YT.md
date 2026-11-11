# LRN-YT: keep YouTube caption airchecks out of learning

No migration. Nothing was applied to `ldtmhafewfifdizgfrnn`. No payment code was edited. No screen, style, or animation was changed.

Read-only precheck on `ldtmhafewfifdizgfrnn` (Nov 11, 2026): 0 rows in `public.airchecks`. No provider values. No `youtube-captions` rows.

Grounded at main `5ec402d`. This must merge before AC-YT (`bc-53b844e3`) writes its first row.

## Why

Airchecks produced from a creator's own YouTube captions (`provider` `youtube-captions`, written by AC-YT) must not feed `lib/learning`.

Google's Limited Use rules (https://developers.google.com/terms/api-services-user-data-policy) bar transferring or using Google user data beyond the user-facing feature it was granted for. The privacy copy in PR 97 (LG2) says: "Results from Google data are not used in pooled anonymized data or to improve Taylslate for other users."

Before this job, `lib/learning/load.ts` read `airchecks.match_evidence` and `airchecks.review_decision` for every line, with no provider filter. `lib/learning/assemble.ts` turned those rows into `codeOnAir`, `aircheckDecision`, and the aired signal. A `youtube-captions` row would have entered the learning review and, through that review, the data used to improve Taylslate.

`airchecks.provider` is live (migration 038). Null means the row predates a transcript source or came from the default path. Null rows still count. The filter is the provider string only.

## Rule

No Google-derived row enters `lib/learning` or any pooled job.

`youtube-captions` is the only Google-derived aircheck provider. The match is exact and case-sensitive. `null`, a missing provider, `podscan`, `deepgram`, `whisper`, and `YouTube-Captions` still count.

## Where it is enforced

- `lib/learning/google-data.ts` exports `GOOGLE_DERIVED_AIRCHECK_PROVIDERS` and `isGoogleDerivedAircheck`. It does not import `lib/airchecks` or `lib/youtube-oauth`.
- `lib/learning/load.ts` selects `provider` on both aircheck reads (`io_line_item_id, provider, match_evidence` and `io_line_item_id, provider, review_decision`). `filterLearningAirchecks` drops Google-derived rows from both result sets before the merge. If the provider column cannot be read, `selectInOptional` already returns `[]`. There is no second read that omits `provider`.
- `lib/learning/assemble.ts` skips Google-derived rows when building `airByLine`. A caller that passes one in still gets `codeOnAir` null and `aircheckDecision` null from that row, and the row does not count as aired. A completed deal or a verified line can still be aired from those other signals.
- `lib/learning/review.ts` is unchanged. It consumes the assembled fields. The aired sentence there still means a confirmed aircheck, a verified line, or a completed deal, and the confirmed aircheck is one assemble kept.
- Pooled jobs today are `lib/learning/pooled-deal-priors.ts` (RPC `refresh_pooled_deal_priors`, migration 069) and `lib/learning/pooled-priors.ts`. `lib/learning/post-air-outcomes.ts` is included in the same guard. None of them read `airchecks`. `lib/learning/pooled-guard.test.ts` fails if any of those four files contains `airchecks` or `youtube_aircheck_metrics`.

## Later work

A future job that reads `airchecks` or `youtube_aircheck_metrics` for learning or pooling needs Chris's OK plus a Limited Use review. Read this file first.
