"use client";

import { useState } from "react";
import OnboardingShell from "../onboarding-shell";
import { MultiCardGrid } from "../multi-card-grid";
import type { ShowPlacement } from "@/lib/data/types";

const OPTIONS = [
  { value: "pre_roll" as const, title: "Pre-roll", sub: "At the start of the episode (+10% premium)", emoji: "⏮️" },
  { value: "mid_roll" as const, title: "Mid-roll", sub: "In the middle — highest engagement", emoji: "⏯️" },
  { value: "post_roll" as const, title: "Post-roll", sub: "At the end (-25% discount)", emoji: "⏭️" },
];

export default function PlacementsForm({ initialValue }: { initialValue: ShowPlacement[] }) {
  const [selected, setSelected] = useState<Set<ShowPlacement>>(new Set(initialValue));

  const toggle = (v: ShowPlacement) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
  };

  return (
    <OnboardingShell
      slug="placements"
      title="Which placements do you offer?"
      subtitle="Pick every slot you're willing to sell."
      onContinue={async () =>
        selected.size > 0 ? { placements: Array.from(selected) } : false
      }
      continueDisabled={selected.size === 0}
    >
      <MultiCardGrid options={OPTIONS} selected={selected} onToggle={toggle} columns={1} />
      <p className="text-xs text-[var(--brand-text-muted)] mt-3">
        Mid-roll commands the highest rates because listeners are most engaged.
      </p>
    </OnboardingShell>
  );
}
