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
          <li>YouTube Data API: public channel data.</li>
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
          deletion of your account data. [CONFIRM WITH COUNSEL] Any additional
          rights, and how long a response should take.
        </p>
      </LegalSection>

      <LegalSection heading="Cookies">
        <p>
          Taylslate sets cookies to keep you signed in. Those are the
          authentication session cookies. It also sets a short-lived cookie so
          a password reset form opens only after a recovery link, a short-lived
          cookie that returns a show to an outreach page after onboarding, and
          cookies an internal admin uses to switch a test view and to return
          to the admin account.
        </p>
        <p>
          Taylslate does not install an advertising pixel or a third-party
          analytics script in this application. [CONFIRM WITH COUNSEL] Whether
          a host such as Vercel or Supabase sets additional cookies we do not
          control in the browser.
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
