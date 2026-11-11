# AC-YT2: clear a retired or lapsed channel's captions by channel

Grounded at main `80f451c` (AC-YT, #100). Migration 088 is merged and not applied. Apply 089 right after 088. Both wait until Chris names them. This PR does not apply either file.

## Why per channel

088 joins the reauth and revoked caption clears on `show_profile_id`, then skips any profile that still has an active connection. After a channel switch, captions fetched from the old channel stay until the 30-day fetch purge. They should go 7 days after that connection is revoked, or 30 days after it lapses (`reauth_required_at`). A channel switch retires the previous grant and does not clear captions itself. Housekeeping is the path that finishes the delete.

LG2's promise that remaining Google data is gone within 7 days of a disconnect is per channel. Captions from the channel that is connected now are never cleared early. An active connection on a different channel does not protect the retired channel.

## How a line maps to a channel

`airchecks` has no channel column (migration 038). The caption feed resolves the channel the same way `lib/airchecks/select.ts` does, then uses the spot only when `connection.channelId` equals that channel (`lib/youtube-oauth/feed.ts`):

1. `shows.youtube_channel_id` for `deals.show_id`, after trim, when it is not empty.
2. Otherwise the `youtube_channels` row with `show_id = deals.show_id`. If more than one row matches, the lowest `channel_id` wins.

089 uses that resolution in both connection-scoped clears:

```sql
coalesce(
  nullif(trim(s.youtube_channel_id), ''),
  (
    select yc.channel_id
      from public.youtube_channels yc
     where yc.show_id = d.show_id
     order by yc.channel_id
     limit 1
  )
)
```

`left join public.shows s on s.id = d.show_id`. The clear also requires `c.show_profile_id = d.show_profile_id`, a `youtube-captions` aircheck on the line, and no `youtube_oauth_connections` row with that `channel_id` and `status = 'active'`. A line whose channel resolves to null is not cleared here. The 30-day `created_at` purge still covers it.

`youtube_oauth_clear_captions` is unchanged. It nulls `transcript_text`, `transcript_segments`, and `match_evidence.excerpt`. `match_result`, `confidence`, `ad_start_seconds`, `ad_end_seconds`, and `match_reasons` stay. The 30-day `created_at` purge, the metric deletes, and the connection row deletes stay in the same order as 088. `youtube_oauth_disconnect` is unchanged.

No new table, column, table grant, or policy. `anon` and `authenticated` cannot execute `youtube_oauth_housekeeping`. `service_role` can. Running 089 twice is a no-op.

## Apply order

1. 088, after Chris names it. Read-only precheck on `ldtmhafewfifdizgfrnn`: `to_regclass('public.youtube_oauth_connections') is null` is true, and `airchecks` count is 0. 088 is not applied.
2. 089, immediately after 088, after Chris names 089.

Do not apply either file from this PR.

## 16-day analytics filter

`loadAnalyticsCandidateRows` reads transcribed `youtube-captions` rows with `created_at` greater than now minus 16 days, then drops an `episode_identifier` that is not an 11-character video id. `lib/youtube-oauth/store.test.ts` covers that filter. `store.ts` is not edited. The feed test that passes `publishedAt` on a candidate does not exercise this query. Production sets `publishedAt` to null after the load.
