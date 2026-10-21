"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import type { Campaign, CampaignStatus } from "@/lib/data/types";
import { tokens } from "@/lib/brand/tokens";

type BadgeTone = "ink" | "muted" | "accent";
type StatusFilter = "all" | CampaignStatus;
type SortKey = "newest" | "oldest" | "name" | "budget";

const statusBadge: Record<CampaignStatus, { tone: BadgeTone; label: string }> = {
  draft: { tone: "muted", label: "Draft" },
  planned: { tone: "ink", label: "Planned" },
  active: { tone: "accent", label: "Active" },
  completed: { tone: "muted", label: "Completed" },
  archived: { tone: "muted", label: "Archived" },
};

const badgeColor: Record<BadgeTone, string> = {
  ink: "var(--ts-ink-on-paper)",
  muted: "var(--ts-ink-muted-on-paper)",
  accent: "var(--ts-accent-text)",
};

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "draft", label: "Drafts" },
  { value: "planned", label: "Planned only" },
  { value: "active", label: "Active only" },
  { value: "completed", label: "Completed only" },
  { value: "archived", label: "Archived only" },
];

const cardClass =
  "border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)]";
const inkBtnClass =
  "inline-flex items-center gap-2 bg-[var(--ts-accent)] px-4 py-2.5 text-sm font-medium text-[var(--ts-accent-foreground)] hover:opacity-90";
const mutedText = "text-[var(--ts-ink-muted-on-paper)]";
const pulseClass = "animate-pulse bg-[var(--ts-ink-on-paper)]/10";
const fieldClass =
  "border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-3 py-2 text-sm text-[var(--ts-ink-on-paper)]";

function fmtDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function statusFor(status: string): { tone: BadgeTone; label: string } {
  if (status in statusBadge) return statusBadge[status as CampaignStatus];
  return { tone: "muted", label: status };
}

function badgeClass(status: string): string {
  const base = "flex-shrink-0 border px-2 py-0.5 text-[10px] font-semibold";
  if (status === "draft") {
    return `${base} border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)]`;
  }
  if (status === "planned") {
    return `${base} border-[var(--ts-ink-on-paper)] bg-[var(--ts-ink-on-paper)]`;
  }
  return `${base} border-[var(--ts-hairline-on-paper)]`;
}

function badgeStyle(status: string): React.CSSProperties {
  if (status === "planned") {
    return {
      borderRadius: tokens.radius,
      color: "var(--ts-paper)",
      backgroundColor: "var(--ts-ink-on-paper)",
    };
  }
  const badge = statusFor(status);
  return {
    borderRadius: tokens.radius,
    color: badgeColor[badge.tone],
    backgroundColor: status === "draft" ? "transparent" : undefined,
  };
}

