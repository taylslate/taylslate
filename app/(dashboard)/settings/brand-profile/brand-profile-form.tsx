"use client";

import Link from "next/link";
import { useState } from "react";
import type {
  BrandCampaignGoal,
  BrandProfile,
  BrandTargetGender,
} from "@/lib/data/types";

const GENDER_OPTIONS: { value: BrandTargetGender; label: string }[] = [
  { value: "mostly_men", label: "Mostly men" },
  { value: "mostly_women", label: "Mostly women" },
  { value: "mixed", label: "Mixed" },
  { value: "no_preference", label: "No preference" },
];

const GOAL_OPTIONS: { value: BrandCampaignGoal; title: string; emoji: string }[] = [
  { value: "direct_sales", title: "Drive direct sales", emoji: "💰" },
  { value: "brand_awareness", title: "Build brand awareness", emoji: "📣" },
  { value: "new_product", title: "Launch a new product", emoji: "🚀" },
  { value: "test_podcast", title: "Test podcast advertising", emoji: "🧪" },
];

const CATEGORIES = [
  "Health & Wellness",
  "Fitness",
  "Business & Finance",
  "Technology",
  "Comedy",
  "True Crime",
  "Self-Improvement",
  "Parenting & Family",
  "Education",
  "News",
  "Sports",
  "Entertainment",
];

const AGE_MIN = 18;
const AGE_MAX = 65;
const MAX_CATEGORIES = 5;
const MAX_GOALS = 3;

function formatMax(v: number): string {
  return v >= AGE_MAX ? `${AGE_MAX}+` : String(v);
}

