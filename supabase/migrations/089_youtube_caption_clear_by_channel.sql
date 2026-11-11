-- ============================================================
-- 089: clear retired YouTube captions by channel
--
-- NOT applied. Apply only after merge and Chris's OK.
-- Apply on ldtmhafewfifdizgfrnn only after 088, and only
-- after Chris names 089. Paste into the Supabase SQL Editor.
-- Do not run this from the app, a seed script, or a deploy hook.
--
-- 088 clears captions for a reauth or revoked connection by
-- joining youtube_oauth_connections to deals on
-- show_profile_id, then skips the profile when any connection
-- on that profile is still active. After a channel switch the
-- old channel's captions wait for the 30-day fetch purge
-- instead of 7 days after revoke, or 30 days after the grant
-- lapses. Remaining Google data within 7 days of a disconnect
-- is a per-channel promise.
--
-- This file replaces youtube_oauth_housekeeping only. The
-- signature, security invoker, search_path, and step order
-- stay the same. Each connection-scoped caption clear matches
-- the line's resolved channel to that connection's channel_id.
-- A line is cleared only when the channel matches, the deal's
-- show_profile_id is that connection's show_profile_id, the
-- line has a youtube-captions aircheck, and no active
-- connection holds the channel. Captions from the channel
-- that is connected now stay.
--
-- Channel resolution matches the caption feed. airchecks has
-- no channel column. shows.youtube_channel_id wins when it is
-- non-empty after trim. Otherwise the lowest
-- youtube_channels.channel_id for deals.show_id is used. A
-- line whose channel resolves to null is not cleared here.
-- The 30-day created_at purge still covers it. Match
-- judgments are not changed.
--
-- No new table, column, table grant, or policy.
-- anon and authenticated stay revoked on this function.
-- service_role keeps execute. Idempotent. Running this file
-- twice is a no-op.
--
-- Introspection (run after applying, read only):
--   select pg_get_functiondef(
--            'public.youtube_oauth_housekeeping(timestamptz)'::regprocedure
--          ) like '%l.channel_id = c.channel_id%' as per_channel;
--   Expected: true
-- ============================================================

create or replace function public.youtube_oauth_housekeeping(p_now timestamptz)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_caption_before timestamptz;
  v_reauth_before timestamptz;
  v_revoked_before timestamptz;
begin
  if p_now is null then
    raise exception 'youtube_oauth_housekeeping: now is required' using errcode = '22023';
  end if;

  v_caption_before := p_now - interval '30 days';
  v_reauth_before := p_now - interval '30 days';
  v_revoked_before := p_now - interval '7 days';

  -- created_at, not updated_at. The airchecks trigger rewrites
  -- updated_at on every update, which would keep captions forever.
  perform public.youtube_oauth_clear_captions(array(
    select io_line_item_id
      from public.airchecks
     where provider = 'youtube-captions'
       and transcript_text is not null
       and created_at < v_caption_before
  ));

  delete from public.youtube_aircheck_metrics m
   using public.youtube_oauth_connections c
   where m.connection_id = c.id
     and c.status = 'reauth_required'
     and c.reauth_required_at is not null
     and c.reauth_required_at < v_reauth_before;

  -- Per channel. An active connection on a different channel
  -- must not keep this channel's captions. A null resolved
  -- channel does not match, so the 30-day purge above clears it.
  perform public.youtube_oauth_clear_captions(array(
    select li.id
      from public.io_line_items li
      join public.insertion_orders io on io.id = li.io_id
      join public.deals d on d.id = io.deal_id
      left join public.shows s on s.id = d.show_id
      join public.youtube_oauth_connections c
        on c.show_profile_id = d.show_profile_id
       and c.channel_id = coalesce(
             nullif(trim(s.youtube_channel_id), ''),
             (
               select yc.channel_id
                 from public.youtube_channels yc
                where yc.show_id = d.show_id
                order by yc.channel_id
                limit 1
             )
           )
     where c.status = 'reauth_required'
       and c.reauth_required_at is not null
       and c.reauth_required_at < v_reauth_before
       and not exists (
         select 1
           from public.youtube_oauth_connections l
          where l.channel_id = c.channel_id
            and l.status = 'active'
       )
       and exists (
         select 1
           from public.airchecks a
          where a.io_line_item_id = li.id
            and a.provider = 'youtube-captions'
       )
  ));

  delete from public.youtube_oauth_connections
   where status = 'reauth_required'
     and reauth_required_at is not null
     and reauth_required_at < v_reauth_before;

  delete from public.youtube_aircheck_metrics m
   using public.youtube_oauth_connections c
   where m.connection_id = c.id
     and c.status = 'revoked'
     and c.revoked_at is not null
     and c.revoked_at < v_revoked_before;

  -- Same channel match as the reauth clear above, for a
  -- connection revoked more than 7 days ago.
  perform public.youtube_oauth_clear_captions(array(
    select li.id
      from public.io_line_items li
      join public.insertion_orders io on io.id = li.io_id
      join public.deals d on d.id = io.deal_id
      left join public.shows s on s.id = d.show_id
      join public.youtube_oauth_connections c
        on c.show_profile_id = d.show_profile_id
       and c.channel_id = coalesce(
             nullif(trim(s.youtube_channel_id), ''),
             (
               select yc.channel_id
                 from public.youtube_channels yc
                where yc.show_id = d.show_id
                order by yc.channel_id
                limit 1
             )
           )
     where c.status = 'revoked'
       and c.revoked_at is not null
       and c.revoked_at < v_revoked_before
       and not exists (
         select 1
           from public.youtube_oauth_connections l
          where l.channel_id = c.channel_id
            and l.status = 'active'
       )
       and exists (
         select 1
           from public.airchecks a
          where a.io_line_item_id = li.id
            and a.provider = 'youtube-captions'
       )
  ));

  delete from public.youtube_oauth_connections
   where status = 'revoked'
     and revoked_at is not null
     and revoked_at < v_revoked_before;
end;
$$;

revoke all on function public.youtube_oauth_housekeeping(timestamptz) from public;
revoke all on function public.youtube_oauth_housekeeping(timestamptz) from anon;
revoke all on function public.youtube_oauth_housekeeping(timestamptz) from authenticated;
grant execute on function public.youtube_oauth_housekeeping(timestamptz) to service_role;

comment on function public.youtube_oauth_housekeeping(timestamptz) is
  '30-day caption purge from created_at. Reauth (30 days) and revoked (7 days) caption clears match the line''s resolved channel to that connection, and skip a channel that is active again. A null channel waits for the 30-day purge. Match judgments stay. service_role only.';
