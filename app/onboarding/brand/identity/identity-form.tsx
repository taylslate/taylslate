"use client";

import { useState } from "react";
import OnboardingShell from "../onboarding-shell";

export default function IdentityForm({
  initialValue,
  initialBrandName,
}: {
  initialValue: string;
  initialBrandName: string;
}) {
  const [value, setValue] = useState(initialValue);
  const [brandName, setBrandName] = useState(initialBrandName);

  return (
    <OnboardingShell
      slug="identity"
      title="What's your brand and what do you sell?"
      subtitle="A sentence or two is plenty. The more specific, the better the match."
      onContinue={async () => ({
        brand_name: brandName.trim(),
        brand_identity: value.trim(),
      })}
      // Only the description is required; the brand name is optional (the
      // outreach pipeline falls back gracefully when it's blank).
      continueDisabled={value.trim().length < 10}
    >
      <label className="block text-xs font-medium text-[var(--brand-text-secondary)] mb-1.5">
        Brand name{" "}
        <span className="font-normal text-[var(--brand-text-muted)]">(optional)</span>
      </label>
      <input
        type="text"
        value={brandName}
        onChange={(e) => setBrandName(e.target.value)}
        maxLength={80}
        placeholder="e.g. Aurora Sleep"
        className="w-full px-4 py-3 mb-4 rounded-xl border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text)] text-sm placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30 focus:border-[var(--brand-blue)] transition-all"
      />

      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={5}
        autoFocus
        placeholder="Start typing..."
        className="w-full px-4 py-3 rounded-xl border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text)] text-sm placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30 focus:border-[var(--brand-blue)] transition-all resize-none"
      />
      <p className="text-xs text-[var(--brand-text-muted)] mt-2">
        What do you sell and who&apos;s it for? Include your product type, price range, and what makes it different.
      </p>
    </OnboardingShell>
  );
}
