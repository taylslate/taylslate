"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import type { Campaign, ScoredShowRecord } from "@/lib/data/types";
import { isBriefV2 } from "@/lib/data/types";

// ---- Types ----

type SortOption = "best_match" | "audience_size" | "lowest_cpm" | "ad_engagement";

interface DiscoveryListProps {
  campaign: Campaign;
}

// ---- Helpers ----

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return n.toLocaleString();
}

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return `$${n.toLocaleString()}`;
}

function fitScoreColor(score: number): string {
  const tone = score >= 75
    ? "text-[var(--ts-ink-on-paper)]"
    : "text-[var(--ts-ink-muted-on-paper)]";
  return `border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] ${tone}`;
}

function riskBadge(level: string): { text: string; color: string } {
  switch (level) {
    case "none": return { text: "Safe", color: "text-[var(--ts-ink-on-paper)]" };
    case "low": return { text: "Low risk", color: "text-[var(--ts-ink-on-paper)]" };
    case "medium": return { text: "Med risk", color: "text-[var(--ts-ink-muted-on-paper)]" };
    case "high": return { text: "High risk", color: "text-[var(--ts-ink-on-paper)]" };
    default: return { text: "Unknown", color: "text-[var(--ts-ink-muted-on-paper)]" };
  }
}

function demographicSummary(show: ScoredShowRecord): string {
  const parts: string[] = [];
  if (show.demographics?.dominantAge) parts.push(show.demographics.dominantAge);
  if (show.demographics?.genderSkew) {
    const skew = show.demographics.genderSkew.replace(/_/g, " ");
    parts.push(skew);
  }
  if (show.demographics?.purchasingPower) {
    parts.push(`${show.demographics.purchasingPower} income`);
  }
  return parts.length > 0 ? parts.join(" · ") : "Demographics unavailable";
}

// ---- Component ----