export default function CampaignsClient({
  initialCampaigns,
}: {
  initialCampaigns?: Campaign[];
}) {
  const [campaigns, setCampaigns] = useState<Campaign[]>(initialCampaigns ?? []);
  const [loading, setLoading] = useState(initialCampaigns === undefined);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<SortKey>("newest");

  useEffect(() => {
    if (initialCampaigns !== undefined) return;
    fetch("/api/campaigns")
      .then((res) => res.json())
      .then((data) => setCampaigns(data.campaigns ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [initialCampaigns]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    const rows = campaigns.filter((campaign) => {
      if (status !== "all" && campaign.status !== status) return false;
      if (query && !campaign.name.toLowerCase().includes(query)) return false;
      return true;
    });
    const sorted = [...rows];
    sorted.sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "budget") return (b.budget_total ?? 0) - (a.budget_total ?? 0);
      const aTime = new Date(a.created_at).getTime();
      const bTime = new Date(b.created_at).getTime();
      return sort === "oldest" ? aTime - bTime : bTime - aTime;
    });
    return sorted;
  }, [campaigns, search, status, sort]);

  if (loading) {
    return (
      <div className="p-4 sm:p-8">
        <div className="mb-8">
          <div className={`mb-2 h-3 w-20 ${pulseClass}`} style={{ borderRadius: tokens.radius }} />
          <div className={`mb-2 h-7 w-40 ${pulseClass}`} style={{ borderRadius: tokens.radius }} />
          <div className={`h-4 w-72 ${pulseClass}`} style={{ borderRadius: tokens.radius }} />
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className={`h-16 ${cardClass} ${pulseClass}`}
              style={{ borderRadius: tokens.radius }}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full p-4 sm:p-8">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 w-full sm:w-auto">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ts-accent-text)]">
            For brands
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">Campaigns</h1>
          <p className={`mt-1 text-sm ${mutedText}`}>
            Briefs you&apos;ve opened and the shows you&apos;re testing.
          </p>
        </div>
        <Link
          href="/campaigns/new"
          className={`${inkBtnClass} sm:shrink-0`}
          style={{ borderRadius: tokens.radius }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          New Campaign
        </Link>
      </div>

      {campaigns.length > 0 ? (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="campaign-search">Search campaigns</label>
            <input
              id="campaign-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search campaigns"
              className={`${fieldClass} min-w-[12rem] flex-1`}
              style={{ borderRadius: tokens.radius }}
            />
            <label className="sr-only" htmlFor="campaign-status">Filter by status</label>
            <select
              id="campaign-status"
              value={status}
              onChange={(event) => setStatus(event.target.value as StatusFilter)}
              className={fieldClass}
              style={{ borderRadius: tokens.radius }}
            >
              {STATUS_FILTERS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <label className="sr-only" htmlFor="campaign-sort">Sort campaigns</label>
            <select
              id="campaign-sort"
              value={sort}
              onChange={(event) => setSort(event.target.value as SortKey)}
              className={fieldClass}
              style={{ borderRadius: tokens.radius }}
            >
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="name">Name</option>
              <option value="budget">Budget</option>
            </select>
          </div>

          {visible.length > 0 ? (
            <div
              className={`${cardClass} divide-y divide-[var(--ts-hairline-on-paper)]`}
              style={{ borderRadius: tokens.radius }}
            >
              {visible.map((campaign) => {
                const recs = Array.isArray(campaign.recommendations) ? campaign.recommendations : [];
                const ytRecs = Array.isArray(campaign.youtube_recommendations) ? campaign.youtube_recommendations : [];
                const totalShows = recs.length + ytRecs.length;
                const platforms = (campaign.platforms ?? []).join(" + ");
                const meta = [
                  fmtDate(campaign.created_at),
                  platforms,
                  `${totalShows} shows`,
                ].filter(Boolean).join(" · ");
                const badge = statusFor(campaign.status);

                return (
                  <Link
                    key={campaign.id}
                    href={`/campaigns/${campaign.id}`}
                    className="flex flex-col gap-2 px-4 py-4 hover:bg-[var(--ts-band-shows)] sm:flex-row sm:items-center sm:gap-4 sm:px-5"
                  >
                    <div className="min-w-0 sm:flex-1">
                      <div className="truncate text-sm font-medium">{campaign.name}</div>
                      <div className={`text-xs break-words ${mutedText}`}>{meta}</div>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-3 sm:contents">
                      <div className="sm:text-right">
                        <div className="text-sm font-medium">
                          ${(campaign.budget_total ?? 0).toLocaleString()}
                        </div>
                        <div className={`text-xs ${mutedText}`}>budget</div>
                      </div>
                      <span className={badgeClass(campaign.status)} style={badgeStyle(campaign.status)}>
                        {badge.label}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className={`${cardClass} px-6 py-10 text-center`} style={{ borderRadius: tokens.radius }}>
              <p className="text-sm font-medium">No campaigns match</p>
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setStatus("all");
                  setSort("newest");
                }}
                className={`${inkBtnClass} mt-4`}
                style={{ borderRadius: tokens.radius }}
              >
                Clear filters
              </button>
            </div>
          )}
        </>
      ) : (
        <div className={cardClass} style={{ borderRadius: tokens.radius }}>
          <div aria-hidden="true" className="pointer-events-none divide-y divide-[var(--ts-hairline-on-paper)] opacity-40">
            <PreviewRow name="Spring test" meta="Mar 2, 2026 · podcast · 6 shows" budget="$25,000" badge="Planned" />
            <PreviewRow name="Follow-up flight" meta="Apr 1, 2026 · podcast + youtube · 4 shows" budget="$12,000" badge="Active" />
          </div>
          <div className="border-t border-[var(--ts-hairline-on-paper)] px-6 py-10 text-center">
            <h2 className="text-lg font-semibold">No campaigns yet</h2>
            <p className={`mx-auto mt-2 max-w-sm text-sm ${mutedText}`}>
              Tell us what you sell. We come back with a short list of shows worth testing.
            </p>
            <Link
              href="/campaigns/new"
              className={`${inkBtnClass} mt-6`}
              style={{ borderRadius: tokens.radius }}
            >
              New campaign
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function PreviewRow({
  name,
  meta,
  budget,
  badge,
}: {
  name: string;
  meta: string;
  budget: string;
  badge: string;
}) {
  return (
    <div className="flex items-center gap-4 px-5 py-4">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{name}</div>
        <div className={`text-xs ${mutedText}`}>{meta}</div>
      </div>
      <div className="text-sm font-medium">{budget}</div>
      <span className="border border-[var(--ts-hairline-on-paper)] px-2 py-0.5 text-[10px] font-semibold">{badge}</span>
    </div>
  );
}
