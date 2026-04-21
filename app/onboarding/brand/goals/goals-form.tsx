"use client";

import { useState } from "react";
import OnboardingShell from "../onboarding-shell";
import type { BrandCampaignGoal } from "@/lib/data/types";

const OPTIONS: { value: BrandCampaignGoal; title: string; sub: string; emoji: string }[] = [
  { value: "direct_sales", title: "Drive direct sales", sub: "Promo codes, conversions, revenue", emoji: "💰" },
  { value: "brand_awareness", title: "Build brand awareness", sub: "Reach new audiences at scale", emoji: "📣" },
  { value: "new_product", title: "Launch a new product", sub: "Generate buzz around a release", emoji: "🚀" },
  { value: "test_podcast", title: "Test podcast advertising", sub: "Experiment to see if it works", emoji: "🧪" },
];

export default function GoalsForm({ initialValue }: { initialValue: BrandCampaignGoal | null }) {
  const [value, setValue] = useState<BrandCampaignGoal | null>(initialValue);

  return (
    <OnboardingShell
      slug="goals"
      title="What's your primary goal?"
      subtitle="We'll tune the recommendations toward shows that deliver this outcome."
      onContinue={async () => (value ? { campaign_goal: value } : false)}
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
              <div className="text-2xl">{opt.emoji}</div>
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
