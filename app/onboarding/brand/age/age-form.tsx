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
      <div className="rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] p-8">
        <div className="mb-8 flex items-center justify-center gap-10">
          <div className="text-center">
            <div className="text-xs font-medium uppercase tracking-wider text-[var(--ts-ink-muted-on-paper)]">From</div>
            <div className="mt-1 text-4xl font-bold text-[var(--ts-ink-on-paper)] tabular-nums">{min}</div>
          </div>
          <div className="text-3xl text-[var(--ts-ink-muted-on-paper)]">–</div>
          <div className="text-center">
            <div className="text-xs font-medium uppercase tracking-wider text-[var(--ts-ink-muted-on-paper)]">To</div>
            <div className="mt-1 text-4xl font-bold text-[var(--ts-ink-on-paper)] tabular-nums">{formatMax(max)}</div>
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

        <div className="mt-5 flex justify-between text-xs text-[var(--ts-ink-muted-on-paper)]">
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
        <label className="text-xs font-medium text-[var(--ts-ink-muted-on-paper)]">{label}</label>
        <span className="text-xs text-[var(--ts-ink-muted-on-paper)] tabular-nums">{displayValue}</span>
      </div>
      <input
        type="range"
        min={AGE_MIN}
        max={AGE_MAX}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--ts-ink-on-paper)]"
      />
    </div>
  );
}
