"use client";

import { useState } from "react";
import OnboardingShell from "../onboarding-shell";

const CATEGORIES = [
  { id: "Health & Wellness", label: "Health & wellness", emoji: "🩺" },
  { id: "Fitness", label: "Fitness", emoji: "🏋️" },
  { id: "Business & Finance", label: "Business & finance", emoji: "💼" },
  { id: "Technology", label: "Technology", emoji: "💻" },
  { id: "Comedy", label: "Comedy", emoji: "😂" },
  { id: "True Crime", label: "True crime", emoji: "🔎" },
  { id: "Self-Improvement", label: "Lifestyle & self-improvement", emoji: "✨" },
  { id: "Parenting & Family", label: "Parenting & family", emoji: "👨‍👩‍👧" },
  { id: "Education", label: "Education", emoji: "📚" },
  { id: "News", label: "News", emoji: "📰" },
  { id: "Sports", label: "Sports", emoji: "🏈" },
  { id: "Entertainment", label: "Entertainment", emoji: "🎬" },
] as const;

const MIN_PICK = 1;
const MAX_PICK = 5;

export default function CategoriesForm({ initialValue }: { initialValue: string[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set(initialValue));

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_PICK) next.add(id);
      return next;
    });
  };

  const count = selected.size;
  const valid = count >= MIN_PICK && count <= MAX_PICK;

  return (
    <OnboardingShell
      slug="categories"
      title="What kind of shows would be a great fit?"
      subtitle={`Pick ${MIN_PICK}–${MAX_PICK} categories where your ideal customer already listens.`}
      onContinue={async () => ({ content_categories: Array.from(selected) })}
      continueDisabled={!valid}
    >
      <div className="grid grid-cols-3 gap-2.5">
        {CATEGORIES.map((cat) => {
          const isSelected = selected.has(cat.id);
          const disabled = !isSelected && count >= MAX_PICK;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => toggle(cat.id)}
              disabled={disabled}
              className={`rounded-[var(--ts-radius)] border bg-[var(--ts-paper)] p-3.5 text-left transition-all ${
                isSelected
                  ? "border-[var(--ts-ink-on-paper)] ring-2 ring-inset ring-[var(--ts-ink-on-paper)]"
                  : disabled
                    ? "cursor-not-allowed border-[var(--ts-hairline-on-paper)] opacity-40"
                    : "border-[var(--ts-hairline-on-paper)] hover:border-[var(--ts-ink-on-paper)]"
              }`}
            >
              <div className="mb-1 text-xl">{cat.emoji}</div>
              <div className="text-xs font-semibold leading-tight text-[var(--ts-ink-on-paper)]">{cat.label}</div>
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
