-- Wave 11: Show contact routing
-- Two optional emails on the show profile so creators can route ad copy and
-- billing notifications away from their signing email. Both nullable —
-- IO generation (Wave 12) reads with fallback to profiles.email.

ALTER TABLE public.show_profiles
  ADD COLUMN IF NOT EXISTS ad_copy_email   TEXT,
  ADD COLUMN IF NOT EXISTS billing_email   TEXT;
