"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import type { Campaign, CampaignStatus } from "@/lib/data/types";
import { tokens } from "@/lib/brand/tokens";

type BadgeTone = "ink" | "muted" | "accent";

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
  accent: "var(--ts-accent)",
};

const cardClass =
  "border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)]";
const inkBtnClass =
  "inline-flex items-center gap-2 bg-[var(--ts-ink-on-paper)] px-4 py-2.5 text-sm font-medium text-[var(--ts-paper)] hover:opacity-90";
const mutedText = "text-[var(--ts-ink-muted-on-paper)]";
const pulseClass = "animate-pulse bg-[var(--ts-ink-on-paper)]/10";

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

export default function CampaignsClient() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/campaigns")
      .then((res) => res.json())
      .then((data) => setCampaigns(data.campaigns ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

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
    <div className="p-4 sm:p-8">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 w-full sm:w-auto">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ts-accent)]">
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
        <div
          className={`${cardClass} divide-y divide-[var(--ts-hairline-on-paper)]`}
          style={{ borderRadius: tokens.radius }}
        >
          {campaigns.map((campaign) => {
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
                  <span
                    className="flex-shrink-0 border border-[var(--ts-hairline-on-paper)] px-2 py-0.5 text-[10px] font-semibold"
                    style={{
                      borderRadius: tokens.radius,
                      color: badgeColor[badge.tone],
                    }}
                  >
                    {badge.label}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div
          className={`${cardClass} px-6 py-16 text-center`}
          style={{ borderRadius: tokens.radius }}
        >
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
      )}
    </div>
  );
}
