"use client";

import { useState } from "react";
import OnboardingShell from "../onboarding-shell";
import { MultiCardGrid } from "../multi-card-grid";
import type { ShowAdFormat } from "@/lib/data/types";

const OPTIONS = [
  { value: "host_read_baked" as const, title: "Host-read baked-in", sub: "Permanently part of the episode — premium CPMs", emoji: "🎤" },
  { value: "dynamic_insertion" as const, title: "Dynamic insertion", sub: "Pre-recorded and stitched in at playback", emoji: "🔀" },
];

export default function FormatsForm({ initialValue }: { initialValue: ShowAdFormat[] }) {
  const [selected, setSelected] = useState<Set<ShowAdFormat>>(new Set(initialValue));

  const toggle = (v: ShowAdFormat) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });
  };

  return (
    <OnboardingShell
      slug="formats"
      title="What ad formats do you offer?"
      subtitle="Pick at least one. You can always change this later."
      onContinue={async () =>
        selected.size > 0 ? { ad_formats: Array.from(selected) } : false
      }
      continueDisabled={selected.size === 0}
    >
      <MultiCardGrid options={OPTIONS} selected={selected} onToggle={toggle} columns={1} />
      <p className="text-xs text-[var(--brand-text-muted)] mt-3">
        Host-read baked-in ads are read by the host and permanently part of the episode. They command higher CPMs.
        Dynamic insertion ads are pre-recorded and stitched in at playback.
      </p>
    </OnboardingShell>
  );
}
