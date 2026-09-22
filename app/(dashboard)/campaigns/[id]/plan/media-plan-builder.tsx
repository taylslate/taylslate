"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  MediaPlan,
  MediaPlanLineItem,
  Placement,
  PlanSpacing,
  ScoredShowRecord,
} from "@/lib/data/types";
import {
  PLACEMENT_MULTIPLIERS,
  adjustedCpm,
  blendedCpm,
  campaignLengthWeeks,
  formatCampaignLength,
  lineTotal,
  spotPrice,
  totalImpressions,
} from "@/lib/utils/pricing";
import { tokens } from "@/lib/brand/tokens";

const radiusStyle = { borderRadius: tokens.radius };

const inkText = "text-[var(--ts-ink-on-paper)]";
const mutedText = "text-[var(--ts-ink-muted-on-paper)]";
const accentText = "text-[var(--ts-accent)]";
const kickerClass =
  "text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ts-accent)]";
const hairlineRule = "border-[var(--ts-hairline-on-paper)]";
const panelClass =
  "border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)]";
const inkBtnClass =
  "inline-flex items-center justify-center gap-2 bg-[var(--ts-ink-on-paper)] px-4 py-2 text-sm font-medium text-[var(--ts-paper)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";
const ghostBtnClass =
  "border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-4 py-2 text-sm font-medium hover:bg-[var(--ts-band-shows)] disabled:cursor-not-allowed disabled:opacity-50";
const fieldClass =
  "border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] text-xs font-medium text-[var(--ts-ink-on-paper)] focus:border-[var(--ts-accent)] focus:outline-none";

const PLACEMENT_OPTIONS: Placement[] = ["pre-roll", "mid-roll", "post-roll"];
const SPACING_OPTIONS: { value: PlanSpacing; label: string }[] = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Biweekly" },
  { value: "monthly", label: "Monthly" },
];
const EPISODE_OPTIONS = [1, 2, 3, 4, 5, 6];

interface Props {
  campaignId: string;
  campaignName: string;
  budgetTotal: number;
  selectedShows: ScoredShowRecord[];
  initialPlan: MediaPlan | null;
}

