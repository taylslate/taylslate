"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { BrandCampaignGoal, BrandProfile, BrandTargetGender } from "@/lib/data/types";
import { BRAND_ONBOARDING_STEPS, TOTAL_STEPS, stepIndexOf } from "../steps";

const GENDER_LABELS: Record<BrandTargetGender, string> = {
  mostly_men: "Mostly men",
  mostly_women: "Mostly women",
  mixed: "Mixed",
  no_preference: "No preference",
};

const GOAL_LABELS: Record<BrandCampaignGoal, string> = {
  direct_sales: "Drive direct sales",
  brand_awareness: "Build brand awareness",
  new_product: "Launch a new product",
  test_podcast: "Test podcast advertising",
};

function formatAgeRange(min?: number | null, max?: number | null): string {
  if (min == null) return "—";
  const maxText = max == null || max >= 65 ? "65+" : String(max);
  return `${min} – ${maxText}`;
}

export default function SummaryClient({ profile }: { profile: BrandProfile }) {
  const router = useRouter();
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = stepIndexOf("summary");
  const progressPct = Math.round(((current + 1) / TOTAL_STEPS) * 100);

  const complete = async () => {
    setError(null);
    setFinishing(true);
    const res = await fetch("/api/brand-profile/complete", { method: "POST" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Couldn't complete onboarding");
      setFinishing(false);
      return;
    }
    router.push("/dashboard");
  };

  return (
    <div className="min-h-screen bg-[var(--brand-surface)] flex flex-col">
      <div className="w-full h-1 bg-[var(--brand-border)]">
        <div className="h-full bg-[var(--brand-blue)] transition-all duration-300" style={{ width: `${progressPct}%` }} />
      </div>

      <div className="flex items-center justify-between px-8 py-5 border-b border-[var(--brand-border)]">
        <Link href="/" className="font-bold text-[var(--brand-text)] tracking-tight">taylslate</Link>
        <div className="text-xs text-[var(--brand-text-muted)]">
          Step {current + 1} of {TOTAL_STEPS} · {BRAND_ONBOARDING_STEPS[current].label}
        </div>
      </div>

      <div className="flex-1 flex items-start justify-center p-8 pt-12">
        <div className="w-full max-w-2xl">
          <h1 className="text-3xl font-bold text-[var(--brand-text)] tracking-tight">Does this look right?</h1>
          <p className="text-[var(--brand-text-secondary)] mt-2 mb-8">
            Edit any section that needs tweaking. You can always change this later in settings.
          </p>

          <div className="rounded-2xl border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] divide-y divide-[var(--brand-border)]">
            <Row label="Website" value={profile.brand_website ?? ""} editSlug="welcome" emptyLabel="Add your website" placeholderAsEmpty />
            <Row label="Brand" value={profile.brand_identity ?? ""} editSlug="identity" emptyLabel="Add your brand description" />
            <Row label="Ideal customer" value={profile.target_customer ?? ""} editSlug="customer" emptyLabel="Describe your ideal customer" />
            <Row label="Age range" value={formatAgeRange(profile.target_age_min, profile.target_age_max)} editSlug="age" />
            <Row label="Audience skew" value={profile.target_gender ? GENDER_LABELS[profile.target_gender] : ""} editSlug="gender" emptyLabel="Pick a skew" />
            <Row
              label="Content categories"
              value={(profile.content_categories ?? []).join(" · ")}
              editSlug="categories"
              emptyLabel="Pick at least one category"
            />
            <Row
              label="Goals"
              value={(profile.campaign_goals ?? []).map((g) => GOAL_LABELS[g]).join(" · ")}
              editSlug="goals"
              emptyLabel="Pick at least one goal"
            />
            <Row label="Exclusions" value={profile.exclusions ?? ""} editSlug="exclusions" emptyLabel="None" placeholderAsEmpty />
          </div>

          {error && (
            <div className="mt-4 p-3 rounded-lg border border-[var(--brand-error)]/30 bg-[var(--brand-error)]/[0.04] text-sm text-[var(--brand-error)]">
              {error}
            </div>
          )}

          <div className="flex items-center justify-between mt-8">
            <Link
              href="/onboarding/brand/exclusions"
              className="text-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors"
            >
              ← Back
            </Link>
            <button
              type="button"
              onClick={complete}
              disabled={finishing}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[var(--brand-blue)] hover:bg-[var(--brand-blue-light)] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
            >
              {finishing ? "Finishing…" : "Looks good — take me to my dashboard"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  editSlug,
  emptyLabel,
  placeholderAsEmpty,
}: {
  label: string;
  value: string;
  editSlug: string;
  emptyLabel?: string;
  placeholderAsEmpty?: boolean;
}) {
  const isEmpty = !value || value.trim().length === 0;
  return (
    <div className="flex items-start justify-between gap-4 px-5 py-4">
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-[var(--brand-text-muted)] uppercase tracking-wider">{label}</div>
        <div
          className={`text-sm mt-1 ${
            isEmpty
              ? placeholderAsEmpty
                ? "text-[var(--brand-text-muted)] italic"
                : "text-[var(--brand-warning)]"
              : "text-[var(--brand-text)]"
          }`}
        >
          {isEmpty ? emptyLabel ?? "—" : value}
        </div>
      </div>
      <Link
        href={`/onboarding/brand/${editSlug}`}
        className="text-xs font-medium text-[var(--brand-blue)] hover:text-[var(--brand-blue-light)] transition-colors whitespace-nowrap"
      >
        Edit
      </Link>
    </div>
  );
}
