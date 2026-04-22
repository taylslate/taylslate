"use client";

import { useState } from "react";
import OnboardingShell from "../onboarding-shell";

export default function ExclusionsForm({ initialValue }: { initialValue: string }) {
  const [value, setValue] = useState(initialValue);

  return (
    <OnboardingShell
      slug="exclusions"
      title="Anything you want to avoid?"
      subtitle="Topics, competitors, content types. Optional — leave blank if nothing comes to mind."
      onContinue={async () => ({ exclusions: value.trim() })}
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
        List any topics, competitors, or content types you want to avoid. Leave blank if you&apos;re open to everything.
      </p>
    </OnboardingShell>
  );
}
