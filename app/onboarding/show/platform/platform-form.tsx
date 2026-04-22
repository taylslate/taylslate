"use client";

import { useState } from "react";
import OnboardingShell from "../onboarding-shell";
import type { ShowProfilePlatform } from "@/lib/data/types";

const OPTIONS: { value: ShowProfilePlatform; title: string; sub: string; emoji: string }[] = [
  { value: "podcast", title: "Podcast", sub: "Audio show on Apple, Spotify, etc.", emoji: "🎙️" },
  { value: "youtube", title: "YouTube", sub: "Video show on YouTube", emoji: "▶️" },
  { value: "both", title: "Both", sub: "Podcast + YouTube version", emoji: "🎬" },
];

export default function PlatformForm({ initialValue }: { initialValue: ShowProfilePlatform | null }) {
  const [value, setValue] = useState<ShowProfilePlatform | null>(initialValue);

  return (
    <OnboardingShell
      slug="platform"
      title="Where does your show live?"
      subtitle="We'll match you with advertisers who buy on your platform."
      onContinue={async () => (value ? { platform: value } : false)}
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
