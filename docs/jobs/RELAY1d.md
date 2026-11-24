# RELAY1d: contacts masked both ways until signing

No migration. No DocuSign file change. No Vercel env change. No real email.

## Decision 8

The brand's contact is hidden from the show until the IO is signed, symmetric to decision 7. Same unlock rule (both sides signed, deal not cancelled, and the deal has an outreach id), same masked text ("Sent through Taylslate" on a document or screen, empty string in JSON), admins exempt. Chris confirmed this in Taylslate Dev Chat on 2026-11-23 at 11:24 PM MT.

Each side still sees its own address. A missing deal, a missing user, or a failed read stays masked.

## What changed

- `lib/relay/io-contact.ts` holds `revealPublisherContact`, `blankPublisherContact`, and the advertiser mirror. IO routes import them.
- Wave 12 and legacy IO PDFs take `showContactVisible` and `brandContactVisible`. Both default to masked, so the unchanged `send-to-docusign` call renders both contact blocks as "Sent through Taylslate" while `createEnvelope` still gets the real account emails.
- Preview, legacy PDF, IO JSON, io/generate, and GET deal apply the same rule. io/generate checks the party before it returns an IO. A show-side write cannot change the stored brand address.
- io/send emails only `getAuthEmail` of the deal's agency account, or the brand account when there is no agency. It is rate limited fail-closed (10 an hour, 30 a day). The response omits `to` unless the caller may see the brand side. No account address is 409.
- PUT `/api/campaigns/selections` accepts only a deduped list of at most 200 ids, on a campaign the caller owns, and only shows `pitchableShowIds` allows (or a non-uuid id already on that campaign's `scored_shows`).
- The two dead "Copy email" buttons are gone. The "Sent through Taylslate" spans stay.

Wave 12 rows leave `agent_id` empty. Preview and GET deal treat the show-profile owner as the publisher party when they apply the rule. That copy is not stored. Legacy visibility still comes only from the deal's party columns.

## Needs Chris

- The signed IO will permanently read "Sent through Taylslate" in both contact blocks. The document is fixed at envelope creation. After signing, the app shows each side the other's address.
- DocuSign's Certificate of Completion and envelope history list every signer's name and email, and a signer can open them from the signing session. DocuSign itself can show each side the other's signing email. Not changed here.
- Agent-created legacy deals can no longer use "Send via Email" (409). Download PDF still works. A caller who is the recipient account gets the same 409.
- 094 and 102 stay unapplied until Chris names them. This job does not apply them.
