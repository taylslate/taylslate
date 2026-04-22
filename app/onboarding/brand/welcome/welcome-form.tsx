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

export default function WelcomeForm({ initialValue }: { initialValue: string }) {
  const [value, setValue] = useState(initialValue);
  const valid = looksLikeUrl(value);

  return (
    <OnboardingShell
      slug="welcome"
      title="Let's set up your brand."
      subtitle="Takes 2-3 minutes. This helps us find shows that actually match — not just shows with the biggest audiences."
      continueLabel="Get started"
      hideBack
      onContinue={async () => ({ brand_website: normalize(value) })}
      continueDisabled={!valid}
    >
      <div className="rounded-2xl border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] p-6 space-y-4 mb-6">
        <Bullet
          num={1}
          title="Drop in your website"
          body="We'll use it to understand your product and audience."
        />
        <Bullet
          num={2}
          title="Tell us what you sell"
          body="A sentence about your product and who it's for."
        />
        <Bullet
          num={3}
          title="Describe your customer"
          body="Age, interests, and a sentence or two about them."
        />
        <Bullet
          num={4}
          title="Pick content categories"
          body="What shows would your ideal customer already be listening to?"
        />
      </div>

      <label className="block text-sm font-medium text-[var(--brand-text)] mb-2">
        Your website
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoFocus
        placeholder="yourbrand.com"
        className="w-full px-4 py-3 rounded-xl border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text)] text-sm placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30 focus:border-[var(--brand-blue)] transition-all"
      />
      <p className="text-xs text-[var(--brand-text-muted)] mt-2">
        Leave blank if you don&apos;t have one yet.
      </p>
      {!valid && (
        <p className="text-xs text-[var(--brand-warning)] mt-2">
          That doesn&apos;t look like a valid URL.
        </p>
      )}
    </OnboardingShell>
  );
}

function Bullet({ num, title, body }: { num: number; title: string; body: string }) {
  return (
    <div className="flex gap-4">
      <div className="w-7 h-7 rounded-full bg-[var(--brand-blue)]/10 text-[var(--brand-blue)] flex items-center justify-center text-xs font-bold flex-shrink-0">
        {num}
      </div>
      <div>
        <div className="font-semibold text-[var(--brand-text)]">{title}</div>
        <div className="text-sm text-[var(--brand-text-secondary)]">{body}</div>
      </div>
    </div>
  );
}
