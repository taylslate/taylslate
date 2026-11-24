-- ============================================================
-- 102: hide show contact from the data API
--
-- NOT APPLIED LIVE, CHRIS MUST NAME IT.
-- Do not run this from the app, a seed script, or a deploy hook.
-- Paste it into the Supabase SQL Editor only after Chris names it.
--
-- authenticated loses table-level SELECT on public.shows,
-- public.outreaches, and public.insertion_orders, then receives
-- column SELECT on every column except the contact address.
-- shows withholds contact_email (41 of 42 columns).
-- outreaches withholds sent_to_email (21 of 22).
-- insertion_orders withholds publisher_contact_email (37 of 38).
-- anon keeps nothing on these three tables. service_role is
-- unchanged. Policies are unchanged. INSERT on insertion_orders
-- and the migration 085 column UPDATE grants stay as they are.
--
-- After this file, a signed-in user cannot select, filter, or
-- order by those three columns through the Data API. The show
-- owner, a roster agent, an admin, and an unlocked deal party
-- still receive the address from server code that reads with
-- service_role after the existing visibility check.
--
-- The same statement removes contactEmail from campaigns.scored_shows
-- and contact_email from campaigns.recommendations,
-- campaigns.youtube_recommendations, and
-- campaigns.expansion_opportunities. On 2026-11-23 that was 2
-- campaigns, 39 scored_shows elements, and 0 legacy array elements.
-- A second run updates 0 rows. No other key is removed. The
-- update_campaigns_timestamp trigger bumps updated_at on the rows
-- that change. An open plan tab gets one plan-conflict retry from
-- direct search. The trigger is not disabled.
--
-- 102 does NOT revoke UPDATE on campaigns.selected_show_ids.
-- The brand can also write scored_shows, recommendations, and the
-- other arrays that count as on the campaign, so a single-column
-- revoke would not close the path. Moving every campaign writer
-- to service_role is a wider change. The send path is closed in
-- app code: recipients come from the server-side catalog, and a
-- hidden show without a real tie is refused.
--
-- Idempotent. Safe to re-run.
--
-- Introspection (run after applying, read only):
--   select has_column_privilege('authenticated', 'public.shows', 'contact_email', 'SELECT'),
--          has_column_privilege('authenticated', 'public.outreaches', 'sent_to_email', 'SELECT'),
--          has_column_privilege('authenticated', 'public.insertion_orders', 'publisher_contact_email', 'SELECT');
--   Expected: false, false, false.
--   select table_name, privilege_type
--     from information_schema.role_table_grants
--    where table_schema = 'public'
--      and grantee = 'authenticated'
--      and table_name in ('shows', 'outreaches', 'insertion_orders')
--    order by 1, 2;
--   Expected: no SELECT row. insertion_orders keeps INSERT.
--   select table_name, count(*)
--     from information_schema.column_privileges
--    where table_schema = 'public'
--      and grantee = 'authenticated'
--      and privilege_type = 'SELECT'
--      and table_name in ('shows', 'outreaches', 'insertion_orders')
--    group by 1;
--   Expected: shows 41, outreaches 21, insertion_orders 37.
--   select count(*) from public.campaigns
--    where (jsonb_typeof(scored_shows) = 'array' and exists (
--            select 1 from jsonb_array_elements(scored_shows) e
--             where jsonb_typeof(e) = 'object' and e ? 'contactEmail'))
--       or (jsonb_typeof(recommendations) = 'array' and exists (
--            select 1 from jsonb_array_elements(recommendations) e
--             where jsonb_typeof(e) = 'object' and e ? 'contact_email'))
--       or (jsonb_typeof(youtube_recommendations) = 'array' and exists (
--            select 1 from jsonb_array_elements(youtube_recommendations) e
--             where jsonb_typeof(e) = 'object' and e ? 'contact_email'))
--       or (jsonb_typeof(expansion_opportunities) = 'array' and exists (
--            select 1 from jsonb_array_elements(expansion_opportunities) e
--             where jsonb_typeof(e) = 'object' and e ? 'contact_email'));
--   Expected: 0.
--   select has_table_privilege('anon', 'public.shows', 'SELECT');
--   Expected: false.
-- ============================================================

-- AUTHENTICATED HAS COLUMN-LEVEL SELECT ON public.shows, public.outreaches AND public.insertion_orders. A NEW COLUMN ON ANY OF THESE TABLES IS NOT READABLE BY SIGNED-IN USERS UNTIL A MIGRATION GRANTS IT BY NAME. Never grant contact_email, sent_to_email or publisher_contact_email to authenticated or anon. Never re-grant table-level SELECT. Update lib/shows/read-columns.ts in the same PR.

revoke select on table public.shows from authenticated;
revoke all on table public.shows from anon;

