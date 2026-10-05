"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type {
  ShowAdFormat,
  ShowAdReadType,
  ShowBrandHistoryEntry,
  ShowCategoryExclusion,
  ShowEpisodeCadence,
  ShowPlacement,
  ShowProfile,
  ShowProfilePlatform,
} from "@/lib/data/types";
import { SHOW_ONBOARDING_STEPS, TOTAL_STEPS, stepIndexOf } from "../steps";
import { getCpmBenchmark, spotPrice } from "@/lib/utils/cpm-benchmark";

const PLATFORM_LABELS: Record<ShowProfilePlatform, string> = {
  podcast: "Podcast",
  youtube: "YouTube",
  both: "Podcast + YouTube",
};
const CADENCE_LABELS: Record<ShowEpisodeCadence, string> = {
  daily: "Daily",
  multiple_weekly: "A few times a week",
  weekly: "Weekly",
  biweekly: "Biweekly",
  monthly: "Monthly",
  irregular: "Irregular",
};
const FORMAT_LABELS: Record<ShowAdFormat, string> = {
  host_read_baked: "Host-read baked-in",
  dynamic_insertion: "Dynamic insertion",
};
const READ_LABELS: Record<ShowAdReadType, string> = {
  personal_experience: "Personal experience",
  scripted: "Scripted",
  talking_points: "Talking points",
  any: "Any",
};
const PLACEMENT_LABELS: Record<ShowPlacement, string> = {
  pre_roll: "Pre-roll",
  mid_roll: "Mid-roll",
  post_roll: "Post-roll",
};
const EXCLUSION_LABELS: Record<ShowCategoryExclusion, string> = {
  gambling: "Gambling",
  alcohol: "Alcohol",
  supplements: "Supplements",
  political: "Political",
  crypto: "Crypto",
  adult: "Adult content",
  none: "Open to everything",
};

function joinLabels<T extends string>(values: T[] | undefined, labels: Record<T, string>): string {
  if (!values || values.length === 0) return "";
  return values.map((v) => labels[v]).join(" · ");
}

const DEAL_TYPE_LABELS: Record<NonNullable<ShowBrandHistoryEntry["deal_type"]>, string> = {
  "one-off": "one-off",
  annual: "annual deal",
};

function formatBrandHistory(entries: ShowBrandHistoryEntry[] | undefined): string {
  if (!entries || entries.length === 0) return "";
  return entries
    .map((e) => {
      const meta = [e.category, e.deal_type ? DEAL_TYPE_LABELS[e.deal_type] : undefined].filter(Boolean);
      return meta.length > 0 ? `${e.brand_name} (${meta.join(" · ")})` : e.brand_name;
    })
    .join(", ");
}

