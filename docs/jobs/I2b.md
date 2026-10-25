# I2b: confident past-campaign show match

Migration 067 is written and not applied. Nothing here was run against `ldtmhafewfifdizgfrnn` except two read-only queries. Apply 067 after 066, and only after merge and Chris's OK.

## What shipped

`POST /api/imports/past-campaigns` sets `matched_show_id` only when the row's show name normalizes to exactly one eligible show. Zero matches and two or more matches store `matched_show_id` null, `show_match_status` `ambiguous`, and confidence `0`. A unique match stores the show id, status `matched`, reason `unique_normalized_name`, and confidence `1`.

Normalization, shared by `normalizeShowMatchKey` and `normalize_show_match_key`: ASCII lowercase, the 32 ASCII punctuation characters become spaces, whitespace collapses, a leading `the` is removed, and a trailing `podcast` or `show` is removed. `The Acquired Podcast!` and `Acquired` are the same key. An empty key matches nothing.

A show is eligible when `is_discoverable` is true, or when `is_discoverable` is false and `shows.agent_id` equals the signed-in caller. That `agent_id` is the creator stored by a non-admin show create. A hidden show someone else created is not a candidate, and it does not make a catalog name ambiguous. A missing `is_discoverable` flag is not treated as catalog. The save route passes the session user id. A `brand_id` or `matched_show_id` in the body is ignored.

`past_campaign_records` has a before insert or update trigger that computes the same decision and overwrites any caller-supplied show id, status, reason, or confidence. A brand cannot force a link through PostgREST. The trigger reads `shows` and does not write `shows`.

Ambiguous rows stay on the brand's private table. `refresh_pooled_import_priors` skips `show_match_status = 'ambiguous'`. A row written before 067 has a null status. If that row already has `matched_show_id`, the pool still accepts it. There is no screen where a brand picks a show.

## Where

- `lib/imports/past-campaigns.ts`
- `app/api/imports/past-campaigns/route.ts`
- `supabase/migrations/067_past_campaign_show_match.sql`
- `docs/jobs/I2b.md`

`lib/imports/review.ts` is unchanged. Its catalog label is still an exact case-insensitive hint, and the save body from that screen still sends `matched_show_id: null`. The save route decides the link.

## Grants

067 adds columns to `past_campaign_records`. It does not create a table. It revokes anon and public again, and revokes truncate, references, and trigger from authenticated again. Authenticated keeps select, insert, update, and delete.

Live `information_schema.role_table_grants` for `past_campaign_records` on `ldtmhafewfifdizgfrnn`, read before 067 is applied:

- `anon` and `public`: no rows.
- `authenticated`: DELETE, INSERT, SELECT, UPDATE.
- `service_role` and `postgres`: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE.

`past_campaign_show_candidates(text)`, `normalize_show_match_key(text)`, and `enforce_past_campaign_show_match()` are executable by `authenticated` and `service_role`. Anon and public have no execute. `refresh_pooled_import_priors()` stays service_role only.

The same live query counted `past_campaign_records`: 0 rows, 0 with `matched_show_id` set. No backfill. No live write.

## Tests

`lib/imports/past-campaigns.test.ts`, `app/api/imports/past-campaigns/route.test.ts`, and `supabase/migrations/067_past_campaign_show_match.test.ts`.

Covers a unique normalized match, no match, two candidates, punctuation and suffix cases, a hidden show the caller did not create, a hidden show the caller created, a client show id ignored, a failed lookup saved as ambiguous, and no write to `shows`. The throwaway database checks the SQL key against the same strings, the trigger overwrite, the candidate function under `auth.uid()`, the pool skipping an ambiguous consented row, and the grants. SQL checks always run. The throwaway database runs when Postgres binaries are present.

No UI change. Screenshots are not applicable.

`npx vitest run` passed 2157 tests. `npx tsc --noEmit` was clean. `npx next build` succeeded.

## Known gaps

- 067 is not applied. Until it is, the save insert writes columns the live table does not have, and the lookup calls a function that does not exist. Apply 067 before relying on this route.
- Ambiguous rows have no resolution step. They stay private and out of the pool. Brands do not match by hand.
- The review screen's catalog sentence is still the old exact-name hint. It can disagree with the link this route stores.
- A consented unique match can enter the pool, including a match to a hidden show this caller created when that show has a category. The pool stores no show id. Pre-067 rows with a null status and a show id still enter.
- Only ASCII punctuation is stripped. A curly quote or an em dash stays in the key.
- `The Mine Show` normalizes to `mine`, and `My Show` normalizes to `my`, because `show` is a suffix.
- A hidden show created by outreach acceptance has no `agent_id`, so this route does not match it.
- Pasting 067 drops and recreates `idx_shows_name_match_key`. That locks writes to `shows` for the build of the index.
