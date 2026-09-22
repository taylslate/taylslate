"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Deal, DealStatus, Placement, PriceType } from "@/lib/data/types";
import { formatDateOnly } from "@/lib/format/date-only";
import { tokens } from "@/lib/brand/tokens";

const radiusStyle = { borderRadius: tokens.radius };
const inkText = "text-[var(--ts-ink-on-paper)]";
const mutedText = "text-[var(--ts-ink-muted-on-paper)]";
const hairlineRule = "border-[var(--ts-hairline-on-paper)]";
const kickerClass =
  "text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ts-accent)]";
const inkBtnClass =
  "inline-flex items-center gap-2 rounded-[var(--ts-radius)] bg-[var(--ts-ink-on-paper)] px-5 py-2.5 text-sm font-medium text-[var(--ts-paper)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";
const ghostBtnClass =
  "inline-flex items-center gap-2 rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-5 py-2.5 text-sm font-medium text-[var(--ts-ink-on-paper)] hover:bg-[var(--ts-band-shows)]";
const pulseClass = "animate-pulse bg-[var(--ts-ink-on-paper)]/10";

const statusOptions: { value: DealStatus; label: string }[] = [
  { value: "planning", label: "Planning" },
  { value: "io_sent", label: "IO Sent" },
  { value: "live", label: "Live" },
  { value: "completed", label: "Completed" },
];

const statusStyles: Record<string, string> = {
  planning: "bg-[var(--ts-band-shows)] text-[var(--ts-ink-muted-on-paper)]",
  io_sent: "bg-[var(--ts-band-shows)] text-[var(--ts-ink-on-paper)]",
  live: "bg-[var(--ts-band-brands)] text-[var(--ts-ink-on-paper)]",
  completed: "border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] text-[var(--ts-ink-muted-on-paper)]",
};

const inputClass =
  "w-full rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-4 py-2.5 text-sm text-[var(--ts-ink-on-paper)] placeholder:text-[var(--ts-ink-muted-on-paper)] focus:border-[var(--ts-accent)] focus:outline-none";
const readOnlyClass =
  "w-full rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-band-shows)] px-4 py-2.5 text-sm text-[var(--ts-ink-muted-on-paper)]";

type DealWithRelations = Deal & { show_name?: string; brand_name?: string; insertion_order?: unknown };

