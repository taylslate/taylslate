"use client";

import { useState } from "react";
import OnboardingShell from "../onboarding-shell";
import {
  getCpmBenchmark,
  spotPrice,
  classifyExpectedCpm,
} from "@/lib/utils/cpm-benchmark";

export default function PricingForm({
  audienceSize,
  initialValue,
}: {
  audienceSize: number;
  initialValue: number | null;
}) {
  const [value, setValue] = useState<string>(
    initialValue != null ? String(initialValue) : ""
  );

  const bench = getCpmBenchmark(audienceSize);
  const parsed = value.trim() ? Number(value) : NaN;
  const hasInput = Number.isFinite(parsed) && parsed > 0;
  const verdict = hasInput ? classifyExpectedCpm(audienceSize, parsed) : null;

  const realisticSpot = spotPrice(audienceSize, bench.realisticCpm);
  const userSpot = hasInput ? spotPrice(audienceSize, parsed) : null;

  return (
    <OnboardingShell
      slug="pricing"
      title="What CPM do you think is fair for your show?"
      subtitle="No wrong answer — we'll show you what the market looks like once you share your number."
      onContinue={async () =>
        hasInput ? { expected_cpm: Math.round(parsed * 100) / 100 } : false
      }
      continueDisabled={!hasInput}
    >
      <div className="relative">
        <span className="absolute top-1/2 left-4 -translate-y-1/2 text-sm text-[var(--ts-ink-muted-on-paper)]">$</span>
        <input
          type="number"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          min={0}
          step={0.01}
          autoFocus
          placeholder="28.50"
          className="w-full rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] py-3 pr-20 pl-8 text-base text-[var(--ts-ink-on-paper)] focus:outline-none"
        />
        <span className="absolute top-1/2 right-4 -translate-y-1/2 text-xs text-[var(--ts-ink-muted-on-paper)]">
          CPM
        </span>
      </div>
      <p className="mt-2 text-xs text-[var(--ts-ink-muted-on-paper)]">
        CPM = cost per thousand impressions. It&apos;s the industry standard for podcast ad pricing.
      </p>

      {hasInput && (
        <div className="mt-6 space-y-4 rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] p-5">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] text-[var(--ts-ink-on-paper)]">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <div className="flex-1">
              <div className="mb-1 text-sm font-semibold text-[var(--ts-ink-on-paper)]">
                Here&apos;s what the market looks like.
              </div>
              <p className="text-sm text-[var(--ts-ink-muted-on-paper)]">
                Shows with <strong className="text-[var(--ts-ink-on-paper)]">{bench.tierLabel}</strong> downloads
                typically earn <strong className="text-[var(--ts-ink-on-paper)]">${bench.cpmMin}–${bench.cpmMax} CPM</strong>.
              </p>
            </div>
          </div>

          <div className="rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] p-4">
            <div className="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--ts-ink-muted-on-paper)]">
              How it works
            </div>
            <div className="mb-3 font-mono text-xs text-[var(--ts-ink-muted-on-paper)]">
              Ad Spot Price = (Downloads ÷ 1,000) × CPM Rate
            </div>
            <div className="text-sm leading-relaxed text-[var(--ts-ink-on-paper)]">
              At <strong>{audienceSize.toLocaleString()}</strong> downloads and a{" "}
              <strong>${bench.realisticCpm} CPM</strong>, each ad spot earns you{" "}
              <strong>
                ${realisticSpot.toLocaleString()}
              </strong>
              .
            </div>
          </div>

          <div className="rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] p-4">
            <div className="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--ts-ink-muted-on-paper)]">
              Your number
            </div>
            <div className="text-sm leading-relaxed text-[var(--ts-ink-on-paper)]">
              At <strong>${parsed.toFixed(parsed % 1 === 0 ? 0 : 2)} CPM</strong>, each ad spot earns you{" "}
              <strong>
                ${userSpot?.toLocaleString()}
              </strong>
              .
            </div>
            {verdict === "above_market" && (
              <p className="mt-2 text-xs text-[var(--ts-accent)]">
                That&apos;s above the typical range for this tier. You can still set your own rate —
                but advertisers may push back, and deals might take longer to close.
              </p>
            )}
            {verdict === "below_market" && (
              <p className="mt-2 text-xs text-[var(--ts-ink-muted-on-paper)]">
                That&apos;s below the typical range. You could likely charge more without losing advertisers.
              </p>
            )}
            {verdict === "in_range" && (
              <p className="mt-2 text-xs text-[var(--ts-ink-on-paper)]">
                Right in the market range for your tier.
              </p>
            )}
          </div>
        </div>
      )}
    </OnboardingShell>
  );
}
