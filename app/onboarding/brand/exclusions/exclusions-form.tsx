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
        className="w-full resize-none rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-4 py-3 text-sm text-[var(--ts-ink-on-paper)] placeholder:text-[var(--ts-ink-muted-on-paper)] focus:outline-none"
      />
      <p className="mt-2 text-xs text-[var(--ts-ink-muted-on-paper)]">
        List any topics, competitors, or content types you want to avoid. Leave blank if you&apos;re open to everything.
      </p>
    </OnboardingShell>
  );
}
