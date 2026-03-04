"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getShowsByAgent } from "@/lib/data";
import type { Placement, PriceType } from "@/lib/data";

const agentId = "user-agent-001";
const agentShows = getShowsByAgent(agentId);

export default function NewDealPage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form state
  const [showId, setShowId] = useState("");
  const [brandName, setBrandName] = useState("");
  const [placement, setPlacement] = useState<Placement>("mid-roll");
  const [adType, setAdType] = useState<"host_read" | "dynamic_insertion">("host_read");
  const [priceType, setPriceType] = useState<PriceType>("cpm");
  const [cpmRate, setCpmRate] = useState<number | "">("");
  const [flatRate, setFlatRate] = useState<number | "">("");
  const [guaranteedDownloads, setGuaranteedDownloads] = useState<number | "">("");
  const [isScripted, setIsScripted] = useState(false);
  const [isPersonalExperience, setIsPersonalExperience] = useState(true);
  const [postDates, setPostDates] = useState<string[]>([""]);
  const [notes, setNotes] = useState("");
  const [showAgency, setShowAgency] = useState(false);
  const [agencyName, setAgencyName] = useState("");
  const [agencyContact, setAgencyContact] = useState("");
  const [agencyEmail, setAgencyEmail] = useState("");

  const selectedShow = agentShows.find((s) => s.id === showId);

  // Auto-fill CPM from show rate card when show + placement changes
  const handleShowChange = (id: string) => {
    setShowId(id);
    const show = agentShows.find((s) => s.id === id);
    if (show && priceType === "cpm") {
      const rate =
        placement === "pre-roll"
          ? show.rate_card.preroll_cpm
          : placement === "mid-roll"
          ? show.rate_card.midroll_cpm
          : show.rate_card.postroll_cpm;
      if (rate) setCpmRate(rate);
    }
    if (show && !guaranteedDownloads) {
      setGuaranteedDownloads(show.audience_size);
    }
  };

  const handlePlacementChange = (p: Placement) => {
    setPlacement(p);
    if (selectedShow && priceType === "cpm") {
      const rate =
        p === "pre-roll"
          ? selectedShow.rate_card.preroll_cpm
          : p === "mid-roll"
          ? selectedShow.rate_card.midroll_cpm
          : selectedShow.rate_card.postroll_cpm;
      if (rate) setCpmRate(rate);
    }
  };

  const addPostDate = () => setPostDates([...postDates, ""]);
  const removePostDate = (index: number) =>
    setPostDates(postDates.filter((_, i) => i !== index));
  const updatePostDate = (index: number, value: string) =>
    setPostDates(postDates.map((d, i) => (i === index ? value : d)));

  // Calculations
  const numEpisodes = postDates.filter((d) => d !== "").length;
  const netPerEpisode =
    priceType === "cpm" && cpmRate && guaranteedDownloads
      ? ((guaranteedDownloads as number) / 1000) * (cpmRate as number)
      : priceType === "flat_rate" && flatRate
      ? (flatRate as number)
      : 0;
  const totalNet = netPerEpisode * Math.max(numEpisodes, 1);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);
    // Simulate creating the deal — will wire to Supabase later
    await new Promise((resolve) => setTimeout(resolve, 1000));
    router.push("/deals");
  };

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-8">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors mb-4"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
          Back
        </button>
        <h1 className="text-2xl font-bold text-[var(--brand-text)] tracking-tight">New Deal</h1>
        <p className="text-sm text-[var(--brand-text-secondary)] mt-1">
          Create a sponsorship deal for one of your shows.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Show Selection */}
        <div>
          <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">Show</label>
          <select
            value={showId}
            onChange={(e) => handleShowChange(e.target.value)}
            required
            className="w-full px-4 py-2.5 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30 focus:border-[var(--brand-blue)] transition-all"
          >
            <option value="">Select a show</option>
            {agentShows.map((show) => (
              <option key={show.id} value={show.id}>
                {show.name} — {show.audience_size.toLocaleString()} avg downloads
              </option>
            ))}
          </select>
        </div>

        {/* Brand Name */}
        <div>
          <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">Brand / Advertiser</label>
          <input
            type="text"
            value={brandName}
            onChange={(e) => setBrandName(e.target.value)}
            required
            placeholder="e.g., Athletic Greens"
            className="w-full px-4 py-2.5 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text)] text-sm placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30 focus:border-[var(--brand-blue)] transition-all"
          />
        </div>

        {/* Agency (optional) */}
        <div className="rounded-xl border border-[var(--brand-border)] bg-[var(--brand-surface)] p-5">
          <div className="flex items-center justify-between mb-3">
            <label className="text-sm font-medium text-[var(--brand-text)]">Agency</label>
            <button
              type="button"
              onClick={() => setShowAgency(!showAgency)}
              className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${
                showAgency
                  ? "border-[var(--brand-blue)] bg-[var(--brand-blue)]/[0.06] text-[var(--brand-blue)]"
                  : "border-[var(--brand-border)] text-[var(--brand-text-muted)] hover:border-[var(--brand-text-muted)]"
              }`}
            >
              {showAgency ? "Remove Agency" : "Add Agency"}
            </button>
          </div>
          {showAgency ? (
            <div className="space-y-3">
              <input
                type="text"
                value={agencyName}
                onChange={(e) => setAgencyName(e.target.value)}
                placeholder="Agency name, e.g., VeritoneOne"
                className="w-full px-4 py-2.5 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text)] text-sm placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30 focus:border-[var(--brand-blue)] transition-all"
              />
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  value={agencyContact}
                  onChange={(e) => setAgencyContact(e.target.value)}
                  placeholder="Contact name"
                  className="w-full px-4 py-2.5 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text)] text-sm placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30 focus:border-[var(--brand-blue)] transition-all"
                />
                <input
                  type="email"
                  value={agencyEmail}
                  onChange={(e) => setAgencyEmail(e.target.value)}
                  placeholder="billing@agency.com"
                  className="w-full px-4 py-2.5 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text)] text-sm placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30 focus:border-[var(--brand-blue)] transition-all"
                />
              </div>
            </div>
          ) : (
            <p className="text-xs text-[var(--brand-text-muted)]">
              No agency — brand is the billing party. Add one if a media buying agency is involved.
            </p>
          )}
        </div>

        {/* Placement */}
        <div>
          <label className="block text-sm font-medium text-[var(--brand-text)] mb-2">Placement</label>
          <div className="flex gap-3">
            {(["pre-roll", "mid-roll", "post-roll"] as Placement[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => handlePlacementChange(p)}
                className={`flex-1 px-4 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                  placement === p
                    ? "border-[var(--brand-blue)] bg-[var(--brand-blue)]/[0.06] text-[var(--brand-blue)]"
                    : "border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text-secondary)] hover:border-[var(--brand-text-muted)]"
                }`}
              >
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Ad Type */}
        <div>
          <label className="block text-sm font-medium text-[var(--brand-text)] mb-2">Ad Type</label>
          <div className="flex gap-3">
            {[
              { id: "host_read" as const, label: "Host-Read Baked-In" },
              { id: "dynamic_insertion" as const, label: "Dynamic Insertion" },
            ].map((type) => (
              <button
                key={type.id}
                type="button"
                onClick={() => setAdType(type.id)}
                className={`flex-1 px-4 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                  adType === type.id
                    ? "border-[var(--brand-blue)] bg-[var(--brand-blue)]/[0.06] text-[var(--brand-blue)]"
                    : "border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text-secondary)] hover:border-[var(--brand-text-muted)]"
                }`}
              >
                {type.label}
              </button>
            ))}
          </div>
        </div>

        {/* Price Type */}
        <div>
          <label className="block text-sm font-medium text-[var(--brand-text)] mb-2">Price Type</label>
          <div className="flex gap-3">
            {[
              { id: "cpm" as const, label: "CPM" },
              { id: "flat_rate" as const, label: "Flat Rate" },
            ].map((type) => (
              <button
                key={type.id}
                type="button"
                onClick={() => setPriceType(type.id)}
                className={`flex-1 px-4 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                  priceType === type.id
                    ? "border-[var(--brand-blue)] bg-[var(--brand-blue)]/[0.06] text-[var(--brand-blue)]"
                    : "border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text-secondary)] hover:border-[var(--brand-text-muted)]"
                }`}
              >
                {type.label}
              </button>
            ))}
          </div>
        </div>

        {/* CPM / Flat Rate + Downloads */}
        <div className="grid grid-cols-2 gap-4">
          {priceType === "cpm" ? (
            <div>
              <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">CPM Rate</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-[var(--brand-text-muted)]">$</span>
                <input
                  type="number"
                  value={cpmRate}
                  onChange={(e) => setCpmRate(e.target.value ? Number(e.target.value) : "")}
                  required
                  min="1"
                  step="0.01"
                  placeholder="25"
                  className="w-full pl-8 pr-4 py-2.5 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text)] text-sm placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30 focus:border-[var(--brand-blue)] transition-all"
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
                  value={flatRate}
                  onChange={(e) => setFlatRate(e.target.value ? Number(e.target.value) : "")}
                  required
                  min="1"
                  step="1"
                  placeholder="875"
                  className="w-full pl-8 pr-4 py-2.5 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text)] text-sm placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30 focus:border-[var(--brand-blue)] transition-all"
                />
              </div>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">Guaranteed Downloads</label>
            <input
              type="number"
              value={guaranteedDownloads}
              onChange={(e) => setGuaranteedDownloads(e.target.value ? Number(e.target.value) : "")}
              required
              min="100"
              step="100"
              placeholder="35000"
              className="w-full px-4 py-2.5 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text)] text-sm placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30 focus:border-[var(--brand-blue)] transition-all"
            />
            <p className="text-xs text-[var(--brand-text-muted)] mt-1.5">Per episode</p>
          </div>
        </div>

        {/* Content Options */}
        <div>
          <label className="block text-sm font-medium text-[var(--brand-text)] mb-2">Content Options</label>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setIsScripted(!isScripted)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                isScripted
                  ? "border-[var(--brand-blue)] bg-[var(--brand-blue)]/[0.06] text-[var(--brand-blue)]"
                  : "border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text-secondary)] hover:border-[var(--brand-text-muted)]"
              }`}
            >
              {isScripted && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              )}
              Scripted
            </button>
            <button
              type="button"
              onClick={() => setIsPersonalExperience(!isPersonalExperience)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                isPersonalExperience
                  ? "border-[var(--brand-blue)] bg-[var(--brand-blue)]/[0.06] text-[var(--brand-blue)]"
                  : "border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text-secondary)] hover:border-[var(--brand-text-muted)]"
              }`}
            >
              {isPersonalExperience && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              )}
              Personal Experience
            </button>
          </div>
          <p className="text-xs text-[var(--brand-text-muted)] mt-2">
            Personal experience means the host has used the product. Most brands prefer this.
          </p>
        </div>

        {/* Post Dates */}
        <div>
          <label className="block text-sm font-medium text-[var(--brand-text)] mb-2">Post Dates</label>
          <div className="space-y-2">
            {postDates.map((date, index) => (
              <div key={index} className="flex items-center gap-2">
                <span className="text-xs text-[var(--brand-text-muted)] w-6 text-right shrink-0">
                  {index + 1}.
                </span>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => updatePostDate(index, e.target.value)}
                  required
                  className="flex-1 px-4 py-2.5 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30 focus:border-[var(--brand-blue)] transition-all"
                />
                {postDates.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removePostDate(index)}
                    className="p-2 rounded-lg text-[var(--brand-text-muted)] hover:text-[var(--brand-error)] hover:bg-[var(--brand-error)]/[0.06] transition-all"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addPostDate}
            className="flex items-center gap-1.5 mt-2 text-sm text-[var(--brand-blue)] hover:text-[var(--brand-blue-light)] font-medium transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add episode
          </button>
          <p className="text-xs text-[var(--brand-text-muted)] mt-1.5">
            Each date is a separate episode/line item on the IO.
          </p>
        </div>

        {/* Notes */}
        <div>
          <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">
            Notes <span className="text-[var(--brand-text-muted)] font-normal ml-1">(optional)</span>
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Any additional deal context, competitor exclusions, etc."
            className="w-full px-4 py-2.5 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text)] text-sm placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30 focus:border-[var(--brand-blue)] transition-all resize-none"
          />
        </div>

        {/* Deal Summary */}
        {(netPerEpisode > 0 || selectedShow) && (
          <div className="rounded-xl border border-[var(--brand-border)] bg-[var(--brand-surface)] p-5">
            <h3 className="text-sm font-semibold text-[var(--brand-text)] mb-3">Deal Summary</h3>
            <div className="grid grid-cols-2 gap-y-2 gap-x-8 text-sm">
              {selectedShow && (
                <div className="flex justify-between col-span-2">
                  <span className="text-[var(--brand-text-muted)]">Show</span>
                  <span className="font-medium text-[var(--brand-text)]">{selectedShow.name}</span>
                </div>
              )}
              {showAgency && agencyName && (
                <div className="flex justify-between col-span-2">
                  <span className="text-[var(--brand-text-muted)]">Agency</span>
                  <span className="font-medium text-[var(--brand-text)]">{agencyName}</span>
                </div>
              )}
              {!showAgency && brandName && (
                <div className="flex justify-between col-span-2">
                  <span className="text-[var(--brand-text-muted)]">Billing party</span>
                  <span className="font-medium text-[var(--brand-text)]">{brandName} (direct)</span>
                </div>
              )}
              {numEpisodes > 0 && (
                <div className="flex justify-between col-span-2">
                  <span className="text-[var(--brand-text-muted)]">Episodes</span>
                  <span className="font-medium text-[var(--brand-text)]">{numEpisodes}</span>
                </div>
              )}
              {netPerEpisode > 0 && (
                <>
                  <div className="flex justify-between col-span-2">
                    <span className="text-[var(--brand-text-muted)]">Rate per episode</span>
                    <span className="font-medium text-[var(--brand-text)]">
                      ${netPerEpisode.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="flex justify-between col-span-2 pt-2 border-t border-[var(--brand-border)]">
                    <span className="font-semibold text-[var(--brand-text)]">Total net</span>
                    <span className="font-bold text-[var(--brand-blue)]">
                      ${totalNet.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Submit */}
        <div className="border-t border-[var(--brand-border)] pt-6">
          <button
            type="submit"
            disabled={isSubmitting || !showId || !brandName}
            className="w-full flex items-center justify-center gap-2 bg-[var(--brand-blue)] hover:bg-[var(--brand-blue-light)] disabled:opacity-50 disabled:cursor-not-allowed text-white py-3 rounded-xl text-sm font-semibold transition-all"
          >
            {isSubmitting ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Creating deal...
              </>
            ) : (
              <>
                Create Deal
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
