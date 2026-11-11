# CLEAN1: /shows CSV duplicate shows, A7 auth nits, Tay nav link

No migration. Nothing was written to `ldtmhafewfifdizgfrnn`. The precheck below is a read. `lib/stripe`, `lib/payouts`, `lib/billing`, `lib/airchecks`, and `plans.ts` were not edited. The import route, the roster importer, and the assistant screens were not edited.

## Precheck

Read only, project `ldtmhafewfifdizgfrnn`, Nov 11, 2026.

| Check | Result |
| --- | --- |
| `shows` | 205 |
| duplicate `normalize_show_match_key` groups | 0 |
| `agent_show_relationships` with `source` `import` | 0 |
| index `command_agent_conversations_one_turn_per_brand` | 1 |

That matches the Nov 10, 2026 expectation (205, 0, 0, 1). No data cleanup.

## Items

1. The legacy `/shows` CSV import skips a row whose show is already in the catalog, and the modal adds the rows the server returns.
2. `lib/api/auth.ts` and `lib/api/plan-gate.ts` no longer import each other. A resolved API key reads its profiles row once.
3. A brand whose real role is `brand` and who is not viewing as someone else sees one nav item, Tay, linking to `/assistant`. It uses the existing nav item pattern.

## Sources

- `PRODUCT_BACKLOG.md:115` (parent closes this; this job does not edit that file)
- `docs/SENIOR_DEV_HANDOFF.md:2195`
- `docs/jobs/Q12.md:45` and `:110` (open question 8)
- A7 review: circular `ApiAuthError` import, and the second profiles read
- `docs/jobs/CA1.md` decision (a) and the nav known gap

## Root cause

`importShows` deduped only against the caller's own roster, and only by exact lowercase name. A show that was already discoverable, listed by another rep, or missing a roster link was inserted again. Near-identical names (`The Daily Podcast` and `Daily`, curly apostrophes, double spaces) also missed the roster check.

The modal called `onImported` with `data.imported`, which is a count. Spreading that number threw, so the modal stayed open after a commit that had already succeeded.

`plan-gate.ts` imported `ApiAuthError` from `auth.ts`, and `auth.ts` imported `assertBrandApiAccess` from `plan-gate.ts`. The resolver read `profiles(id)` and the gate read `profiles(role, plan)` for the same id.

`/assistant` was brand-only and had no nav item.

## What shipped

`findCatalogDuplicates` looks up candidate shows with the service role and returns the indexes of rows that match. The select is `id, name, agent_id, is_discoverable, rss_url`. One `ilike` on `name` per distinct search token (the longest word of 3 or more characters), limit 25. Feed lookups are `ilike` contains on the normalized key, limit 10. A lookup error throws `Show lookup failed.` The matched show's id, name, and owner are not returned and are not logged.

Name equality uses `normalizeRosterShowName`. The show must be discoverable, or its `agent_id` must be the caller. A hidden show owned by another rep is not a name match. When the row has `rss_url`, `normalizeRssUrl` equality matches any show. `importShows` calls this once before the loop. A match is pushed to `skipped` and is not inserted. The roster set and the in-file set use the same normalized name. A new name still inserts one hidden show (unless the caller is an admin) and one pending `source` `import` link, and a failed link still rolls the new show back. The response shape is unchanged.

The modal passes `data.shows` when it is an array, and an empty array otherwise. Labels, classes, and copy on that screen are unchanged. Skipped rows are still not shown in the modal.

`ApiAuthError` moved unchanged to `lib/api/errors.ts`. `auth.ts` re-exports it. `assertProfileApiAccess` is the pure allow rule. `keyTiedToUser` selects `id, role, plan` once and the resolver passes that row in. `assertBrandApiAccess` still reads `role, plan` and calls the pure rule.

Tay is `{ label: "Tay", href: "/assistant", iconKey: "shows" }`, after Search and before Invoices, only when `getNavItemsForRole("brand", { assistant: true })`. A call without the option returns the previous arrays. Agency, show, and agent do not get Tay. The sidebar passes `assistantEnabled` through the same link map. The layout sets it only when `profile.role` and the effective role are both `brand`, so an admin or a dual-profile user viewing as brand does not see a link that 404s.

A static test reads string literals and JSX text in `app/**/*.tsx` and `components/**/*.tsx` (tests excluded) and fails on `/command agent/i`. No identifier, event name, or `command_agent` source value was renamed.

## Decisions

- Tay reuses the existing `shows` icon. CRM and Search already do. A dedicated icon is a later polish item.
- Tay sits after Search and before Invoices.
- A CSV duplicate is skipped silently in the existing skipped list. The rep links that show through the roster import.

## Left out

- CA1 claimTurn millisecond race. SEC2 already fixed it. No SQL.
- CA1 fallback usage row test. Already in `lib/command-agent/run.test.ts`.
- Pointing `/shows` at `/api/reps/roster/import` (Q12 open question 8). That adds a preview step, owner notices, and disputes. Chris decides.
- SA-14. No size or row cap on `/api/shows/import`, and CSV formula cells are not neutralized. Caps would change accepted input. SA-14 cites `route.ts:37`, which is now `:41`.
- Showing skipped rows in the modal. That is new UI.
- Replacing raw DB error text in `importShows` errors. Changing messages is behavior.
- The second role read inside `importShows` after the route already checked. The helper is public. Left as it is.
- CA1 gaps: a reused `ca:{message id}:{n}` idempotency key, no 90-day purge, the crashed-turn 120 second lock, and unrecorded killed calls.
- A5 gaps: overlapping revokes both return 200, and the disabled Generate API Key button on `/settings`.
- A7 gap: Tay is not plan-gated.
- M1 gaps (OAuth, approve or pay tools, tools/list paging).
- SEC6 follow-ups (mask `sent_to_email` on the pitch page, timing, brand-chosen recipient).
- The legacy modal and the route's CSV parser do not send `rss_url`. Feed matching runs when a caller includes it. This job does not change that payload.

## Known gaps

- Name lookup returns at most 25 rows per token and feed lookup at most 10. A token that fills the cap can miss a later duplicate. The lookup does not fail closed on the cap. B1 does, for its own path. This job copies the limits and not that cap failure.
- A duplicate is skipped with no extra copy in the modal. `skipped_names` is still on the JSON response.
- `importShows` still appends `showError.message` on an insert failure.
- The modal still does not upload `rss_url`, so two different names that share a feed can still insert from that screen.
- Tay is not plan-gated.
- This PR does not merge. Paul reviews.
