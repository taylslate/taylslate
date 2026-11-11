# LG2: Privacy policy and terms, Google and YouTube

No migration. Nothing was applied to `ldtmhafewfifdizgfrnn`. No route, style, or code path changed. Copy only.

Grounded at main `b7efa4a` (SEC6, #93).

Legal copy is published only after Chris approves the exact text in the PR. Merging is publishing. This job does not merge.

## Why

LOCKED (Chris, 2026-11-11): "we draft the privacy policy and terms updates by about Nov 20".

Google's sensitive-scope review for `youtube.force-ssl` and `yt-analytics.readonly` needs a privacy policy on the verified domain that discloses how Google user data is accessed, used, stored, and shared.

This job is separate from AC-YT. The policy has to be live before that submission.

## Requirements and sources

| Requirement | Source |
| --- | --- |
| Privacy policy on the verified domain discloses how Google user data is accessed, used, stored, and shared | https://support.google.com/cloud/answer/13464321 and https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification |
| Terms bind users of YouTube API Services to the YouTube Terms of Service | YouTube API Services Developer Policies III.A.1, https://developers.google.com/youtube/terms/developer-policies |
| Privacy policy says the product uses YouTube API Services and links the Google Privacy Policy | Developer Policies III.A.2 |
| Privacy policy says what is accessed, collected, stored, and used, and how it is shared | Developer Policies III.A.2 |
| Privacy policy discloses cookies | Developer Policies III.A.2 |
| Users can revoke access at https://security.google.com/settings/security/permissions | Developer Policies III.A.2 |
| Privacy policy has a contact | Developer Policies III.A.2 |
| After revocation, delete Google data within 7 days | Developer Policies III.D.3 |
| Stored YouTube API data is refreshed or deleted within 30 days, and authorization is re-checked at least every 30 days | Developer Policies III.E.4 |
| Limited Use sentence, verbatim, with the policy URL | Google API Services User Data Policy, https://developers.google.com/terms/api-services-user-data-policy |
| Scopes, what is stored, why, who sees it, retention, disconnect, and that brands do not see captions or analytics | AC-YT facts in `/workspace/prompts/AC-YT-youtube-oauth-airchecks.md` (scopes, retention, disconnect, no brand visibility, Testing mode). That prompt is not in this repo. The sentences below are the copy that prompt requires. |
| Public channel data (title, description, thumbnail, subscriber, video, and view counts) is refreshed or deleted within 30 days | L1: `lib/youtube-library/refresh.ts` (the 30-day sweep) and `YOUTUBE_STATS_MAX_AGE_DAYS` in `lib/youtube-library/store.ts` |
| External links stay in the same tab, and the full https URL is visible | This job. `LegalBodyLink` has no `target`. The URL is the link text. |

## Where the copy went

`/privacy`, section "Google and YouTube data", after "How we use it":

- Taylslate uses YouTube API Services. By connecting a YouTube channel you also agree to the YouTube Terms of Service (https://www.youtube.com/t/terms). Google's Privacy Policy is at https://policies.google.com/privacy.
- If you are a creator and choose to connect your YouTube channel, Taylslate asks Google for two permissions. youtube.force-ssl lets us read the caption tracks of videos on your channel. Google does not offer a narrower permission for captions, and it also allows changes to your channel; Taylslate never uploads, edits, deletes or posts anything. yt-analytics.readonly lets us read YouTube Analytics for videos on your Taylslate deals.
- What we store: your channel ID and title; the caption text for a video that is tied to one of your Taylslate deals, and the part of it that contains the sponsor read; for those videos only, views, estimated minutes watched, average view duration and the audience retention points around the sponsor read; and the Google access and refresh tokens, encrypted.
- Why we use it: only to check that a booked sponsor read aired as agreed and to record delivery for that deal. We do not use Google user data for advertising, we do not sell it, and we do not use it to train AI models. Results from Google data are not used in pooled anonymized data or to improve Taylslate for other users.
- Who can see it: you, and Taylslate staff who review a sponsor read. Brands do not see your captions or analytics. [CONFIRM WITH COUNSEL] Whether staff review needs its own line under Google's human-reading rules.
- Caption text and the sponsor-read excerpt are deleted 30 days after we fetch them. The result of the check (whether the read was found, its position and length) stays with the deal record. Analytics values are kept while your channel stays connected, and we re-check your authorization at least every 30 days. If your authorization lapses and you do not reconnect, we delete your Google data 30 days later. If you disconnect in Taylslate, we revoke our access at Google, delete your tokens right away, and delete the remaining Google data within 7 days. If you remove Taylslate at Google, we treat that as a lapsed authorization and delete your tokens when our daily check detects it. [CONFIRM WITH COUNSEL] Whether YouTube API policy III.D.3 requires deletion within 7 days after that revocation at Google.
- Disconnect at any time on www.taylslate.com/settings/youtube, or remove Taylslate at https://security.google.com/settings/security/permissions.
- Taylslate's use and transfer to any other app of information received from Google APIs will adhere to the Google API Services User Data Policy (https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.
- Separately, Taylslate stores public YouTube channel data (title, description, thumbnail, subscriber, video and view counts) through the YouTube Data API to help brands find creators. It is refreshed or deleted within 30 days.

`/privacy`, "Service providers": the YouTube line is now "Google (YouTube Data API and YouTube Analytics API): public channel data, and, for creators who connect a channel, the data described under Google and YouTube data."

`/privacy`, "Cookies", one added sentence: "Connecting a YouTube channel sets a short-lived cookie (10 minutes) that protects the Google sign-in step."

`/privacy`, "Your rights", one added sentence: "You can also disconnect YouTube as described under Google and YouTube data." [PRIVACY CONTACT EMAIL] stays.

`/terms`, section "YouTube", after "What Taylslate does": "Taylslate uses YouTube API Services. If you connect a YouTube channel or use a feature that shows YouTube data, you agree to be bound by the YouTube Terms of Service (https://www.youtube.com/t/terms). How Taylslate handles Google data is in the Privacy Policy." Privacy Policy links to `/privacy`. The terms page file does not contain the word "draft".

`CONSENT_LINE`, `DataUseCopy`, the pooled-data copy, and `LEGAL_DRAFT_BANNER` are unchanged. `components/marketing/legal-document.tsx` was not edited.

## Chris must supply before Google submission

Blocking. This job does not invent these.

- The legal entity name, mailing address, and a working privacy contact email. Placeholders still on the page: [COMPANY LEGAL NAME], [MAILING ADDRESS], [PRIVACY CONTACT EMAIL] in `app/privacy/page.tsx`. Google and the YouTube audit form both ask for a legal name and contact. A policy with placeholders will likely fail review.
- Whether `LEGAL_DRAFT_BANNER` ("Draft for review. Not yet legal advice or an agreed contract.") comes off. A reviewer may read a draft policy as no policy. Removing it is a one-line change in `components/marketing/legal-document.tsx`, which this job does not own.
- Approval of every sentence in the draft copy above, or edits. The staff-review sentence stays marked [CONFIRM WITH COUNSEL] until counsel decides whether that human-reading line is required.

Terms placeholders that LG1 already left, and that this job did not fill: [COMPANY LEGAL NAME], [ENTITY TYPE AND STATE OF FORMATION], [MAILING ADDRESS], [LEGAL CONTACT EMAIL], [GOVERNING LAW STATE], [VENUE], [EFFECTIVE DATE], [CONFIRM CURRENT PRICING].

## Not in this PR

- AC-YT itself. The retention periods above are the AC-YT periods. This copy does not promise a shorter one.
- Taking the draft banner off.
- Any change under `lib/stripe`, `lib/payouts`, `lib/billing`, or `lib/airchecks`.
- A migration, a live write, a charge, or a send.