grant select (
  id,
  name,
  slug,
  platform,
  description,
  image_url,
  categories,
  tags,
  network,
  contact_name,
  contact_method,
  agent_id,
  audience_size,
  demographics,
  audience_interests,
  rate_card,
  price_type,
  min_buy,
  ad_formats,
  episode_cadence,
  avg_episode_length_min,
  current_sponsors,
  past_sponsors,
  apple_id,
  spotify_id,
  youtube_channel_id,
  rss_url,
  is_claimed,
  is_verified,
  data_sources,
  available_slots,
  next_available_date,
  last_api_refresh,
  created_at,
  updated_at,
  audience_purchase_power,
  surfaces,
  medium_priors,
  is_discoverable,
  podscan_id,
  ownership_status
) on table public.shows to authenticated;

revoke select on table public.outreaches from authenticated;
revoke all on table public.outreaches from anon;

grant select (
  id,
  brand_profile_id,
  campaign_id,
  show_id,
  podscan_id,
  show_name,
  proposed_cpm,
  proposed_episode_count,
  proposed_placement,
  proposed_flight_start,
  proposed_flight_end,
  pitch_body,
  sent_at,
  response_status,
  responded_at,
  counter_cpm,
  counter_message,
  decline_reason,
  token,
  created_at,
  updated_at
) on table public.outreaches to authenticated;

revoke select on table public.insertion_orders from authenticated;
revoke all on table public.insertion_orders from anon;

grant select (
  id,
  io_number,
  deal_id,
  advertiser_name,
  advertiser_contact_name,
  advertiser_contact_email,
  publisher_name,
  publisher_contact_name,
  publisher_address,
  agency_name,
  agency_contact_name,
  agency_contact_email,
  agency_billing_contact,
  agency_address,
  send_invoices_to,
  total_downloads,
  total_gross,
  total_net,
  payment_terms,
  competitor_exclusion,
  exclusivity_days,
  rofr_days,
  cancellation_notice_days,
  download_tracking_days,
  make_good_threshold,
  status,
  sent_at,
  signed_at,
  signed_by_publisher,
  signed_by_agency,
  created_at,
  updated_at,
  payment_off_platform,
  rofr_enabled,
  make_good_enabled,
  download_tracking_enabled,
  payer
) on table public.insertion_orders to authenticated;

update public.campaigns as c
set
  scored_shows = case
    when jsonb_typeof(c.scored_shows) = 'array' then (
      select coalesce(
        jsonb_agg(
          case
            when jsonb_typeof(elem.item) = 'object' then elem.item - 'contactEmail'
            else elem.item
          end
          order by elem.ord
        ),
        '[]'::jsonb
      )
      from jsonb_array_elements(c.scored_shows) with ordinality as elem(item, ord)
    )
    else c.scored_shows
  end,
  recommendations = case
    when jsonb_typeof(c.recommendations) = 'array' then (
      select coalesce(
        jsonb_agg(
          case
            when jsonb_typeof(elem.item) = 'object' then elem.item - 'contact_email'
            else elem.item
          end
          order by elem.ord
        ),
        '[]'::jsonb
      )
      from jsonb_array_elements(c.recommendations) with ordinality as elem(item, ord)
    )
    else c.recommendations
  end,
  youtube_recommendations = case
    when jsonb_typeof(c.youtube_recommendations) = 'array' then (
      select coalesce(
        jsonb_agg(
          case
            when jsonb_typeof(elem.item) = 'object' then elem.item - 'contact_email'
            else elem.item
          end
          order by elem.ord
        ),
        '[]'::jsonb
      )
      from jsonb_array_elements(c.youtube_recommendations) with ordinality as elem(item, ord)
    )
    else c.youtube_recommendations
  end,
  expansion_opportunities = case
    when jsonb_typeof(c.expansion_opportunities) = 'array' then (
      select coalesce(
        jsonb_agg(
          case
            when jsonb_typeof(elem.item) = 'object' then elem.item - 'contact_email'
            else elem.item
          end
          order by elem.ord
        ),
        '[]'::jsonb
      )
      from jsonb_array_elements(c.expansion_opportunities) with ordinality as elem(item, ord)
    )
    else c.expansion_opportunities
  end
where
  (
    jsonb_typeof(c.scored_shows) = 'array'
    and exists (
      select 1
      from jsonb_array_elements(c.scored_shows) as e
      where jsonb_typeof(e) = 'object'
        and e ? 'contactEmail'
    )
  )
  or (
    jsonb_typeof(c.recommendations) = 'array'
    and exists (
      select 1
      from jsonb_array_elements(c.recommendations) as e
      where jsonb_typeof(e) = 'object'
        and e ? 'contact_email'
    )
  )
  or (
    jsonb_typeof(c.youtube_recommendations) = 'array'
    and exists (
      select 1
      from jsonb_array_elements(c.youtube_recommendations) as e
      where jsonb_typeof(e) = 'object'
        and e ? 'contact_email'
    )
  )
  or (
    jsonb_typeof(c.expansion_opportunities) = 'array'
    and exists (
      select 1
      from jsonb_array_elements(c.expansion_opportunities) as e
      where jsonb_typeof(e) = 'object'
        and e ? 'contact_email'
    )
  );
