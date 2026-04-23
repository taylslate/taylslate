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
          <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">
            Ad copy & talking points
          </label>
          <p className="text-xs text-[var(--brand-text-muted)] mb-2">
            Where we send brand briefs, scripts, and pixel instructions.
          </p>
          <input
            type="email"
            value={adCopyEmail}
            onChange={(e) => setAdCopyEmail(e.target.value)}
            placeholder={signingEmail || "ads@yourshow.com"}
            className="w-full px-4 py-3 rounded-xl border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text)] text-base focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30 focus:border-[var(--brand-blue)] transition-all"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">
            Invoices & payment notifications
          </label>
          <p className="text-xs text-[var(--brand-text-muted)] mb-2">
            Where we send IO confirmations, invoices, and payout updates.
          </p>
          <input
            type="email"
            value={billingEmail}
            onChange={(e) => setBillingEmail(e.target.value)}
            placeholder={signingEmail || "billing@yourshow.com"}
            className="w-full px-4 py-3 rounded-xl border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text)] text-base focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30 focus:border-[var(--brand-blue)] transition-all"
          />
        </div>

        {!valid && (
          <p className="text-xs text-[var(--brand-warning)]">
            Please use a valid email format, or clear the field to use your signing email.
          </p>
        )}

        <div className="text-xs text-[var(--brand-text-muted)] border-t border-[var(--brand-border)] pt-4">
          You can always change these later in settings.
        </div>
      </div>
    </OnboardingShell>
  );
}
