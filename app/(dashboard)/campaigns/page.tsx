"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import type { Campaign, CampaignStatus } from "@/lib/data/types";

const statusStyles: Record<CampaignStatus, string> = {
  draft: "bg-[var(--brand-text-muted)]/10 text-[var(--brand-text-muted)]",
  planned: "bg-[var(--brand-blue)]/10 text-[var(--brand-blue)]",
  active: "bg-[var(--brand-success)]/10 text-[var(--brand-success)]",
  completed: "bg-[var(--brand-teal)]/10 text-[var(--brand-teal)]",
  archived: "bg-[var(--brand-text-muted)]/10 text-[var(--brand-text-muted)]",
};

export default function CampaignsPage() {
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
      <div className="p-8 max-w-5xl">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-[var(--brand-text)] tracking-tight">Campaigns</h1>
            <p className="text-sm text-[var(--brand-text-secondary)] mt-1">Plan and manage your podcast and YouTube sponsorship campaigns.</p>
          </div>
        </div>
        <div className="flex items-center justify-center py-24">
          <div className="w-8 h-8 border-3 border-[var(--brand-blue)]/20 border-t-[var(--brand-blue)] rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-[var(--brand-text)] tracking-tight">Campaigns</h1>
          <p className="text-sm text-[var(--brand-text-secondary)] mt-1">
            Plan and manage your podcast and YouTube sponsorship campaigns.
          </p>
        </div>
        <Link href="/campaigns/new" className="inline-flex items-center gap-2 bg-[var(--brand-blue)] hover:bg-[var(--brand-blue-light)] text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          New Campaign
        </Link>
      </div>

      {campaigns.length > 0 ? (
        <div className="space-y-3">
          {campaigns.map((campaign) => {
            const recs = Array.isArray(campaign.recommendations) ? campaign.recommendations : [];
            const ytRecs = Array.isArray(campaign.youtube_recommendations) ? campaign.youtube_recommendations : [];
            const totalShows = recs.length + ytRecs.length;

            return (
              <Link
                key={campaign.id}
                href={`/campaigns/${campaign.id}`}
                className="flex items-center justify-between p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)] hover:border-[var(--brand-blue)]/30 hover:shadow-sm transition-all group"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--brand-blue)]/10 to-[var(--brand-teal)]/10 flex items-center justify-center">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--brand-blue)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
                      <line x1="4" x2="4" y1="22" y2="15" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-[var(--brand-text)] group-hover:text-[var(--brand-blue)] transition-colors">
                      {campaign.name}
                    </h3>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-xs text-[var(--brand-text-muted)]">
                        {new Date(campaign.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </span>
                      <span className="text-xs text-[var(--brand-text-muted)]">{(campaign.platforms ?? []).join(" + ")}</span>
                      <span className="text-xs text-[var(--brand-text-muted)]">{totalShows} shows</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-5">
                  <div className="text-right">
                    <div className="text-sm font-semibold text-[var(--brand-text)]">${(campaign.budget_total ?? 0).toLocaleString()}</div>
                    <div className="text-xs text-[var(--brand-text-muted)]">budget</div>
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-medium capitalize ${statusStyles[campaign.status] ?? statusStyles.draft}`}>
                    {campaign.status}
                  </span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--brand-text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-0 group-hover:opacity-100 transition-opacity">
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-24 bg-[var(--brand-surface-elevated)] rounded-2xl border border-[var(--brand-border)] border-dashed">
          <div className="w-16 h-16 rounded-2xl bg-[var(--brand-blue)]/[0.06] flex items-center justify-center mb-5">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--brand-blue)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
              <line x1="4" x2="4" y1="22" y2="15" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-[var(--brand-text)] mb-2">No campaigns yet</h3>
          <p className="text-sm text-[var(--brand-text-muted)] mb-6 max-w-sm text-center">
            Create your first campaign to discover the best podcast and YouTube sponsorship opportunities for your brand.
          </p>
          <Link href="/campaigns/new" className="inline-flex items-center gap-2 bg-[var(--brand-blue)] hover:bg-[var(--brand-blue-light)] text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Create your first campaign
          </Link>
        </div>
      )}
    </div>
  );
}
