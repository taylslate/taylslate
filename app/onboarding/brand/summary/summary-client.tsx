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
    <div className="flex min-h-screen flex-col bg-[var(--ts-paper)] text-[var(--ts-ink-on-paper)]">
      <div className="h-1 w-full bg-[var(--ts-hairline-on-paper)]">
        <div className="h-full bg-[var(--ts-ink-on-paper)] transition-all duration-300" style={{ width: `${progressPct}%` }} />
      </div>

      <div className="flex items-center border-b border-[var(--ts-hairline-on-paper)] px-8 py-5">
        <div className="text-xs text-[var(--ts-ink-muted-on-paper)]">
          Step {current + 1} of {TOTAL_STEPS} · {BRAND_ONBOARDING_STEPS[current].label}
        </div>
      </div>

      <div className="flex flex-1 items-start justify-center p-8 pt-12">
        <div className="w-full max-w-2xl">
          <h1 className="text-3xl font-bold tracking-tight text-[var(--ts-ink-on-paper)]">Does this look right?</h1>
          <p className="mt-2 mb-8 text-[var(--ts-ink-muted-on-paper)]">
            Edit any section that needs tweaking. You can always change this later in settings.
          </p>

          <div className="divide-y divide-[var(--ts-hairline-on-paper)] rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)]">
            <Row label="Website" value={profile.brand_website ?? ""} editSlug="welcome" emptyLabel="Add your website" placeholderAsEmpty />
            <Row label="Brand name" value={profile.brand_name ?? ""} editSlug="identity" emptyLabel="Add your brand name" placeholderAsEmpty />
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
            <div className="mt-4 rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] p-3 text-sm text-[var(--ts-accent)]">
              {error}
            </div>
          )}

          <div className="mt-8 flex items-center justify-between">
            <Link
              href="/onboarding/brand/exclusions"
              className="text-sm text-[var(--ts-ink-muted-on-paper)] transition-colors hover:text-[var(--ts-ink-on-paper)]"
            >
              ← Back
            </Link>
            <button
              type="button"
              onClick={complete}
              disabled={finishing}
              className="inline-flex items-center gap-2 rounded-[var(--ts-radius)] bg-[var(--ts-ink-on-paper)] px-6 py-3 text-sm font-semibold text-[var(--ts-paper)] transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
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
        <div className="text-xs font-medium uppercase tracking-wider text-[var(--ts-ink-muted-on-paper)]">{label}</div>
        <div
          className={`mt-1 text-sm ${
            isEmpty
              ? placeholderAsEmpty
                ? "text-[var(--ts-ink-muted-on-paper)] italic"
                : "text-[var(--ts-accent)]"
              : "text-[var(--ts-ink-on-paper)]"
          }`}
        >
          {isEmpty ? emptyLabel ?? "—" : value}
        </div>
      </div>
      <Link
        href={`/onboarding/brand/${editSlug}?return=summary`}
        className="text-xs font-medium whitespace-nowrap text-[var(--ts-accent)] transition-colors hover:opacity-80"
      >
        Edit
      </Link>
    </div>
  );
}
