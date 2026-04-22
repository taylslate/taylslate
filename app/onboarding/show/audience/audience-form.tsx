"use client";

import { useState } from "react";
import OnboardingShell from "../onboarding-shell";

export default function AudienceForm({
  initialValue,
  podscanEstimate,
}: {
  initialValue: number | null;
  podscanEstimate: number | null;
}) {
  const [value, setValue] = useState<string>(
    initialValue != null ? String(initialValue) : ""
  );

  const parsed = value.trim() ? Number(value) : NaN;
  const valid = Number.isFinite(parsed) && parsed >= 0;

  return (
    <OnboardingShell
      slug="audience"
      title="What are your average downloads per episode in the first 30 days?"
      subtitle="This is the number brands use to calculate ad pricing."
      onContinue={async () => (valid ? { audience_size: Math.round(parsed) } : false)}
      continueDisabled={!valid}
    >
      <div className="relative">
        <input
          type="number"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          min={0}
          step={100}
          autoFocus
          placeholder="e.g. 12000"
          className="w-full pl-4 pr-32 py-3 rounded-xl border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text)] text-base focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30 focus:border-[var(--brand-blue)] transition-all"
        />
        <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs text-[var(--brand-text-muted)] whitespace-nowrap">
          downloads / ep
        </span>
      </div>
      <p className="text-xs text-[var(--brand-text-muted)] mt-2">
        Check your hosting platform dashboard if you&apos;re not sure (Megaphone, Libsyn, Transistor, etc.).
      </p>
      {podscanEstimate != null && (
        <div className="mt-4 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface)] px-4 py-3 text-xs text-[var(--brand-text-secondary)]">
          Podscan estimate: <strong className="text-[var(--brand-text)]">{podscanEstimate.toLocaleString()}</strong> downloads/ep.
          Use your own number if you have it — it&apos;s more accurate.
        </div>
      )}
    </OnboardingShell>
  );
}
