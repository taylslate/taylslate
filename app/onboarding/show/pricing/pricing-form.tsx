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
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-[var(--brand-text-muted)]">$</span>
        <input
          type="number"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          min={0}
          step={0.01}
          autoFocus
          placeholder="28.50"
          className="w-full pl-8 pr-20 py-3 rounded-xl border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text)] text-base focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30 focus:border-[var(--brand-blue)] transition-all"
        />
        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-[var(--brand-text-muted)]">
          CPM
        </span>
      </div>
      <p className="text-xs text-[var(--brand-text-muted)] mt-2">
        CPM = cost per thousand impressions. It&apos;s the industry standard for podcast ad pricing.
      </p>

      {hasInput && (
        <div className="mt-6 rounded-2xl border border-[var(--brand-blue)]/20 bg-[var(--brand-blue)]/[0.03] p-5 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-[var(--brand-blue)]/10 text-[var(--brand-blue)] flex items-center justify-center flex-shrink-0 mt-0.5">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <div className="flex-1">
              <div className="text-sm font-semibold text-[var(--brand-text)] mb-1">
                Here&apos;s what the market looks like.
              </div>
              <p className="text-sm text-[var(--brand-text-secondary)]">
                Shows with <strong className="text-[var(--brand-text)]">{bench.tierLabel}</strong> downloads
                typically earn <strong className="text-[var(--brand-text)]">${bench.cpmMin}–${bench.cpmMax} CPM</strong>.
              </p>
            </div>
          </div>

          <div className="rounded-xl bg-[var(--brand-surface-elevated)] border border-[var(--brand-border)] p-4">
            <div className="text-xs uppercase tracking-wider text-[var(--brand-text-muted)] font-medium mb-2">
              How it works
            </div>
            <div className="font-mono text-xs text-[var(--brand-text-secondary)] mb-3">
              Ad Spot Price = (Downloads ÷ 1,000) × CPM Rate
            </div>
            <div className="text-sm text-[var(--brand-text)] leading-relaxed">
              At <strong>{audienceSize.toLocaleString()}</strong> downloads and a{" "}
              <strong>${bench.realisticCpm} CPM</strong>, each ad spot earns you{" "}
              <strong className="text-[var(--brand-blue)]">
                ${realisticSpot.toLocaleString()}
              </strong>
              .
            </div>
          </div>

          <div className="rounded-xl border border-[var(--brand-border)] p-4">
            <div className="text-xs uppercase tracking-wider text-[var(--brand-text-muted)] font-medium mb-2">
              Your number
            </div>
            <div className="text-sm text-[var(--brand-text)] leading-relaxed">
              At <strong>${parsed.toFixed(parsed % 1 === 0 ? 0 : 2)} CPM</strong>, each ad spot earns you{" "}
              <strong className="text-[var(--brand-text)]">
                ${userSpot?.toLocaleString()}
              </strong>
              .
            </div>
            {verdict === "above_market" && (
              <p className="text-xs text-[var(--brand-warning)] mt-2">
                That&apos;s above the typical range for this tier. You can still set your own rate —
                but advertisers may push back, and deals might take longer to close.
              </p>
            )}
            {verdict === "below_market" && (
              <p className="text-xs text-[var(--brand-text-muted)] mt-2">
                That&apos;s below the typical range. You could likely charge more without losing advertisers.
              </p>
            )}
            {verdict === "in_range" && (
              <p className="text-xs text-[var(--brand-success)] mt-2">
                Right in the market range for your tier.
              </p>
            )}
          </div>
        </div>
      )}
    </OnboardingShell>
  );
}
