"use client";

import { useState } from "react";
import OnboardingShell from "../onboarding-shell";

export default function IdentityForm({ initialValue }: { initialValue: string }) {
  const [value, setValue] = useState(initialValue);

  return (
    <OnboardingShell
      slug="identity"
      title="What's your brand and what do you sell?"
      subtitle="A sentence or two is plenty. The more specific, the better the match."
      onContinue={async () => ({ brand_identity: value.trim() })}
      continueDisabled={value.trim().length < 10}
    >
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={5}
        autoFocus
        placeholder="e.g. SaunaBox makes portable infrared saunas for home use, priced $400-800"
        className="w-full px-4 py-3 rounded-xl border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text)] text-sm placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30 focus:border-[var(--brand-blue)] transition-all resize-none"
      />
      <p className="text-xs text-[var(--brand-text-muted)] mt-2">
        {value.trim().length < 10 ? "Write at least a sentence to continue." : `${value.trim().length} characters`}
      </p>
    </OnboardingShell>
  );
}
