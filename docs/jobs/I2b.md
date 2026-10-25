# I2b: confident past-campaign show match

Migration 068 is written and not applied. Nothing here was run against `ldtmhafewfifdizgfrnn` except two read-only queries before this renumber. Apply 068 after 067, and only after merge and Chris's OK. 067 is the roster-link review note.

## What shipped

`POST /api/imports/past-campaigns` sets `matched_show_id` only when the row's show name normalizes to exactly one eligible show. Zero matches and two or more matches store `matched_show_id` null, `show_match_status` `ambiguous`, and confidence `0`. A unique match stores the show id, status `matched`, reason `unique_normalized_name`, and confidence `1`.

Normalization, shared by `normalizeShowMatchKey` and `normalize_show_match_key`: U+2019 becomes an apostrophe, U+00A0 becomes a space, then case follows JavaScript `toLowerCase` (U+0130 expands to i plus a combining dot). The 32 ASCII punctuation characters become spaces, whitespace collapses, a leading `the` is removed, and a trailing `podcast` or `show` is removed. `The Acquired Podcast!` and `Acquired` are the same key. An empty key matches nothing. The SQL function sets `search_path` to empty and qualifies `pg_catalog`.

A show is eligible when `is_discoverable` is true, or when `is_discoverable` is false and `shows.agent_id` equals the signed-in caller. That `agent_id` is the creator stored by a non-admin show create. A hidden show someone else created is not a candidate, and it does not make a catalog name ambiguous. A missing `is_discoverable` flag is not treated as catalog. The save route passes the session user id. A `brand_id` or `matched_show_id` in the body is ignored.

`past_campaign_records` has a before insert or update trigger that computes the same decision for a brand session and overwrites a caller-supplied show id, status, reason, or confidence. It returns the row unchanged when `auth.role()` is `service_role`, or when `current_user` is `service_role` or `postgres`. The check on status, reason, and confidence still applies, so those sessions cannot store `matched` without a show id. A brand cannot force a link through PostgREST. The trigger reads `shows` and does not write `shows`.

Ambiguous rows stay on the brand's private table. `refresh_pooled_import_priors` skips `show_match_status = 'ambiguous'` and skips a show that is not discoverable. A row written before 068 has a null status. If that row already has `matched_show_id` and the show is discoverable, the pool still accepts it. A hidden show stays off the pool. There is no screen where a brand picks a show.

## Where

- `lib/imports/past-campaigns.ts`
- `app/api/imports/past-campaigns/route.ts`
- `supabase/migrations/068_past_campaign_show_match.sql`
- `docs/jobs/I2b.md`

`lib/imports/review.ts` is unchanged. Its catalog label is still an exact case-insensitive hint, and the save body from that screen still sends `matched_show_id: null`. The save route decides the link.

## Grants

068 adds columns to `past_campaign_records`. It does not create a table. It revokes anon and public again, and revokes truncate, references, and trigger from authenticated again. Authenticated keeps select, insert, update, and delete.

Live `information_schema.role_table_grants` for `past_campaign_records` on `ldtmhafewfifdizgfrnn`, read before 068 is applied:

- `anon` and `public`: no rows.
- `authenticated`: DELETE, INSERT, SELECT, UPDATE.
- `service_role` and `postgres`: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE.

`past_campaign_show_candidates(text)`, `normalize_show_match_key(text)`, and `enforce_past_campaign_show_match()` are executable by `authenticated` and `service_role`. Anon and public have no execute. `refresh_pooled_import_priors()` stays service_role only.

The same live query counted `past_campaign_records`: 0 rows, 0 with `matched_show_id` set. No backfill. No live write.

## Tests

`lib/imports/past-campaigns.test.ts`, `app/api/imports/past-campaigns/route.test.ts`, and `supabase/migrations/068_past_campaign_show_match.test.ts`.

Covers a unique normalized match, no match, two candidates, punctuation and suffix cases, U+2019, U+00A0, and Unicode case, a hidden show the caller did not create, a hidden show the caller created, a client show id ignored, a failed lookup saved as ambiguous, and no write to `shows`. The throwaway database checks the SQL key against the same strings, a brand overwrite, a service_role id that stays, the candidate function under `auth.uid()`, the pool skipping an ambiguous consented row and a hidden show, an empty `search_path` on the normalizer, and the grants. SQL checks always run. The throwaway database runs when Postgres binaries are present.

No UI change. Screenshots are not applicable.

`npx vitest run` passed 2197 tests. `npx tsc --noEmit` was clean. `npx next build` succeeded.

## Known gaps

- 068 is not applied. Until it is, the save insert writes columns the live table does not have, and the lookup calls a function that does not exist. Apply 068 after 067, before relying on this route.
- Ambiguous rows have no resolution step. They stay private and out of the pool. Brands do not match by hand.
- The review screen's catalog sentence is still the old exact-name hint. It can disagree with the link this route stores.
- A consented unique match of a discoverable show can enter the pool. The pool stores no show id. A hidden show does not enter, including one this caller created. A pre-068 row with a null status and a discoverable show id still enters.
- An em dash stays in the key. U+2019 does not.
- `The Mine Show` normalizes to `mine`, and `My Show` normalizes to `my`, because `show` is a suffix.
- A hidden show created by outreach acceptance has no `agent_id`, so this route does not match it.
- Pasting 068 drops and recreates `idx_shows_name_match_key`. That locks writes to `shows` for the build of the index.
