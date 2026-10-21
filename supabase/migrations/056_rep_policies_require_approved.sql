-- ============================================================
-- 056: rep learning policies require an approved roster link
--
-- NOT applied. Paste into the SQL editor after 055 is applied
-- and Chris says OK, then introspect. Do not run this from the
-- app, a seed script, or a deploy hook. Apply this after 055.
-- Do not re-run 047 after this file: 047 recreates these
-- policies without the status check and would undo it. Re-run
-- 056 last if that happens.
--
-- 047 lets a rep read and write learning notes when
-- agent_show_relationships has any row for the caller and the
-- deal's show. A pending or rejected claim is not a roster
-- link. Each of those five subqueries now requires
-- a.status = 'approved'. deals.agent_id is unchanged: a rep
-- already on the deal does not need a roster row.
--
-- Recreates only the three learning_overrides policies that
-- read agent_show_relationships:
--   "Campaign readers select learning overrides"
--   "Rep inserts own learning overrides"
--   "Author updates own learning overrides"
-- Other 047 policies are left as they are. No grants. No row
-- updates. repMayWrite is unchanged.
--
-- Idempotent. Safe to re-run.
--
-- Introspection (run after applying):
--   select polname, pg_get_expr(polqual, polrelid) as using_expr,
--          pg_get_expr(polwithcheck, polrelid) as check_expr
--     from pg_policy
--    where polrelid = 'public.learning_overrides'::regclass
--      and polname in (
--        'Campaign readers select learning overrides',
--        'Rep inserts own learning overrides',
--        'Author updates own learning overrides'
--      )
--    order by polname;
--   Expected: five occurrences of a.status = 'approved' across
--   those expressions (one in the select policy, two in the
--   insert policy, two in the update policy). deals.agent_id
--   checks are still there.
-- ============================================================

drop policy if exists "Campaign readers select learning overrides"
  on public.learning_overrides;
create policy "Campaign readers select learning overrides"
  on public.learning_overrides
  for select to authenticated
  using (
    exists (
      select 1 from public.campaigns c
      where c.id = learning_overrides.campaign_id
        and c.user_id = auth.uid()
    )
    or author_id = auth.uid()
    or exists (
      select 1
      from public.deals d
      left join public.outreaches o on o.id = d.outreach_id
      where (o.campaign_id = learning_overrides.campaign_id
             or d.campaign_id = learning_overrides.campaign_id)
        and (
          d.agent_id = auth.uid()
          or exists (
            select 1 from public.agent_show_relationships a
            where a.agent_id = auth.uid()
              and a.show_id = d.show_id
              and a.status = 'approved'
          )
        )
    )
  );

drop policy if exists "Rep inserts own learning overrides"
  on public.learning_overrides;
create policy "Rep inserts own learning overrides"
  on public.learning_overrides
  for insert to authenticated
  with check (
    author_role = 'rep'
    and author_id = auth.uid()
    and exists (
      select 1
      from public.deals d
      left join public.outreaches o on o.id = d.outreach_id
      where (o.campaign_id = learning_overrides.campaign_id
             or d.campaign_id = learning_overrides.campaign_id)
        and (
          d.agent_id = auth.uid()
          or exists (
            select 1 from public.agent_show_relationships a
            where a.agent_id = auth.uid()
              and a.show_id = d.show_id
              and a.status = 'approved'
          )
        )
    )
    and (
      target_kind <> 'show'
      or exists (
        select 1 from public.agent_show_relationships a
        where a.agent_id = auth.uid()
          and a.show_id::text = learning_overrides.target_key
          and a.status = 'approved'
      )
      or exists (
        select 1 from public.deals d
        where d.agent_id = auth.uid()
          and d.show_id::text = learning_overrides.target_key
          and (
            d.campaign_id = learning_overrides.campaign_id
            or exists (
              select 1 from public.outreaches o
              where o.id = d.outreach_id
                and o.campaign_id = learning_overrides.campaign_id
            )
          )
      )
    )
  );

drop policy if exists "Author updates own learning overrides"
  on public.learning_overrides;
create policy "Author updates own learning overrides"
  on public.learning_overrides
  for update to authenticated
  using (author_id = auth.uid())
  with check (
    author_id = auth.uid()
    and (
      (
        author_role = 'brand'
        and exists (
          select 1 from public.campaigns c
          where c.id = learning_overrides.campaign_id
            and c.user_id = auth.uid()
        )
      )
      or (
        author_role = 'rep'
        and exists (
          select 1
          from public.deals d
          left join public.outreaches o on o.id = d.outreach_id
          where (o.campaign_id = learning_overrides.campaign_id
                 or d.campaign_id = learning_overrides.campaign_id)
            and (
              d.agent_id = auth.uid()
              or exists (
                select 1 from public.agent_show_relationships a
                where a.agent_id = auth.uid()
                  and a.show_id = d.show_id
                  and a.status = 'approved'
              )
            )
        )
        and (
          target_kind <> 'show'
          or exists (
            select 1 from public.agent_show_relationships a
            where a.agent_id = auth.uid()
              and a.show_id::text = learning_overrides.target_key
              and a.status = 'approved'
          )
          or exists (
            select 1 from public.deals d
            where d.agent_id = auth.uid()
              and d.show_id::text = learning_overrides.target_key
              and (
                d.campaign_id = learning_overrides.campaign_id
                or exists (
                  select 1 from public.outreaches o
                  where o.id = d.outreach_id
                    and o.campaign_id = learning_overrides.campaign_id
                )
              )
          )
        )
      )
    )
  );
