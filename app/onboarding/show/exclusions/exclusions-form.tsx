"use client";

import { useState } from "react";
import OnboardingShell from "../onboarding-shell";
import { MultiCardGrid } from "../multi-card-grid";
import type { ShowCategoryExclusion } from "@/lib/data/types";

const OPTIONS = [
  { value: "gambling" as const, title: "Gambling", emoji: "🎰" },
  { value: "alcohol" as const, title: "Alcohol", emoji: "🍷" },
  { value: "supplements" as const, title: "Supplements", emoji: "💊" },
  { value: "political" as const, title: "Political", emoji: "🗳️" },
  { value: "crypto" as const, title: "Crypto", emoji: "🪙" },
  { value: "adult" as const, title: "Adult content", emoji: "🔞" },
  { value: "none" as const, title: "None — I'm open to everything", sub: "No category exclusions", emoji: "✅" },
];

export default function ExclusionsForm({ initialValue }: { initialValue: ShowCategoryExclusion[] }) {
  const [selected, setSelected] = useState<Set<ShowCategoryExclusion>>(new Set(initialValue));

  const toggle = (v: ShowCategoryExclusion) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (v === "none") {
        // Selecting "none" clears everything else; deselecting clears it.
        if (next.has("none")) next.delete("none");
        else {
          next.clear();
          next.add("none");
        }
        return next;
      }
      next.delete("none");
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
  };

  return (
    <OnboardingShell
      slug="exclusions"
      title="Any categories you won't accept ads from?"
      subtitle="Pick anything you want to block. Or skip if you're open to everything."
      onContinue={async () => ({
        category_exclusions: selected.size > 0 ? Array.from(selected) : ["none"],
      })}
    >
      <MultiCardGrid
        options={OPTIONS}
        selected={selected}
        onToggle={toggle}
        columns={2}
        mutuallyExclusive="none"
      />
      <p className="text-xs text-[var(--brand-text-muted)] mt-3">
        We&apos;ll filter incoming deals so you don&apos;t have to say no.
      </p>
    </OnboardingShell>
  );
}
