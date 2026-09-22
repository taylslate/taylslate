"use client";

import Link from "next/link";
import { useState } from "react";
import type {
  BrandCampaignGoal,
  BrandProfile,
  BrandTargetGender,
} from "@/lib/data/types";
import { tokens } from "@/lib/brand/tokens";

const radiusStyle = { borderRadius: tokens.radius };

const inkText = "text-[var(--ts-ink-on-paper)]";
const mutedText = "text-[var(--ts-ink-muted-on-paper)]";
const hairlineRule = "border-[var(--ts-hairline-on-paper)]";
const panelClass = "border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)]";
const fieldClass =
  "w-full border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-3 py-2 text-sm text-[var(--ts-ink-on-paper)] placeholder:text-[var(--ts-ink-muted-on-paper)] focus:border-[var(--ts-accent)] focus:outline-none";
const inkBtnClass =
  "inline-flex items-center gap-2 bg-[var(--ts-ink-on-paper)] px-6 py-2.5 text-sm font-medium text-[var(--ts-paper)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40";
const kickerClass =
  "text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ts-accent)]";
const chipOn = `border ${hairlineRule} bg-[var(--ts-band-brands)] ${inkText}`;
const chipOff = `border ${hairlineRule} bg-[var(--ts-paper)] ${mutedText} hover:bg-[var(--ts-band-shows)]`;
const chipDisabled = `border ${hairlineRule} bg-[var(--ts-paper)] ${mutedText} cursor-not-allowed opacity-40`;

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
/** Matches sanitizeBrandProfilePatch in /api/brand-profile — outreach From: cap. */
const MAX_BRAND_NAME = 80;

function formatMax(v: number): string {
  return v >= AGE_MAX ? `${AGE_MAX}+` : String(v);
}

export default function BrandProfileForm({ profile }: { profile: BrandProfile | null }) {
  const [brandName, setBrandName] = useState(profile?.brand_name ?? "");
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
    const trimmedName = brandName.trim();
    if (!trimmedName) {
      setError("Brand name is required.");
      return;
    }

    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/brand-profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brand_name: trimmedName.slice(0, MAX_BRAND_NAME),
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
      setBrandName(trimmedName.slice(0, MAX_BRAND_NAME));
      setSavedAt(new Date().toLocaleTimeString());
      setSaving(false);
    } catch {
      setError("Network error. Try again.");
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl p-4 sm:p-8">
      <div className="mb-1 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className={kickerClass}>For brands</p>
          <h1 className={`mt-2 text-2xl font-semibold tracking-tight ${inkText}`}>
            Brand profile
          </h1>
        </div>
        <Link
          href="/settings"
          className={`text-sm ${mutedText} hover:text-[var(--ts-ink-on-paper)]`}
        >
          ← Back to settings
        </Link>
      </div>
      <p className={`mb-8 text-sm ${mutedText}`}>
        Update the foundational info we use to match your campaigns with shows. Changes apply to every
        future campaign — use the new-campaign flow to override anything for a single campaign.
      </p>

      <div className="space-y-6">
        <Section title="Brand name" htmlFor="brand-name">
          <input
            id="brand-name"
            type="text"
            value={brandName}
            onChange={(e) => setBrandName(e.target.value)}
            maxLength={MAX_BRAND_NAME}
            required
            placeholder="e.g. Aurora Sleep"
            className={fieldClass}
            style={radiusStyle}
          />
          <Hint>
            Used as the From name on outreach emails and the headline on the public pitch page.
          </Hint>
        </Section>

        <Section title="Brand identity">
          <textarea
            value={identity}
            onChange={(e) => setIdentity(e.target.value)}
            rows={4}
            placeholder="Start typing..."
            className={`${fieldClass} resize-none`}
            style={radiusStyle}
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
            className={fieldClass}
            style={radiusStyle}
          />
        </Section>

        <Section title="Ideal customer">
          <textarea
            value={customer}
            onChange={(e) => setCustomer(e.target.value)}
            rows={4}
            placeholder="Start typing..."
            className={`${fieldClass} resize-none`}
            style={radiusStyle}
          />
          <Hint>
            Think about who actually buys from you — their age, interests, lifestyle, and what problems
            they&apos;re solving.
          </Hint>
        </Section>

        <Section title="Target age range">
          <div className={`p-5 ${panelClass}`} style={radiusStyle}>
            <div className="mb-5 flex items-center justify-center gap-6">
              <div className="text-center">
                <div className={`text-[10px] font-medium uppercase tracking-wider ${mutedText}`}>From</div>
                <div className={`text-2xl font-semibold tabular-nums ${inkText}`}>{ageMin}</div>
              </div>
              <div className={`text-xl ${mutedText}`}>–</div>
              <div className="text-center">
                <div className={`text-[10px] font-medium uppercase tracking-wider ${mutedText}`}>To</div>
                <div className={`text-2xl font-semibold tabular-nums ${inkText}`}>{formatMax(ageMaxState)}</div>
              </div>
            </div>
            <div className="space-y-3">
              <input
                type="range"
                min={AGE_MIN}
                max={AGE_MAX}
                value={ageMin}
                onChange={(e) => handleAgeMin(Number(e.target.value))}
                className="w-full accent-[var(--ts-accent)]"
                aria-label="Minimum age"
              />
              <input
                type="range"
                min={AGE_MIN}
                max={AGE_MAX}
                value={ageMaxState}
                onChange={(e) => handleAgeMax(Number(e.target.value))}
                className="w-full accent-[var(--ts-accent)]"
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
                  className={`p-3 text-sm font-medium ${selected ? chipOn : chipOff}`}
                  style={radiusStyle}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </Section>

        <Section title="Content categories" hint={`${categories.size} of ${MAX_CATEGORIES} selected`}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {CATEGORIES.map((cat) => {
              const selected = categories.has(cat);
              const disabled = !selected && categories.size >= MAX_CATEGORIES;
              return (
                <button
                  key={cat}
                  type="button"
                  disabled={disabled}
                  onClick={() => toggleCategory(cat)}
                  className={`px-3 py-2 text-xs font-medium ${
                    selected ? chipOn : disabled ? chipDisabled : chipOff
                  }`}
                  style={radiusStyle}
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
                  className={`flex items-center gap-2 px-3 py-2 text-left text-sm font-medium ${
                    selected ? chipOn : disabled ? chipDisabled : chipOff
                  }`}
                  style={radiusStyle}
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
            className={`${fieldClass} resize-none`}
            style={radiusStyle}
          />
          <Hint>
            List any topics, competitors, or content types you want to avoid. Leave blank if you&apos;re
            open to everything.
          </Hint>
        </Section>
      </div>

      <div className={`mt-8 flex items-center justify-between border-t pt-6 ${hairlineRule}`}>
        <div className={`text-xs ${mutedText}`}>
          {savedAt && !error ? `Saved at ${savedAt}` : ""}
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className={inkBtnClass}
          style={radiusStyle}
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
      {error && (
        <div
          className="mt-4 border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-band-brands)] p-3 text-sm text-[var(--ts-accent)]"
          style={radiusStyle}
        >
          {error}
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  hint,
  htmlFor,
  children,
}: {
  title: string;
  hint?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label
          htmlFor={htmlFor}
          className={`block text-sm font-medium ${inkText}`}
        >
          {title}
        </label>
        {hint && <span className={`text-xs ${mutedText}`}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className={`mt-2 text-xs ${mutedText}`}>{children}</p>;
}