export default function DiscoveryList({ campaign }: DiscoveryListProps) {
  const router = useRouter();
  const shows = (campaign.scored_shows ?? []) as ScoredShowRecord[];
  const initialSelections = new Set(campaign.selected_show_ids ?? []);
  // V2-brief campaigns (Wave 14 2A) never reach this component pre-2B —
  // they have no scored_shows. Null out the legacy brief metadata for them.
  const brief = isBriefV2(campaign.brief) ? null : campaign.brief;

  const [selectedIds, setSelectedIds] = useState<Set<string>>(initialSelections);
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [sortBy, setSortBy] = useState<SortOption>("best_match");
  const [isSaving, setIsSaving] = useState(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Extract unique categories from shows
  const allCategories = useMemo(() => {
    const cats = new Map<string, number>();
    for (const show of shows) {
      for (const cat of show.categories) {
        cats.set(cat, (cats.get(cat) ?? 0) + 1);
      }
    }
    return Array.from(cats.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([name]) => name);
  }, [shows]);

  // Filter and sort
  const filteredShows = useMemo(() => {
    let result = [...shows];

    // Category filter
    if (activeCategory !== "all") {
      result = result.filter((s) =>
        s.categories.some((c) => c.toLowerCase() === activeCategory.toLowerCase())
      );
    }

    // Sort
    switch (sortBy) {
      case "audience_size":
        result.sort((a, b) => b.audienceSize - a.audienceSize);
        break;
      case "lowest_cpm":
        result.sort((a, b) => a.estimatedCpm - b.estimatedCpm);
        break;
      case "ad_engagement":
        result.sort((a, b) => (b.adEngagementRate ?? 0) - (a.adEngagementRate ?? 0));
        break;
      default: // best_match
        result.sort((a, b) => b.compositeScore - a.compositeScore);
    }

    return result;
  }, [shows, activeCategory, sortBy]);

  // Selection handlers with debounced save
  const persistSelections = useCallback(
    (newIds: Set<string>) => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(async () => {
        setIsSaving(true);
        try {
          await fetch("/api/campaigns/selections", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              campaign_id: campaign.id,
              selected_show_ids: Array.from(newIds),
            }),
          });
        } catch {
          console.error("Failed to save selections");
        }
        setIsSaving(false);
      }, 800);
    },
    [campaign.id]
  );

  const toggleShow = useCallback(
    (podcastId: string) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(podcastId)) next.delete(podcastId);
        else next.add(podcastId);
        persistSelections(next);
        return next;
      });
    },
    [persistSelections]
  );

  const selectAll = useCallback(() => {
    const allIds = new Set(filteredShows.map((s) => s.podcastId));
    setSelectedIds(allIds);
    persistSelections(allIds);
  }, [filteredShows, persistSelections]);

  const clearAll = useCallback(() => {
    setSelectedIds(new Set());
    persistSelections(new Set());
  }, [persistSelections]);

  // Running totals for selected shows
  const planSummary = useMemo(() => {
    const selected = shows.filter((s) => selectedIds.has(s.podcastId));
    const totalImpressions = selected.reduce((sum, s) => sum + s.audienceSize, 0);
    const totalSpend = selected.reduce((sum, s) => sum + (s.audienceSize / 1000) * s.estimatedCpm, 0);
    return {
      count: selected.length,
      totalImpressions,
      totalSpend: Math.round(totalSpend),
    };
  }, [shows, selectedIds]);

  return (
    <div className="flex h-[calc(100vh-64px)] flex-col bg-[var(--ts-paper)] text-[var(--ts-ink-on-paper)]">
      {/* ---- Brief summary bar ---- */}
      <div className="px-8 pt-6 pb-4 border-b border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)]">
        <div className="flex items-center gap-3 mb-1">
          <button
            onClick={() => router.push("/campaigns")}
            className="text-[var(--ts-ink-muted-on-paper)] hover:text-[var(--ts-ink-on-paper)] transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <h1 className="text-xl font-bold text-[var(--ts-ink-on-paper)] tracking-tight">{campaign.name}</h1>
          {isSaving && (
            <span className="text-xs text-[var(--ts-ink-muted-on-paper)] animate-pulse">Saving...</span>
          )}
        </div>
        <div className="flex items-center gap-4 text-sm text-[var(--ts-ink-muted-on-paper)]">
          {brief?.brand_url && (
            <span className="flex items-center gap-1">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
              {brief.brand_url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
            </span>
          )}
          <span className="flex items-center gap-1">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
            {formatCurrency(campaign.budget_total)} budget
          </span>
          {brief?.target_age_range && (
            <span>Ages {brief.target_age_range}</span>
          )}
          {brief && brief.target_interests.length > 0 && (
            <span>{brief.target_interests.slice(0, 3).join(", ")}</span>
          )}
          <span className="text-[var(--ts-ink-muted-on-paper)]">{shows.length} shows scored</span>
        </div>
      </div>

      {/* ---- Filters + sort ---- */}
      <div className="px-8 py-3 flex items-center gap-3 border-b border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)]">
        {/* Category pills */}
        <div className="flex-1 flex items-center gap-2 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setActiveCategory("all")}
            className={`whitespace-nowrap rounded-[var(--ts-radius)] px-3 py-1.5 text-xs font-medium transition-all ${
              activeCategory === "all"
                ? "bg-[var(--ts-ink-on-paper)] text-[var(--ts-paper)]"
                : "border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] text-[var(--ts-ink-muted-on-paper)] hover:text-[var(--ts-ink-on-paper)]"
            }`}
          >
            All shows ({shows.length})
          </button>
          {allCategories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(activeCategory === cat ? "all" : cat)}
              className={`whitespace-nowrap rounded-[var(--ts-radius)] px-3 py-1.5 text-xs font-medium capitalize transition-all ${
                activeCategory === cat
                  ? "bg-[var(--ts-ink-on-paper)] text-[var(--ts-paper)]"
                  : "border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] text-[var(--ts-ink-muted-on-paper)] hover:text-[var(--ts-ink-on-paper)]"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Sort dropdown */}
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortOption)}
          className="rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-3 py-1.5 text-xs text-[var(--ts-ink-on-paper)] focus:border-[var(--ts-accent)] focus:outline-none"
        >
          <option value="best_match">Best match</option>
          <option value="audience_size">Audience size</option>
          <option value="lowest_cpm">Lowest CPM</option>
          <option value="ad_engagement">Ad engagement</option>
        </select>

        {/* Select all / clear */}
        <div className="flex items-center gap-2 text-xs">
          <button onClick={selectAll} className="text-[var(--ts-accent)] hover:underline">
            Select all
          </button>
          <span className="text-[var(--ts-hairline-on-paper)]">|</span>
          <button onClick={clearAll} className="text-[var(--ts-ink-muted-on-paper)] hover:underline">
            Clear
          </button>
        </div>
      </div>

      {/* ---- Show list ---- */}
      <div className="flex-1 overflow-y-auto px-8 py-4">
        {filteredShows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-[var(--ts-ink-muted-on-paper)]">
            <p className="text-sm">No shows match this filter.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredShows.map((show) => (
              <ShowRow
                key={show.podcastId}
                show={show}
                isSelected={selectedIds.has(show.podcastId)}
                onToggle={() => toggleShow(show.podcastId)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ---- Plan summary bar ---- */}
      <div className="px-8 py-4 border-t border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] flex items-center gap-6">
        <div className="flex items-center gap-6 flex-1">
          <div>
            <div className="text-xs text-[var(--ts-ink-muted-on-paper)]">Selected</div>
            <div className="text-lg font-bold text-[var(--ts-ink-on-paper)]">
              {planSummary.count} <span className="text-sm font-normal text-[var(--ts-ink-muted-on-paper)]">shows</span>
            </div>
          </div>
          <div className="w-px h-8 bg-[var(--ts-hairline-on-paper)]" />
          <div>
            <div className="text-xs text-[var(--ts-ink-muted-on-paper)]">Est. Impressions</div>
            <div className="text-lg font-bold text-[var(--ts-ink-on-paper)]">{formatNumber(planSummary.totalImpressions)}</div>
          </div>
          <div className="w-px h-8 bg-[var(--ts-hairline-on-paper)]" />
          <div>
            <div className="text-xs text-[var(--ts-ink-muted-on-paper)]">Est. Spend</div>
            <div className="text-lg font-bold text-[var(--ts-ink-on-paper)]">{formatCurrency(planSummary.totalSpend)}</div>
          </div>
          {planSummary.totalSpend > campaign.budget_total && (
            <span className="text-xs font-medium text-[var(--ts-ink-on-paper)]">Over budget</span>
          )}
        </div>
        <button
          onClick={() => router.push(`/campaigns/${campaign.id}/plan`)}
          disabled={planSummary.count === 0}
          className="flex items-center gap-2 rounded-[var(--ts-radius)] bg-[var(--ts-ink-on-paper)] px-6 py-2.5 text-sm font-semibold text-[var(--ts-paper)] transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Build media plan
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ---- Show row component ----

function ShowRow({
  show,
  isSelected,
  onToggle,
}: {
  show: ScoredShowRecord;
  isSelected: boolean;
  onToggle: () => void;
}) {
  const safety = show.brandSafety ? riskBadge(show.brandSafety.maxRiskLevel) : null;

  return (
    <div
      onClick={onToggle}
      className={`flex cursor-pointer items-center gap-4 rounded-[var(--ts-radius)] border px-4 py-3.5 transition-all ${
        isSelected
          ? "border-[var(--ts-hairline-on-paper)] bg-[var(--ts-ink-on-paper)]/[0.04]"
          : "border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)]"
      }`}
    >
      {/* Checkbox */}
      <div
        className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-[var(--ts-radius)] transition-all ${
          isSelected
            ? "border border-[var(--ts-ink-on-paper)] bg-[var(--ts-ink-on-paper)]"
            : "border-2 border-[var(--ts-hairline-on-paper)]"
        }`}
      >
        {isSelected && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--ts-paper)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        )}
      </div>

      {/* Show image / initials */}
      <div className="w-10 h-10 rounded-[var(--ts-radius)] flex-shrink-0 overflow-hidden border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] flex items-center justify-center">
        {show.imageUrl ? (
          <img src={show.imageUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <span className="text-xs font-bold text-[var(--ts-ink-on-paper)]">
            {show.name.slice(0, 2).toUpperCase()}
          </span>
        )}
      </div>

      {/* Name + demographic line */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-[var(--ts-ink-on-paper)] truncate">{show.name}</span>
          {safety && (
            <span className={`text-[10px] ${safety.color}`}>{safety.text}</span>
          )}
        </div>
        <div className="text-xs text-[var(--ts-ink-muted-on-paper)] truncate mt-0.5">
          {demographicSummary(show)}
        </div>
      </div>

      {/* Sponsor count */}
      <div className="text-center w-16 flex-shrink-0">
        <div className="text-xs text-[var(--ts-ink-muted-on-paper)]">Sponsors</div>
        <div className="text-sm font-medium text-[var(--ts-ink-on-paper)]">
          {show.sponsorCount > 0 ? show.sponsorCount : "—"}
        </div>
      </div>

      {/* Audience — Podscan estimate */}
      <div className="text-center w-20 flex-shrink-0">
        <div
          className="text-xs text-[var(--ts-ink-muted-on-paper)]"
          title="Estimated from Podscan data — confirmed at outreach"
        >
          Audience · est.
        </div>
        <div className="text-sm font-medium text-[var(--ts-ink-on-paper)]">{formatNumber(show.audienceSize)}</div>
      </div>

      {/* CPM — Podscan estimate */}
      <div className="text-center w-16 flex-shrink-0">
        <div
          className="text-xs text-[var(--ts-ink-muted-on-paper)]"
          title="Estimated from Podscan data — confirmed at outreach"
        >
          CPM · est.
        </div>
        <div className="text-sm font-medium text-[var(--ts-ink-on-paper)]">${show.estimatedCpm}</div>
      </div>

      {/* Ad engagement */}
      <div className="text-center w-20 flex-shrink-0">
        <div className="text-xs text-[var(--ts-ink-muted-on-paper)]">Ad Eng.</div>
        <div className="text-sm font-medium text-[var(--ts-ink-on-paper)]">
          {show.adEngagementRate != null
            ? `${Math.round(show.adEngagementRate * 100)}%`
            : "—"}
        </div>
      </div>

      {/* Fit score badge */}
      <div className={`px-2.5 py-1 rounded-[var(--ts-radius)] text-xs font-semibold flex-shrink-0 ${fitScoreColor(show.compositeScore)}`}>
        {show.compositeScore}
      </div>
    </div>
  );
}
