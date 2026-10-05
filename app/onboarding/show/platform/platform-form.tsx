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
              className={`flex w-full items-start gap-3.5 rounded-[var(--ts-radius)] border bg-[var(--ts-paper)] p-4 text-left transition-all ${
                selected
                  ? "border-[var(--ts-ink-on-paper)] ring-2 ring-inset ring-[var(--ts-ink-on-paper)]"
                  : "border-[var(--ts-hairline-on-paper)] hover:border-[var(--ts-ink-on-paper)]"
              }`}
            >
              <div className="text-2xl">{opt.emoji}</div>
              <div>
                <div className="font-semibold text-[var(--ts-ink-on-paper)]">{opt.title}</div>
                <div className="mt-0.5 text-xs text-[var(--ts-ink-muted-on-paper)]">{opt.sub}</div>
              </div>
            </button>
          );
        })}
      </div>
    </OnboardingShell>
  );
}
