"use client";

import { useState } from "react";
import OnboardingShell from "../onboarding-shell";

function looksLikeUrl(v: string): boolean {
  const trimmed = v.trim();
  if (trimmed.length === 0) return true; // website is optional
  try {
    const url = trimmed.startsWith("http") ? trimmed : `https://${trimmed}`;
    new URL(url);
    return /\.[a-z]{2,}/i.test(url);
  } catch {
    return false;
  }
}

function normalize(v: string): string {
  const t = v.trim();
  if (!t) return "";
  return t.startsWith("http") ? t : `https://${t}`;
}

export default function WebsiteForm({ initialValue }: { initialValue: string }) {
  const [value, setValue] = useState(initialValue);
  const valid = looksLikeUrl(value);

  return (
    <OnboardingShell
      slug="website"
      title="What's your website?"
      subtitle="We'll analyze your site to understand your product and audience. You can leave this blank if you don't have one yet."
      onContinue={async () => ({ brand_website: normalize(value) })}
      continueDisabled={!valid}
    >
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoFocus
        placeholder="yourbrand.com"
        className="w-full px-4 py-3 rounded-xl border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text)] text-sm placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30 focus:border-[var(--brand-blue)] transition-all"
      />
      {!valid && (
        <p className="text-xs text-[var(--brand-warning)] mt-2">
          That doesn&apos;t look like a valid URL.
        </p>
      )}
    </OnboardingShell>
  );
}
