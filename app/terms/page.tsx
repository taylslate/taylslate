import type { Metadata } from "next";
import {
  DataUseCopy,
  LegalBodyLink,
  LegalDocument,
  LegalSection,
} from "@/components/marketing/legal-document";
import { publicMetadata } from "@/lib/marketing/site";

export const CONSENT_LINE =
  "Taylslate may use aggregated, anonymized data from deals booked and completed through Taylslate to improve pricing and recommendations. Aggregates never identify a brand, and each one combines at least five brands. Files you upload stay private unless you choose to share them.";

export const metadata: Metadata = publicMetadata("/terms");

export default function TermsPage() {
  return (
    <LegalDocument title="Terms of Service">
      <p>
        These terms are written for [COMPANY LEGAL NAME], [ENTITY TYPE AND
        STATE OF FORMATION]. They are not an agreed contract while the line
        above is on this page. Effective date: [EFFECTIVE DATE].
      </p>

      <LegalSection heading="Who may use Taylslate">
        <p>
          Taylslate is for brands, shows, and Sales Agent / Manager accounts.
          A brand plans and buys host-read sponsorships. A show receives
          offers and delivers the reads. A Sales Agent / Manager represents
          shows. An agency account can also sign up to manage campaigns for
          brand clients.
        </p>
      </LegalSection>

      <LegalSection heading="Accounts and sign-in">
        <p>
          You need an account. Sign-in is a 6-digit code sent to your email.
          [CONFIRM WITH COUNSEL] Who may open an account, including any rule
          about age or authority to bind a company.
        </p>
      </LegalSection>

      <LegalSection heading="What Taylslate does">
        <p>
          Taylslate is software for podcast and long-form YouTube sponsorships.
          A brand can run discovery, send outreach, and receive an insertion
          order. That order is signed through DocuSign. Taylslate also
          facilitates payment, as described under Payments.
        </p>
      </LegalSection>

      <LegalSection heading="How we use data">
        <DataUseCopy consentLine={CONSENT_LINE} />
      </LegalSection>

      <LegalSection heading="User content and uploads">
        <p>
          You may submit a campaign brief, brand or show profile details, and
          uploaded past-campaign files (CSV, XLSX, or PDF). [CONFIRM WITH
          COUNSEL] What license you grant Taylslate to host and process that
          material. An uploaded file stays private to the brand that uploaded
          it unless that brand opts in, as described under How we use data.
        </p>
      </LegalSection>

      <LegalSection heading="Payments">
        <p>
          When a booking pays through Taylslate, the brand saves a card with
          Stripe. The card is set up at signature and kept on file. Taylslate
          does not store the card number. Stripe does.
        </p>
        <p>
          The brand is charged for an episode when delivery of that episode is
          verified, not up front. The show is paid out through Stripe Connect
          after that charge succeeds. A show may request an early payout for a
          fee. Taylslate&apos;s fee sits on the brand side: the brand is charged
          the rate on the insertion order plus the platform fee, and the show
          is paid the rate on the order. See the pricing shown in your account
          [CONFIRM CURRENT PRICING].
        </p>
        <p>
          If an insertion order is marked to pay outside Taylslate, that order
          uses the payment wording written on it, and the card charge above
          does not apply.
        </p>
        <p>
          [CONFIRM WITH COUNSEL] Refunds, chargebacks, and what happens if a
          charge fails.
        </p>
      </LegalSection>

      <LegalSection heading="Acceptable use and take-down">
        <p>
          Do not use Taylslate for unlawful activity, and do not upload
          material you do not have the right to share. The insertion order
          Taylslate generates includes a morality and take-down clause between
          the advertiser and the publisher. [CONFIRM WITH COUNSEL]
          Taylslate&apos;s own process for suspending an account or removing
          material.
        </p>
      </LegalSection>

      <LegalSection heading="Deal terms live in the insertion order">
        <p>
          The advertising terms for a booking live in the insertion order the
          brand and the show sign. On the order Taylslate generates, the
          signature lines are Advertiser and Publisher. An on-platform order
          says the brand is charged the rate on the order plus the platform
          fee, and the show is paid the full rate on the order. The order can
          name an agency of record when one is set. [CONFIRM WITH COUNSEL]
          Whether Taylslate is a party to that advertising agreement.
        </p>
      </LegalSection>

      <LegalSection heading="Disclaimers">
        <p>
          [CONFIRM WITH COUNSEL] Whether Taylslate disclaims warranties, and
          whether discovery scores, download estimates, or recommendations are
          a promise of results. These terms do not promise a refund, an
          uptime level, or a particular advertising result.
        </p>
      </LegalSection>

      <LegalSection heading="Limitation of liability">
        <p>
          [CONFIRM WITH COUNSEL] Any cap on what Taylslate would owe, including
          whether indirect or consequential damages are excluded.
        </p>
      </LegalSection>

      <LegalSection heading="Termination">
        <p>
          [CONFIRM WITH COUNSEL] When Taylslate or a user may close an
          account, and what happens to open deals and unpaid charges.
        </p>
      </LegalSection>

      <LegalSection heading="Changes to these terms">
        <p>
          This page is not an agreed contract yet. [CONFIRM WITH COUNSEL] How
          Taylslate will tell users when these terms change, and when a change
          takes effect.
        </p>
      </LegalSection>

      <LegalSection heading="Contact">
        <p>
          [COMPANY LEGAL NAME]
          <br />
          [ENTITY TYPE AND STATE OF FORMATION]
          <br />
          [MAILING ADDRESS]
          <br />
          Legal contact: [LEGAL CONTACT EMAIL]
          <br />
          Governing law: [GOVERNING LAW STATE]
          <br />
          Venue: [VENUE]
          <br />
          Effective date: [EFFECTIVE DATE]
        </p>
        <p>
          The privacy policy is at{" "}
          <LegalBodyLink href="/privacy">Privacy Policy</LegalBodyLink>.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
