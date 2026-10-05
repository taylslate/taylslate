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
          className="w-full rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] py-3 pr-32 pl-4 text-base text-[var(--ts-ink-on-paper)] focus:outline-none"
        />
        <span className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-xs whitespace-nowrap text-[var(--ts-ink-muted-on-paper)]">
          downloads / ep
        </span>
      </div>
      <p className="mt-2 text-xs text-[var(--ts-ink-muted-on-paper)]">
        Check your hosting platform dashboard if you&apos;re not sure (Megaphone, Libsyn, Transistor, etc.).
      </p>
      {podscanEstimate != null && (
        <div className="mt-4 rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-4 py-3 text-xs text-[var(--ts-ink-muted-on-paper)]">
          Podscan estimate: <strong className="text-[var(--ts-ink-on-paper)]">{podscanEstimate.toLocaleString()}</strong> downloads/ep.
          Use your own number if you have it — it&apos;s more accurate.
        </div>
      )}
    </OnboardingShell>
  );
}
