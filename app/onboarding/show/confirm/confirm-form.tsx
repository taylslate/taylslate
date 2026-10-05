"use client";

import Image from "next/image";
import { useState } from "react";
import OnboardingShell from "../onboarding-shell";
import type { ShowProfile } from "@/lib/data/types";

export default function ConfirmForm({ profile }: { profile: ShowProfile | null }) {
  const [name, setName] = useState(profile?.show_name ?? "");
  const [description, setDescription] = useState(profile?.show_description ?? "");
  const [categories, setCategories] = useState(
    (profile?.show_categories ?? []).join(", ")
  );
  const [episodeCount, setEpisodeCount] = useState<string>(
    profile?.episode_count != null ? String(profile.episode_count) : ""
  );

  const found = !!profile?.show_name;

  return (
    <OnboardingShell
      slug="confirm"
      title={found ? "Does this look right?" : "Tell us about your show"}
      subtitle={
        found
          ? "We pulled this from your feed. Correct anything that's off."
          : "We couldn't find your show automatically. Fill in the basics and we'll take it from here."
      }
      onContinue={async () => ({
        show_name: name.trim(),
        show_description: description.trim() || null,
        show_categories: categories
          .split(",")
          .map((c) => c.trim())
          .filter(Boolean),
        episode_count:
          episodeCount.trim() && !isNaN(Number(episodeCount))
            ? Math.max(0, Math.round(Number(episodeCount)))
            : null,
      })}
      continueDisabled={name.trim().length < 2}
    >
      {found && profile?.show_image_url && (
        <div className="mb-5 flex items-center gap-4">
          <Image
            src={profile.show_image_url}
            alt=""
            width={72}
            height={72}
            className="rounded-[var(--ts-radius)] object-cover"
            unoptimized
          />
          <div className="text-xs text-[var(--ts-ink-muted-on-paper)]">
            Cover art pulled from your feed.
          </div>
        </div>
      )}

      <Field label="Show name">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your show name"
          className="w-full rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-4 py-2.5 text-sm text-[var(--ts-ink-on-paper)] focus:outline-none"
        />
      </Field>

      <Field label="One-line description">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="What's your show about?"
          className="w-full resize-none rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-4 py-2.5 text-sm text-[var(--ts-ink-on-paper)] focus:outline-none"
        />
      </Field>

      <Field
        label="Categories"
        hint="Comma-separated (e.g. Business, Technology)"
      >
        <input
          type="text"
          value={categories}
          onChange={(e) => setCategories(e.target.value)}
          placeholder="Business, Technology"
          className="w-full rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-4 py-2.5 text-sm text-[var(--ts-ink-on-paper)] focus:outline-none"
        />
      </Field>

      <Field label="Episode count">
        <input
          type="number"
          value={episodeCount}
          onChange={(e) => setEpisodeCount(e.target.value)}
          min={0}
          step={1}
          placeholder="0"
          className="w-full rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-4 py-2.5 text-sm text-[var(--ts-ink-on-paper)] focus:outline-none"
        />
      </Field>

      {profile?.audience_size != null && (
        <div className="mt-3 rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-4 py-3">
          <div className="mb-1 text-xs uppercase tracking-wider text-[var(--ts-ink-muted-on-paper)]">
            Estimated audience size
          </div>
          <div className="text-sm text-[var(--ts-ink-on-paper)]">
            {profile.audience_size.toLocaleString()} avg. downloads per episode (Podscan estimate)
          </div>
          <div className="mt-1 text-xs text-[var(--ts-ink-muted-on-paper)]">
            You&apos;ll confirm this yourself in a couple of steps.
          </div>
        </div>
      )}
    </OnboardingShell>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      <label className="mb-1.5 block text-sm font-medium text-[var(--ts-ink-on-paper)]">{label}</label>
      {children}
      {hint && <p className="mt-1.5 text-xs text-[var(--ts-ink-muted-on-paper)]">{hint}</p>}
    </div>
  );
}
