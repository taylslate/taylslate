"use client";

import { useState } from "react";
import OnboardingShell from "../onboarding-shell";

export default function IdentityForm({
  initialValue,
  initialBrandName,
}: {
  initialValue: string;
  initialBrandName: string;
}) {
  const [value, setValue] = useState(initialValue);
  const [brandName, setBrandName] = useState(initialBrandName);

  return (
    <OnboardingShell
      slug="identity"
      title="What's your brand and what do you sell?"
      subtitle="A sentence or two is plenty. The more specific, the better the match."
      onContinue={async () => {
        // Omit blank brand_name so PUT doesn't 400 (name is optional here;
        // Settings → Brand profile requires it on later edits).
        const name = brandName.trim();
        return {
          ...(name ? { brand_name: name } : {}),
          brand_identity: value.trim(),
        };
      }}
      // Only the description is required; the brand name is optional (the
      // outreach pipeline falls back gracefully when it's blank).
      continueDisabled={value.trim().length < 10}
    >
      <label className="mb-1.5 block text-xs font-medium text-[var(--ts-ink-muted-on-paper)]">
        Brand name{" "}
        <span className="font-normal text-[var(--ts-ink-muted-on-paper)]">(optional)</span>
      </label>
      <input
        type="text"
        value={brandName}
        onChange={(e) => setBrandName(e.target.value)}
        maxLength={80}
        placeholder="e.g. Aurora Sleep"
        className="mb-4 w-full rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-4 py-3 text-sm text-[var(--ts-ink-on-paper)] placeholder:text-[var(--ts-ink-muted-on-paper)] focus:outline-none"
      />

      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={5}
        autoFocus
        placeholder="Start typing..."
        className="w-full resize-none rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-4 py-3 text-sm text-[var(--ts-ink-on-paper)] placeholder:text-[var(--ts-ink-muted-on-paper)] focus:outline-none"
      />
      <p className="mt-2 text-xs text-[var(--ts-ink-muted-on-paper)]">
        What do you sell and who&apos;s it for? Include your product type, price range, and what makes it different.
      </p>
    </OnboardingShell>
  );
}
