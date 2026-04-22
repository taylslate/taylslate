"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { BrandCampaignGoal, BrandProfile } from "@/lib/data/types";
import {
  buildBriefFromProfile,
  mergeProfileWithOverrides,
  type CampaignOverrides,
} from "@/lib/utils/brand-brief";

interface Props {
  initialName?: string;
  profile: BrandProfile | null;
}

type View = "question" | "form";

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

const MAX_CATEGORIES = 5;
const MAX_GOALS = 3;

type OverrideKey = "audience" | "categories" | "goals";

export default function NewCampaignForm({ initialName = "", profile }: Props) {
  const router = useRouter();
  const [view, setView] = useState<View>(profile ? "question" : "form");
  const [activeOverrides, setActiveOverrides] = useState<Set<OverrideKey>>(new Set());

  // Override state (never persists to brand profile)
  const [overrideCustomer, setOverrideCustomer] = useState("");
  const [overrideCategories, setOverrideCategories] = useState<Set<string>>(
    new Set(profile?.content_categories ?? [])
  );
  const [overrideGoals, setOverrideGoals] = useState<Set<BrandCampaignGoal>>(
    new Set(profile?.campaign_goals ?? [])
  );

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(["podcast"]);
  const [name, setName] = useState(initialName);
  const [brandUrl, setBrandUrl] = useState(profile?.brand_website ?? "");
  const [budgetTotal, setBudgetTotal] = useState<string>("");

  const overrides: CampaignOverrides = useMemo(() => {
    const o: CampaignOverrides = {};
    if (activeOverrides.has("audience") && overrideCustomer.trim().length > 0) {
      o.target_customer = overrideCustomer.trim();
    }
    if (activeOverrides.has("categories") && overrideCategories.size > 0) {
      o.content_categories = Array.from(overrideCategories);
    }
    if (activeOverrides.has("goals") && overrideGoals.size > 0) {
      o.campaign_goals = Array.from(overrideGoals);
    }
    return o;
  }, [activeOverrides, overrideCustomer, overrideCategories, overrideGoals]);

  const mergedProfile = useMemo(
    () => mergeProfileWithOverrides(profile, overrides),
    [profile, overrides]
  );

  // Free-form brief derived from the merged profile. The user can still edit
  // it in the textarea if they want — that edit wins once they touch it.
  const derivedBrief = useMemo(
    () => buildBriefFromProfile(mergedProfile),
    [mergedProfile]
  );
  const [briefText, setBriefText] = useState(derivedBrief);
  const [briefManuallyEdited, setBriefManuallyEdited] = useState(false);

  // Keep the textarea in sync with overrides until the user manually edits.
  const effectiveBrief = briefManuallyEdited ? briefText : derivedBrief;

  const toggleOverride = (key: OverrideKey) => {
    setActiveOverrides((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const togglePlatform = (platform: string) => {
    setSelectedPlatforms((prev) =>
      prev.includes(platform) ? prev.filter((p) => p !== platform) : [...prev, platform]
    );
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    const finalBrief = effectiveBrief.trim();
    if (!finalBrief) {
      setError("Please describe your ideal campaign.");
      setIsSubmitting(false);
      return;
    }

    const body = {
      name,
      brand_url: brandUrl || undefined,
      budget_total: Number(budgetTotal),
      platforms: selectedPlatforms,
      brief_text: finalBrief,
    };

    try {
      const res = await fetch("/api/campaigns/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong. Please try again.");
        setIsSubmitting(false);
        return;
      }
      router.push(`/campaigns/${data.campaign_id}`);
    } catch {
      setError("Network error. Please check your connection and try again.");
      setIsSubmitting(false);
    }
  };

  // ---- View: Question ----

  if (view === "question") {
    return (
      <div className="p-8 max-w-2xl">
        <div className="mb-8">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-1.5 text-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors mb-4"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
            Back
          </button>
          <h1 className="text-2xl font-bold text-[var(--brand-text)] tracking-tight">
            New Campaign
          </h1>
          <p className="text-sm text-[var(--brand-text-secondary)] mt-1">
            Anything different for this campaign?
          </p>
        </div>

        <button
          type="button"
          onClick={() => setView("form")}
          className="w-full flex items-center justify-between p-5 rounded-xl border-2 border-[var(--brand-blue)] bg-[var(--brand-blue)]/[0.04] hover:bg-[var(--brand-blue)]/[0.08] transition-all mb-6 text-left"
        >
          <div>
            <div className="font-semibold text-[var(--brand-text)]">
              No, use my profile as-is
            </div>
            <div className="text-xs text-[var(--brand-text-muted)] mt-0.5">
              Jump straight to budget and discover shows.
            </div>
          </div>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--brand-blue)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </button>

        <div className="text-xs uppercase tracking-wider text-[var(--brand-text-muted)] font-medium mb-3">
          Override just for this campaign
        </div>

        <div className="space-y-2.5">
          <OverrideCard
            title="Different target audience"
            active={activeOverrides.has("audience")}
            onToggle={() => toggleOverride("audience")}
          >
            <textarea
              value={overrideCustomer}
              onChange={(e) => setOverrideCustomer(e.target.value)}
              rows={3}
              placeholder={profile?.target_customer ?? "Describe the audience you want for this campaign"}
              className="w-full px-4 py-2.5 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface)] text-[var(--brand-text)] text-sm placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30 focus:border-[var(--brand-blue)] transition-all resize-none mt-3"
            />
            <p className="text-xs text-[var(--brand-text-muted)] mt-2">
              Your saved audience stays untouched — this applies to this campaign only.
            </p>
          </OverrideCard>

          <OverrideCard
            title="Different categories"
            active={activeOverrides.has("categories")}
            onToggle={() => toggleOverride("categories")}
          >
            <div className="grid grid-cols-3 gap-2 mt-3">
              {CATEGORIES.map((cat) => {
                const selected = overrideCategories.has(cat);
                const disabled = !selected && overrideCategories.size >= MAX_CATEGORIES;
                return (
                  <button
                    key={cat}
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      setOverrideCategories((prev) => {
                        const next = new Set(prev);
                        if (next.has(cat)) next.delete(cat);
                        else if (next.size < MAX_CATEGORIES) next.add(cat);
                        return next;
                      });
                    }}
                    className={`px-3 py-2 rounded-lg border text-xs font-semibold transition-all ${
                      selected
                        ? "border-[var(--brand-blue)] bg-[var(--brand-blue)]/[0.06] text-[var(--brand-blue)]"
                        : disabled
                          ? "border-[var(--brand-border)] bg-[var(--brand-surface)] opacity-40 cursor-not-allowed text-[var(--brand-text-muted)]"
                          : "border-[var(--brand-border)] bg-[var(--brand-surface)] text-[var(--brand-text-secondary)] hover:border-[var(--brand-blue)]/30"
                    }`}
                  >
                    {cat}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-[var(--brand-text-muted)] mt-2">
              {overrideCategories.size} of {MAX_CATEGORIES} selected
            </p>
          </OverrideCard>

          <OverrideCard
            title="Different goals"
            active={activeOverrides.has("goals")}
            onToggle={() => toggleOverride("goals")}
          >
            <div className="grid grid-cols-2 gap-2 mt-3">
              {GOAL_OPTIONS.map((opt) => {
                const selected = overrideGoals.has(opt.value);
                const disabled = !selected && overrideGoals.size >= MAX_GOALS;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      setOverrideGoals((prev) => {
                        const next = new Set(prev);
                        if (next.has(opt.value)) next.delete(opt.value);
                        else if (next.size < MAX_GOALS) next.add(opt.value);
                        return next;
                      });
                    }}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-all ${
                      selected
                        ? "border-[var(--brand-blue)] bg-[var(--brand-blue)]/[0.06] text-[var(--brand-blue)]"
                        : disabled
                          ? "border-[var(--brand-border)] bg-[var(--brand-surface)] opacity-40 cursor-not-allowed text-[var(--brand-text-muted)]"
                          : "border-[var(--brand-border)] bg-[var(--brand-surface)] text-[var(--brand-text-secondary)] hover:border-[var(--brand-blue)]/30"
                    }`}
                  >
                    <span>{opt.emoji}</span>
                    <span className="font-semibold">{opt.title}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-[var(--brand-text-muted)] mt-2">
              {overrideGoals.size} of {MAX_GOALS} selected
            </p>
          </OverrideCard>
        </div>

        <div className="mt-6 pt-6 border-t border-[var(--brand-border)] flex items-center justify-between">
          <Link
            href="/settings/brand-profile"
            className="text-sm font-medium text-[var(--brand-blue)] hover:text-[var(--brand-blue-light)] transition-colors"
          >
            Update my brand profile →
          </Link>
          {activeOverrides.size > 0 && (
            <button
              type="button"
              onClick={() => setView("form")}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[var(--brand-blue)] hover:bg-[var(--brand-blue-light)] text-white text-sm font-semibold transition-colors"
            >
              Continue with overrides
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </button>
          )}
        </div>
      </div>
    );
  }

  // ---- View: Form ----

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-8">
        <button
          onClick={() => (profile ? setView("question") : router.back())}
          className="flex items-center gap-1.5 text-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors mb-4"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
          Back
        </button>
        <h1 className="text-2xl font-bold text-[var(--brand-text)] tracking-tight">New Campaign</h1>
        <p className="text-sm text-[var(--brand-text-secondary)] mt-1">
          Set a budget and we&apos;ll score matching shows.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">Campaign Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="e.g., Q2 Fitness Launch"
            className="w-full px-4 py-2.5 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text)] text-sm placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30 focus:border-[var(--brand-blue)] transition-all"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">Brand Website</label>
          <input
            type="url"
            value={brandUrl}
            onChange={(e) => setBrandUrl(e.target.value)}
            placeholder="https://yourbrand.com"
            className="w-full px-4 py-2.5 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text)] text-sm placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30 focus:border-[var(--brand-blue)] transition-all"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--brand-text)] mb-2">Platforms</label>
          <div className="flex gap-3">
            {[
              { id: "podcast", label: "Podcasts", icon: "🎙️" },
              { id: "youtube", label: "YouTube", icon: "▶️" },
            ].map((platform) => (
              <button
                key={platform.id}
                type="button"
                onClick={() => togglePlatform(platform.id)}
                className={`flex items-center gap-2.5 px-4 py-3 rounded-xl border text-sm font-medium transition-all flex-1 ${
                  selectedPlatforms.includes(platform.id)
                    ? "border-[var(--brand-blue)] bg-[var(--brand-blue)]/[0.06] text-[var(--brand-blue)]"
                    : "border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text-secondary)] hover:border-[var(--brand-text-muted)]"
                }`}
              >
                <span className="text-lg">{platform.icon}</span>
                {platform.label}
                {selectedPlatforms.includes(platform.id) && (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ml-auto">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-sm font-medium text-[var(--brand-text)]">
              What&apos;s being sent to the scoring engine
            </label>
            {profile && activeOverrides.size > 0 && (
              <span className="text-xs font-medium text-[var(--brand-blue)] bg-[var(--brand-blue)]/[0.08] px-2 py-0.5 rounded">
                {activeOverrides.size} override{activeOverrides.size === 1 ? "" : "s"} applied
              </span>
            )}
          </div>
          <textarea
            value={effectiveBrief}
            onChange={(e) => {
              setBriefText(e.target.value);
              setBriefManuallyEdited(true);
            }}
            required
            rows={8}
            placeholder="Start typing..."
            className="w-full px-4 py-2.5 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text)] text-sm placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30 focus:border-[var(--brand-blue)] transition-all resize-none"
          />
          <p className="text-xs text-[var(--brand-text-muted)] mt-1.5">
            {briefManuallyEdited
              ? "You've edited the brief manually. Toggling overrides won't overwrite your edits."
              : profile
                ? "This merges your brand profile with any campaign-specific overrides. Edit freely — you&rsquo;re seeing exactly what the scoring engine will receive."
                : "Write in plain English — what you sell, who you want to reach, and your campaign goals."}
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">Campaign Budget (USD)</label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-[var(--brand-text-muted)]">$</span>
            <input
              type="number"
              value={budgetTotal}
              onChange={(e) => setBudgetTotal(e.target.value)}
              required
              min="1000"
              step="1000"
              placeholder="20000"
              className="w-full pl-8 pr-4 py-2.5 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text)] text-sm placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30 focus:border-[var(--brand-blue)] transition-all"
            />
          </div>
          <p className="text-xs text-[var(--brand-text-muted)] mt-1.5">
            Minimum $1,000. We recommend at least $5,000 for meaningful testing across 3-5 shows.
          </p>
        </div>

        <div className="border-t border-[var(--brand-border)] pt-6">
          <button
            type="submit"
            disabled={isSubmitting || selectedPlatforms.length === 0}
            className="w-full flex items-center justify-center gap-2 bg-[var(--brand-blue)] hover:bg-[var(--brand-blue-light)] disabled:opacity-50 disabled:cursor-not-allowed text-white py-3 rounded-xl text-sm font-semibold transition-all"
          >
            {isSubmitting ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Discovering and scoring shows...
              </>
            ) : (
              <>
                Discover Shows
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </>
            )}
          </button>
          {error && (
            <div className="mt-4 p-3 rounded-lg border border-[var(--brand-error)]/30 bg-[var(--brand-error)]/[0.04] text-sm text-[var(--brand-error)]">
              {error}
            </div>
          )}
        </div>
      </form>
    </div>
  );
}

function OverrideCard({
  title,
  active,
  onToggle,
  children,
}: {
  title: string;
  active: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-xl border transition-all ${
        active
          ? "border-[var(--brand-blue)] bg-[var(--brand-blue)]/[0.03]"
          : "border-[var(--brand-border)] bg-[var(--brand-surface-elevated)]"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 text-left"
      >
        <div className="font-semibold text-[var(--brand-text)]">{title}</div>
        <div
          className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
            active
              ? "border-[var(--brand-blue)] bg-[var(--brand-blue)]"
              : "border-[var(--brand-border)]"
          }`}
        >
          {active && (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </div>
      </button>
      {active && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}
