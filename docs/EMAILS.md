# Taylslate emails

Every message Taylslate sends uses `lib/email/layout.ts`: paper `#f2ebe1`, ink `#1c1915`, the mark at `https://www.taylslate.com/mark.png`, the wordmark, a footer, and a plain-text part. Copper `#c17a45` is for links. Buttons are ink with paper text.

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

Login magic links, handoff magic links, and show-setup magic links set `bypassManagedReroute`. They go to the real address so a managed brand can still sign in.

Invoice send and legacy campaign outreach call Resend directly. They are not rerouted. IO PDF send calls `resolveManagedDelivery` itself.

## App mail (Resend)

| Id | Trigger | Recipient | Template | From | Reroute |
| --- | --- | --- | --- | --- | --- |
| login-magic | `POST /api/auth/login/magic` | The address typed on `/login` (brand or show) | `lib/email/templates/login-magic.ts` | auth@ | Bypassed |
| handoff-magic | `POST /api/admin/managed-brands/[id]/handoff` via `lib/accounts/handoff.ts` | The new brand email | `login-magic.ts` | auth@ | Bypassed |
| show-setup-magic | `POST /api/auth/magic/start` | Show email | `lib/email/templates/magic-link.ts` | auth@ | Bypassed. Link is `{origin}/api/auth/magic?token=` |
| outreach-pitch | `POST /api/outreach` | Show contact | `lib/email/templates/outreach.ts` | {Brand} \<outreach@\> reply-to outreach@ | Yes, `sendEmail` lookup by `to` |
| legacy-campaign-outreach | `POST /api/campaigns/outreach/send` | Show `contact_email` | `lib/email/templates/campaign-outreach.ts` | Taylslate \<outreach@\> | No. Direct Resend. Subject is whatever the caller sends |
| brand-accepted / counter / declined | Show accept, counter, or decline in `app/api/outreach/[token]/_shared.ts` | Brand | `lib/email/templates/outreach-response-brand.ts` | notifications@ | Yes, `recipientProfileId` |
| io-ready | Same accept path when a deal is created, and `POST /api/outreach/[token]/accept-counter` | Brand | `lib/email/templates/io-ready-for-signature.ts` | notifications@ | Yes, `recipientProfileId` |
| brand-reminder | `GET /api/cron/deal-timeouts` on day 3 | Brand | `lib/email/templates/brand-signature-reminder.ts` | notifications@ | Yes, `recipientProfileId` |
| show-countersign | DocuSign webhook after the brand signs | Show | `lib/email/templates/show-countersignature-request.ts` | notifications@ | Lookup by `to` if that profile is managed |
| deal-cancelled | Brand cancel (`POST /api/deals/[id]/cancel`), DocuSign void, and the day-14 cron | Show | `lib/email/templates/deal-cancelled-show.ts` | notifications@ | Lookup by `to`. Timeout cron does not pass a profile id |
| invoice | `POST /api/invoices/send` | `invoice.bill_to_email` | `lib/email/templates/invoice-notice.ts` | {Name} via Taylslate \<invoices@\> | No. Direct Resend |
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

Login on `/login` does not use the Supabase magic-link template. That path is Resend (`login-magic`). The hosted magic-link template is still updated so a dashboard send matches.

| Template | Subject | Link |
| --- | --- | --- |
| Confirm signup | Confirm your Taylslate account | `{{ .SiteURL }}/callback?token_hash={{ .TokenHash }}&type=signup&next=/onboarding` |
| Magic link | Log in to Taylslate | `…&type=magiclink&next=/dashboard` |
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