export default function SummaryClient({ profile }: { profile: ShowProfile }) {
  const router = useRouter();
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = stepIndexOf("summary");
  const progressPct = Math.round(((current + 1) / TOTAL_STEPS) * 100);

  const complete = async () => {
    setError(null);
    setFinishing(true);
    const res = await fetch("/api/show-profile/complete", { method: "POST" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Couldn't complete onboarding");
      setFinishing(false);
      return;
    }
    const data = await res.json().catch(() => ({}));
    // A show that came from a public pitch gets bounced straight back to it. Use a
    // HARD navigation (not router.push) so the pitch page's server component re-runs
    // and the now-onboarded show sees "Accept offer" immediately — no manual refresh.
    if (data.redirect_to) {
      window.location.assign(data.redirect_to);
      return;
    }
    router.push("/dashboard");
  };

  const audience = profile.audience_size ?? 0;
  const expected = profile.expected_cpm ?? 0;
  const bench = audience > 0 ? getCpmBenchmark(audience) : null;
  const userSpot = audience > 0 && expected > 0 ? spotPrice(audience, expected) : null;
  const marketLow = bench ? spotPrice(audience, bench.cpmMin) : null;
  const marketHigh = bench ? spotPrice(audience, bench.cpmMax) : null;

  return (
    <div className="flex min-h-screen flex-col bg-[var(--ts-paper)] text-[var(--ts-ink-on-paper)]">
      <div className="h-1 w-full bg-[var(--ts-hairline-on-paper)]">
        <div
          className="h-full bg-[var(--ts-ink-on-paper)] transition-all duration-300"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      <div className="flex items-center border-b border-[var(--ts-hairline-on-paper)] px-8 py-5">
        <div className="text-xs text-[var(--ts-ink-muted-on-paper)]">
          Step {current + 1} of {TOTAL_STEPS} · {SHOW_ONBOARDING_STEPS[current].label}
        </div>
      </div>

      <div className="flex flex-1 items-start justify-center p-8 pt-12">
        <div className="w-full max-w-2xl">
          <h1 className="text-3xl font-bold tracking-tight text-[var(--ts-ink-on-paper)]">Does this look right?</h1>
          <p className="mt-2 mb-8 text-[var(--ts-ink-muted-on-paper)]">
            Edit any section that needs tweaking. You can always change this later in settings.
          </p>

          {profile.show_image_url && (
            <div className="mb-6 flex items-center gap-4 rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] p-4">
              <Image
                src={profile.show_image_url}
                alt=""
                width={64}
                height={64}
                className="rounded-[var(--ts-radius)] object-cover"
                unoptimized
              />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold text-[var(--ts-ink-on-paper)]">
                  {profile.show_name ?? "Your show"}
                </div>
                {profile.show_description && (
                  <div className="line-clamp-2 text-xs text-[var(--ts-ink-muted-on-paper)]">
                    {profile.show_description}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="divide-y divide-[var(--ts-hairline-on-paper)] rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)]">
            <Row label="Feed URL" value={profile.feed_url ?? ""} editSlug="welcome" emptyLabel="Add your feed URL" />
            <Row
              label="Show"
              value={[profile.show_name, joinLabels(profile.show_categories, Object.fromEntries((profile.show_categories ?? []).map((c) => [c, c])))]
                .filter(Boolean)
                .join(" · ")}
              editSlug="confirm"
              emptyLabel="Add show details"
            />
            <Row label="Platform" value={profile.platform ? PLATFORM_LABELS[profile.platform] : ""} editSlug="platform" emptyLabel="Pick a platform" />
            <Row label="Episode cadence" value={profile.episode_cadence ? CADENCE_LABELS[profile.episode_cadence] : ""} editSlug="cadence" emptyLabel="Pick a cadence" />
            <Row
              label="Audience size"
              value={profile.audience_size != null ? `${profile.audience_size.toLocaleString()} downloads/ep` : ""}
              editSlug="audience"
              emptyLabel="Add your audience size"
            />
            <Row
              label="Expected CPM"
              value={profile.expected_cpm != null ? `$${profile.expected_cpm}` : ""}
              editSlug="pricing"
              emptyLabel="Share your CPM expectation"
            />
            <Row label="Ad formats" value={joinLabels(profile.ad_formats, FORMAT_LABELS)} editSlug="formats" emptyLabel="Pick at least one format" />
            <Row label="Ad reads" value={joinLabels(profile.ad_read_types, READ_LABELS)} editSlug="read-types" emptyLabel="Pick at least one" />
            <Row label="Placements" value={joinLabels(profile.placements, PLACEMENT_LABELS)} editSlug="placements" emptyLabel="Pick at least one" />
            <Row label="Exclusions" value={joinLabels(profile.category_exclusions, EXCLUSION_LABELS)} editSlug="exclusions" emptyLabel="Open to everything" placeholderAsEmpty />
            <Row
              label="Brand history"
              value={formatBrandHistory(profile.brand_history)}
              editSlug="brand-history"
              emptyLabel="None added"
              placeholderAsEmpty
            />
            <Row
              label="Ad copy email"
              value={profile.ad_copy_email ?? ""}
              editSlug="contacts"
              emptyLabel="Using your signing email"
              placeholderAsEmpty
            />
            <Row
              label="Billing email"
              value={profile.billing_email ?? ""}
              editSlug="contacts"
              emptyLabel="Using your signing email"
              placeholderAsEmpty
            />
          </div>

          {bench && userSpot != null && marketLow != null && marketHigh != null && (
            <div className="mt-6 rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] p-5">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--ts-ink-muted-on-paper)]">
                What you can realistically expect to earn
              </div>
              <div className="text-sm leading-relaxed text-[var(--ts-ink-on-paper)]">
                At <strong>{audience.toLocaleString()}</strong> downloads, the market pays{" "}
                <strong>${marketLow.toLocaleString()}–${marketHigh.toLocaleString()}</strong> per ad spot
                (${bench.cpmMin}–${bench.cpmMax} CPM). At your ${expected} CPM expectation, each spot
                would earn you <strong>${userSpot.toLocaleString()}</strong>.
              </div>
            </div>
          )}

          {error && (
            <div className="mt-4 rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] p-3 text-sm text-[var(--ts-accent)]">
              {error}
            </div>
          )}

          <div className="mt-8 flex items-center justify-between">
            <Link
              href="/onboarding/show/contacts"
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
        href={`/onboarding/show/${editSlug}?return=summary`}
        className="text-xs font-medium whitespace-nowrap text-[var(--ts-accent)] transition-colors hover:opacity-80"
      >
        Edit
      </Link>
    </div>
  );
}