export default function LegacyDealClient({ dealId }: { dealId: string }) {
  const id = dealId;
  const router = useRouter();

  const [deal, setDeal] = useState<DealWithRelations | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [hasIO, setHasIO] = useState(false);
  const [isGeneratingIO, setIsGeneratingIO] = useState(false);

  // Edit form state
  const [editStatus, setEditStatus] = useState<DealStatus>("planning");
  const [editPlacement, setEditPlacement] = useState<Placement>("mid-roll");
  const [editPriceType, setEditPriceType] = useState<PriceType>("cpm");
  const [editCpmRate, setEditCpmRate] = useState<number | "">("");
  const [editFlatRate, setEditFlatRate] = useState<number | "">("");
  const [editGuaranteedDownloads, setEditGuaranteedDownloads] = useState<number | "">("");
  const [editNumEpisodes, setEditNumEpisodes] = useState<number | "">("");
  const [editFlightStart, setEditFlightStart] = useState("");
  const [editFlightEnd, setEditFlightEnd] = useState("");
  const [editNotes, setEditNotes] = useState("");

  const fetchDeal = useCallback(async () => {
    try {
      const res = await fetch(`/api/deals/${id}`);
      if (!res.ok) {
        setError(res.status === 404 ? "Deal not found" : "Failed to load deal");
        return;
      }
      const data = await res.json();
      if (data?.deal) {
        setDeal(data.deal);
        // Check if IO exists from the relation data
        if (data.deal.insertion_order) {
          setHasIO(true);
        }
      }
    } catch {
      setError("Failed to load deal");
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  // Check IO existence separately (in case relation didn't include it)
  const checkIO = useCallback(async () => {
    try {
      const res = await fetch(`/api/deals/${id}/io`);
      setHasIO(res.ok);
    } catch {
      // IO doesn't exist
    }
  }, [id]);

  useEffect(() => {
    fetchDeal();
    checkIO();
  }, [fetchDeal, checkIO]);

  if (isLoading) {
    return (
      <div className="p-4 sm:p-8">
        <div className={`mb-3 h-3 w-16 ${pulseClass}`} style={radiusStyle} />
        <div className={`mb-2 h-7 w-48 ${pulseClass}`} style={radiusStyle} />
        <div className={`h-4 w-64 ${pulseClass}`} style={radiusStyle} />
      </div>
    );
  }

  if (error || !deal) {
    return (
      <div className={`min-h-screen bg-[var(--ts-paper)] p-4 sm:p-8 ${inkText}`}>
        <Link href="/deals" className={`mb-4 flex items-center gap-1.5 text-xs ${mutedText} hover:text-[var(--ts-ink-on-paper)]`}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
          Deals
        </Link>
        <h1 className={`text-xl font-semibold ${inkText}`}>{error || "Deal not found"}</h1>
      </div>
    );
  }

  const showName = deal.show_name ?? "Unknown Show";
  const brandName = deal.brand_name ?? "Unknown Brand";

  const startEdit = () => {
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
    try {
      const cpm = editPriceType === "cpm" ? Number(editCpmRate) || deal.cpm_rate : 0;
      const downloads = Number(editGuaranteedDownloads) || deal.guaranteed_downloads;
      const episodes = Number(editNumEpisodes) || deal.num_episodes;

      const updates: Record<string, unknown> = {
        status: editStatus,
        placement: editPlacement,
        price_type: editPriceType,
        cpm_rate: cpm,
        guaranteed_downloads: downloads,
        num_episodes: episodes,
        flight_start: editFlightStart,
        flight_end: editFlightEnd,
        notes: editNotes || null,
      };

      if (editPriceType === "flat_rate") {
        updates.net_per_episode = Number(editFlatRate) || deal.net_per_episode;
        updates.total_net = (updates.net_per_episode as number) * episodes;
      }

      const res = await fetch(`/api/deals/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });

      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Failed to save changes");
        return;
      }

      // Refresh deal from API
      const refreshRes = await fetch(`/api/deals/${id}`);
      if (refreshRes.ok) {
        const data = await refreshRes.json();
        if (data?.deal) setDeal(data.deal);
      }

      setIsEditing(false);
    } catch {
      alert("Failed to save changes");
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setIsEditing(false);
  };

  const handleGenerateIO = async () => {
    setIsGeneratingIO(true);
    try {
      const res = await fetch(`/api/deals/${id}/io/generate`, { method: "POST" });
      if (res.status === 201) {
        router.push(`/deals/${id}/io`);
        return;
      }
      if (res.status === 409) {
        // IO already exists
        setHasIO(true);
        router.push(`/deals/${id}/io`);
        return;
      }
      const data = await res.json();
      alert(data.error || "Failed to generate IO");
    } catch {
      alert("Failed to generate IO");
    } finally {
      setIsGeneratingIO(false);
    }
  };

  // Computed edit values
  const editNetPerEp =
    editPriceType === "cpm" && editCpmRate && editGuaranteedDownloads
      ? ((editGuaranteedDownloads as number) / 1000) * (editCpmRate as number)
      : editPriceType === "flat_rate" && editFlatRate
        ? (editFlatRate as number)
        : 0;
  const editTotalNet = editNetPerEp * (Number(editNumEpisodes) || 0);

  return (
    <div className={`min-h-screen bg-[var(--ts-paper)] p-4 sm:p-8 ${inkText}`}>
      <div className="mb-8 max-w-3xl">
        <div className="mb-3 flex items-center gap-3">
          <Link
            href="/deals"
            className={`flex items-center gap-1.5 text-xs ${mutedText} hover:text-[var(--ts-ink-on-paper)]`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
            Deals
          </Link>
          <p className={kickerClass}>For brands</p>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className={`text-xl font-semibold tracking-tight ${inkText}`}>
              {showName}
            </h1>
            <p className={`mt-1 text-sm ${mutedText}`}>
              {brandName} &middot; {deal.num_episodes} episode{deal.num_episodes !== 1 ? "s" : ""} &middot; {deal.placement}
            </p>
          </div>
          {!isEditing && (
            <div className="flex items-center gap-3">
              <span
                className={`px-2.5 py-1 text-xs font-medium ${statusStyles[deal.status] ?? `border ${hairlineRule} ${mutedText}`}`}
                style={radiusStyle}
              >
                {deal.status.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase())}
              </span>
              <button
                onClick={startEdit}
                className={ghostBtnClass}
                style={radiusStyle}
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
        <div className="max-w-3xl space-y-6">
          {/* Status */}
          <div>
            <label className="block text-sm font-medium text-[var(--ts-ink-on-paper)] mb-1.5">Status</label>
            <select value={editStatus} onChange={(e) => setEditStatus(e.target.value as DealStatus)} className={inputClass}>
              {statusOptions.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>

          {/* Show (read-only in edit mode) */}
          <div>
            <label className="block text-sm font-medium text-[var(--ts-ink-on-paper)] mb-1.5">Show</label>
            <div className={readOnlyClass}>{showName}</div>
          </div>

          {/* Brand (read-only in edit mode) */}
          <div>
            <label className="block text-sm font-medium text-[var(--ts-ink-on-paper)] mb-1.5">Brand / Advertiser</label>
            <div className={readOnlyClass}>{brandName}</div>
          </div>

          {/* Placement */}
          <div>
            <label className="block text-sm font-medium text-[var(--ts-ink-on-paper)] mb-2">Placement</label>
            <div className="flex gap-3">
              {(["pre-roll", "mid-roll", "post-roll"] as Placement[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setEditPlacement(p)}
                  className={`flex-1 rounded-[var(--ts-radius)] border px-4 py-2.5 text-sm font-medium ${
                    editPlacement === p
                      ? "border-[var(--ts-hairline-on-paper)] bg-[var(--ts-band-brands)] text-[var(--ts-ink-on-paper)]"
                      : "border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] text-[var(--ts-ink-muted-on-paper)] hover:bg-[var(--ts-band-shows)]"
                  }`}
                >
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Price Type */}
          <div>
            <label className="block text-sm font-medium text-[var(--ts-ink-on-paper)] mb-2">Price Type</label>
            <div className="flex gap-3">
              {(["cpm", "flat_rate"] as PriceType[]).map((pt) => (
                <button
                  key={pt}
                  type="button"
                  onClick={() => setEditPriceType(pt)}
                  className={`flex-1 rounded-[var(--ts-radius)] border px-4 py-2.5 text-sm font-medium ${
                    editPriceType === pt
                      ? "border-[var(--ts-hairline-on-paper)] bg-[var(--ts-band-brands)] text-[var(--ts-ink-on-paper)]"
                      : "border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] text-[var(--ts-ink-muted-on-paper)] hover:bg-[var(--ts-band-shows)]"
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
                <label className="block text-sm font-medium text-[var(--ts-ink-on-paper)] mb-1.5">CPM Rate</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-[var(--ts-ink-muted-on-paper)]">$</span>
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
                <label className="block text-sm font-medium text-[var(--ts-ink-on-paper)] mb-1.5">Flat Rate per Episode</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-[var(--ts-ink-muted-on-paper)]">$</span>
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
              <label className="block text-sm font-medium text-[var(--ts-ink-on-paper)] mb-1.5">Guaranteed Downloads</label>
              <input
                type="number"
                value={editGuaranteedDownloads}
                onChange={(e) => setEditGuaranteedDownloads(e.target.value ? Number(e.target.value) : "")}
                min="100"
                step="100"
                className={inputClass}
              />
              <p className="text-xs text-[var(--ts-ink-muted-on-paper)] mt-1">Per episode</p>
            </div>
          </div>

          {/* Episodes + Dates */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-[var(--ts-ink-on-paper)] mb-1.5">Episodes</label>
              <input
                type="number"
                value={editNumEpisodes}
                onChange={(e) => setEditNumEpisodes(e.target.value ? Number(e.target.value) : "")}
                min="1"
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--ts-ink-on-paper)] mb-1.5">Flight Start</label>
              <input type="date" value={editFlightStart} onChange={(e) => setEditFlightStart(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--ts-ink-on-paper)] mb-1.5">Flight End</label>
              <input type="date" value={editFlightEnd} onChange={(e) => setEditFlightEnd(e.target.value)} className={inputClass} />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-[var(--ts-ink-on-paper)] mb-1.5">
              Notes <span className="text-[var(--ts-ink-muted-on-paper)] font-normal ml-1">(optional)</span>
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
            <div className="rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-band-shows)] p-5">
              <h3 className="text-sm font-semibold text-[var(--ts-ink-on-paper)] mb-3">Updated Summary</h3>
              <div className="grid grid-cols-2 gap-y-2 text-sm">
                <div className="flex justify-between col-span-2">
                  <span className="text-[var(--ts-ink-muted-on-paper)]">Rate per episode</span>
                  <span className="font-medium text-[var(--ts-ink-on-paper)]">
                    ${editNetPerEp.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between col-span-2 pt-2 border-t border-[var(--ts-hairline-on-paper)]">
                  <span className="font-semibold text-[var(--ts-ink-on-paper)]">Total net</span>
                  <span className="font-bold text-[var(--ts-ink-on-paper)]">
                    ${editTotalNet.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Save / Cancel */}
          <div className="flex items-center gap-3 pt-4 border-t border-[var(--ts-hairline-on-paper)]">
            <button
              onClick={handleCancel}
              className={ghostBtnClass}
              style={radiusStyle}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className={inkBtnClass}
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
        <div className="max-w-3xl space-y-6">
          {/* Deal Info */}
          <section className="p-5 bg-[var(--ts-paper)] rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)]">
            <h2 className="text-xs font-semibold text-[var(--ts-ink-muted-on-paper)] uppercase tracking-wider mb-4">Deal Details</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-[var(--ts-ink-on-paper)] mb-1.5">Show</label>
                <div className={readOnlyClass}>{showName}</div>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--ts-ink-on-paper)] mb-1.5">Brand</label>
                <div className={readOnlyClass}>{brandName}</div>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--ts-ink-on-paper)] mb-1.5">Placement</label>
                <div className={readOnlyClass}>{deal.placement.charAt(0).toUpperCase() + deal.placement.slice(1)}</div>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--ts-ink-on-paper)] mb-1.5">Price Type</label>
                <div className={readOnlyClass}>{deal.price_type === "cpm" ? `CPM — $${deal.cpm_rate}` : `Flat Rate — $${deal.net_per_episode.toLocaleString()}`}</div>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--ts-ink-on-paper)] mb-1.5">Guaranteed Downloads</label>
                <div className={readOnlyClass}>{deal.guaranteed_downloads.toLocaleString()} / episode</div>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--ts-ink-on-paper)] mb-1.5">Episodes</label>
                <div className={readOnlyClass}>{deal.num_episodes}</div>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--ts-ink-on-paper)] mb-1.5">Flight Start</label>
                <div className={readOnlyClass}>{formatDateOnly(deal.flight_start)}</div>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--ts-ink-on-paper)] mb-1.5">Flight End</label>
                <div className={readOnlyClass}>{formatDateOnly(deal.flight_end)}</div>
              </div>
              {deal.notes && (
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-[var(--ts-ink-on-paper)] mb-1.5">Notes</label>
                  <div className={readOnlyClass}>{deal.notes}</div>
                </div>
              )}
            </div>
          </section>

          {/* Financials */}
          <section className="p-5 bg-[var(--ts-paper)] rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)]">
            <h2 className="text-xs font-semibold text-[var(--ts-ink-muted-on-paper)] uppercase tracking-wider mb-4">Financials</h2>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center p-3 rounded-[var(--ts-radius)] bg-[var(--ts-band-shows)]">
                <div className="text-xs text-[var(--ts-ink-muted-on-paper)] font-medium uppercase tracking-wider mb-1">Per Episode</div>
                <div className="text-lg font-bold text-[var(--ts-ink-on-paper)]">
                  ${deal.net_per_episode.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
              <div className="text-center p-3 rounded-[var(--ts-radius)] bg-[var(--ts-band-shows)]">
                <div className="text-xs text-[var(--ts-ink-muted-on-paper)] font-medium uppercase tracking-wider mb-1">Episodes</div>
                <div className="text-lg font-bold text-[var(--ts-ink-on-paper)]">{deal.num_episodes}</div>
              </div>
              <div className="text-center p-3 rounded-[var(--ts-radius)] bg-[var(--ts-band-shows)]">
                <div className="text-xs text-[var(--ts-ink-muted-on-paper)] font-medium uppercase tracking-wider mb-1">Total Net</div>
                <div className="text-lg font-bold text-[var(--ts-ink-on-paper)]">
                  ${deal.total_net.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
            </div>
          </section>

          {/* Exclusivity */}
          {deal.competitor_exclusion.length > 0 && (
            <section className="p-5 bg-[var(--ts-paper)] rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)]">
              <h2 className="text-xs font-semibold text-[var(--ts-ink-muted-on-paper)] uppercase tracking-wider mb-3">Competitor Exclusion</h2>
              <div className="flex items-center gap-2 flex-wrap">
                {deal.competitor_exclusion.map((comp) => (
                  <span key={comp} className="rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-band-shows)] px-2.5 py-1 text-xs font-medium text-[var(--ts-ink-on-paper)]">
                    {comp}
                  </span>
                ))}
              </div>
              <div className="flex items-center gap-4 mt-3 text-xs text-[var(--ts-ink-muted-on-paper)]">
                <span>{deal.exclusivity_days} days exclusivity</span>
                <span>{deal.rofr_days} days ROFR</span>
              </div>
            </section>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3 pt-4 border-t border-[var(--ts-hairline-on-paper)]">
            {hasIO ? (
              <Link
                href={`/deals/${deal.id}/io`}
                className={inkBtnClass}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                View IO
              </Link>
            ) : deal.status === "planning" ? (
              <button
                onClick={handleGenerateIO}
                disabled={isGeneratingIO}
                className={inkBtnClass}
              >
                {isGeneratingIO ? (
                  <>
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Generating IO...
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                    Generate IO
                  </>
                )}
              </button>
            ) : null}
            <button
              onClick={startEdit}
              className={ghostBtnClass}
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
