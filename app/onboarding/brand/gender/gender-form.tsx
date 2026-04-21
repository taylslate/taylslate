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
              className={`p-4 rounded-xl border text-left transition-all ${
                selected
                  ? "border-[var(--brand-blue)] bg-[var(--brand-blue)]/[0.04] ring-2 ring-[var(--brand-blue)]/20"
                  : "border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] hover:border-[var(--brand-blue)]/30"
              }`}
            >
              <div className="font-semibold text-[var(--brand-text)]">{opt.label}</div>
              <div className="text-xs text-[var(--brand-text-muted)] mt-0.5">{opt.sub}</div>
            </button>
          );
        })}
      </div>
    </OnboardingShell>
  );
}
