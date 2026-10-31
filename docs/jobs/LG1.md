# LG1: Terms of Service and Privacy Policy

No migration. Nothing was applied to `ldtmhafewfifdizgfrnn`. No payment code was edited.

The copy is a draft. The draft banner stays until Chris removes it. `PUBLIC_PAGES` marks `/terms` and `/privacy` with `marketing: false`, so they are `noindex` and they are not in the sitemap.

## What shipped

Signed-out visitors can open `/terms` and `/privacy`. `proxy.ts` matches those two paths exactly. A longer path such as `/terms/extra` still redirects to `/login`.

The footer in `components/marketing/marketing-chrome.tsx` links Terms to `/terms` and Privacy to `/privacy`. That chrome is shared by the home page, `/for-shows`, and the auth shell (login and signup). A search for `href="#"` under `app/` and `components/` found only those two footer links, and both now point at the pages.

The approved consent line is one exported constant, `CONSENT_LINE` in `app/terms/page.tsx`. Privacy imports that same constant. The sentences under "How the product applies that line" are not part of that approved line. The terms page file does not use the word "draft" because `lib/learning/pooled-deal-priors.test.ts` reads that file and rejects it. The visible banner lives in `components/marketing/legal-document.tsx`.

## Terms sections

- Who may use Taylslate
- Accounts and sign-in
- What Taylslate does
- How we use data
- User content and uploads
- Payments
- Acceptable use and take-down
- Deal terms live in the insertion order
- Disclaimers
- Limitation of liability
- Termination
- Changes to these terms
- Contact

## Privacy sections

- What we collect
- How we use it
- Pooled anonymized data
- Service providers
- Retention
- Security
- Your rights
- Cookies
- Children
- Changes
- Contact

## Placeholders

These render as square brackets in the page text:

- [COMPANY LEGAL NAME]
- [ENTITY TYPE AND STATE OF FORMATION] (Terms)
- [MAILING ADDRESS]
- [GOVERNING LAW STATE] (Terms)
- [VENUE] (Terms)
- [EFFECTIVE DATE] (Terms)
- [LEGAL CONTACT EMAIL] (Terms)
- [PRIVACY CONTACT EMAIL] (Privacy)
- [CONFIRM CURRENT PRICING] (Terms payments). This is the stand-in for fee percentages and plan prices, which are not written on the page.

`ops@taylslate.com` is an operations address in the repo. It is not used as the legal or privacy contact.

## [CONFIRM WITH COUNSEL]

Terms:

- Who may open an account, including age or authority to bind a company.
- What license the user grants Taylslate to host and process briefs, profiles, and uploads.
- Refunds, chargebacks, and a failed charge.
- Taylslate's own process for suspending an account or removing material. The morality and take-down clause on the generated insertion order is between the advertiser and the publisher.
- Whether Taylslate is a party to the advertising agreement. The generated order's signature lines are Advertiser and Publisher. That is not a conclusion that Taylslate is or is not a party.
- Whether Taylslate disclaims warranties, and whether scores, estimates, or recommendations are a promise of results.
- Any cap on damages, including indirect or consequential damages.
- When an account may be closed, and what happens to open deals and unpaid charges.
- How a change to the terms is announced, and when it takes effect.

Privacy:

- Any use of personal information beyond operating the service.
- How long each category of data is kept, including after a deletion request.
- Any security certification or extra security statement. The page does not claim SOC 2, GDPR compliance, insurance, or an uptime level.
- Any privacy rights beyond access, correction, and deletion by email, and the response time.
- Whether Vercel or Supabase sets extra cookies the app does not control.
- What the Cloudflare Turnstile script stores in the browser on login, signup, and forgot-password, and how long it is kept.
- Whether the "not directed to children under 18" line should be a different minimum age.
- How a change to the privacy policy is announced, and when it takes effect.

## Product sentences next to the consent line

These sit under the label "How the product applies that line". They are not the approved L2 line. Chris has not approved them.

- Anonymized patterns from deals booked and transacted through Taylslate feed a pooled dataset.
- An uploaded past-campaign file joins that pool only if the brand opts in on the import screen. The checkbox is off by default. The terms version recorded is pooling-v1.
- A brand's own uploaded past-campaign file stays private to that brand, is not shown to other brands or shows, and that file is never part of any aggregate unless that brand opted in. An imported insertion-order PDF becomes an ordinary deal and is pooled once it is signed. This narrowing still needs Chris's approval.

