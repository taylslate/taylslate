"use client";

import { useState } from "react";
import OnboardingShell from "../onboarding-shell";

const AGE_MIN = 18;
const AGE_MAX = 65;

function formatMax(v: number): string {
  return v >= AGE_MAX ? `${AGE_MAX}+` : String(v);
}

export default function AgeForm({
  initialMin,
  initialMax,
}: {
  initialMin: number;
  initialMax: number;
}) {
  const [min, setMin] = useState(Math.max(AGE_MIN, Math.min(AGE_MAX, initialMin)));
  const [max, setMax] = useState(Math.max(AGE_MIN, Math.min(AGE_MAX, initialMax)));

  const handleMinChange = (v: number) => setMin(Math.min(v, max - 1));
  const handleMaxChange = (v: number) => setMax(Math.max(v, min + 1));

  return (
    <OnboardingShell
      slug="age"
      title="What age range are you targeting?"
      subtitle="Set the bounds of your core audience. We'll find shows whose listeners skew into this range."
      onContinue={async () => ({
        target_age_min: min,
        target_age_max: max >= AGE_MAX ? 120 : max,
      })}
    >
      <div className="rounded-2xl border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] p-8">
        <div className="flex items-center justify-center gap-10 mb-8">
          <div className="text-center">
            <div className="text-xs uppercase tracking-wider text-[var(--brand-text-muted)] font-medium">From</div>
            <div className="text-4xl font-bold text-[var(--brand-text)] tabular-nums mt-1">{min}</div>
          </div>
          <div className="text-3xl text-[var(--brand-text-muted)]">–</div>
          <div className="text-center">
            <div className="text-xs uppercase tracking-wider text-[var(--brand-text-muted)] font-medium">To</div>
            <div className="text-4xl font-bold text-[var(--brand-text)] tabular-nums mt-1">{formatMax(max)}</div>
          </div>
        </div>

        <div className="space-y-5">
          <SliderRow
            label="Minimum age"
            value={min}
            onChange={handleMinChange}
            displayValue={String(min)}
          />
          <SliderRow
            label="Maximum age"
            value={max}
            onChange={handleMaxChange}
            displayValue={formatMax(max)}
          />
        </div>

        <div className="flex justify-between mt-5 text-xs text-[var(--brand-text-muted)]">
          <span>{AGE_MIN}</span>
          <span>30</span>
          <span>45</span>
          <span>{AGE_MAX}+</span>
        </div>
      </div>
    </OnboardingShell>
  );
}

function SliderRow({
  label,
  value,
  onChange,
  displayValue,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  displayValue: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-xs font-medium text-[var(--brand-text-secondary)]">{label}</label>
        <span className="text-xs tabular-nums text-[var(--brand-text-muted)]">{displayValue}</span>
      </div>
      <input
        type="range"
        min={AGE_MIN}
        max={AGE_MAX}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--brand-blue)]"
      />
    </div>
  );
}