function formatCurrency(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

function formatImpressions(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return n.toLocaleString();
}

/** Compact "est." marker for a Podscan-derived number (audience or CPM) — mirrors
 *  the discovery EstimateTag so provenance reads the same on the plan. */
function EstTag() {
  return (
    <span
      data-testid="plan-estimate"
      title="Estimated from Podscan data — confirmed at outreach"
      className={`border px-1 py-0.5 text-[10px] font-medium ${hairlineRule} bg-[var(--ts-paper)] ${mutedText}`}
      style={radiusStyle}
    >
      est.
    </span>
  );
}

function placementLabel(p: Placement): string {
  return p === "pre-roll" ? "Pre-roll" : p === "mid-roll" ? "Mid-roll" : "Post-roll";
}

export default function MediaPlanBuilder({
  campaignId,
  campaignName,
  budgetTotal,
  selectedShows,
  initialPlan,
}: Props) {
  const router = useRouter();

  // Seed line items from persisted plan OR defaults for newly selected shows.
  const defaultPlacement = initialPlan?.default_placement ?? "mid-roll";
  const defaultEpisodes = initialPlan?.default_episodes ?? 3;
  const defaultSpacing = initialPlan?.spacing ?? "weekly";

  const buildInitialLineItems = useCallback((): MediaPlanLineItem[] => {
    const persistedById = new Map(
      (initialPlan?.line_items ?? []).map((li) => [li.podcast_id, li])
    );
    return selectedShows.map((show) => {
      const existing = persistedById.get(show.podcastId);
      return (
        existing ?? {
          podcast_id: show.podcastId,
          // Wave 14 Phase 2C Layer 5: seed at the placement the brand chose in
          // discovery (it travels on the scored-show record); fall back to the
          // plan default for legacy shows that carry none.
          placement: show.placement ?? defaultPlacement,
          num_episodes: defaultEpisodes,
        }
      );
    });
  }, [selectedShows, initialPlan, defaultPlacement, defaultEpisodes]);

  const [placementDefault, setPlacementDefault] = useState<Placement>(defaultPlacement);
  const [episodesDefault, setEpisodesDefault] = useState<number>(defaultEpisodes);
  const [spacing, setSpacing] = useState<PlanSpacing>(defaultSpacing);
  const [lineItems, setLineItems] = useState<MediaPlanLineItem[]>(buildInitialLineItems);

  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fast lookup for scored-show data keyed by podcast_id.
  const showById = useMemo(() => {
    const map = new Map<string, ScoredShowRecord>();
    for (const s of selectedShows) map.set(s.podcastId, s);
    return map;
  }, [selectedShows]);

  // Visible line items = only those whose show is still present (after removals).
  const visibleItems = useMemo(
    () => lineItems.filter((li) => showById.has(li.podcast_id)),
    [lineItems, showById]
  );

  // ---- Persistence ----

  const persistPlan = useCallback(
    (next: {
      default_placement: Placement;
      default_episodes: number;
      spacing: PlanSpacing;
      line_items: MediaPlanLineItem[];
    }) => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(async () => {
        setSaving(true);
        try {
          await fetch("/api/campaigns/plan", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ campaign_id: campaignId, media_plan: next }),
          });
        } catch {
          // Non-fatal — the user can retry by tweaking again.
        }
        setSaving(false);
      }, 600);
    },
    [campaignId]
  );

  useEffect(() => {
    persistPlan({
      default_placement: placementDefault,
      default_episodes: episodesDefault,
      spacing,
      line_items: lineItems,
    });
    // Cleanup on unmount: fire the pending save immediately.
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [placementDefault, episodesDefault, spacing, lineItems, persistPlan]);

  // ---- Mutations ----

  const updateItem = (podcastId: string, patch: Partial<MediaPlanLineItem>) => {
    setLineItems((prev) =>
      prev.map((li) => (li.podcast_id === podcastId ? { ...li, ...patch } : li))
    );
  };

  const removeItem = (podcastId: string) => {
    setLineItems((prev) => {
      const next = prev.filter((li) => li.podcast_id !== podcastId);
      // Also deselect at the discovery level so the show doesn't reappear on
      // reload (the plan falls back to selected_show_ids for new additions).
      fetch("/api/campaigns/selections", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaign_id: campaignId,
          selected_show_ids: next.map((li) => li.podcast_id),
        }),
      }).catch(() => {
        /* non-fatal */
      });
      return next;
    });
  };

  const applyDefaultPlacement = (next: Placement) => {
    setPlacementDefault(next);
    setLineItems((prev) => prev.map((li) => ({ ...li, placement: next })));
  };

  const applyDefaultEpisodes = (next: number) => {
    setEpisodesDefault(next);
    setLineItems((prev) => prev.map((li) => ({ ...li, num_episodes: next })));
  };

  // ---- Derived totals ----

  const summary = useMemo(() => {
    let spend = 0;
    const impressionInputs: { audienceSize: number; episodes: number }[] = [];
    let maxEpisodes = 0;

    for (const li of visibleItems) {
      const show = showById.get(li.podcast_id);
      if (!show) continue;
      spend += lineTotal(show.audienceSize, show.estimatedCpm, li.placement, li.num_episodes);
      impressionInputs.push({ audienceSize: show.audienceSize, episodes: li.num_episodes });
      if (li.num_episodes > maxEpisodes) maxEpisodes = li.num_episodes;
    }

    const impressions = totalImpressions(impressionInputs);
    const cpm = blendedCpm(spend, impressions);
    const weeks = campaignLengthWeeks(maxEpisodes, spacing);

    return {
      totalSpend: spend,
      totalImpressions: impressions,
      blendedCpm: cpm,
      lengthWeeks: weeks,
      overBudget: spend > budgetTotal,
    };
  }, [visibleItems, showById, spacing, budgetTotal]);

  // ---- Export CSV (stub) ----

  const exportCsv = () => {
    const header = [
      "Show",
      "Audience",
      "Base CPM",
      "Placement",
      "Adjusted CPM",
      "Episodes",
      "Spot price",
      "Line total",
    ];
    const rows = visibleItems.map((li) => {
      const show = showById.get(li.podcast_id)!;
      const adj = adjustedCpm(show.estimatedCpm, li.placement);
      const spot = spotPrice(show.audienceSize, show.estimatedCpm, li.placement);
      return [
        `"${show.name.replace(/"/g, '""')}"`,
        show.audienceSize,
        show.estimatedCpm,
        li.placement,
        adj.toFixed(2),
        li.num_episodes,
        Math.round(spot),
        Math.round(spot * li.num_episodes),
      ];
    });
    const csv = [header.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${campaignName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-plan.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // ---- Generate IOs ----

  const generateIOs = async () => {
    if (visibleItems.length === 0) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/campaigns/plan/generate-ios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaign_id: campaignId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to generate IOs");
        setGenerating(false);
        return;
      }
      router.push("/deals");
    } catch {
      setError("Network error — please try again");
      setGenerating(false);
    }
  };

  return (
    <div className={`flex h-[calc(100vh-64px)] flex-col bg-[var(--ts-paper)] ${inkText}`}>
      {/* ---- Header ---- */}
      <div className={`border-b ${hairlineRule} bg-[var(--ts-paper)] px-8 pt-6 pb-5`}>
        <div className="mb-3 flex items-center gap-3">
          <button
            onClick={() => router.push(`/campaigns/${campaignId}`)}
            className={`flex items-center gap-1.5 text-xs ${mutedText} hover:text-[var(--ts-ink-on-paper)]`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
            Back to discovery
          </button>
          <p className={kickerClass}>For brands</p>
          {saving && (
            <span className={`text-xs ${mutedText}`}>Saving…</span>
          )}
        </div>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className={`text-xl font-semibold tracking-tight ${inkText}`}>{campaignName}</h1>
            <p className={`mt-1 text-sm ${mutedText}`}>
              Configure placements, episodes, and spacing. Pricing updates as you edit.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => router.push(`/campaigns/${campaignId}`)}
              className={`${ghostBtnClass} ${inkText}`}
              style={radiusStyle}
            >
              Edit shows
            </button>
            <button
              onClick={exportCsv}
              disabled={visibleItems.length === 0}
              className={`${ghostBtnClass} ${inkText}`}
              style={radiusStyle}
            >
              Export CSV
            </button>
            <button
              onClick={() => router.push(`/campaigns/${campaignId}/outreach`)}
              disabled={visibleItems.length === 0}
              className={`${ghostBtnClass} ${accentText}`}
              style={radiusStyle}
            >
              Send outreach
            </button>
            <button
              onClick={generateIOs}
              disabled={visibleItems.length === 0 || generating}
              className={inkBtnClass}
              style={radiusStyle}
            >
              {generating ? "Generating…" : "Generate IOs"}
            </button>
          </div>
        </div>
      </div>

      {/* ---- Summary cards + global controls ---- */}
      <div className={`border-b ${hairlineRule} bg-[var(--ts-paper)] px-8 py-5`}>
        <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <SummaryCard
            label="Total spend"
            value={formatCurrency(summary.totalSpend)}
            sub={`of ${formatCurrency(budgetTotal)} budget`}
            tone={summary.overBudget ? "warning" : "neutral"}
          />
          <SummaryCard
            label="Total impressions"
            value={formatImpressions(summary.totalImpressions)}
            sub={`${visibleItems.length} show${visibleItems.length === 1 ? "" : "s"}`}
          />
          <SummaryCard
            label="Blended CPM"
            value={summary.blendedCpm ? `$${summary.blendedCpm.toFixed(2)}` : "—"}
            sub="Weighted by impressions"
          />
          <SummaryCard
            label="Campaign length"
            value={formatCampaignLength(summary.lengthWeeks)}
            sub={`${spacing.charAt(0).toUpperCase() + spacing.slice(1)} cadence`}
          />
        </div>

        <div className="flex flex-wrap items-center gap-6">
          <ControlGroup label="Default placement">
            <div className="flex gap-1.5">
              {PLACEMENT_OPTIONS.map((p) => (
                <button
                  key={p}
                  onClick={() => applyDefaultPlacement(p)}
                  aria-pressed={placementDefault === p}
                  className={`border px-3 py-1.5 text-xs font-medium ${hairlineRule} ${
                    placementDefault === p
                      ? "bg-[var(--ts-band-brands)] text-[var(--ts-ink-on-paper)]"
                      : "bg-[var(--ts-paper)] text-[var(--ts-ink-muted-on-paper)] hover:bg-[var(--ts-band-shows)]"
                  }`}
                  style={radiusStyle}
                >
                  {placementLabel(p)}
                </button>
              ))}
            </div>
          </ControlGroup>

          <ControlGroup label="Default episodes">
            <select
              value={episodesDefault}
              onChange={(e) => applyDefaultEpisodes(Number(e.target.value))}
              className={`px-3 py-1.5 ${fieldClass}`}
              style={radiusStyle}
            >
              {EPISODE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n} {n === 1 ? "episode" : "episodes"}
                </option>
              ))}
            </select>
          </ControlGroup>

          <ControlGroup label="Spacing">
            <select
              value={spacing}
              onChange={(e) => setSpacing(e.target.value as PlanSpacing)}
              className={`px-3 py-1.5 ${fieldClass}`}
              style={radiusStyle}
            >
              {SPACING_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </ControlGroup>
        </div>
      </div>

      {/* ---- Line items table ---- */}
      <div className="flex-1 overflow-auto px-8 py-6">
        {visibleItems.length === 0 ? (
          <div className={`py-12 text-center text-sm ${mutedText}`}>
            No shows in the plan. <button onClick={() => router.push(`/campaigns/${campaignId}`)} className={`${accentText} hover:underline`}>Go back to discovery</button> to add some.
          </div>
        ) : (
          <div className={`${panelClass} overflow-hidden`} style={radiusStyle}>
            <table className="w-full text-sm">
              <thead className={`border-b ${hairlineRule} bg-[var(--ts-paper)]`}>
                <tr className={`text-left text-xs font-medium uppercase tracking-wider ${mutedText}`}>
                  <th className="px-4 py-3">Show</th>
                  <th className="px-4 py-3 text-right">Audience</th>
                  <th className="px-4 py-3 text-right">CPM</th>
                  <th className="px-4 py-3">Placement</th>
                  <th className="px-4 py-3">Episodes</th>
                  <th className="px-4 py-3 text-right">Spot price</th>
                  <th className="px-4 py-3 text-right">Line total</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className={`divide-y divide-[var(--ts-hairline-on-paper)]`}>
                {visibleItems.map((li) => {
                  const show = showById.get(li.podcast_id)!;
                  const adj = adjustedCpm(show.estimatedCpm, li.placement);
                  const spot = spotPrice(show.audienceSize, show.estimatedCpm, li.placement);
                  const total = spot * li.num_episodes;
                  const multiplier = PLACEMENT_MULTIPLIERS[li.placement];
                  return (
                    <tr key={li.podcast_id} className="hover:bg-[var(--ts-band-shows)]">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {show.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={show.imageUrl} alt="" className={`h-9 w-9 border object-cover ${hairlineRule}`} style={radiusStyle} />
                          ) : (
                            <div className={`h-9 w-9 border bg-[var(--ts-paper)] ${hairlineRule}`} style={radiusStyle} />
                          )}
                          <div className="min-w-0">
                            <div className={`truncate font-medium ${inkText}`}>{show.name}</div>
                            {show.publisherName && (
                              <div className={`truncate text-xs ${mutedText}`}>{show.publisherName}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className={`px-4 py-3 text-right tabular-nums ${mutedText}`}>
                        <span className="inline-flex items-center justify-end gap-1.5">
                          {formatImpressions(show.audienceSize)}
                          {show.audienceIsEstimate && <EstTag />}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        <div className={`inline-flex items-center justify-end gap-1.5 ${inkText}`}>
                          ${adj.toFixed(2)}
                          {show.costIsEstimate && <EstTag />}
                        </div>
                        <div className={`text-xs ${mutedText}`}>
                          ${show.estimatedCpm.toFixed(2)} × {multiplier}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          aria-label={`Placement for ${show.name}`}
                          value={li.placement}
                          onChange={(e) => updateItem(li.podcast_id, { placement: e.target.value as Placement })}
                          className={`px-2.5 py-1.5 ${fieldClass}`}
                          style={radiusStyle}
                        >
                          {PLACEMENT_OPTIONS.map((p) => (
                            <option key={p} value={p}>
                              {placementLabel(p)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          aria-label={`Episodes for ${show.name}`}
                          value={li.num_episodes}
                          onChange={(e) => updateItem(li.podcast_id, { num_episodes: Number(e.target.value) })}
                          className={`px-2.5 py-1.5 ${fieldClass}`}
                          style={radiusStyle}
                        >
                          {EPISODE_OPTIONS.map((n) => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className={`px-4 py-3 text-right tabular-nums ${mutedText}`}>
                        {formatCurrency(spot)}
                      </td>
                      <td className={`px-4 py-3 text-right font-semibold tabular-nums ${inkText}`}>
                        {formatCurrency(total)}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => removeItem(li.podcast_id)}
                          className={`p-1.5 ${mutedText} hover:bg-[var(--ts-band-shows)] hover:text-[var(--ts-ink-on-paper)]`}
                          style={radiusStyle}
                          title="Remove from plan"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                            <line x1="10" x2="10" y1="11" y2="17" />
                            <line x1="14" x2="14" y1="11" y2="17" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {visibleItems.some((li) => {
              const s = showById.get(li.podcast_id);
              return Boolean(s?.costIsEstimate || s?.audienceIsEstimate);
            }) && (
              <p className={`flex items-center gap-1.5 border-t px-4 py-3 text-xs ${hairlineRule} ${mutedText}`}>
                <EstTag /> Audience &amp; CPM are Podscan estimates; spot prices and
                line totals are derived from them and confirmed at outreach.
              </p>
            )}
          </div>
        )}

        {error && (
          <div className={`mt-4 border p-3 text-sm ${panelClass} ${inkText}`} style={radiusStyle}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "neutral" | "warning";
}) {
  const valueClass =
    tone === "warning" ? "text-[var(--ts-accent)]" : "text-[var(--ts-ink-on-paper)]";
  return (
    <div className={`${panelClass} px-4 py-3`} style={radiusStyle}>
      <div className={`text-xs font-medium uppercase tracking-wider ${mutedText}`}>{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${valueClass}`}>{value}</div>
      <div className={`mt-0.5 text-xs ${mutedText}`}>{sub}</div>
    </div>
  );
}

function ControlGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`text-xs font-medium uppercase tracking-wider ${mutedText}`}>{label}</span>
      {children}
    </div>
  );
}
