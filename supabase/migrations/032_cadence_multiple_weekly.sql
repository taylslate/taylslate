-- 032_cadence_multiple_weekly.sql
-- Add the 'multiple_weekly' episode cadence ("A few times a week", 2-4
-- episodes/week) between 'daily' and 'weekly'. The value is written by show
-- onboarding into show_profiles.episode_cadence, which is guarded by a
-- column-level CHECK constraint (migration 009); the legacy shows inventory
-- table has its own CHECK (migration 001). Both must allow the new value.
--
-- Idempotent + safely re-runnable: the original constraints are UNNAMED inline
-- column checks (Postgres auto-generated names), so we drop ANY check
-- constraint referencing episode_cadence on each table before adding the
-- widened, explicitly-named constraint. A plain "DROP CONSTRAINT IF EXISTS
-- <guessed name>" could miss the real one and leave the old narrow constraint
-- in force, silently rejecting 'multiple_weekly'.

-- show_profiles.episode_cadence (onboarding writes here) — full set incl. irregular.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'show_profiles'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%episode_cadence%'
  LOOP
    EXECUTE format('ALTER TABLE public.show_profiles DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.show_profiles
  ADD CONSTRAINT show_profiles_episode_cadence_check
  CHECK (episode_cadence IN ('daily', 'multiple_weekly', 'weekly', 'biweekly', 'monthly', 'irregular'));

-- shows.episode_cadence (legacy inventory) — original set (no irregular) + multiple_weekly.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'shows'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%episode_cadence%'
  LOOP
    EXECUTE format('ALTER TABLE public.shows DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.shows
  ADD CONSTRAINT shows_episode_cadence_check
  CHECK (episode_cadence IN ('daily', 'multiple_weekly', 'weekly', 'biweekly', 'monthly'));
