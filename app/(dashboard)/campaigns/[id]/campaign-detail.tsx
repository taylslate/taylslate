"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Campaign, OutreachDraft } from "@/lib/data";

function ShowAvatar({ name, imageUrl }: { name: string; imageUrl?: string }) {
  const [imgError, setImgError] = useState(false);

  if (imageUrl && !imgError) {
    return (
      <img
        src={imageUrl}
        alt={name}
        className="w-12 h-12 rounded-lg object-cover flex-shrink-0"
        onError={() => setImgError(true)}
      />
    );
  }

  return (
    <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-[var(--brand-blue)]/20 to-[var(--brand-teal)]/20 flex items-center justify-center flex-shrink-0">
      <span className="text-sm font-bold text-[var(--brand-blue)]">{name?.charAt(0) ?? "?"}</span>
    </div>
  );
}

type Tab = "plan" | "outreach" | "adcopy";

export default function CampaignDetail({ campaign }: { campaign: Campaign }) {
  const router = useRouter();
  const recommendations = campaign.recommendations;
  const youtubeRecs = campaign.youtube_recommendations ?? [];
  const expansions = campaign.expansion_opportunities ?? [];
  const allShowIds = [...recommendations.map((r) => r.show_id), ...youtubeRecs.map((r) => r.show_id)];
  const [activeTab, setActiveTab] = useState<Tab>("plan");
  const [selectedShows, setSelectedShows] = useState<string[]>(allShowIds);

  // Outreach state
  const [outreachDrafts, setOutreachDrafts] = useState<OutreachDraft[]>([]);
  const [isGeneratingOutreach, setIsGeneratingOutreach] = useState(false);
  const [outreachError, setOutreachError] = useState<string | null>(null);
  const [sendStatus, setSendStatus] = useState<Record<string, "sending" | "sent" | "failed">>({});
  const [isSendingAll, setIsSendingAll] = useState(false);

  // Deal creation state
  const [isCreatingDeals, setIsCreatingDeals] = useState(false);
  const [dealsCreated, setDealsCreated] = useState(false);
  const [dealsError, setDealsError] = useState<string | null>(null);
  const [dealsCount, setDealsCount] = useState(0);

  const selectedPodcasts = recommendations.filter((r) => selectedShows.includes(r.show_id));
  const selectedYouTube = youtubeRecs.filter((r) => selectedShows.includes(r.show_id));
  const totalAllocated = selectedPodcasts.reduce((sum, r) => sum + r.allocated_budget, 0)
    + selectedYouTube.reduce((sum, r) => sum + r.allocated_budget, 0);
  const totalImpressions = selectedPodcasts.reduce((sum, r) => sum + r.estimated_impressions, 0)
    + selectedYouTube.reduce((sum, r) => sum + r.estimated_views, 0);
  const avgCpm = selectedPodcasts.length > 0
    ? selectedPodcasts.reduce((sum, r) => sum + r.estimated_cpm, 0) / selectedPodcasts.length
    : 0;
  const totalShowCount = selectedPodcasts.length + selectedYouTube.length;

  const toggleShow = (id: string) => {
    setSelectedShows((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  };

  const handleApproveAndDraft = async () => {
    setIsGeneratingOutreach(true);
    setOutreachError(null);
    try {
      const res = await fetch("/api/campaigns/outreach/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaign }),
      });
      const data = await res.json();
      if (!res.ok) {
        setOutreachError(data.error || "Failed to generate outreach emails");
        return;
      }
      setOutreachDrafts(data.drafts);
      setActiveTab("outreach");
    } catch {
      setOutreachError("Network error. Please try again.");
    } finally {
      setIsGeneratingOutreach(false);
    }
  };

  const handleCreateDeals = async () => {
    setIsCreatingDeals(true);
    setDealsError(null);
    try {
      const selectedPodcastRecs = recommendations.filter((r) => selectedShows.includes(r.show_id));
      const selectedYouTubeRecs = youtubeRecs.filter((r) => selectedShows.includes(r.show_id));

      const res = await fetch("/api/campaigns/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaign_id: campaign.id,
          campaign_name: campaign.name,
          brand_id: campaign.user_id,
          recommendations: selectedPodcastRecs,
          youtube_recommendations: selectedYouTubeRecs,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setDealsError(data.error || "Failed to create deals");
        return;
      }
      if (data.created > 0) {
        setDealsCreated(true);
        setDealsCount(data.created);
        if (data.failed > 0) {
          setDealsError(`${data.failed} show(s) failed to create deals. ${data.errors?.join(', ') || ''}`);
        }
        setTimeout(() => router.push("/deals"), 1500);
      } else {
        setDealsError("No deals were created");
      }
    } catch {
      setDealsError("Network error. Please try again.");
    } finally {
      setIsCreatingDeals(false);
    }
  };

  const updateDraft = (showId: string, field: "subject" | "body", value: string) => {
    setOutreachDrafts((prev) =>
      prev.map((d) => (d.show_id === showId ? { ...d, [field]: value } : d))
    );
  };

  const sendSingleEmail = async (draft: OutreachDraft) => {
    setSendStatus((prev) => ({ ...prev, [draft.show_id]: "sending" }));
    try {
      const res = await fetch("/api/campaigns/outreach/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ drafts: [draft] }),
      });
      const data = await res.json();
      if (!res.ok || !data.results?.[0]?.success) {
        setSendStatus((prev) => ({ ...prev, [draft.show_id]: "failed" }));
        return;
      }
      setSendStatus((prev) => ({ ...prev, [draft.show_id]: "sent" }));
      setOutreachDrafts((prev) =>
        prev.map((d) => (d.show_id === draft.show_id ? { ...d, sent: true } : d))
      );
    } catch {
      setSendStatus((prev) => ({ ...prev, [draft.show_id]: "failed" }));
    }
  };

  const sendAllEmails = async () => {
    const unsent = outreachDrafts.filter((d) => !d.sent);
    if (unsent.length === 0) return;
    setIsSendingAll(true);
    for (const d of unsent) {
      setSendStatus((prev) => ({ ...prev, [d.show_id]: "sending" }));
    }
    try {
      const res = await fetch("/api/campaigns/outreach/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ drafts: unsent }),
      });
      const data = await res.json();
      if (data.results) {
        const newStatus: Record<string, "sent" | "failed"> = {};
        const sentIds: string[] = [];
        for (const result of data.results) {
          newStatus[result.show_id] = result.success ? "sent" : "failed";
          if (result.success) sentIds.push(result.show_id);
        }
        setSendStatus((prev) => ({ ...prev, ...newStatus }));
        setOutreachDrafts((prev) =>
          prev.map((d) => (sentIds.includes(d.show_id) ? { ...d, sent: true } : d))
        );
      }
    } catch {
      for (const d of unsent) {
        setSendStatus((prev) => ({ ...prev, [d.show_id]: "failed" }));
      }
    } finally {
      setIsSendingAll(false);
    }
  };

  const unsentCount = outreachDrafts.filter((d) => !d.sent).length;

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
            ${campaign.budget_total.toLocaleString()} budget · {allShowIds.length} shows recommended
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button className="px-4 py-2 rounded-lg border border-[var(--brand-border)] text-sm font-medium text-[var(--brand-text-secondary)] hover:bg-[var(--brand-surface)] transition-colors">Export CSV</button>
          {dealsCreated ? (
            <button
              onClick={() => router.push("/deals")}
              className="px-4 py-2 rounded-lg bg-[var(--brand-success)] text-white text-sm font-medium transition-colors flex items-center gap-2"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              {dealsCount} Deals Created — View Pipeline
            </button>
          ) : (
            <button
              onClick={handleCreateDeals}
              disabled={isCreatingDeals || totalShowCount === 0}
              className="px-4 py-2 rounded-lg bg-[var(--brand-teal)] hover:bg-[var(--brand-teal-light)] text-white text-sm font-medium transition-colors disabled:opacity-60 flex items-center gap-2"
            >
              {isCreatingDeals ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Creating Deals...
                </>
              ) : (
                <>Approve & Create Deals ({totalShowCount})</>
              )}
            </button>
          )}
          <button
            onClick={handleApproveAndDraft}
            disabled={isGeneratingOutreach}
            className="px-4 py-2 rounded-lg bg-[var(--brand-blue)] hover:bg-[var(--brand-blue-light)] text-white text-sm font-medium transition-colors disabled:opacity-60 flex items-center gap-2"
          >
            {isGeneratingOutreach ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Drafting Emails...
              </>
            ) : outreachDrafts.length > 0 ? (
              "Regenerate Outreach"
            ) : (
              "Approve & Draft Outreach"
            )}
          </button>
        </div>
      </div>

      {outreachError && (
        <div className="mb-6 px-4 py-3 bg-[var(--brand-error)]/10 border border-[var(--brand-error)]/20 rounded-lg text-sm text-[var(--brand-error)]">
          {outreachError}
        </div>
      )}

      {dealsError && (
        <div className="mb-6 px-4 py-3 bg-[var(--brand-error)]/10 border border-[var(--brand-error)]/20 rounded-lg text-sm text-[var(--brand-error)]">
          {dealsError}
        </div>
      )}

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
          <div className="text-xl font-bold text-[var(--brand-text)]">{totalShowCount}</div>
          <div className="text-xs text-[var(--brand-text-muted)] mt-0.5">of {allShowIds.length} recommended</div>
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
            {tab.id === "outreach" && outreachDrafts.length > 0 && (
              <span className="ml-1.5 text-xs opacity-75">({outreachDrafts.length})</span>
            )}
          </button>
        ))}
      </div>

      {activeTab === "plan" && (
        <div>
          {/* Podcast Section */}
          {recommendations.length > 0 && (
            <div>
              <div className="flex items-center gap-3 mb-4">
                <h2 className="text-sm font-semibold text-[var(--brand-text)] uppercase tracking-wider">Podcasts</h2>
                <span className="text-xs text-[var(--brand-text-muted)]">CPM pricing · {recommendations.length} shows</span>
                <div className="flex-1 h-px bg-[var(--brand-border)]" />
              </div>
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
                        <ShowAvatar name={show.show_name} imageUrl={show.image_url} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3 mb-2">
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
                            {(show.categories ?? []).map((cat, idx) => (
                              <span key={`${cat}-${idx}`} className="text-xs text-[var(--brand-text-muted)] bg-[var(--brand-surface)] px-2 py-0.5 rounded">{String(cat)}</span>
                            ))}
                          </div>
                          <div className="flex items-center gap-6 text-sm">
                            <div><span className="text-[var(--brand-text-muted)]">Downloads: </span><span className="font-medium text-[var(--brand-text)]">{(show.audience_size / 1000).toFixed(0)}K/ep</span></div>
                            <div><span className="text-[var(--brand-text-muted)]">CPM: </span><span className="font-medium text-[var(--brand-text)]">${show.estimated_cpm}</span></div>
                            <div><span className="text-[var(--brand-text-muted)]">Per Episode: </span><span className="font-medium text-[var(--brand-text)]">${Math.round((show.audience_size / 1000) * show.estimated_cpm).toLocaleString()}</span></div>
                            <div><span className="text-[var(--brand-text-muted)]">Episodes: </span><span className="font-medium text-[var(--brand-text)]">{show.num_episodes}x {show.placement}</span></div>
                            <div><span className="text-[var(--brand-text-muted)]">Total: </span><span className="font-semibold text-[var(--brand-blue)]">${show.allocated_budget.toLocaleString()}</span></div>
                          </div>
                          <div className="flex items-center gap-2 mt-3">
                            <span className="text-xs text-[var(--brand-text-muted)]">Also sponsors:</span>
                            {(show.current_sponsors ?? []).map((sponsor, idx) => (
                              <span key={`${sponsor}-${idx}`} className="text-xs bg-[var(--brand-orange)]/[0.08] text-[var(--brand-orange)] px-2 py-0.5 rounded font-medium">{sponsor}</span>
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
            </div>
          )}

          {/* YouTube Section */}
          {youtubeRecs.length > 0 && (
            <div className={recommendations.length > 0 ? "mt-8" : ""}>
              <div className="flex items-center gap-3 mb-4">
                <h2 className="text-sm font-semibold text-[var(--brand-text)] uppercase tracking-wider">YouTube</h2>
                <span className="text-xs text-[var(--brand-text-muted)]">Flat fee per video · {youtubeRecs.length} channels</span>
                <div className="flex-1 h-px bg-[var(--brand-border)]" />
              </div>
              <div className="space-y-3">
                {youtubeRecs.map((show, index) => {
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
                        <ShowAvatar name={show.show_name} imageUrl={show.image_url} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3 mb-2">
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
                            {(show.categories ?? []).map((cat, idx) => (
                              <span key={`${cat}-${idx}`} className="text-xs text-[var(--brand-text-muted)] bg-[var(--brand-surface)] px-2 py-0.5 rounded">{String(cat)}</span>
                            ))}
                          </div>
                          <div className="flex items-center gap-6 text-sm">
                            <div><span className="text-[var(--brand-text-muted)]">Avg Views: </span><span className="font-medium text-[var(--brand-text)]">{(show.audience_size / 1000).toFixed(0)}K/video</span></div>
                            <div><span className="text-[var(--brand-text-muted)]">Fee: </span><span className="font-medium text-[var(--brand-text)]">${show.flat_fee_per_video.toLocaleString()}/video</span></div>
                            <div><span className="text-[var(--brand-text-muted)]">Videos: </span><span className="font-medium text-[var(--brand-text)]">{show.num_videos}x integration</span></div>
                            <div><span className="text-[var(--brand-text-muted)]">Allocation: </span><span className="font-semibold text-[var(--brand-blue)]">${show.allocated_budget.toLocaleString()}</span></div>
                          </div>
                          <div className="flex items-center gap-2 mt-3">
                            <span className="text-xs text-[var(--brand-text-muted)]">Also sponsors:</span>
                            {(show.current_sponsors ?? []).map((sponsor, idx) => (
                              <span key={`${sponsor}-${idx}`} className="text-xs bg-[var(--brand-orange)]/[0.08] text-[var(--brand-orange)] px-2 py-0.5 rounded font-medium">{sponsor}</span>
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
            </div>
          )}
        </div>
      )}

      {activeTab === "plan" && expansions.length > 0 && (
        <div className="mt-8">
          <div className="flex items-center gap-3 mb-4">
            <h2 className="text-sm font-semibold text-[var(--brand-text)] uppercase tracking-wider">Expansion Opportunities</h2>
            <div className="flex-1 h-px bg-[var(--brand-border)]" />
            <span className="text-xs text-[var(--brand-text-muted)]">{expansions.length} additional shows</span>
          </div>
          <p className="text-xs text-[var(--brand-text-secondary)] mb-4">
            Strong audience fits that didn&apos;t make the initial budget. Consider these if you increase spend or want alternatives.
          </p>
          <div className="grid grid-cols-2 gap-3">
            {expansions.map((show) => (
              <div key={show.show_id} className="p-4 bg-[var(--brand-surface-elevated)] rounded-xl border border-dashed border-[var(--brand-border)] hover:border-[var(--brand-teal)]/40 transition-all">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-sm text-[var(--brand-text)]">{show.show_name}</h3>
                    <span className="text-[10px] uppercase font-medium px-1.5 py-0.5 rounded bg-[var(--brand-surface)] text-[var(--brand-text-muted)]">{show.platform}</span>
                  </div>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                    show.fit_score >= 80 ? "bg-[var(--brand-blue)]/10 text-[var(--brand-blue)]"
                      : "bg-[var(--brand-teal)]/10 text-[var(--brand-teal)]"
                  }`}>{show.fit_score}% fit</span>
                </div>
                <div className="flex items-center gap-2 mb-2">
                  {(show.categories ?? []).slice(0, 3).map((cat, idx) => (
                    <span key={`${cat}-${idx}`} className="text-xs text-[var(--brand-text-muted)] bg-[var(--brand-surface)] px-1.5 py-0.5 rounded">{String(cat)}</span>
                  ))}
                </div>
                <div className="flex items-center gap-4 text-xs text-[var(--brand-text-secondary)] mb-3">
                  <span>{(show.audience_size / 1000).toFixed(0)}K {show.platform === "youtube" ? "views" : "downloads"}</span>
                  {show.platform === "youtube" && show.flat_fee && <span>${show.flat_fee.toLocaleString()}/video</span>}
                  {show.platform === "podcast" && show.estimated_cpm && <span>${show.estimated_cpm} CPM</span>}
                  {show.network && <span>{show.network}</span>}
                </div>
                <p className="text-xs text-[var(--brand-teal)] leading-relaxed">{show.reason}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === "outreach" && (
        <div>
          {/* AI-generated drafts */}
          {outreachDrafts.length > 0 ? (
            <div>
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm text-[var(--brand-text-secondary)]">
                  {outreachDrafts.length} personalized emails drafted. Review and edit before sending.
                </p>
                {unsentCount > 0 && (
                  <button
                    onClick={sendAllEmails}
                    disabled={isSendingAll}
                    className="px-4 py-2 rounded-lg bg-[var(--brand-blue)] hover:bg-[var(--brand-blue-light)] text-white text-sm font-medium transition-colors disabled:opacity-60 flex items-center gap-2"
                  >
                    {isSendingAll ? (
                      <>
                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Sending...
                      </>
                    ) : (
                      `Send All (${unsentCount})`
                    )}
                  </button>
                )}
              </div>
              <div className="space-y-4">
                {outreachDrafts.map((draft) => {
                  const status = sendStatus[draft.show_id];
                  const isSent = draft.sent;
                  return (
                    <div key={draft.show_id} className={`p-5 bg-[var(--brand-surface-elevated)] rounded-xl border ${
                      isSent ? "border-[var(--brand-success)]/30" : "border-[var(--brand-border)]"
                    }`}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-[var(--brand-text)]">{draft.show_name}</h3>
                          <span className="text-[10px] uppercase font-medium px-1.5 py-0.5 rounded bg-[var(--brand-surface)] text-[var(--brand-text-muted)]">{draft.platform}</span>
                          <span className="text-xs text-[var(--brand-text-muted)]">{draft.contact_email}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {isSent && (
                            <span className="text-xs font-medium px-2 py-1 rounded-full bg-[var(--brand-success)]/10 text-[var(--brand-success)]">Sent</span>
                          )}
                          {status === "failed" && !isSent && (
                            <span className="text-xs font-medium px-2 py-1 rounded-full bg-[var(--brand-error)]/10 text-[var(--brand-error)]">Failed</span>
                          )}
                          {!isSent && (
                            <button
                              onClick={() => sendSingleEmail(draft)}
                              disabled={status === "sending"}
                              className="text-xs text-[var(--brand-blue)] hover:underline font-medium disabled:opacity-50"
                            >
                              {status === "sending" ? "Sending..." : "Send"}
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div>
                          <label className="text-xs text-[var(--brand-text-muted)] font-medium mb-1 block">Subject</label>
                          <input
                            type="text"
                            value={draft.subject}
                            onChange={(e) => updateDraft(draft.show_id, "subject", e.target.value)}
                            disabled={isSent}
                            className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface)] text-[var(--brand-text)] focus:outline-none focus:border-[var(--brand-blue)] disabled:opacity-60"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-[var(--brand-text-muted)] font-medium mb-1 block">Body</label>
                          <textarea
                            value={draft.body}
                            onChange={(e) => updateDraft(draft.show_id, "body", e.target.value)}
                            disabled={isSent}
                            rows={6}
                            className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface)] text-[var(--brand-text)] focus:outline-none focus:border-[var(--brand-blue)] disabled:opacity-60 resize-y leading-relaxed"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            /* Fallback: static templates for seed campaigns or pre-approve state */
            <div className="space-y-4">
              <div className="mb-4 px-4 py-3 bg-[var(--brand-surface)] rounded-lg border border-[var(--brand-border)]">
                <p className="text-sm text-[var(--brand-text-secondary)]">
                  Click <strong className="text-[var(--brand-text)]">Approve &amp; Draft Outreach</strong> above to generate personalized emails for each show using AI.
                </p>
              </div>
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
                      Your show&apos;s focus on {show.categories[0]?.toLowerCase()} aligns perfectly with our target customer.
                    </p>
                    <p className="mb-2">
                      We&apos;re thinking a {show.num_episodes}-episode {show.placement} campaign and would love to chat about availability and what a partnership could look like.
                    </p>
                    <p className="text-[var(--brand-text-muted)] italic mt-3 text-xs">AI-generated draft — review and personalize before sending.</p>
                  </div>
                </div>
              ))}
              {youtubeRecs.map((show) => (
                <div key={show.show_id} className="p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)]">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-[var(--brand-text)]">{show.show_name}</h3>
                      <span className="text-[10px] uppercase font-medium px-1.5 py-0.5 rounded bg-[var(--brand-surface)] text-[var(--brand-text-muted)]">YouTube</span>
                      <span className="text-xs text-[var(--brand-text-muted)]">{show.contact_email}</span>
                    </div>
                    <button className="text-xs text-[var(--brand-blue)] hover:underline font-medium">Copy email</button>
                  </div>
                  <div className="bg-[var(--brand-surface)] rounded-lg p-4 text-sm text-[var(--brand-text-secondary)] leading-relaxed">
                    <p className="font-medium text-[var(--brand-text)] mb-2">Subject: Sponsorship Opportunity — [Your Brand] x {show.show_name}</p>
                    <p className="mb-2">Hi {show.show_name} team,</p>
                    <p className="mb-2">
                      I&apos;m reaching out from [Your Brand] — we&apos;re looking for YouTube creators whose audience aligns with our target customer.
                      Your channel&apos;s focus on {show.categories[0]?.toLowerCase()} is a great fit.
                    </p>
                    <p className="mb-2">
                      We&apos;re interested in a {show.num_videos}-video integrated sponsorship and would love to chat about availability and what a collaboration could look like.
                    </p>
                    <p className="text-[var(--brand-text-muted)] italic mt-3 text-xs">AI-generated draft — review and personalize before sending.</p>
                  </div>
                </div>
              ))}
            </div>
          )}
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
          {youtubeRecs.map((show) => (
            <div key={show.show_id} className="p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)]">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <h3 className="font-semibold text-[var(--brand-text)]">{show.show_name}</h3>
                  <span className="text-[10px] uppercase font-medium px-1.5 py-0.5 rounded bg-[var(--brand-surface)] text-[var(--brand-text-muted)]">YouTube</span>
                  <span className="text-xs bg-[var(--brand-surface)] px-2 py-0.5 rounded text-[var(--brand-text-muted)]">integrated segment</span>
                </div>
                <button className="text-xs text-[var(--brand-blue)] hover:underline font-medium">Copy brief</button>
              </div>
              <div className="bg-[var(--brand-surface)] rounded-lg p-4 text-sm text-[var(--brand-text-secondary)] leading-relaxed">
                <p className="font-medium text-[var(--brand-text)] mb-2">Talking Points</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>Introduce [Your Brand] naturally within your content</li>
                  <li>Highlight [key product benefit] and your personal experience</li>
                  <li>Show the product on screen — unboxing or in-use demo preferred</li>
                  <li>Direct viewers to [URL] with code {show.show_name.toUpperCase().replace(/\s/g, "")} for 15% off</li>
                  <li>Include link in video description and pinned comment</li>
                </ul>
                <p className="text-[var(--brand-text-muted)] italic mt-3 text-xs">AI-generated brief — customize with your brand details and the creator&apos;s style.</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
