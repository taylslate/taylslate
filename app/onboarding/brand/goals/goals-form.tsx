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
              className={`rounded-[var(--ts-radius)] border bg-[var(--ts-paper)] p-3.5 text-left transition-all ${
                isSelected
                  ? "border-[var(--ts-ink-on-paper)] ring-2 ring-inset ring-[var(--ts-ink-on-paper)]"
                  : disabled
                    ? "cursor-not-allowed border-[var(--ts-hairline-on-paper)] opacity-40"
                    : "border-[var(--ts-hairline-on-paper)] hover:border-[var(--ts-ink-on-paper)]"
              }`}
            >
              <div className="mb-1 text-xl">{opt.emoji}</div>
              <div className="text-sm font-semibold leading-tight text-[var(--ts-ink-on-paper)]">{opt.title}</div>
              <div className="mt-1 text-xs leading-snug text-[var(--ts-ink-muted-on-paper)]">{opt.sub}</div>
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-[var(--ts-ink-muted-on-paper)]">
        {count} of {MAX_PICK} selected
      </p>
    </OnboardingShell>
  );
}
