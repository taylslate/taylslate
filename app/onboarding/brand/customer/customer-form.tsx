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
        className="w-full resize-none rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-4 py-3 text-sm text-[var(--ts-ink-on-paper)] placeholder:text-[var(--ts-ink-muted-on-paper)] focus:outline-none"
      />
      <p className="mt-2 text-xs text-[var(--ts-ink-muted-on-paper)]">
        Think about who actually buys from you — their age, interests, lifestyle, and what problems they&apos;re solving.
      </p>
    </OnboardingShell>
  );
}
