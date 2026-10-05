"use client";

import { useState } from "react";
import OnboardingShell from "../onboarding-shell";

interface Props {
  initialAdCopyEmail: string;
  initialBillingEmail: string;
  signingEmail: string;
}

function isValidEmailOrEmpty(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  // Loose check — server-side validation lives in the show-profile sanitizer.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

export default function ContactsForm({
  initialAdCopyEmail,
  initialBillingEmail,
  signingEmail,
}: Props) {
  const [adCopyEmail, setAdCopyEmail] = useState<string>(initialAdCopyEmail);
  const [billingEmail, setBillingEmail] = useState<string>(initialBillingEmail);

  const valid = isValidEmailOrEmpty(adCopyEmail) && isValidEmailOrEmpty(billingEmail);

  return (
    <OnboardingShell
      slug="contacts"
      title="Where should specific emails go?"
      subtitle="Both optional — leave blank to use your signing email for everything."
      continueDisabled={!valid}
      onContinue={async () =>
        valid
          ? {
              ad_copy_email: adCopyEmail.trim() || null,
              billing_email: billingEmail.trim() || null,
            }
          : false
      }
    >
      <div className="space-y-6">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-[var(--ts-ink-on-paper)]">
            Ad copy & talking points
          </label>
          <p className="mb-2 text-xs text-[var(--ts-ink-muted-on-paper)]">
            Where we send brand briefs, scripts, and pixel instructions.
          </p>
          <input
            type="email"
            value={adCopyEmail}
            onChange={(e) => setAdCopyEmail(e.target.value)}
            placeholder={signingEmail || "ads@yourshow.com"}
            className="w-full rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-4 py-3 text-base text-[var(--ts-ink-on-paper)] focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-[var(--ts-ink-on-paper)]">
            Invoices & payment notifications
          </label>
          <p className="mb-2 text-xs text-[var(--ts-ink-muted-on-paper)]">
            Where we send IO confirmations, invoices, and payout updates.
          </p>
          <input
            type="email"
            value={billingEmail}
            onChange={(e) => setBillingEmail(e.target.value)}
            placeholder={signingEmail || "billing@yourshow.com"}
            className="w-full rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-4 py-3 text-base text-[var(--ts-ink-on-paper)] focus:outline-none"
          />
        </div>

        {!valid && (
          <p className="text-xs text-[var(--ts-accent)]">
            Please use a valid email format, or clear the field to use your signing email.
          </p>
        )}

        <div className="border-t border-[var(--ts-hairline-on-paper)] pt-4 text-xs text-[var(--ts-ink-muted-on-paper)]">
          You can always change these later in settings.
        </div>
      </div>
    </OnboardingShell>
  );
}
