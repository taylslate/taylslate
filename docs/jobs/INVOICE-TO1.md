# INVOICE-TO1: Lock the invoice recipient

No migration. No live write. No email was sent. Resend is mocked in tests.

## What shipped

`POST /api/invoices/send` accepts only `invoice_id`. A body that includes `invoice` is 400, including when `invoice_id` is also present. The route loads the invoice and the IO's `deal_id` with the service role (`getInvoiceForDelivery`), then the deal. Invoice and IO policies only name `agent_id`, `brand_id`, and `agency_id`. A Wave 12 show owner is `show_profile_id`, so the user client cannot be the ownership read.

The caller must be that publisher side: `deal.agent_id` equals the authenticated profile id, or the caller's show profile id equals `deal.show_profile_id`. A missing invoice, a missing IO, a missing deal, and a caller who is not that side all return 404 `{ "error": "Invoice not found" }`. Ownership is the profile id from `auth.uid()`. It is not an email compare. A brand or agency party is not the publisher.

The recipient is `getAuthEmail` of `deal.agency_id` when that is set, otherwise `deal.brand_id`. The request body, `invoices.bill_to_email`, and the IO contact columns are not the address. The same profile id is `recipientProfileId` on `resolveManagedDelivery`, so a managed brand or agency still reroutes. If that profile is the caller, or the account has no login email, the route returns 409 and does not send. The PDF attached to the message uses that account address. The JSON response does not include `to`, and its subject is the original subject, so a managed prefix cannot echo the address.

`enforceIoSend` runs after auth and before the load. It is fail-closed, 10 an hour and 30 a day, the same helper as IO send. Provider and database failures return a fixed message. The code is logged. The message is not.

The invoices list posts `{ invoice_id }` for both an existing row and a just-generated row. Generate already saves the invoice. The detail page already posted the id. Both screens render the bill-to address as `Sent through Taylslate`. The name stays.

## Callers of POST /api/invoices/send

- `app/(dashboard)/invoices/page.tsx` `handleSendEmail`. List send and generated send both post `{ invoice_id }`. The generated id is the one `POST /api/invoices/generate` already stored. A generated payload with no id does not send.
- `app/(dashboard)/invoices/[id]/page.tsx` `handleSendInvoice`. Still posts `{ invoice_id: id }`.
- No other application caller. The route tests call the handler directly.

`POST /api/invoices/pdf` still accepts a client invoice for download. That is not this route.

## Not edited

`lib/stripe`, `lib/billing`, `lib/payouts`, `lib/airchecks`, `plans.ts`, outreach, and IO PDF code. No migration. No Vercel env change. `docs/EMAILS.md` still describes the old recipient. `GET /api/invoices` and `GET /api/invoices/[id]` still return the stored `bill_to_email`. Those files are outside this job.

`createInvoiceFromIO` still writes `bill_to_email` from `send_invoices_to`, then `agency_contact_email`, then `advertiser_contact_email`, and `from_email` from `invoiceFromEmail`. Send does not read `bill_to_email`.

## Tests

`app/api/invoices/send/route.test.ts`: not-owner and missing are the same 404, `invoice` is 400, the address is the deal account and not the request or the stored invoice email, agency wins over brand, managed reroute keeps `recipientProfileId`, 409 when the account is missing or the caller is the recipient, 429 and 503 from the limiter, and a provider or thrown error is not copied into the body.

`app/(dashboard)/invoices/page.test.tsx` and `app/(dashboard)/invoices/[id]/page.test.tsx`: the address renders as `Sent through Taylslate`, and both send buttons post an id.
