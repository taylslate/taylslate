# SEC7: function EXECUTE grants and pinned search_path

No page or component was edited. Screenshots are not applicable. Migration 090 is in the PR and is not applied.

## Advisor findings

Live security advisors on `ldtmhafewfifdizgfrnn`, Nov 11, 2026 MST. Checks were SELECT only.

| Advisor | Function | What 090 does |
| --- | --- | --- |
| `anon_security_definer_function_executable` | `get_avg_negotiated_cpm(uuid)` | Revoke EXECUTE from PUBLIC, anon, and authenticated. service_role keeps EXECUTE. Pin search_path to ''. |
| `authenticated_security_definer_function_executable` | `get_avg_negotiated_cpm(uuid)` | Same revoke. |
| `authenticated_security_definer_function_executable` | `auth_login_email()` | Accepted. authenticated keeps EXECUTE. |
| `function_search_path_mutable` | `update_updated_at`, `reset_monthly_campaigns`, `get_avg_negotiated_cpm` | Pin search_path to ''. Grants on the first two stay as they are. |
| `auth_leaked_password_protection` | Auth dashboard | Out of scope. See the note for Chris. |

`get_avg_negotiated_cpm(uuid)` is SECURITY DEFINER, owned by postgres, with proconfig null. RLS does not apply. A signed-out caller can read the average negotiated CPM for any show through `/rest/v1/rpc/get_avg_negotiated_cpm`. That is SA-06. The mutable search_path items are SA-19.

Live `pg_proc` the same day:

- `get_avg_negotiated_cpm(uuid)`: definer, proconfig null, EXECUTE for PUBLIC, anon, authenticated, and service_role. Body averages `public.deals.cpm_rate` for `signed`, `live`, and `completed` once three rows match. Source: `001_initial_schema.sql`.
- `reset_monthly_campaigns()`: invoker, proconfig null, EXECUTE for PUBLIC, anon, authenticated, and service_role. Updates `public.profiles` and calls `now()` and `date_trunc`.
- `update_updated_at()`: invoker trigger, proconfig null, same EXECUTE list. Body sets `NEW.updated_at = now()`. Sixteen live triggers call it.
- `auth_login_email()`: definer, proconfig `{search_path=auth, public, pg_temp}`, EXECUTE for postgres, authenticated, and service_role. anon and PUBLIC hold none (071 and 077). Body reads `auth.users.email` for `auth.uid()`.

## Caller grep

Grepped at `71a26ec`.

`get_avg_negotiated_cpm`: no `supabase.rpc` call in app, lib, or scripts. Other references are `000_drop_and_recreate.sql`, `001_initial_schema.sql`, and `TECHNICAL_SPEC.md`. No policy, view, or function body references it. Revoking PUBLIC, anon, and authenticated is safe.

`reset_monthly_campaigns` and `update_updated_at`: no RPC caller. This job changes only their search_path.

`auth_login_email`: no `supabase.rpc` caller. RLS calls it as the querying role:

- policy "Shows readable by signed-in participants" on `public.shows` (071 and 077)
- policy "Show reads outreach to their email" on `public.outreaches` (077)
- `public.user_owns_show(uuid)`, which the show_surfaces policy calls (077)

## auth_login_email decision

A policy expression runs with the caller's privileges. Revoking EXECUTE from authenticated would make every signed-in SELECT on shows and outreaches fail. authenticated keeps EXECUTE. The RPC returns only the caller's own login email, read by `auth.uid()`. The authenticated advisor warning is accepted and recorded in SA-06 and SA-19.

Moving the function out of `/rest/v1` would mean re-creating three policies and `user_owns_show`. Not this job.

Every name in the three pinned bodies is schema-qualified (`public.profiles`, `public.deals`) or in `pg_catalog` (`now`, `date_trunc`, `avg`, `count`). search_path `''` is safe. The file is ALTER and REVOKE only, so the bodies stay byte for byte.

## Apply order

Any time after merge, when Chris names 090. Apply on `ldtmhafewfifdizgfrnn`. Paste into the Supabase SQL Editor. Independent of deploy, because no app code changes. Idempotent. Safe to re-run.

090 does not change grants on `update_updated_at`, `reset_monthly_campaigns`, or any other function. The rest of the SA-19 EXECUTE cleanup stays a follow-up.

## Verify

After Chris applies 090, run this SELECT only:

```sql
select p.oid::regprocedure as fn, p.prosecdef, p.proconfig,
       has_function_privilege('anon', p.oid, 'execute') as anon_x,
       has_function_privilege('authenticated', p.oid, 'execute') as auth_x,
       has_function_privilege('service_role', p.oid, 'execute') as svc_x,
       coalesce(p.proacl::text, '') like '%{=X%' or coalesce(p.proacl::text, '') like '%,=X%' as public_x
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('get_avg_negotiated_cpm', 'auth_login_email', 'update_updated_at', 'reset_monthly_campaigns')
 order by 1;
```

Expected. `p.proconfig` is a text array, so a value that contains quotes, commas, or spaces is printed with extra quotes. Empty search_path prints as `{"search_path=\"\""}`.

- `get_avg_negotiated_cpm(uuid)`: definer, `{"search_path=\"\""}`, anon false, authenticated false, service_role true, public false.
- `auth_login_email()`: definer, `{"search_path=auth, public, pg_temp"}`, anon false, authenticated true, service_role true, public false.
- `reset_monthly_campaigns()` and `update_updated_at()`: invoker, `{"search_path=\"\""}`, grants unchanged.

Then load `/shows/search` and `/dashboard` once while signed in. The shows and outreaches policies should still return rows.

`get_advisors` (security) should no longer list `function_search_path_mutable` or `anon_security_definer_function_executable`. `authenticated_security_definer_function_executable` should list only `auth_login_email`, documented above as accepted.

## Note for Chris

Leaked-password protection is off (advisor `auth_leaked_password_protection`). Turn it on in the Supabase dashboard: Authentication, Attack Protection, "Prevent use of leaked passwords". That setting is not SQL. This migration does not change it.
