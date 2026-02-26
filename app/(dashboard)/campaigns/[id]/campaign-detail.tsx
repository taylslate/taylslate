"use client";

import { useState } from "react";
import Link from "next/link";
import type { Campaign } from "@/lib/data";

type Tab = "plan" | "outreach" | "adcopy";

export default function CampaignDetail({ campaign }: { campaign: Campaign }) {
  const recommendations = campaign.recommendations;
  const [activeTab, setActiveTab] = useState<Tab>("plan");
  const [selectedShows, setSelectedShows] = useState<string[]>(
    recommendations.map((r) => r.show_id)
  );

  const selected = recommendations.filter((r) => selectedShows.includes(r.show_id));
  const totalAllocated = selected.reduce((sum, r) => sum + r.allocated_budget, 0);
  const totalImpressions = selected.reduce((sum, r) => sum + r.estimated_impressions, 0);
  const avgCpm = selected.length > 0
    ? selected.reduce((sum, r) => sum + r.estimated_cpm, 0) / selected.length
    : 0;

  const toggleShow = (id: string) => {
    setSelectedShows((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  };

  return (
    <div className="p-8 max-w-6xl">
      <div className="flex items-start justify-between mb-6">
        <div>
          <Link href="/campaigns" className="flex items-center gap-1.5 text-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors mb-3">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
            All Campaigns
          </Link>
          <h1 className="text-2xl font-bold text-[var(--brand-text)] tracking-tight">{campaign.name}</h1>
          <p className="text-sm text-[var(--brand-text-secondary)] mt-1">
            ${campaign.budget_total.toLocaleString()} budget · {recommendations.length} shows recommended
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button className="px-4 py-2 rounded-lg border border-[var(--brand-border)] text-sm font-medium text-[var(--brand-text-secondary)] hover:bg-[var(--brand-surface)] transition-colors">Export CSV</button>
          <button className="px-4 py-2 rounded-lg bg-[var(--brand-blue)] hover:bg-[var(--brand-blue-light)] text-white text-sm font-medium transition-colors">Save Plan</button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-8">
        <div className="p-4 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)]">
          <div className="text-xs text-[var(--brand-text-muted)] font-medium uppercase tracking-wider mb-1">Budget Allocated</div>
          <div className="text-xl font-bold text-[var(--brand-text)]">${totalAllocated.toLocaleString()}</div>
          <div className="text-xs text-[var(--brand-text-muted)] mt-0.5">of ${campaign.budget_total.toLocaleString()}</div>
        </div>
        <div className="p-4 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)]">
          <div className="text-xs text-[var(--brand-text-muted)] font-medium uppercase tracking-wider mb-1">Est. Impressions</div>
          <div className="text-xl font-bold text-[var(--brand-text)]">{(totalImpressions / 1000).toFixed(0)}K</div>
          <div className="text-xs text-[var(--brand-text-muted)] mt-0.5">total reach</div>
        </div>
        <div className="p-4 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)]">
          <div className="text-xs text-[var(--brand-text-muted)] font-medium uppercase tracking-wider mb-1">Shows Selected</div>
          <div className="text-xl font-bold text-[var(--brand-text)]">{selectedShows.length}</div>
          <div className="text-xs text-[var(--brand-text-muted)] mt-0.5">of {recommendations.length} recommended</div>
        </div>
        <div className="p-4 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)]">
          <div className="text-xs text-[var(--brand-text-muted)] font-medium uppercase tracking-wider mb-1">Avg. CPM</div>
          <div className="text-xl font-bold text-[var(--brand-text)]">${avgCpm.toFixed(0)}</div>
          <div className="text-xs text-[var(--brand-text-muted)] mt-0.5">across selected shows</div>
        </div>
      </div>

      <div className="flex gap-1 mb-6 bg-[var(--brand-surface-elevated)] p-1 rounded-xl border border-[var(--brand-border)] w-fit">
        {[
          { id: "plan" as Tab, label: "Media Plan" },
          { id: "outreach" as Tab, label: "Outreach Emails" },
          { id: "adcopy" as Tab, label: "Ad Copy" },
        ].map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              activeTab === tab.id
                ? "bg-[var(--brand-blue)] text-white shadow-sm"
                : "text-[var(--brand-text-secondary)] hover:text-[var(--brand-text)]"
            }`}>
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "plan" && (
        <div className="space-y-3">
          {recommendations.map((show, index) => {
            const isSelected = selectedShows.includes(show.show_id);
            return (
              <div key={show.show_id} className={`p-5 bg-[var(--brand-surface-elevated)] rounded-xl border transition-all ${
                isSelected ? "border-[var(--brand-blue)]/20" : "border-[var(--brand-border)] opacity-50"
              }`}>
                <div className="flex items-start gap-4">
                  <button onClick={() => toggleShow(show.show_id)}
                    className={`mt-1 w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                      isSelected ? "bg-[var(--brand-blue)] border-[var(--brand-blue)]" : "border-[var(--brand-border)]"
                    }`}>
                    {isSelected && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    )}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[var(--brand-blue)]/10 text-xs font-bold text-[var(--brand-blue)]">{index + 1}</span>
                      <h3 className="font-semibold text-[var(--brand-text)]">{show.show_name}</h3>
                      {show.network && (
                        <span className="text-xs text-[var(--brand-text-muted)] bg-[var(--brand-surface)] px-2 py-0.5 rounded">{show.network}</span>
                      )}
                      <span className={`ml-auto text-xs font-semibold px-2 py-0.5 rounded-full ${
                        show.fit_score >= 90 ? "bg-[var(--brand-success)]/10 text-[var(--brand-success)]"
                          : show.fit_score >= 80 ? "bg-[var(--brand-blue)]/10 text-[var(--brand-blue)]"
                          : "bg-[var(--brand-warning)]/10 text-[var(--brand-warning)]"
                      }`}>{show.fit_score}% fit</span>
                    </div>
                    <div className="flex items-center gap-2 mb-3">
                      {show.categories.map((cat) => (
                        <span key={cat} className="text-xs text-[var(--brand-text-muted)] bg-[var(--brand-surface)] px-2 py-0.5 rounded">{cat}</span>
                      ))}
                    </div>
                    <div className="flex items-center gap-6 text-sm">
                      <div><span className="text-[var(--brand-text-muted)]">Audience: </span><span className="font-medium text-[var(--brand-text)]">{(show.audience_size / 1000).toFixed(0)}K</span></div>
                      <div><span className="text-[var(--brand-text-muted)]">CPM: </span><span className="font-medium text-[var(--brand-text)]">${show.estimated_cpm}</span></div>
                      <div><span className="text-[var(--brand-text-muted)]">Episodes: </span><span className="font-medium text-[var(--brand-text)]">{show.num_episodes}x {show.placement}</span></div>
                      <div><span className="text-[var(--brand-text-muted)]">Allocation: </span><span className="font-semibold text-[var(--brand-blue)]">${show.allocated_budget.toLocaleString()}</span></div>
                    </div>
                    <div className="flex items-center gap-2 mt-3">
                      <span className="text-xs text-[var(--brand-text-muted)]">Also sponsors:</span>
                      {show.current_sponsors.map((sponsor) => (
                        <span key={sponsor} className="text-xs bg-[var(--brand-orange)]/[0.08] text-[var(--brand-orange)] px-2 py-0.5 rounded font-medium">{sponsor}</span>
                      ))}
                    </div>
                    {show.overlap_flag && (
                      <div className="flex items-center gap-2 mt-3 px-3 py-2 bg-[var(--brand-warning)]/[0.06] rounded-lg border border-[var(--brand-warning)]/20">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--brand-warning)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                          <line x1="12" x2="12" y1="9" y2="13" /><line x1="12" x2="12.01" y1="17" y2="17" />
                        </svg>
                        <span className="text-xs text-[var(--brand-warning)] font-medium">
                          Likely audience overlap with {show.overlap_with.join(", ")}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {activeTab === "outreach" && (
        <div className="space-y-4">
          {recommendations.map((show) => (
            <div key={show.show_id} className="p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)]">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-[var(--brand-text)]">{show.show_name}</h3>
                  <span className="text-xs text-[var(--brand-text-muted)]">{show.contact_email}</span>
                </div>
                <button className="text-xs text-[var(--brand-blue)] hover:underline font-medium">Copy email</button>
              </div>
              <div className="bg-[var(--brand-surface)] rounded-lg p-4 text-sm text-[var(--brand-text-secondary)] leading-relaxed">
                <p className="font-medium text-[var(--brand-text)] mb-2">Subject: Partnership Opportunity — [Your Brand] x {show.show_name}</p>
                <p className="mb-2">Hi {show.show_name} team,</p>
                <p className="mb-2">
                  I&apos;m reaching out from [Your Brand] — we&apos;re a fitness and wellness company looking to connect with your audience.
                  Your show&apos;s focus on {show.categories[0].toLowerCase()} aligns perfectly with our target customer.
                </p>
                <p className="mb-2">
                  We&apos;re planning a {show.num_episodes}-episode {show.placement} campaign and have allocated ${show.allocated_budget.toLocaleString()} for this partnership.
                  Would love to discuss availability and rates.
                </p>
                <p className="text-[var(--brand-text-muted)] italic mt-3 text-xs">AI-generated draft — review and personalize before sending.</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === "adcopy" && (
        <div className="space-y-4">
          {recommendations.map((show) => (
            <div key={show.show_id} className="p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)]">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <h3 className="font-semibold text-[var(--brand-text)]">{show.show_name}</h3>
                  <span className="text-xs bg-[var(--brand-surface)] px-2 py-0.5 rounded text-[var(--brand-text-muted)]">~60 seconds</span>
                </div>
                <button className="text-xs text-[var(--brand-blue)] hover:underline font-medium">Copy script</button>
              </div>
              <div className="bg-[var(--brand-surface)] rounded-lg p-4 text-sm text-[var(--brand-text-secondary)] leading-relaxed">
                <p>
                  &quot;You know I&apos;m always talking about what keeps me performing at my best, and that&apos;s why I&apos;m excited to partner with [Your Brand].
                  Their [product] is the real deal — clean ingredients, no junk, and it actually tastes good. I&apos;ve been using it for [timeframe] and the difference
                  in my [benefit] has been noticeable. Head to [URL] and use code {show.show_name.toUpperCase().replace(/\s/g, "")} for 15% off your first order.
                  That&apos;s [URL], code {show.show_name.toUpperCase().replace(/\s/g, "")}.&quot;
                </p>
                <p className="text-[var(--brand-text-muted)] italic mt-3 text-xs">AI-generated draft — customize with your brand details and the host&apos;s voice.</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
