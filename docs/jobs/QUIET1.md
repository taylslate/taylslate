# QUIET1: show name search wildcards and the 089 cross-profile test

Grounded on `origin/main` at `8c79cfd`. No migration. Nothing in this job was written to the live database.

## What changed

A show name search is a literal contains match. `GET /api/shows?search=` and the catalog half of direct show search both go through `getShowsFiltered`. That function used to pass the term into PostgREST `ilike` with `%`, `_`, and `*` still live, so `search=*` or `search=%` matched every discoverable show.

`escapeShowNameTerm` trims, removes every `*`, undoes one escape pass, caps at 100 characters, then escapes `\`, `%`, and `_`. `*` is removed because PostgREST maps it to `%` and a backslash does not escape it. One escape pass is undone because `/shows/search` and direct show search already escape `\`, `%`, and `_`. A comma and a closing parenthesis stay literal. They matter inside a PostgREST `.or()` string, and this path uses `.ilike()` only.

`showNameContainsPattern` wraps the escaped term in percent signs. An empty term (for example `*` alone, or whitespace) returns `[]` and does not query. `showNameExactPattern` is the same term with no `%` added.

`POST /api/deals` looks up `show_name` with that exact pattern. A name that contains `*` uses `.eq("name", trimmedName)`, because `*` cannot be escaped in `ilike`. An empty pattern returns the existing "No show named" field error and does not query. Zero, one, and two row handling is unchanged.

`GET /api/deals` logs a fixed tag and the error code, and returns 500 `{ error: "Failed to fetch deals" }`. The response does not include the database message.

Migration 089's test now has three PGlite cases. Another profile's youtube-captions line on the same channel stays when the first profile's connection is revoked (8 days) or `reauth_required` (31 days). A third case pins today's channel-wide active block: an active connection on `UCshared2` from the other profile keeps the first profile's line. The SQL file was not edited.

## Where

- `lib/shows/search-pattern.ts` and `search-pattern.test.ts`
- `lib/data/queries.ts` (`getShowsFiltered` search only) and `lib/data/show-search.test.ts`
- `app/api/shows/route.test.ts` (raw `search` is still forwarded)
- `app/api/deals/route.ts` (`resolveShowId` and the GET catch) and `route.test.ts`
- `supabase/migrations/089_youtube_caption_clear_by_channel.test.ts` (cases only)
- `docs/jobs/QUIET1.md`
- `docs/SENIOR_DEV_HANDOFF.md` (this job's section)

`lib/stripe`, `lib/payouts`, `lib/billing`, and `lib/airchecks` were not edited. No `.sql` file was edited. No screen, copy, or style changed.

## Tests

Vitest. Ship commands are recorded in the PR.

- `*` alone returns `[]` and `getShowsFiltered` does not call `.from`.
- `%` is sent as `%\%\%`. An already escaped `50\%` matches raw `50%`.
- `a,b)` is one `.ilike` of `%a,b)%` and `.or` is not called. `is_discoverable` and the limit cap stay.
- `GET /api/shows` forwards the raw `search` param for the brand branch and the agent branch.
- `show_name: "%"` sends `\%` to `.ilike`. `show_name: "Show*"` uses `.eq` and does not call `.ilike`.
- A thrown `getDealsFiltered` error returns `{ error: "Failed to fetch deals" }` with none of the thrown message in the body.
- 089: cross-profile keep for a revoked connection and for `reauth_required`. The channel-wide active block is pinned. Existing 089 cases are unchanged. PGlite only.

## Known gaps

- 089's active-connection block is channel-wide across profiles, by design. The new test pins that. The SQL was not changed.
- `POST /api/deals` still returns `Failed to create deal:` plus the thrown message. This job changes the GET catch only.
- No migration. This PR does not merge. Paul reviews.
