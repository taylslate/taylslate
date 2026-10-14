-- ============================================================
-- 042: negotiated IO terms
--
-- Concierge insertion orders are paid off-platform and the
-- terms differ per deal. These columns are the editor's source
-- for that document. Defaults match the document the generators
-- already print, so an existing IO with no edits keeps the same
-- payment sentence, ROFR, make-good, and download tracking.
--
-- insertion_orders and io_line_items are pre-020 tables. No new
-- table, so no Data API grant block. The columns inherit the
-- tables' existing grants.
--
-- Idempotent. Safe to re-run. No backfill: existing rows take
-- the column defaults.
--
-- Introspection check (run after applying):
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--    where table_schema = 'public'
--      and table_name = 'insertion_orders'
--      and column_name in (
--        'payment_off_platform', 'rofr_enabled', 'make_good_enabled',
--        'download_tracking_enabled', 'payer'
--      )
--    order by column_name;
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--    where table_schema = 'public'
--      and table_name = 'io_line_items'
--      and column_name = 'spot_format';
--   select conname from pg_constraint
--    where conname = 'insertion_orders_payer_check';
-- ============================================================

alter table public.insertion_orders
  add column if not exists payment_off_platform boolean not null default false;

alter table public.insertion_orders
  add column if not exists rofr_enabled boolean not null default true;

alter table public.insertion_orders
  add column if not exists make_good_enabled boolean not null default true;

alter table public.insertion_orders
  add column if not exists download_tracking_enabled boolean not null default true;

alter table public.insertion_orders
  add column if not exists payer text not null default 'brand';

alter table public.insertion_orders
  drop constraint if exists insertion_orders_payer_check;

alter table public.insertion_orders
  add constraint insertion_orders_payer_check
  check (payer in ('brand', 'agency'));

alter table public.io_line_items
  add column if not exists spot_format text;

comment on column public.insertion_orders.payment_off_platform is
  'When true, the IO payment term is payment_terms and the document does not describe Taylslate pay-as-delivers or the platform fee.';

comment on column public.insertion_orders.rofr_enabled is
  'When false, the ROFR term is left out of the IO. rofr_days stays editable.';

comment on column public.insertion_orders.make_good_enabled is
  'When false, the make-good term is left out of the IO. make_good_threshold stays editable.';

comment on column public.insertion_orders.download_tracking_enabled is
  'When false, the download-tracking term is left out of the IO. download_tracking_days stays editable.';

comment on column public.insertion_orders.payer is
  'Who pays this IO when an agency of record is named: brand (advertiser) or agency.';

comment on column public.io_line_items.spot_format is
  'Per-line read format printed on the IO (host-read, produced, and so on). Null keeps the show default.';
