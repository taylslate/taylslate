"use client";

import { useState } from "react";
import OnboardingShell from "../onboarding-shell";
import type { ShowEpisodeCadence } from "@/lib/data/types";

const OPTIONS: { value: ShowEpisodeCadence; title: string; sub: string }[] = [
  { value: "daily", title: "Daily", sub: "5+ episodes a week" },
  { value: "multiple_weekly", title: "A few times a week", sub: "2–4 episodes a week" },
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
              className={`flex w-full items-start gap-3.5 rounded-[var(--ts-radius)] border bg-[var(--ts-paper)] p-4 text-left transition-all ${
                selected
                  ? "border-[var(--ts-ink-on-paper)] ring-2 ring-inset ring-[var(--ts-ink-on-paper)]"
                  : "border-[var(--ts-hairline-on-paper)] hover:border-[var(--ts-ink-on-paper)]"
              }`}
            >
              <div>
                <div className="font-semibold text-[var(--ts-ink-on-paper)]">{opt.title}</div>
                <div className="mt-0.5 text-xs text-[var(--ts-ink-muted-on-paper)]">{opt.sub}</div>
              </div>
            </button>
          );
        })}
      </div>
    </OnboardingShell>
  );
}
