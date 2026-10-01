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
      <div className="mb-6 space-y-4 rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] p-6">
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

      <label className="mb-2 block text-sm font-medium text-[var(--ts-ink-on-paper)]">
        Your website
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoFocus
        placeholder="yourbrand.com"
        className="w-full rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-4 py-3 text-sm text-[var(--ts-ink-on-paper)] placeholder:text-[var(--ts-ink-muted-on-paper)] focus:outline-none"
      />
      <p className="mt-2 text-xs text-[var(--ts-ink-muted-on-paper)]">
        Leave blank if you don&apos;t have one yet.
      </p>
      {!valid && (
        <p className="mt-2 text-xs text-[var(--ts-accent)]">
          That doesn&apos;t look like a valid URL.
        </p>
      )}
    </OnboardingShell>
  );
}

function Bullet({ num, title, body }: { num: number; title: string; body: string }) {
  return (
    <div className="flex gap-4">
      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] text-xs font-bold text-[var(--ts-ink-on-paper)]">
        {num}
      </div>
      <div>
        <div className="font-semibold text-[var(--ts-ink-on-paper)]">{title}</div>
        <div className="text-sm text-[var(--ts-ink-muted-on-paper)]">{body}</div>
      </div>
    </div>
  );
}
