"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import type { Campaign, ScoredShowRecord } from "@/lib/data/types";

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
  if (score >= 90) return "bg-[var(--brand-success)]/10 text-[var(--brand-success)]";
  if (score >= 75) return "bg-[var(--brand-blue)]/10 text-[var(--brand-blue)]";
  if (score >= 60) return "bg-[var(--brand-warning)]/10 text-[var(--brand-warning)]";
  return "bg-[var(--brand-text-muted)]/10 text-[var(--brand-text-muted)]";
}

function riskBadge(level: string): { text: string; color: string } {
  switch (level) {
    case "none": return { text: "Safe", color: "text-[var(--brand-success)]" };
    case "low": return { text: "Low risk", color: "text-[var(--brand-success)]" };
    case "medium": return { text: "Med risk", color: "text-[var(--brand-warning)]" };
    case "high": return { text: "High risk", color: "text-[var(--brand-error)]" };
    default: return { text: "Unknown", color: "text-[var(--brand-text-muted)]" };
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
    <div className="flex flex-col h-[calc(100vh-64px)]">
      {/* ---- Brief summary bar ---- */}
      <div className="px-8 pt-6 pb-4 border-b border-[var(--brand-border)] bg-[var(--brand-surface-elevated)]">
        <div className="flex items-center gap-3 mb-1">
          <button
            onClick={() => router.push("/campaigns")}
            className="text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <h1 className="text-xl font-bold text-[var(--brand-text)] tracking-tight">{campaign.name}</h1>
          {isSaving && (
            <span className="text-xs text-[var(--brand-text-muted)] animate-pulse">Saving...</span>
          )}
        </div>
        <div className="flex items-center gap-4 text-sm text-[var(--brand-text-secondary)]">
          {campaign.brief.brand_url && (
            <span className="flex items-center gap-1">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
              {campaign.brief.brand_url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
            </span>
          )}
          <span className="flex items-center gap-1">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
            {formatCurrency(campaign.budget_total)} budget
          </span>
          {campaign.brief.target_age_range && (
            <span>Ages {campaign.brief.target_age_range}</span>
          )}
          {campaign.brief.target_interests.length > 0 && (
            <span>{campaign.brief.target_interests.slice(0, 3).join(", ")}</span>
          )}
          <span className="text-[var(--brand-text-muted)]">{shows.length} shows scored</span>
        </div>
      </div>

      {/* ---- Filters + sort ---- */}
      <div className="px-8 py-3 flex items-center gap-3 border-b border-[var(--brand-border)] bg-[var(--brand-surface)]">
        {/* Category pills */}
        <div className="flex-1 flex items-center gap-2 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setActiveCategory("all")}
            className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
              activeCategory === "all"
                ? "bg-[var(--brand-blue)] text-white"
                : "bg-[var(--brand-surface-elevated)] border border-[var(--brand-border)] text-[var(--brand-text-secondary)] hover:border-[var(--brand-blue)]/40"
            }`}
          >
            All shows ({shows.length})
          </button>
          {allCategories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(activeCategory === cat ? "all" : cat)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all capitalize ${
                activeCategory === cat
                  ? "bg-[var(--brand-blue)] text-white"
                  : "bg-[var(--brand-surface-elevated)] border border-[var(--brand-border)] text-[var(--brand-text-secondary)] hover:border-[var(--brand-blue)]/40"
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
          className="px-3 py-1.5 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-xs text-[var(--brand-text-secondary)] focus:outline-none focus:ring-1 focus:ring-[var(--brand-blue)]/30"
        >
          <option value="best_match">Best match</option>
          <option value="audience_size">Audience size</option>
          <option value="lowest_cpm">Lowest CPM</option>
          <option value="ad_engagement">Ad engagement</option>
        </select>

        {/* Select all / clear */}
        <div className="flex items-center gap-2 text-xs">
          <button onClick={selectAll} className="text-[var(--brand-blue)] hover:underline">
            Select all
          </button>
          <span className="text-[var(--brand-border)]">|</span>
          <button onClick={clearAll} className="text-[var(--brand-text-muted)] hover:underline">
            Clear
          </button>
        </div>
      </div>

      {/* ---- Show list ---- */}
      <div className="flex-1 overflow-y-auto px-8 py-4">
        {filteredShows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-[var(--brand-text-muted)]">
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
      <div className="px-8 py-4 border-t border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] flex items-center gap-6">
        <div className="flex items-center gap-6 flex-1">
          <div>
            <div className="text-xs text-[var(--brand-text-muted)]">Selected</div>
            <div className="text-lg font-bold text-[var(--brand-text)]">
              {planSummary.count} <span className="text-sm font-normal text-[var(--brand-text-secondary)]">shows</span>
            </div>
          </div>
          <div className="w-px h-8 bg-[var(--brand-border)]" />
          <div>
            <div className="text-xs text-[var(--brand-text-muted)]">Est. Impressions</div>
            <div className="text-lg font-bold text-[var(--brand-text)]">{formatNumber(planSummary.totalImpressions)}</div>
          </div>
          <div className="w-px h-8 bg-[var(--brand-border)]" />
          <div>
            <div className="text-xs text-[var(--brand-text-muted)]">Est. Spend</div>
            <div className="text-lg font-bold text-[var(--brand-text)]">{formatCurrency(planSummary.totalSpend)}</div>
          </div>
          {planSummary.totalSpend > campaign.budget_total && (
            <span className="text-xs text-[var(--brand-warning)] font-medium">Over budget</span>
          )}
        </div>
        <button
          onClick={() => router.push(`/campaigns/${campaign.id}/plan`)}
          disabled={planSummary.count === 0}
          className="px-6 py-2.5 rounded-xl bg-[var(--brand-blue)] hover:bg-[var(--brand-blue-light)] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold transition-all flex items-center gap-2"
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
      className={`flex items-center gap-4 px-4 py-3.5 rounded-xl border cursor-pointer transition-all ${
        isSelected
          ? "border-[var(--brand-blue)]/50 bg-[var(--brand-blue)]/[0.03]"
          : "border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] hover:border-[var(--brand-blue)]/30"
      }`}
    >
      {/* Checkbox */}
      <div
        className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 transition-all ${
          isSelected
            ? "bg-[var(--brand-blue)] border-[var(--brand-blue)]"
            : "border-2 border-[var(--brand-border)]"
        }`}
      >
        {isSelected && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        )}
      </div>

      {/* Show image / initials */}
      <div className="w-10 h-10 rounded-lg flex-shrink-0 overflow-hidden bg-gradient-to-br from-[var(--brand-blue)]/20 to-[var(--brand-teal)]/20 flex items-center justify-center">
        {show.imageUrl ? (
          <img src={show.imageUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <span className="text-xs font-bold text-[var(--brand-blue)]">
            {show.name.slice(0, 2).toUpperCase()}
          </span>
        )}
      </div>

      {/* Name + demographic line */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-[var(--brand-text)] truncate">{show.name}</span>
          {safety && (
            <span className={`text-[10px] ${safety.color}`}>{safety.text}</span>
          )}
        </div>
        <div className="text-xs text-[var(--brand-text-muted)] truncate mt-0.5">
          {demographicSummary(show)}
        </div>
      </div>

      {/* Sponsor count */}
      <div className="text-center w-16 flex-shrink-0">
        <div className="text-xs text-[var(--brand-text-muted)]">Sponsors</div>
        <div className="text-sm font-medium text-[var(--brand-text)]">
          {show.sponsorCount > 0 ? show.sponsorCount : "—"}
        </div>
      </div>

      {/* Audience */}
      <div className="text-center w-20 flex-shrink-0">
        <div className="text-xs text-[var(--brand-text-muted)]">Audience</div>
        <div className="text-sm font-medium text-[var(--brand-text)]">{formatNumber(show.audienceSize)}</div>
      </div>

      {/* CPM */}
      <div className="text-center w-16 flex-shrink-0">
        <div className="text-xs text-[var(--brand-text-muted)]">CPM</div>
        <div className="text-sm font-medium text-[var(--brand-text)]">${show.estimatedCpm}</div>
      </div>

      {/* Ad engagement */}
      <div className="text-center w-20 flex-shrink-0">
        <div className="text-xs text-[var(--brand-text-muted)]">Ad Eng.</div>
        <div className="text-sm font-medium text-[var(--brand-text)]">
          {show.adEngagementRate != null
            ? `${Math.round(show.adEngagementRate * 100)}%`
            : "—"}
        </div>
      </div>

      {/* Fit score badge */}
      <div className={`px-2.5 py-1 rounded-full text-xs font-semibold flex-shrink-0 ${fitScoreColor(show.compositeScore)}`}>
        {show.compositeScore}
      </div>
    </div>
  );
}
