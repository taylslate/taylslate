"use client";

import { useState } from "react";
import OnboardingShell from "../onboarding-shell";
import type { BrandTargetGender } from "@/lib/data/types";

const OPTIONS: { value: BrandTargetGender; label: string; sub: string }[] = [
  { value: "mostly_men", label: "Mostly men", sub: "60%+ male audience" },
  { value: "mostly_women", label: "Mostly women", sub: "60%+ female audience" },
  { value: "mixed", label: "Mixed", sub: "Roughly balanced" },
  { value: "no_preference", label: "No preference", sub: "We'll pick the best fit regardless" },
];

export default function GenderForm({ initialValue }: { initialValue: BrandTargetGender | null }) {
  const [value, setValue] = useState<BrandTargetGender | null>(initialValue);

  return (
    <OnboardingShell
      slug="gender"
      title="Who's your primary audience?"
      subtitle="This weights the audience-fit score in our recommendations."
      onContinue={async () => (value ? { target_gender: value } : false)}
      continueDisabled={!value}
    >
      <div className="grid grid-cols-2 gap-3">
        {OPTIONS.map((opt) => {
          const selected = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setValue(opt.value)}
              className={`rounded-[var(--ts-radius)] border bg-[var(--ts-paper)] p-4 text-left transition-all ${
                selected
                  ? "border-[var(--ts-ink-on-paper)] ring-2 ring-inset ring-[var(--ts-ink-on-paper)]"
                  : "border-[var(--ts-hairline-on-paper)] hover:border-[var(--ts-ink-on-paper)]"
              }`}
            >
              <div className="font-semibold text-[var(--ts-ink-on-paper)]">{opt.label}</div>
              <div className="mt-0.5 text-xs text-[var(--ts-ink-muted-on-paper)]">{opt.sub}</div>
            </button>
          );
        })}
      </div>
    </OnboardingShell>
  );
}
