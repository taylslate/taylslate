# R1-FIX: Show sign-up follow-ups

A visitor who started a password sign-up (an auth user, no `profiles` row) and then used `/signup/show` with the same email now gets a `show` / `free` profile and lands in show onboarding. Before this, verify returned `verify_failed` 403. Builds on R1 (PR 109, `2f71cfc`). No migration.

## What changed

1. Send (`app/api/auth/login/otp/route.ts`). When `intent` is `show_signup`, an auth user exists, and there is no outreach token, the route still emails the `generateLink` code. It also stores a pending hash, the `show_signup` marker, and `LOGIN_OTP_PENDING_MS`, with `p_clear_pending` false, so the marker survives until verify. The hash is of a minted code that is never emailed. The body stays `{ ok: true }` for existing and unknown addresses. The route still does not read `profiles`. An existing user with a profile keeps that role. A no-profile auth user is finished on verify.
2. Verify (`app/api/auth/login/otp/verify/route.ts`). After a successful `verifyOtp`, a `profiles` row of any role is not written. A row with a role finishes as that role, even when the marker is `show_signup`. A row with no role still 403s. If there is no row, and the consumed marker is `show_signup` and still unexpired, `insertShowProfile` writes `{ id, email, full_name: "", role: "show", tier: "free" }` keyed only by user id (`upsert` on `id` with `ignoreDuplicates`, then a re-read). Role `show` finishes at `/onboarding/show` unless the request already has a safe `next`. Any other stored role finishes as that role. No row and no valid marker still 403s. This path does not call `createUser`.
3. `insertShowProfile` in `lib/auth/login-otp-show.ts` is the insert `createShowAccount` now uses too. A race that stores a different role on that id is left untouched and returned as stored.
4. The show onboarding summary button idle label is `Next: prove you own the show`. The finishing state and the `/settings/ownership` redirect are unchanged. Brand summary was not edited.
5. `show_signup_ip_day` is keyed with `loginOtpClientIp` (prefers `x-vercel-forwarded-for`). `lib/security/rate-limit.ts` was not edited.
6. `/signup/show` is in `PUBLIC_PAGES` immediately after `/signup`, `marketing: false`, title `Sign up as a show or creator | Taylslate`. `app/(auth)/signup/show/layout.tsx` exports that metadata. The page copy is the description: a 6-digit code, no password.

## Routes and files

- `lib/auth/login-otp-show.ts` and `login-otp-show.test.ts`
- `app/api/auth/login/otp/route.ts` and `route.test.ts`
- `app/api/auth/login/otp/verify/route.ts` and `route.test.ts`
- `app/onboarding/show/summary/summary-client.tsx` and `summary-client.test.tsx`
- `lib/marketing/site.ts` and `site.test.ts`
- `app/(auth)/signup/show/layout.tsx` (new)
- `docs/jobs/R1.md` (the summary-copy and `PUBLIC_PAGES` gaps now point here)

`components/auth/show-email-code.tsx` was not edited. `intent` is still sent only on the code request. `proxy.ts`, `lib/stripe`, `lib/payouts`, `lib/billing`, `lib/airchecks`, and `lib/security/rate-limit.ts` were not edited.

## Known gaps

- No captcha on `/signup/show`. The send route's per-email, per-IP, and per-day limits are still the only brake.
- An existing profile that uses `/signup/show` still signs in as that role. The page does not say the address already had an account.
- A `profiles` row with an empty role still 403s, marker or not.
- A show sign-up `next` that fails `safeLoginNext` still falls back to `/dashboard`. The dashboard layout routes a `show` account onward.
- No migration.
