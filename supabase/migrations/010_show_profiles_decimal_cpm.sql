-- Wave 10.x patch: allow decimal CPMs in show_profiles.expected_cpm
-- Shows need to enter values like $28.50. NUMERIC(6,2) covers 0.00–9999.99,
-- which is well past the $15-$50 band in CLAUDE.md's domain notes.

ALTER TABLE public.show_profiles
  ALTER COLUMN expected_cpm TYPE NUMERIC(6,2)
  USING expected_cpm::NUMERIC(6,2);
