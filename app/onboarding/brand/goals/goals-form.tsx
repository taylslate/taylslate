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

const MIN_PICK = 1;
const MAX_PICK = 3;

export default function GoalsForm({ initialValue }: { initialValue: BrandCampaignGoal[] }) {
  const [selected, setSelected] = useState<Set<BrandCampaignGoal>>(new Set(initialValue));

  const toggle = (value: BrandCampaignGoal) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else if (next.size < MAX_PICK) next.add(value);
      return next;
    });
  };

  const count = selected.size;
  const valid = count >= MIN_PICK && count <= MAX_PICK;

  return (
    <OnboardingShell
      slug="goals"
      title="What are your goals for this?"
      subtitle={`Pick ${MIN_PICK}–${MAX_PICK}. We'll tune recommendations toward shows that deliver these outcomes.`}
      onContinue={async () => ({ campaign_goals: Array.from(selected) })}
      continueDisabled={!valid}
    >
      <div className="grid grid-cols-2 gap-2.5">
        {OPTIONS.map((opt) => {
          const isSelected = selected.has(opt.value);
          const disabled = !isSelected && count >= MAX_PICK;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => toggle(opt.value)}
              disabled={disabled}
              className={`p-3.5 rounded-xl border text-left transition-all ${
                isSelected
                  ? "border-[var(--brand-blue)] bg-[var(--brand-blue)]/[0.04] ring-2 ring-[var(--brand-blue)]/20"
                  : disabled
                    ? "border-[var(--brand-border)] bg-[var(--brand-surface)] opacity-40 cursor-not-allowed"
                    : "border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] hover:border-[var(--brand-blue)]/30"
              }`}
            >
              <div className="text-xl mb-1">{opt.emoji}</div>
              <div className="text-sm font-semibold text-[var(--brand-text)] leading-tight">{opt.title}</div>
              <div className="text-xs text-[var(--brand-text-muted)] mt-1 leading-snug">{opt.sub}</div>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-[var(--brand-text-muted)] mt-3">
        {count} of {MAX_PICK} selected
      </p>
    </OnboardingShell>
  );
}
