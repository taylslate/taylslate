-- Simplify deal status to 4 states: planning, io_sent, live, completed
-- Migrate existing deals from old statuses to new ones

-- Step 1: Update existing deals to use new status values
UPDATE public.deals SET status = 'planning' WHERE status IN ('proposed', 'negotiating', 'approved');
UPDATE public.deals SET status = 'io_sent' WHERE status IN ('signed');
-- 'io_sent', 'live', 'completed' stay as-is
-- 'cancelled' deals get moved to 'completed' (or delete them if preferred)
UPDATE public.deals SET status = 'completed' WHERE status = 'cancelled';

-- Step 2: Drop the old constraint and add the new one
ALTER TABLE public.deals DROP CONSTRAINT IF EXISTS deals_status_check;
ALTER TABLE public.deals ADD CONSTRAINT deals_status_check CHECK (status IN ('planning', 'io_sent', 'live', 'completed'));

-- Step 3: Update default value
ALTER TABLE public.deals ALTER COLUMN status SET DEFAULT 'planning';
