"use client";

import { useState } from "react";
import OnboardingShell from "../onboarding-shell";
import type { ShowEpisodeCadence } from "@/lib/data/types";

const OPTIONS: { value: ShowEpisodeCadence; title: string; sub: string }[] = [
  { value: "daily", title: "Daily", sub: "5+ episodes a week" },
  { value: "weekly", title: "Weekly", sub: "One episode a week (most common)" },
  { value: "biweekly", title: "Biweekly", sub: "Every other week" },
  { value: "monthly", title: "Monthly", sub: "Once a month" },
  { value: "irregular", title: "Irregular", sub: "No fixed schedule" },
];

export default function CadenceForm({ initialValue }: { initialValue: ShowEpisodeCadence | null }) {
  const [value, setValue] = useState<ShowEpisodeCadence | null>(initialValue);

  return (
    <OnboardingShell
      slug="cadence"
      title="How often do you publish?"
      subtitle="Advertisers use this to plan flight lengths and exclusivity windows."
      onContinue={async () => (value ? { episode_cadence: value } : false)}
      continueDisabled={!value}
    >
      <div className="space-y-2.5">
        {OPTIONS.map((opt) => {
          const selected = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setValue(opt.value)}
              className={`w-full flex items-start gap-3.5 p-4 rounded-xl border text-left transition-all ${
                selected
                  ? "border-[var(--brand-blue)] bg-[var(--brand-blue)]/[0.04] ring-2 ring-[var(--brand-blue)]/20"
                  : "border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] hover:border-[var(--brand-blue)]/30"
              }`}
            >
              <div>
                <div className="font-semibold text-[var(--brand-text)]">{opt.title}</div>
                <div className="text-xs text-[var(--brand-text-muted)] mt-0.5">{opt.sub}</div>
              </div>
            </button>
          );
        })}
      </div>
    </OnboardingShell>
  );
}
