-- Add missing INSERT and UPDATE RLS policies for shows table.
-- Without these, authenticated users cannot create or update shows via the anon key client.
-- The createShow function now uses the admin client as a workaround, but these policies
-- are still needed for any future anon-key operations on shows.

CREATE POLICY "Shows insert by authenticated" ON public.shows
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Shows update by authenticated" ON public.shows
  FOR UPDATE USING (auth.uid() IS NOT NULL);
