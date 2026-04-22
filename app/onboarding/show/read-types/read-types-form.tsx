"use client";

import { useState } from "react";
import OnboardingShell from "../onboarding-shell";
import { MultiCardGrid } from "../multi-card-grid";
import type { ShowAdReadType } from "@/lib/data/types";

const OPTIONS = [
  { value: "personal_experience" as const, title: "Personal experience", sub: "Host shares their own usage of the product", emoji: "🙋" },
  { value: "scripted" as const, title: "Scripted", sub: "Host reads word-for-word from a script", emoji: "📜" },
  { value: "talking_points" as const, title: "Talking points", sub: "3-5 bullets the host ad-libs from", emoji: "🗒️" },
  { value: "any" as const, title: "Any of the above", sub: "Flexible on reads — whatever the brand wants", emoji: "✨" },
];

export default function ReadTypesForm({ initialValue }: { initialValue: ShowAdReadType[] }) {
  const [selected, setSelected] = useState<Set<ShowAdReadType>>(new Set(initialValue));

  const toggle = (v: ShowAdReadType) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
  };

  return (
    <OnboardingShell
      slug="read-types"
      title="What types of ad reads will you do?"
      subtitle="Pick everything you're comfortable with."
      onContinue={async () =>
        selected.size > 0 ? { ad_read_types: Array.from(selected) } : false
      }
      continueDisabled={selected.size === 0}
    >
      <MultiCardGrid options={OPTIONS} selected={selected} onToggle={toggle} columns={2} mutuallyExclusive="any" />
      <p className="text-xs text-[var(--brand-text-muted)] mt-3">
        Most brands prefer talking points — 3-5 bullet points the host ad-libs from. Personal experience
        commands the highest trust.
      </p>
    </OnboardingShell>
  );
}
