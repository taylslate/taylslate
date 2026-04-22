"use client";

import { useState } from "react";
import OnboardingShell from "../onboarding-shell";

export default function CustomerForm({ initialValue }: { initialValue: string }) {
  const [value, setValue] = useState(initialValue);

  return (
    <OnboardingShell
      slug="customer"
      title="Describe your ideal customer in a sentence or two."
      subtitle="Who do you picture when you imagine a perfect customer?"
      onContinue={async () => ({ target_customer: value.trim() })}
      continueDisabled={value.trim().length < 10}
    >
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={5}
        autoFocus
        placeholder="Start typing..."
        className="w-full px-4 py-3 rounded-xl border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text)] text-sm placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30 focus:border-[var(--brand-blue)] transition-all resize-none"
      />
      <p className="text-xs text-[var(--brand-text-muted)] mt-2">
        Think about who actually buys from you — their age, interests, lifestyle, and what problems they&apos;re solving.
      </p>
    </OnboardingShell>
  );
}
