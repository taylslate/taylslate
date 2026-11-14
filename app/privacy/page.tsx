import type { Metadata } from "next";
import {
  DataUseCopy,
  LegalBodyLink,
  LegalDocument,
  LegalSection,
} from "@/components/marketing/legal-document";
import { publicMetadata } from "@/lib/marketing/site";
import { CONSENT_LINE } from "@/app/terms/page";

export const metadata: Metadata = publicMetadata("/privacy");

export default function PrivacyPage() {
  return (
    <LegalDocument title="Privacy Policy">
      <p>
        This policy is a draft for [COMPANY LEGAL NAME]. It describes what
        Taylslate collects and how that information is used. It is not legal
        advice while the draft line above is on this page.
      </p>

      <LegalSection heading="What we collect">
        <p>When you use Taylslate, we collect:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>Account email and name.</li>
          <li>Company.</li>
          <li>Brand and show profile data.</li>
          <li>Campaign briefs.</li>
          <li>Uploaded past-campaign files.</li>
          <li>
            Deal and payment records, including amounts, status, and Stripe
            identifiers. Taylslate does not store card numbers.
          </li>
          <li>
            Usage logs the app writes when something happens, such as a deal
            update or an operation record.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="How we use it">
        <p>
          We use this information to run accounts, discovery, outreach,
          insertion orders, signatures, and payments, and to keep a record of
          what happened. [CONFIRM WITH COUNSEL] Any use beyond operating the
          service.
        </p>
      </LegalSection>

      <LegalSection heading="Google and YouTube data">
        <p>
          Taylslate uses YouTube API Services. By connecting a YouTube channel
          you also agree to the YouTube Terms of Service (
          <LegalBodyLink href="https://www.youtube.com/t/terms">
            https://www.youtube.com/t/terms
          </LegalBodyLink>
          ). Google&apos;s Privacy Policy is at{" "}
          <LegalBodyLink href="https://policies.google.com/privacy">
            https://policies.google.com/privacy
          </LegalBodyLink>
          .
        </p>
        <p>
          If you are a creator and choose to connect your YouTube channel,
          Taylslate asks Google for two permissions. youtube.force-ssl lets us
          read the caption tracks of videos on your channel. Google does not
          offer a narrower permission for captions, and it also allows changes
          to your channel; Taylslate never uploads, edits, deletes or posts
          anything. yt-analytics.readonly lets us read YouTube Analytics for
          videos on your Taylslate deals.
        </p>
        <p>
          What we store: your channel ID and title; the caption text for a
          video that is tied to one of your Taylslate deals, and the part of
          it that contains the sponsor read; for those videos only, views,
          estimated minutes watched, average view duration and the audience
          retention points around the sponsor read; and the Google access and
          refresh tokens, encrypted.
        </p>
        <p>
          Why we use it: only to check that a booked sponsor read aired as
          agreed and to record delivery for that deal. We do not use Google
          user data for advertising, we do not sell it, and we do not use it
          to train AI models. Results from Google data are not used in pooled
          anonymized data or to improve Taylslate for other users.
        </p>
        <p>
          Who can see it: you, and Taylslate staff who review a sponsor read.
          Brands do not see your captions or analytics. [CONFIRM WITH COUNSEL]
          Whether staff review needs its own line under Google&apos;s
          human-reading rules.
        </p>
        <p>
          Caption text and the sponsor-read excerpt are deleted 30 days after
          we fetch them. The result of the check (whether the read was found,
          its position and length) stays with the deal record. Analytics values
          are kept while your channel stays connected, and we re-check your
          authorization at least every 30 days. If your authorization lapses
          and you do not reconnect, we delete your Google data 30 days later.
          If you disconnect in Taylslate, we revoke our access at Google,
          delete your tokens right away, and delete the remaining Google data
          within 7 days. If you remove Taylslate at Google, we treat that as a lapsed
          authorization and delete your tokens when our daily check detects
          it. [CONFIRM WITH COUNSEL] Whether YouTube API policy III.D.3
          requires deletion within 7 days after that revocation at Google.
        </p>
        <p>
          Disconnect at any time on{" "}
          <LegalBodyLink href="https://www.taylslate.com/settings/youtube">
            www.taylslate.com/settings/youtube
          </LegalBodyLink>
          , or remove Taylslate at{" "}
          <LegalBodyLink href="https://security.google.com/settings/security/permissions">
            https://security.google.com/settings/security/permissions
          </LegalBodyLink>
          .
        </p>
        <p>
          Taylslate&apos;s use and transfer to any other app of information
          received from Google APIs will adhere to the Google API Services User
          Data Policy (
          <LegalBodyLink href="https://developers.google.com/terms/api-services-user-data-policy">
            https://developers.google.com/terms/api-services-user-data-policy
          </LegalBodyLink>
          ), including the Limited Use requirements.
        </p>
        <p>
          Separately, Taylslate stores public YouTube channel data (title,
          description, thumbnail, subscriber, video and view counts) through
          the YouTube Data API to help brands find creators. It is refreshed or
          deleted within 30 days.
        </p>
      </LegalSection>

      <LegalSection heading="Pooled anonymized data">
        <DataUseCopy consentLine={CONSENT_LINE} />
      </LegalSection>

      <LegalSection heading="Service providers">
        <p>
          These providers process data for the purpose named. Each one is in
          use in this product.
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>Supabase: database and auth.</li>
          <li>Vercel: hosting.</li>
          <li>Stripe: payments and payouts.</li>
          <li>DocuSign: e-signature.</li>
          <li>Resend: email.</li>
          <li>Anthropic: AI drafting and scoring.</li>
          <li>Podscan: public podcast show data.</li>
          <li>
            Google (YouTube Data API and YouTube Analytics API): public channel
            data, and, for creators who connect a channel, the data described
            under Google and YouTube data.
          </li>
          <li>
            Cloudflare Turnstile: bot check on login, signup, and
            forgot-password.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="Retention">
        <p>
          [CONFIRM WITH COUNSEL] How long account, profile, brief, upload,
          deal, payment, and log data are kept, including after you ask for
          deletion.
        </p>
      </LegalSection>

      <LegalSection heading="Security">
        <p>
          Sign-in is an email code. Database access for a signed-in user is
          limited by row rules, and server-side writes use a separate service
          credential. Card numbers are collected by Stripe, not stored by
          Taylslate. This draft does not claim a certification, insurance, or
          an uptime level. [CONFIRM WITH COUNSEL] Any security statement that
          should be added.
        </p>
      </LegalSection>

      <LegalSection heading="Your rights">
        <p>
          Email [PRIVACY CONTACT EMAIL] to ask for access to, correction of, or
          deletion of your account data. You can also disconnect YouTube as
          described under Google and YouTube data. [CONFIRM WITH COUNSEL] Any
          additional rights, and how long a response should take.
        </p>
      </LegalSection>

      <LegalSection heading="Cookies">
        <p>
          Taylslate sets cookies to keep you signed in. Those are the
          authentication session cookies. It also sets a short-lived cookie so
          a password reset form opens only after a recovery link, a short-lived
          cookie that returns a show to an outreach page after onboarding, and
          cookies an internal admin uses to switch a test view and to return
          to the admin account. Connecting a YouTube channel sets a
          short-lived cookie (10 minutes) that protects the Google sign-in
          step.
        </p>
        <p>
          Taylslate does not install an advertising pixel or a third-party
          analytics script in this application. Login, signup, and
          forgot-password load a Cloudflare Turnstile script for a bot check.
          [CONFIRM WITH COUNSEL] What that script stores in the browser, and
          how long it is kept. [CONFIRM WITH COUNSEL] Whether a host such as
          Vercel or Supabase sets additional cookies we do not control in the
          browser.
        </p>
      </LegalSection>

      <LegalSection heading="Children">
        <p>
          Taylslate is not directed to children under 18. [CONFIRM WITH
          COUNSEL] Whether the minimum age should be stated differently.
        </p>
      </LegalSection>

      <LegalSection heading="Changes">
        <p>
          This page is a draft. [CONFIRM WITH COUNSEL] How a change to this
          policy will be announced, and when it takes effect.
        </p>
      </LegalSection>

      <LegalSection heading="Contact">
        <p>
          [COMPANY LEGAL NAME]
          <br />
          [MAILING ADDRESS]
          <br />
          Privacy contact: [PRIVACY CONTACT EMAIL]
        </p>
        <p>
          The terms of service are at{" "}
          <LegalBodyLink href="/terms">Terms of Service</LegalBodyLink>.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
