-- Add stripe_connect_account_id to profiles for shows/agents receiving payouts
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stripe_connect_account_id TEXT;
