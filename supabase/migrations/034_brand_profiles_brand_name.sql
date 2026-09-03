-- ============================================================
-- Migration 034: Durable brand name on the brand profile (A6 fix)
-- ============================================================
-- The brand's name was never stored as a field. Every consumer derived it by
-- splitting the free-text `brand_identity` paragraph (first clause before
-- punctuation), which on a paragraph with no early punctuation leaked prose into
-- outreach From: lines, the IO advertiser name, and pitch/response emails. This
-- adds a durable, user-confirmed name field that the whole brand-name pipeline
-- prefers; the paragraph split survives only as a bounded legacy fallback.
--
--   brand_profiles.brand_name  TEXT, nullable, default null.
--                              Captured (optionally) in brand onboarding; editable
--                              from the onboarding review row / settings. When null,
--                              the runtime helper falls back to the bounded
--                              brand_identity clause / website domain, so onboarding
--                              is never gated on it.
--
-- Backfill: best-effort from the AI-validated campaign product name
-- (`campaigns.brief -> product ->> brand_name`) — the highest-quality existing
-- source, and it avoids the paragraph split entirely. Most-recent campaign per
-- user. Guarded by `brand_name IS NULL` so re-running is a no-op. Rows with no
-- such campaign are left NULL by design (runtime fallback handles them).
--
-- Idempotent. Re-running is safe.
-- No Data API grant block: `brand_profiles` is an existing (grandfathered) table,
-- created in 007_add_brand_profiles.sql — pre-020, covered by the table-level
-- grants in migration 020. Columns added later inherit those grants.

ALTER TABLE public.brand_profiles
  ADD COLUMN IF NOT EXISTS brand_name TEXT;

COMMENT ON COLUMN public.brand_profiles.brand_name IS
  'A6 fix. Durable, user-confirmed short brand name used as the outreach From: name, IO advertiser name, and pitch/notification sender. Preferred over the legacy brand_identity paragraph split. Nullable; when null the runtime helper falls back to the bounded identity clause / website domain.';

-- Best-effort backfill from the campaign product name (avoids the paragraph
-- split). DISTINCT ON keeps the most-recent campaign per user. Guarded by
-- IS NULL so this is a no-op on re-run.
UPDATE public.brand_profiles bp
SET brand_name = c.bn
FROM (
  SELECT DISTINCT ON (user_id)
         user_id,
         NULLIF(TRIM(brief -> 'product' ->> 'brand_name'), '') AS bn
  FROM public.campaigns
  WHERE NULLIF(TRIM(brief -> 'product' ->> 'brand_name'), '') IS NOT NULL
  ORDER BY user_id, created_at DESC
) c
WHERE bp.user_id = c.user_id
  AND bp.brand_name IS NULL;