export default function BrandProfileForm({ profile }: { profile: BrandProfile | null }) {
  const [identity, setIdentity] = useState(profile?.brand_identity ?? "");
  const [website, setWebsite] = useState(profile?.brand_website ?? "");
  const [customer, setCustomer] = useState(profile?.target_customer ?? "");
  const [ageMin, setAgeMin] = useState(profile?.target_age_min ?? 30);
  const [ageMaxState, setAgeMaxState] = useState(() => {
    const raw = profile?.target_age_max ?? 45;
    return raw >= AGE_MAX ? AGE_MAX : raw;
  });
  const [gender, setGender] = useState<BrandTargetGender | null>(
    profile?.target_gender ?? null
  );
  const [categories, setCategories] = useState<Set<string>>(
    new Set(profile?.content_categories ?? [])
  );
  const [goals, setGoals] = useState<Set<BrandCampaignGoal>>(
    new Set(profile?.campaign_goals ?? [])
  );
  const [exclusions, setExclusions] = useState(profile?.exclusions ?? "");

  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleAgeMin = (v: number) => setAgeMin(Math.min(v, ageMaxState - 1));
  const handleAgeMax = (v: number) => setAgeMaxState(Math.max(v, ageMin + 1));

  const toggleCategory = (c: string) => {
    setCategories((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else if (next.size < MAX_CATEGORIES) next.add(c);
      return next;
    });
  };

  const toggleGoal = (g: BrandCampaignGoal) => {
    setGoals((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else if (next.size < MAX_GOALS) next.add(g);
      return next;
    });
  };

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/brand-profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brand_identity: identity,
          brand_website: website,
          target_customer: customer,
          target_age_min: ageMin,
          target_age_max: ageMaxState >= AGE_MAX ? 120 : ageMaxState,
          target_gender: gender ?? undefined,
          content_categories: Array.from(categories),
          campaign_goals: Array.from(goals),
          exclusions,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to save. Try again.");
        setSaving(false);
        return;
      }
      setSavedAt(new Date().toLocaleTimeString());
      setSaving(false);
    } catch {
      setError("Network error. Try again.");
      setSaving(false);
    }
  };

  return (
    <div className="p-8 max-w-2xl">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold text-[var(--brand-text)] tracking-tight">
          Brand profile
        </h1>
        <Link
          href="/settings"
          className="text-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors"
        >
          ← Back to settings
        </Link>
      </div>
      <p className="text-sm text-[var(--brand-text-secondary)] mb-8">
        Update the foundational info we use to match your campaigns with shows. Changes apply to every
        future campaign — use the new-campaign flow to override anything for a single campaign.
      </p>

      <div className="space-y-6">
        <Section title="Brand identity">
          <textarea
            value={identity}
            onChange={(e) => setIdentity(e.target.value)}
            rows={4}
            placeholder="Start typing..."
            className="w-full px-4 py-2.5 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text)] text-sm placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30 focus:border-[var(--brand-blue)] transition-all resize-none"
          />
          <Hint>
            What do you sell and who&apos;s it for? Include your product type, price range, and what
            makes it different.
          </Hint>
        </Section>

        <Section title="Brand website">
          <input
            type="url"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="https://yourbrand.com"
            className="w-full px-4 py-2.5 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text)] text-sm placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30 focus:border-[var(--brand-blue)] transition-all"
          />
        </Section>

        <Section title="Ideal customer">
          <textarea
            value={customer}
            onChange={(e) => setCustomer(e.target.value)}
            rows={4}
            placeholder="Start typing..."
            className="w-full px-4 py-2.5 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text)] text-sm placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30 focus:border-[var(--brand-blue)] transition-all resize-none"
          />
          <Hint>
            Think about who actually buys from you — their age, interests, lifestyle, and what problems
            they&apos;re solving.
          </Hint>
        </Section>

        <Section title="Target age range">
          <div className="rounded-xl border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] p-5">
            <div className="flex items-center justify-center gap-6 mb-5">
              <div className="text-center">
                <div className="text-[10px] uppercase tracking-wider text-[var(--brand-text-muted)] font-medium">From</div>
                <div className="text-2xl font-bold text-[var(--brand-text)] tabular-nums">{ageMin}</div>
              </div>
              <div className="text-xl text-[var(--brand-text-muted)]">–</div>
              <div className="text-center">
                <div className="text-[10px] uppercase tracking-wider text-[var(--brand-text-muted)] font-medium">To</div>
                <div className="text-2xl font-bold text-[var(--brand-text)] tabular-nums">{formatMax(ageMaxState)}</div>
              </div>
            </div>
            <div className="space-y-3">
              <input
                type="range"
                min={AGE_MIN}
                max={AGE_MAX}
                value={ageMin}
                onChange={(e) => handleAgeMin(Number(e.target.value))}
                className="w-full accent-[var(--brand-blue)]"
                aria-label="Minimum age"
              />
              <input
                type="range"
                min={AGE_MIN}
                max={AGE_MAX}
                value={ageMaxState}
                onChange={(e) => handleAgeMax(Number(e.target.value))}
                className="w-full accent-[var(--brand-blue)]"
                aria-label="Maximum age"
              />
            </div>
          </div>
        </Section>

        <Section title="Audience skew">
          <div className="grid grid-cols-2 gap-2">
            {GENDER_OPTIONS.map((opt) => {
              const selected = gender === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setGender(opt.value)}
                  className={`p-3 rounded-lg border text-sm font-semibold transition-all ${
                    selected
                      ? "border-[var(--brand-blue)] bg-[var(--brand-blue)]/[0.06] text-[var(--brand-blue)]"
                      : "border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text-secondary)] hover:border-[var(--brand-blue)]/30"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </Section>

        <Section title="Content categories" hint={`${categories.size} of ${MAX_CATEGORIES} selected`}>
          <div className="grid grid-cols-3 gap-2">
            {CATEGORIES.map((cat) => {
              const selected = categories.has(cat);
              const disabled = !selected && categories.size >= MAX_CATEGORIES;
              return (
                <button
                  key={cat}
                  type="button"
                  disabled={disabled}
                  onClick={() => toggleCategory(cat)}
                  className={`px-3 py-2 rounded-lg border text-xs font-semibold transition-all ${
                    selected
                      ? "border-[var(--brand-blue)] bg-[var(--brand-blue)]/[0.06] text-[var(--brand-blue)]"
                      : disabled
                        ? "border-[var(--brand-border)] bg-[var(--brand-surface)] opacity-40 cursor-not-allowed text-[var(--brand-text-muted)]"
                        : "border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text-secondary)] hover:border-[var(--brand-blue)]/30"
                  }`}
                >
                  {cat}
                </button>
              );
            })}
          </div>
        </Section>

        <Section title="Goals" hint={`${goals.size} of ${MAX_GOALS} selected`}>
          <div className="grid grid-cols-2 gap-2">
            {GOAL_OPTIONS.map((opt) => {
              const selected = goals.has(opt.value);
              const disabled = !selected && goals.size >= MAX_GOALS;
              return (
                <button
                  key={opt.value}
                  type="button"
                  disabled={disabled}
                  onClick={() => toggleGoal(opt.value)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-semibold transition-all text-left ${
                    selected
                      ? "border-[var(--brand-blue)] bg-[var(--brand-blue)]/[0.06] text-[var(--brand-blue)]"
                      : disabled
                        ? "border-[var(--brand-border)] bg-[var(--brand-surface)] opacity-40 cursor-not-allowed text-[var(--brand-text-muted)]"
                        : "border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text-secondary)] hover:border-[var(--brand-blue)]/30"
                  }`}
                >
                  <span>{opt.emoji}</span>
                  <span>{opt.title}</span>
                </button>
              );
            })}
          </div>
        </Section>

        <Section title="Exclusions">
          <textarea
            value={exclusions}
            onChange={(e) => setExclusions(e.target.value)}
            rows={3}
            placeholder="Start typing..."
            className="w-full px-4 py-2.5 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text)] text-sm placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30 focus:border-[var(--brand-blue)] transition-all resize-none"
          />
          <Hint>
            List any topics, competitors, or content types you want to avoid. Leave blank if you&apos;re
            open to everything.
          </Hint>
        </Section>
      </div>

      <div className="mt-8 pt-6 border-t border-[var(--brand-border)] flex items-center justify-between">
        <div className="text-xs text-[var(--brand-text-muted)]">
          {savedAt && !error ? `Saved at ${savedAt}` : ""}
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[var(--brand-blue)] hover:bg-[var(--brand-blue-light)] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
      {error && (
        <div className="mt-4 p-3 rounded-lg border border-[var(--brand-error)]/30 bg-[var(--brand-error)]/[0.04] text-sm text-[var(--brand-error)]">
          {error}
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="block text-sm font-medium text-[var(--brand-text)]">{title}</label>
        {hint && <span className="text-xs text-[var(--brand-text-muted)]">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-[var(--brand-text-muted)] mt-2">{children}</p>;
}
