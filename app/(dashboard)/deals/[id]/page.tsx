"use client";

import { useState } from "react";
import Link from "next/link";
import {
  getDealsByAgent,
  getShowsByAgent,
  getShowById,
  getIOByDeal,
  profiles,
} from "@/lib/data";
import type { Deal, DealStatus, Placement, PriceType } from "@/lib/data";

const agentId = "user-agent-001";
const allDeals = getDealsByAgent(agentId);
const agentShows = getShowsByAgent(agentId);

const statusOptions: { value: DealStatus; label: string }[] = [
  { value: "proposed", label: "Proposed" },
  { value: "negotiating", label: "Negotiating" },
  { value: "approved", label: "Approved" },
  { value: "io_sent", label: "IO Sent" },
  { value: "signed", label: "Signed" },
  { value: "live", label: "Live" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

const statusStyles: Record<string, string> = {
  proposed: "bg-[var(--brand-blue)]/10 text-[var(--brand-blue)]",
  negotiating: "bg-[var(--brand-warning)]/10 text-[var(--brand-warning)]",
  approved: "bg-[var(--brand-success)]/10 text-[var(--brand-success)]",
  io_sent: "bg-[var(--brand-blue)]/10 text-[var(--brand-blue)]",
  signed: "bg-[var(--brand-success)]/10 text-[var(--brand-success)]",
  live: "bg-[var(--brand-success)]/10 text-[var(--brand-success)]",
  completed: "bg-[var(--brand-text-muted)]/10 text-[var(--brand-text-muted)]",
  cancelled: "bg-[var(--brand-error)]/10 text-[var(--brand-error)]",
};

function getBrandName(brandId: string): string {
  return profiles.find((p) => p.id === brandId)?.company_name ?? "Unknown";
}

const inputClass =
  "w-full px-4 py-2.5 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text)] text-sm placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30 focus:border-[var(--brand-blue)] transition-all";
const readOnlyClass =
  "w-full px-4 py-2.5 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface)]/60 text-sm text-[var(--brand-text-secondary)]";

export default function DealDetailPage({ params }: { params: Promise<{ id: string }> }) {
  // Unwrap params in a client component — use React.use() pattern
  const { id } = params as unknown as { id: string };
  const initialDeal = allDeals.find((d) => d.id === id);

  const [deal, setDeal] = useState<Deal | undefined>(initialDeal);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Edit form state
  const [editBrandName, setEditBrandName] = useState("");
  const [editShowId, setEditShowId] = useState("");
  const [editStatus, setEditStatus] = useState<DealStatus>("proposed");
  const [editPlacement, setEditPlacement] = useState<Placement>("mid-roll");
  const [editPriceType, setEditPriceType] = useState<PriceType>("cpm");
  const [editCpmRate, setEditCpmRate] = useState<number | "">("");
  const [editFlatRate, setEditFlatRate] = useState<number | "">("");
  const [editGuaranteedDownloads, setEditGuaranteedDownloads] = useState<number | "">("");
  const [editNumEpisodes, setEditNumEpisodes] = useState<number | "">("");
  const [editFlightStart, setEditFlightStart] = useState("");
  const [editFlightEnd, setEditFlightEnd] = useState("");
  const [editNotes, setEditNotes] = useState("");

  if (!deal) {
    return (
      <div className="p-8 max-w-3xl">
        <Link href="/deals" className="flex items-center gap-1.5 text-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors mb-4">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
          All Deals
        </Link>
        <h1 className="text-2xl font-bold text-[var(--brand-text)]">Deal not found</h1>
      </div>
    );
  }

  const show = getShowById(deal.show_id);
  const brandName = getBrandName(deal.brand_id);
  const existingIO = getIOByDeal(deal.id);
  const showIOLink = ["approved", "io_sent", "signed", "live", "completed"].includes(deal.status);

  const startEdit = () => {
    setEditBrandName(brandName);
    setEditShowId(deal.show_id);
    setEditStatus(deal.status);
    setEditPlacement(deal.placement);
    setEditPriceType(deal.price_type);
    setEditCpmRate(deal.cpm_rate);
    setEditFlatRate(deal.price_type === "flat_rate" ? deal.net_per_episode : "");
    setEditGuaranteedDownloads(deal.guaranteed_downloads);
    setEditNumEpisodes(deal.num_episodes);
    setEditFlightStart(deal.flight_start.split("T")[0]);
    setEditFlightEnd(deal.flight_end.split("T")[0]);
    setEditNotes(deal.notes ?? "");
    setIsEditing(true);
  };

  const handleSave = async () => {
    setIsSaving(true);
    await new Promise((r) => setTimeout(r, 800));

    const editShow = getShowById(editShowId);
    const cpm = editPriceType === "cpm" ? Number(editCpmRate) || deal.cpm_rate : 0;
    const downloads = Number(editGuaranteedDownloads) || deal.guaranteed_downloads;
    const episodes = Number(editNumEpisodes) || deal.num_episodes;
    const netPerEp =
      editPriceType === "cpm"
        ? (downloads / 1000) * cpm
        : Number(editFlatRate) || deal.net_per_episode;

    setDeal({
      ...deal,
      show_id: editShowId,
      status: editStatus,
      placement: editPlacement,
      price_type: editPriceType,
      cpm_rate: cpm,
      guaranteed_downloads: downloads,
      num_episodes: episodes,
      net_per_episode: netPerEp,
      total_net: netPerEp * episodes,
      flight_start: editFlightStart,
      flight_end: editFlightEnd,
      notes: editNotes || undefined,
      updated_at: new Date().toISOString(),
    });

    setIsEditing(false);
    setIsSaving(false);
  };

  const handleCancel = () => {
    setIsEditing(false);
  };

  // Computed
  const editNetPerEp =
    editPriceType === "cpm" && editCpmRate && editGuaranteedDownloads
      ? ((editGuaranteedDownloads as number) / 1000) * (editCpmRate as number)
      : editPriceType === "flat_rate" && editFlatRate
        ? (editFlatRate as number)
        : 0;
  const editTotalNet = editNetPerEp * (Number(editNumEpisodes) || 0);

  const fmtDate = (d: string) =>
    new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  return (
    <div className="p-8 max-w-3xl">
      {/* Back + Header */}
      <div className="mb-8">
        <Link
          href="/deals"
          className="flex items-center gap-1.5 text-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors mb-4"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
          All Deals
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--brand-text)] tracking-tight">
              {show?.name ?? "Unknown Show"}
            </h1>
            <p className="text-sm text-[var(--brand-text-secondary)] mt-1">
              {brandName} &middot; {deal.num_episodes} episode{deal.num_episodes !== 1 ? "s" : ""} &middot; {deal.placement}
            </p>
          </div>
          {!isEditing && (
            <div className="flex items-center gap-3">
              <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${statusStyles[deal.status] ?? ""}`}>
                {deal.status.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase())}
              </span>
              <button
                onClick={startEdit}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-[var(--brand-border)] text-sm font-medium text-[var(--brand-text-secondary)] hover:border-[var(--brand-blue)] hover:text-[var(--brand-blue)] transition-all"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
                Edit
              </button>
            </div>
          )}
        </div>
      </div>

      {isEditing ? (
        /* ======================== EDIT MODE ======================== */
        <div className="space-y-6">
          {/* Status */}
          <div>
            <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">Status</label>
            <select value={editStatus} onChange={(e) => setEditStatus(e.target.value as DealStatus)} className={inputClass}>
              {statusOptions.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>

          {/* Show */}
          <div>
            <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">Show</label>
            <select value={editShowId} onChange={(e) => setEditShowId(e.target.value)} className={inputClass}>
              {agentShows.map((s) => (
                <option key={s.id} value={s.id}>{s.name} — {s.audience_size.toLocaleString()} avg downloads</option>
              ))}
            </select>
          </div>

          {/* Brand */}
          <div>
            <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">Brand / Advertiser</label>
            <input type="text" value={editBrandName} onChange={(e) => setEditBrandName(e.target.value)} className={inputClass} />
            <p className="text-xs text-[var(--brand-text-muted)] mt-1">Display name only — billing profile unchanged</p>
          </div>

          {/* Placement */}
          <div>
            <label className="block text-sm font-medium text-[var(--brand-text)] mb-2">Placement</label>
            <div className="flex gap-3">
              {(["pre-roll", "mid-roll", "post-roll"] as Placement[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setEditPlacement(p)}
                  className={`flex-1 px-4 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                    editPlacement === p
                      ? "border-[var(--brand-blue)] bg-[var(--brand-blue)]/[0.06] text-[var(--brand-blue)]"
                      : "border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text-secondary)] hover:border-[var(--brand-text-muted)]"
                  }`}
                >
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Price Type */}
          <div>
            <label className="block text-sm font-medium text-[var(--brand-text)] mb-2">Price Type</label>
            <div className="flex gap-3">
              {(["cpm", "flat_rate"] as PriceType[]).map((pt) => (
                <button
                  key={pt}
                  type="button"
                  onClick={() => setEditPriceType(pt)}
                  className={`flex-1 px-4 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                    editPriceType === pt
                      ? "border-[var(--brand-blue)] bg-[var(--brand-blue)]/[0.06] text-[var(--brand-blue)]"
                      : "border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text-secondary)] hover:border-[var(--brand-text-muted)]"
                  }`}
                >
                  {pt === "cpm" ? "CPM" : "Flat Rate"}
                </button>
              ))}
            </div>
          </div>

          {/* Rates + Downloads */}
          <div className="grid grid-cols-2 gap-4">
            {editPriceType === "cpm" ? (
              <div>
                <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">CPM Rate</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-[var(--brand-text-muted)]">$</span>
                  <input
                    type="number"
                    value={editCpmRate}
                    onChange={(e) => setEditCpmRate(e.target.value ? Number(e.target.value) : "")}
                    min="1"
                    step="0.01"
                    className={`${inputClass} pl-8`}
                  />
                </div>
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">Flat Rate per Episode</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-[var(--brand-text-muted)]">$</span>
                  <input
                    type="number"
                    value={editFlatRate}
                    onChange={(e) => setEditFlatRate(e.target.value ? Number(e.target.value) : "")}
                    min="1"
                    step="1"
                    className={`${inputClass} pl-8`}
                  />
                </div>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">Guaranteed Downloads</label>
              <input
                type="number"
                value={editGuaranteedDownloads}
                onChange={(e) => setEditGuaranteedDownloads(e.target.value ? Number(e.target.value) : "")}
                min="100"
                step="100"
                className={inputClass}
              />
              <p className="text-xs text-[var(--brand-text-muted)] mt-1">Per episode</p>
            </div>
          </div>

          {/* Episodes + Dates */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">Episodes</label>
              <input
                type="number"
                value={editNumEpisodes}
                onChange={(e) => setEditNumEpisodes(e.target.value ? Number(e.target.value) : "")}
                min="1"
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">Flight Start</label>
              <input type="date" value={editFlightStart} onChange={(e) => setEditFlightStart(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">Flight End</label>
              <input type="date" value={editFlightEnd} onChange={(e) => setEditFlightEnd(e.target.value)} className={inputClass} />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">
              Notes <span className="text-[var(--brand-text-muted)] font-normal ml-1">(optional)</span>
            </label>
            <textarea
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              rows={2}
              placeholder="Deal context, competitor exclusions, etc."
              className={`${inputClass} resize-none`}
            />
          </div>

          {/* Edit Summary */}
          {editNetPerEp > 0 && (
            <div className="rounded-xl border border-[var(--brand-border)] bg-[var(--brand-surface)] p-5">
              <h3 className="text-sm font-semibold text-[var(--brand-text)] mb-3">Updated Summary</h3>
              <div className="grid grid-cols-2 gap-y-2 text-sm">
                <div className="flex justify-between col-span-2">
                  <span className="text-[var(--brand-text-muted)]">Rate per episode</span>
                  <span className="font-medium text-[var(--brand-text)]">
                    ${editNetPerEp.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between col-span-2 pt-2 border-t border-[var(--brand-border)]">
                  <span className="font-semibold text-[var(--brand-text)]">Total net</span>
                  <span className="font-bold text-[var(--brand-blue)]">
                    ${editTotalNet.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Save / Cancel */}
          <div className="flex items-center gap-3 pt-4 border-t border-[var(--brand-border)]">
            <button
              onClick={handleCancel}
              className="px-5 py-2.5 rounded-lg border border-[var(--brand-border)] text-sm font-medium text-[var(--brand-text-secondary)] hover:bg-[var(--brand-surface)] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[var(--brand-blue)] hover:bg-[var(--brand-blue-light)] text-white text-sm font-medium transition-colors disabled:opacity-50"
            >
              {isSaving ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Saving...
                </>
              ) : (
                "Save Changes"
              )}
            </button>
          </div>
        </div>
      ) : (
        /* ======================== VIEW MODE ======================== */
        <div className="space-y-6">
          {/* Deal Info */}
          <section className="p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)]">
            <h2 className="text-xs font-semibold text-[var(--brand-text-muted)] uppercase tracking-wider mb-4">Deal Details</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">Show</label>
                <div className={readOnlyClass}>{show?.name ?? "Unknown"}</div>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">Brand</label>
                <div className={readOnlyClass}>{brandName}</div>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">Placement</label>
                <div className={readOnlyClass}>{deal.placement.charAt(0).toUpperCase() + deal.placement.slice(1)}</div>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">Price Type</label>
                <div className={readOnlyClass}>{deal.price_type === "cpm" ? `CPM — $${deal.cpm_rate}` : `Flat Rate — $${deal.net_per_episode.toLocaleString()}`}</div>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">Guaranteed Downloads</label>
                <div className={readOnlyClass}>{deal.guaranteed_downloads.toLocaleString()} / episode</div>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">Episodes</label>
                <div className={readOnlyClass}>{deal.num_episodes}</div>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">Flight Start</label>
                <div className={readOnlyClass}>{fmtDate(deal.flight_start)}</div>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">Flight End</label>
                <div className={readOnlyClass}>{fmtDate(deal.flight_end)}</div>
              </div>
              {deal.notes && (
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">Notes</label>
                  <div className={readOnlyClass}>{deal.notes}</div>
                </div>
              )}
            </div>
          </section>

          {/* Financials */}
          <section className="p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)]">
            <h2 className="text-xs font-semibold text-[var(--brand-text-muted)] uppercase tracking-wider mb-4">Financials</h2>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center p-3 rounded-lg bg-[var(--brand-surface)]">
                <div className="text-xs text-[var(--brand-text-muted)] font-medium uppercase tracking-wider mb-1">Per Episode</div>
                <div className="text-lg font-bold text-[var(--brand-text)]">
                  ${deal.net_per_episode.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
              <div className="text-center p-3 rounded-lg bg-[var(--brand-surface)]">
                <div className="text-xs text-[var(--brand-text-muted)] font-medium uppercase tracking-wider mb-1">Episodes</div>
                <div className="text-lg font-bold text-[var(--brand-text)]">{deal.num_episodes}</div>
              </div>
              <div className="text-center p-3 rounded-lg bg-[var(--brand-surface)]">
                <div className="text-xs text-[var(--brand-text-muted)] font-medium uppercase tracking-wider mb-1">Total Net</div>
                <div className="text-lg font-bold text-[var(--brand-blue)]">
                  ${deal.total_net.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
            </div>
          </section>

          {/* Exclusivity */}
          {deal.competitor_exclusion.length > 0 && (
            <section className="p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)]">
              <h2 className="text-xs font-semibold text-[var(--brand-text-muted)] uppercase tracking-wider mb-3">Competitor Exclusion</h2>
              <div className="flex items-center gap-2 flex-wrap">
                {deal.competitor_exclusion.map((comp) => (
                  <span key={comp} className="text-xs bg-[var(--brand-orange)]/[0.08] text-[var(--brand-orange)] px-2.5 py-1 rounded-full font-medium">
                    {comp}
                  </span>
                ))}
              </div>
              <div className="flex items-center gap-4 mt-3 text-xs text-[var(--brand-text-muted)]">
                <span>{deal.exclusivity_days} days exclusivity</span>
                <span>{deal.rofr_days} days ROFR</span>
              </div>
            </section>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3 pt-4 border-t border-[var(--brand-border)]">
            {showIOLink && (
              <Link
                href={`/deals/${deal.id}/io`}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[var(--brand-blue)] hover:bg-[var(--brand-blue-light)] text-white text-sm font-medium transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                {existingIO ? "View IO" : "Generate IO"}
              </Link>
            )}
            <button
              onClick={startEdit}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg border border-[var(--brand-border)] text-sm font-medium text-[var(--brand-text-secondary)] hover:border-[var(--brand-blue)] hover:text-[var(--brand-blue)] transition-all"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              Edit Deal
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