## Factual sources

| Statement | Source |
| --- | --- |
| Approved consent line, word for word | `app/terms/page.tsx` before this job, and `docs/jobs/L2.md` |
| Deal pool is anonymized groups of booked on-platform deals, kept at 5 distinct brands | `docs/jobs/L2.md` |
| Import checkbox off by default; terms version `pooling-v1` only when checked | `docs/jobs/I3.md`; constant `POOLING_TERMS_VERSION` in `lib/imports/review.ts` |
| Role labels Brand / Advertiser, Agency, Sales Agent / Manager | `app/onboarding/roles.tsx` |
| Sign-in is a 6-digit email code | `app/api/auth/login/otp/route.ts` |
| Discovery, outreach, insertion order, DocuSign, then payment | `docs/architecture-logs/TAYLSLATE_MASTER_ARCHITECTURE.md` section 3.5; DocuSign package `docusign-esign` |
| Card on file via Stripe SetupIntent at signature; card type; Taylslate does not receive the card number (Stripe CardElement) | `lib/stripe/setup-intent.ts`; `components/payments/CardForm.tsx` |
| Charge per episode after delivery is verified; fee is on top of the IO rate and stays with the platform; show is paid the IO rate | `lib/stripe/payment-intent.ts`; `lib/pdf/io-terms.ts` `ON_PLATFORM_PAYMENT` |
| Show payout through Stripe Connect after the charge succeeds (`settled_at` on `charge.succeeded`) | `lib/payouts/transfer.ts`; architecture doc payments row |
| Early payout exists and has a fee; the percentage is not printed | `lib/payouts/constants.ts` (read only) |
| Some orders are marked to pay outside Taylslate | `lib/pdf/io-terms.ts` `payment_off_platform` |
| Signature lines Advertiser and Publisher; agency of record is a named party when set | `lib/pdf/io-generator.ts`; `lib/pdf/io-terms.ts` |
| Supabase database and auth | `@supabase/supabase-js` and `@supabase/ssr` in `package.json` |
| Vercel hosting | architecture doc stack table; `next` in `package.json` |
| Stripe payments and payouts | `stripe` and `@stripe/stripe-js` in `package.json` |
| DocuSign e-signature | `docusign-esign` in `package.json` |
| Resend email | `resend` in `package.json` |
| Anthropic AI drafting and scoring | `@anthropic-ai/sdk` in `package.json`; `lib/llm/client.ts` |
| Podscan public show data | `lib/enrichment/podscan.ts` (`https://podscan.fm/api/v1`). Not an npm package. |
| YouTube Data API public channel data | `lib/enrichment/youtube.ts` (`https://www.googleapis.com/youtube/v3`). Not an npm package. |
| Auth session cookies | Supabase server client cookie adapter in `proxy.ts` and `lib/supabase/server.ts` |
| Recovery cookie `tslate_pw_recovery` | `lib/auth/recovery-cookie.ts` |
| Onboarding return cookie `tslate_onboarding_return` | `lib/auth/onboarding-return.ts` |
| Admin view cookie `taylslate_view_as` | `lib/data/queries.ts` |
| Admin return cookie `tslate_return_token` | `lib/admin/return-token.ts` |
| No advertising pixel and no analytics script. A Cloudflare Turnstile script does load. | `package.json` has no analytics package. `app/layout.tsx` loads no tag manager, pixel, or analytics script. `rg` for gtag, PostHog, Plausible, and Vercel Analytics in app code found none. Login, signup, and forgot-password mount `TurnstileWidget`, which loads `https://challenges.cloudflare.com/turnstile/v0/api.js` from `components/auth/turnstile-widget.tsx` when the site key is set. `pixel_required` on an insertion order is an IO field, not a site pixel. |

Fee percentages and plan prices were read in `lib/billing/plans.ts` only to avoid copying them. They are not on the page.

## Tests

`proxy.test.ts`, `lib/marketing/site.test.ts`, `app/terms/page.test.tsx`, `app/privacy/page.test.tsx`.
