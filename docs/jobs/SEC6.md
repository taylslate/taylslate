# SEC6: Bind the pitch magic link to the outreach recipient

No page or component was edited. Screenshots are not applicable. No migration.

## Audit

Read on main `2732ccd`. `POST /api/auth/magic/start` checked the JSON shape, verified the outreach token by signature only, signed a magic token for `body.email` with the 24 hour default, and mailed it to `body.email` from `EMAIL_FROM_AUTH` with `bypassManagedReroute`. Nothing compared the address to `outreaches.sent_to_email`. Nothing limited the route. The pitch page prefills the recipient and lets the visitor edit it. It only reads `res.ok` and `data.error`.

`GET /api/auth/magic` already limits by IP. It verified the magic token, then found or created an auth user for the token email (`email_confirm` true, `profiles.role` `show`) and minted a fresh Supabase hashed token. The magic token itself was stateless and reusable until `exp`. The route did not check the email against an outreach. `next` stays `/onboarding/show`. `return_url` had to be same-origin before the return cookie was set. No open redirect.

The start response was the same shape for every address, because it sent either way. 401 and 404 only say whether the outreach token is valid.

A session at some other address is not attached to the outreach, the show profile, the deal, IO signing, or a payout. The pitch page treats the show as onboarded only through `profileByLoginEmail(sent_to_email)`. Accept sets `deals.show_profile_id` from that same address, or NULL. Onboarding backfill links NULL deals only when `sent_to_email` matches the user's auth email. Accept, counter, and decline still need only the outreach token. That is SEC5, not this job.

`POST /api/auth/login/otp` already mints a new-account code only when the address is the outreach contact, and it limits per email and per IP. This job copies that binding onto the magic start route, and checks it again when the link is opened.

Ownership status and the payout verify gate are never reached here, because a mismatched session is not linked to the show.

## Severity

Medium. Not an account takeover and not a payout takeover. The harms are unlimited Taylslate-branded auth mail to any address (spam, a phishing cover, sender reputation on the auth domain), a confirmed `show` account at whatever inbox clicks the link, the outreach token riding inside `return_url`, and a link that could be reused for 24 hours.

## Precheck

Read only, project `ldtmhafewfifdizgfrnn`, Nov 11, 2026. No rows written.

| Check | Result |
| --- | --- |
| `outreaches` | 1 |
| `outreaches` with an empty `sent_to_email` | 0 |
| auth users with `raw_user_meta_data.source = 'magic_link'` | 0 |
| `public.rate_limit_hit(text,text,integer,integer)` | present |
| `rate_limit_events` | 5 |

That matches the Nov 10, 2026 expectation (1, 0, 0, not null, about 5). Coding continued.

## Choice

No migration. Both ends bind to `sent_to_email` in the route. Start refuses a mismatch quietly. Verify refuses a token whose email is not that recipient, including a link minted before this deploy for some other address. The counter is the existing `rate_limit_hit`, through `enforceMagicStart`. The shorter expiry is an argument to `signMagicLinkToken`. `lib/io/tokens.ts` was not edited. Its default stays 24 hours for any other caller.

`enforceMagicStart` fails closed. Rules, in order:

1. IP, bucket `magic_start_ip`, 10 per hour (`LOGIN_CODE_SEND_IP_MAX` and its window).
2. Outreach, bucket `magic_start_outreach`, key the outreach id, `MAGIC_START_OUTREACH_MAX` 5 per hour (same one-hour window).
3. Email, bucket `magic_start_email`, key `hashRateLimitEmail`, 3 per 15 minutes (`LOGIN_CODE_SEND_EMAIL_MAX` and its window).

The limit runs for a match and a mismatch. Over the limit is 429 with `Retry-After`. A counter error is 503 and sends nothing.

On a match the route signs with `MAGIC_START_TTL_SECONDS` (3600), sends to the normalized recipient, and returns `{ ok: true }` whether or not the send succeeded. A failed send is logged with the reason, not the address. `email_sent` and `email_reason` are dropped.

`GET /api/auth/magic` parses `return_url` after `verifyMagicLinkToken` and before any user lookup. It requires this origin, a path of exactly `/outreach/<token>`, a valid outreach token, a row from `getOutreachById`, and `normalizeLoginEmail(sent_to_email) === email`. Any failure redirects to `/auth/magic?error=invalid_or_expired` and creates nothing. The parsed URL is what the existing return cookie uses. The cookie, `/onboarding/show`, `generateLink`, and the callback are unchanged.

The pitch client was not edited.

## Decisions

Defaults, used as specified.

- Single-use magic tokens. Possible with no migration (one hit, key a hash of the token, window equal to the TTL). A mail scanner that prefetches the GET would burn the only use and the show would land on an error. Default: not single-use. 1 hour TTL instead.
- Rate limit numbers. Default: 10 per IP per hour, 5 per outreach per hour, 3 per email per 15 minutes.
- A show whose real inbox differs from what the brand typed gets no link and no error. Default: accept that, same as the email-code path. The brand resends to the right address.

## Apply order

None. No migration, grant, or policy. Independent of 084 (merged), 085 (SEC3), 086 (SEC4), and 087 (SEC5). Deploy closes old 24 hour links that were minted for an address other than the recipient, because GET now checks the binding.

## Follow-ups

Not in this PR.

- The pitch page passes `sent_to_email` to the browser, so a token holder sees the recipient anyway. The generic answer does not hide that. Mask it in a later UI job. SEC5 owns `app/outreach/[token]/page.tsx`.
- The mismatch path skips the brand lookup and the send, so it answers faster. Moot while the address is on the page. Revisit with the masking job.
- GET still creates `role` `show` for a new address that passes the binding. The brand chooses `sent_to_email`, so one invite can target any inbox. Same as the email-code path. Consider a confirm step before account creation.
- `siteOrigin` falls back to the request host when `NEXT_PUBLIC_SITE_URL` is unset. Confirm it is set in production.
- The setup email still says the link expires in 24 hours (`lib/email/templates/magic-link.ts`). That file is outside this job. The token expires in 1 hour.
- `docs/security/RATE_LIMITS.md` still says this route has no limit. That file is outside this job.

SEC5 follow-up "magic/start sends to any address": closed by SEC6. The sentence was not in `docs/security/S-A_FINDINGS.md` on main `2732ccd`. The SEC6 finding there records the close.
