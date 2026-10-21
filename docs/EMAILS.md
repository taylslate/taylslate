# Taylslate emails

Every message Taylslate sends uses `lib/email/layout.ts`: a white field (`#ffffff`), a thin ink header bar (`#1c1915`), the mark at `https://www.taylslate.com/mark.png`, the wordmark, a footer, and a plain-text part. Gold `#8c6e1f` is for links on the white field. Gold on the canvas field is `#7a5f17`. Buttons are ink with white text.

Regenerate HTML previews with:

```
npx tsx scripts/preview-emails.ts
```

Files land in `docs/email-previews/`.

## Senders

| Constant | From |
| --- | --- |
| `EMAIL_FROM_AUTH` | Taylslate \<auth@taylslate.com\> |
| `EMAIL_FROM_NOTIFICATIONS` | Taylslate \<notifications@taylslate.com\> |
| `EMAIL_FROM_OUTREACH` | Taylslate \<outreach@taylslate.com\> |
| `viaTaylslateFrom(name, invoices@)` | {Name} via Taylslate \<invoices@taylslate.com\> |
| `viaTaylslateFrom(name, io@)` | {Name} via Taylslate \<io@taylslate.com\> |
| Outreach pitch | {Brand} \<outreach@taylslate.com\>, reply-to outreach@taylslate.com |

`sendEmail` defaults to `notifications@` when a caller does not pass `from`.

## Managed-account reroute

`resolveManagedDelivery` in `lib/email/send.ts` sends mail for a managed profile to `MANAGED_ACCOUNT_INBOX` and prefixes the subject with the original address. Lookup is by `recipientProfileId`, then by the `to` address.

Login codes, handoff magic links, and show-setup magic links set `bypassManagedReroute`. They go to the real address so a managed account can still sign in.

Invoice send, legacy campaign outreach, and IO PDF send call `resolveManagedDelivery` before Resend. A managed recipient goes to `MANAGED_ACCOUNT_INBOX`. If that variable is unset, invoice send and IO PDF send return 409 and do not send. Legacy campaign outreach records that failure on the draft and does not send that draft.

## App mail (Resend)

| Id | Trigger | Recipient | Template | From | Reroute |
| --- | --- | --- | --- | --- | --- |
| login-magic | `POST /api/auth/login/magic` | The address typed on `/login` (brand or show) | `lib/email/templates/login-magic.ts` | auth@ | Bypassed |
| login-otp | `POST /api/auth/login/otp` | Any existing account on `/login` (brand or show), or show setup on a pitch | `lib/email/templates/login-otp.ts` | auth@ | Bypassed. Body is the 6-digit code. No link. `/login/show` redirects to `/login` |
| handoff-magic | `POST /api/admin/managed-brands/[id]/handoff` via `lib/accounts/handoff.ts` | The new brand email | `login-magic.ts` | auth@ | Bypassed |
| show-setup-magic | `POST /api/auth/magic/start` | Show email | `lib/email/templates/magic-link.ts` | auth@ | Bypassed. Link is `{origin}/api/auth/magic?token=` |
| outreach-pitch | `POST /api/outreach` | Show contact | `lib/email/templates/outreach.ts` | {Brand} \<outreach@\> reply-to outreach@ | Yes, `sendEmail` lookup by `to` |
| legacy-campaign-outreach | `POST /api/campaigns/outreach/send` | Show `contact_email` | `lib/email/templates/campaign-outreach.ts` | Taylslate \<outreach@\> | Yes, via `resolveManagedDelivery` (lookup by `to`). Subject is whatever the caller sends |
| brand-accepted / counter / declined | Show accept, counter, or decline in `app/api/outreach/[token]/_shared.ts` | Brand | `lib/email/templates/outreach-response-brand.ts` | notifications@ | Yes, `recipientProfileId` |
| io-ready | Same accept path when a deal is created, and `POST /api/outreach/[token]/accept-counter` | Brand | `lib/email/templates/io-ready-for-signature.ts` | notifications@ | Yes, `recipientProfileId` |
| brand-reminder | `GET /api/cron/deal-timeouts` on day 3 | Brand | `lib/email/templates/brand-signature-reminder.ts` | notifications@ | Yes, `recipientProfileId` |
| show-countersign | DocuSign webhook after the brand signs | Show | `lib/email/templates/show-countersignature-request.ts` | notifications@ | Lookup by `to` if that profile is managed |
| deal-cancelled | Brand cancel (`POST /api/deals/[id]/cancel`), DocuSign void, and the day-14 cron | Show | `lib/email/templates/deal-cancelled-show.ts` | notifications@ | Lookup by `to`. Timeout cron does not pass a profile id |
| invoice | `POST /api/invoices/send` | `invoice.bill_to_email` | `lib/email/templates/invoice-notice.ts` | {Name} via Taylslate \<invoices@\> | Yes, via `resolveManagedDelivery`. Profile id is the agency when the bill-to address is the agency, otherwise the brand |
| io-pdf | `POST /api/deals/[id]/io/send` | Agency email, otherwise the advertiser | `lib/email/templates/io-attachment.ts` | {Name} via Taylslate \<io@\> | Yes, via `resolveManagedDelivery` |
| conversion-alert | `GET /api/cron/conversion-alerts` | `INTERNAL_ALERT_EMAIL`, or chris@taylslate.com | `lib/alerts/conversion.ts` | notifications@ | Not applied. The cron skips managed customers before send |

