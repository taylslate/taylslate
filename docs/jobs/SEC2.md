# SEC2: constant-time cron auth and a race-free turn lock

No page or component was edited. Screenshots are not applicable.

## Cron auth

`lib/security/cron-auth.ts` exports `isCronAuthorized`. It copies the airchecks check: a missing secret is false, both sides are buffered, a different length is false, and an equal length uses `timingSafeEqual`. The header and the secret are not logged.

`conversion-alerts` and `deal-timeouts` call it with `allowUnsetSecretOutsideProduction: true`. An unset `CRON_SECRET` is still authorized when `NODE_ENV` is not `production`, which is the local-dev behavior those two routes had. The other three (`pooled-priors`, `youtube-library-pull`, `youtube-library-refresh`) stay fail-closed. Production and Vercel Preview run with `NODE_ENV` production, so they stay fail-closed there. Status codes and 401 bodies are unchanged.

`airchecks`, `roster-owner-notices`, and `youtube-library-emails` were not edited. They already use `timingSafeEqual`.

`app/api/cron/youtube-library-pull/route.test.ts` and `app/api/cron/youtube-library-refresh/route.test.ts` each asserted that the route source still contained `` Bearer ${secret} ``. That comparison now lives in the helper. Those two assertions were changed to `isCronAuthorized`. No other line in those files changed. They are outside the Owns list. Leaving them would fail `npx vitest run` on a string that this job was told to delete.

## Turn lock

Plain PostgREST cannot say "set my turn only if no other conversation of this brand holds a fresh turn" in one atomic statement. An advisory-lock RPC would also be atomic, but it needs a function and an execute grant. The partial unique index does not. It is the invariant on the column that already means "a turn is held", and it needs no RLS or grant change.

084 nulls duplicate non-null `turn_started_at` values per brand, keeping the latest (`turn_started_at desc, id desc`). It does not delete rows. Then:

```sql
create unique index if not exists command_agent_conversations_one_turn_per_brand
  on public.command_agent_conversations (brand_id)
  where turn_started_at is not null;
```

`claimTurn` then:

1. Nulls `turn_started_at` for this brand where it is older than 120 seconds, so a stale lock does not hold the unique slot.
2. Keeps the fresh pre-check as a fast busy.
3. Sets `turn_started_at` where `id`, `brand_id`, and `turn_started_at is null`. Unique violation 23505 is busy. Zero rows falls back to the existing conversation check (busy if the row exists, missing if it does not).
4. After a successful claim, reads fresh turns again. If this conversation is not the earliest, it releases the lock and returns busy. With 084 there is only one non-null turn, so this check changes nothing. Without 084 it still breaks the tie.

Return values stay `"claimed" | "busy" | "missing" | "error"`. The assistant route was not edited. The non-production unset-secret allowance on `conversion-alerts` and `deal-timeouts` is unchanged.

## Apply order

083 is applied on `ldtmhafewfifdizgfrnn`. 084 is in this PR and was not applied to any database.

Merge first, then apply 084 any time after Chris names it. Merging deploys the post-check, so two conversations of one brand still yield one winner before 084 exists. Do not apply 084 before this code is live. The claim path on production today treats a unique violation as an error, so a stale lock under the new index would return 503.

Paste `supabase/migrations/084_command_agent_turn_lock.sql` into the Supabase SQL Editor. Then run the introspection query in that file. Expected: one unique index on `(brand_id)` where `turn_started_at is not null`. Anon, public, and authenticated grants on `command_agent_conversations` stay empty. RLS is unchanged.