Payments and payouts do not send a Taylslate email. Stripe may send its own receipt if that is turned on in Stripe. DocuSign sends the countersign envelope from dse@docusign.net. The show-countersign message tells the host to expect that.

Deal links in the app use `NEXT_PUBLIC_SITE_URL`, falling back to `https://www.taylslate.com`.

## Supabase Auth mail

Hosted on project `ldtmhafewfifdizgfrnn`. Source of the HTML is `lib/email/templates/auth.ts`. These are not sent through Resend. The SMTP sender name should be Taylslate. Apply with:

```
SUPABASE_ACCESS_TOKEN=... npx tsx scripts/apply-auth-email-templates.ts
```

The script patches subject and HTML only. It does not flip `mailer_notifications_*_enabled` and it does not change SMTP host, port, or password. It sets `smtp_sender_name` to Taylslate only when that field is something else.

`/login` sends a 6-digit code through Resend (`login-otp`) for brands and shows. It does not use a hosted Supabase template. `/login/show` redirects there. Handoff still sends the Resend magic-link email (`login-magic`). The hosted magic-link template stays a link so a dashboard send does not become a code. Supabase has no separate OTP config field, so `scripts/apply-auth-email-templates.ts` checks the code template in `lib/email/templates/auth.ts` (`id: otp`) and does not write it. Running that script is not required for the `/login` code change.

| Template | Subject | Link |
| --- | --- | --- |
| Confirm signup | Confirm your Taylslate account | `{{ .SiteURL }}/callback?token_hash={{ .TokenHash }}&type=signup&next=/onboarding` |
| Magic link | Log in to Taylslate | `…&type=magiclink&next=/dashboard` |
| OTP | Your Taylslate sign-in code | `{{ .Token }}` in the body. No link. Same copy as Resend `login-otp`, which is what `/login` sends to brands and shows. Not written by the apply script |
| Reset password | Reset your Taylslate password | `…&type=recovery&next=/reset-password` |
| Invite | You are invited to Taylslate | `…&type=invite&next=/onboarding` |
| Email change | Confirm your new Taylslate email | `{{ .ConfirmationURL }}` and `{{ .NewEmail }}`. Secure email change uses different verify types for the old and new address, so this one stays on ConfirmationURL |
| Reauthentication | Your Taylslate verification code | `{{ .Token }}` in the body. No link |
| Password changed | Your Taylslate password was changed | Notice only |
| Email changed | Your Taylslate email was changed | `{{ .OldEmail }}` to `{{ .Email }}` |
| Phone changed | Your Taylslate phone number was changed | `{{ .OldPhone }}` to `{{ .Phone }}` |
| MFA enrolled | A verification method was added to your Taylslate account | `{{ .FactorType }}` |
| MFA unenrolled | A verification method was removed from your Taylslate account | `{{ .FactorType }}` |
| Identity linked | A sign-in method was linked to your Taylslate account | `{{ .Provider }}`, `{{ .Email }}` |
| Identity unlinked | A sign-in method was removed from your Taylslate account | `{{ .Provider }}`, `{{ .Email }}` |

Confirm, magic link, recovery, and invite must not use `{{ .ConfirmationURL }}`. That URL puts the session in a fragment `/callback` cannot read.
