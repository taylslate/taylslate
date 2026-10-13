"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Placement, PriceType, Show } from "@/lib/data";
import { tokens } from "@/lib/brand/tokens";

const radiusStyle = { borderRadius: tokens.radius };
const inkText = "text-[var(--ts-ink-on-paper)]";
const mutedText = "text-[var(--ts-ink-muted-on-paper)]";
const kickerClass =
  "text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ts-accent)]";
const inputClass =
  "min-w-0 w-full rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-4 py-2.5 text-sm text-[var(--ts-ink-on-paper)] placeholder:text-[var(--ts-ink-muted-on-paper)] focus:border-[var(--ts-accent)] focus:outline-none";
const labelClass = "mb-1.5 block text-sm font-medium text-[var(--ts-ink-on-paper)]";
const panelClass = "border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] p-5";
const chipOn =
  "border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-band-brands)] text-[var(--ts-ink-on-paper)]";
const chipOff =
  "border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] text-[var(--ts-ink-muted-on-paper)] hover:bg-[var(--ts-band-shows)]";
const linkClass =
  "mt-2 flex items-center gap-1.5 text-sm font-medium text-[var(--ts-accent)] hover:underline";

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1.5 text-xs text-[var(--ts-accent)]">{message}</p>;
}

export default function NewDealPage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [shows, setShows] = useState<Show[]>([]);
  const [showsError, setShowsError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/shows?limit=100")
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(data?.error || "Could not load shows");
        }
        if (!Array.isArray(data)) throw new Error("Could not load shows");
        if (!cancelled) setShows(data as Show[]);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setShowsError(err instanceof Error ? err.message : "Could not load shows");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  const selectedShow = shows.find((s) => s.id === showId);

  // Auto-fill CPM from show rate card when show + placement changes
  const handleShowChange = (id: string) => {
    setShowId(id);
    const show = shows.find((s) => s.id === id);
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
    setFieldErrors({});
    setSubmitError(null);

    const dates = postDates.filter((d) => d !== "").sort();
    const noteParts = [
      brandName.trim() ? `Advertiser: ${brandName.trim()}` : "",
      showAgency && agencyName.trim()
        ? `Agency: ${agencyName.trim()}${agencyContact.trim() ? ` (${agencyContact.trim()})` : ""}${agencyEmail.trim() ? ` ${agencyEmail.trim()}` : ""}`
        : "",
      notes.trim(),
    ].filter(Boolean);

    try {
      const res = await fetch("/api/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          show_id: showId,
          num_episodes: dates.length,
          placement,
          ad_format: adType,
          price_type: priceType,
          cpm_rate: priceType === "cpm" ? cpmRate : undefined,
          flat_rate: priceType === "flat_rate" ? flatRate : undefined,
          guaranteed_downloads: guaranteedDownloads,
          is_scripted: isScripted,
          is_personal_experience: isPersonalExperience,
          reader_type: "host_read",
          content_type: "evergreen",
          pixel_required: false,
          flight_start: dates[0],
          flight_end: dates[dates.length - 1],
          notes: noteParts.join("\n") || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 400) {
        setFieldErrors(data.fields && typeof data.fields === "object" ? data.fields : {});
        setSubmitError(typeof data.error === "string" ? data.error : "Check the highlighted fields");
        return;
      }
      if (!res.ok || !data.deal?.id) {
        setSubmitError(typeof data.error === "string" ? data.error : "Failed to create deal");
        return;
      }
      router.push(`/deals/${data.deal.id}`);
    } catch {
      setSubmitError("Network error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl p-4 sm:p-8">
      <div className="mb-8">
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
          <button
            onClick={() => router.back()}
            className={`flex items-center gap-1.5 text-xs ${mutedText} hover:text-[var(--ts-ink-on-paper)]`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
            Back
          </button>
          <p className={`${kickerClass} whitespace-nowrap`}>For brands</p>
        </div>
        <h1 className={`text-2xl font-semibold tracking-tight ${inkText}`}>New Deal</h1>
        <p className={`mt-1 text-sm ${mutedText}`}>
          Create a sponsorship deal for one of your shows.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Show Selection */}
        <div>
          <label className={labelClass}>Show</label>
          <select
            value={showId}
            onChange={(e) => handleShowChange(e.target.value)}
            required
            className={inputClass}
          >
            <option value="">{showsError ? "Shows unavailable" : "Select a show"}</option>
            {shows.map((show) => (
              <option key={show.id} value={show.id}>
                {show.name} — {show.audience_size.toLocaleString()} avg downloads
              </option>
            ))}
          </select>
          <FieldError message={fieldErrors.show_id} />
          {showsError && <p className="mt-1.5 text-xs text-[var(--ts-accent)]">{showsError}</p>}
        </div>

        {/* Brand Name */}
        <div>
          <label className={labelClass}>Brand / Advertiser</label>
          <input
            type="text"
            value={brandName}
            onChange={(e) => setBrandName(e.target.value)}
            required
            placeholder="e.g., Athletic Greens"
            className={inputClass}
          />
        </div>

        {/* Agency (optional) */}
        <div className={panelClass} style={radiusStyle}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <label className={`text-sm font-medium ${inkText}`}>Agency</label>
            <button
              type="button"
              onClick={() => setShowAgency(!showAgency)}
              className={`rounded-[var(--ts-radius)] border px-3 py-1.5 text-xs font-medium ${
                showAgency ? chipOn : chipOff
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
                className={inputClass}
              />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <input
                  type="text"
                  value={agencyContact}
                  onChange={(e) => setAgencyContact(e.target.value)}
                  placeholder="Contact name"
                  className={inputClass}
                />
                <input
                  type="email"
                  value={agencyEmail}
                  onChange={(e) => setAgencyEmail(e.target.value)}
                  placeholder="billing@agency.com"
                  className={inputClass}
                />
              </div>
            </div>
          ) : (
            <p className="text-xs text-[var(--ts-ink-muted-on-paper)]">
              No agency — brand is the billing party. Add one if a media buying agency is involved.
            </p>
          )}
        </div>

        {/* Placement */}
        <div>
          <label className="block text-sm font-medium text-[var(--ts-ink-on-paper)] mb-2">Placement</label>
          <div className="flex flex-wrap gap-3">
            {(["pre-roll", "mid-roll", "post-roll"] as Placement[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => handlePlacementChange(p)}
                className={`flex-1 px-4 py-2.5 rounded-[var(--ts-radius)] border text-sm font-medium transition-all ${
                  placement === p
                    ? "border-[var(--ts-hairline-on-paper)] bg-[var(--ts-band-brands)] text-[var(--ts-ink-on-paper)]"
                    : "border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] text-[var(--ts-ink-muted-on-paper)] hover:bg-[var(--ts-band-shows)]"
                }`}
              >
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Ad Type */}
        <div>
          <label className="block text-sm font-medium text-[var(--ts-ink-on-paper)] mb-2">Ad Type</label>
          <div className="flex flex-wrap gap-3">
            {[
              { id: "host_read" as const, label: "Host-Read Baked-In" },
              { id: "dynamic_insertion" as const, label: "Dynamic Insertion" },
            ].map((type) => (
              <button
                key={type.id}
                type="button"
                onClick={() => setAdType(type.id)}
                className={`flex-1 px-4 py-2.5 rounded-[var(--ts-radius)] border text-sm font-medium transition-all ${
                  adType === type.id
                    ? "border-[var(--ts-hairline-on-paper)] bg-[var(--ts-band-brands)] text-[var(--ts-ink-on-paper)]"
                    : "border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] text-[var(--ts-ink-muted-on-paper)] hover:bg-[var(--ts-band-shows)]"
                }`}
              >
                {type.label}
              </button>
            ))}
          </div>
        </div>

        {/* Price Type */}
        <div>
          <label className="block text-sm font-medium text-[var(--ts-ink-on-paper)] mb-2">Price Type</label>
          <div className="flex flex-wrap gap-3">
            {[
              { id: "cpm" as const, label: "CPM" },
              { id: "flat_rate" as const, label: "Flat Rate" },
            ].map((type) => (
              <button
                key={type.id}
                type="button"
                onClick={() => setPriceType(type.id)}
                className={`flex-1 px-4 py-2.5 rounded-[var(--ts-radius)] border text-sm font-medium transition-all ${
                  priceType === type.id
                    ? "border-[var(--ts-hairline-on-paper)] bg-[var(--ts-band-brands)] text-[var(--ts-ink-on-paper)]"
                    : "border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] text-[var(--ts-ink-muted-on-paper)] hover:bg-[var(--ts-band-shows)]"
                }`}
              >
                {type.label}
              </button>
            ))}
          </div>
        </div>

        {/* CPM / Flat Rate + Downloads */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {priceType === "cpm" ? (
            <div>
              <label className="block text-sm font-medium text-[var(--ts-ink-on-paper)] mb-1.5">CPM Rate</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-[var(--ts-ink-muted-on-paper)]">$</span>
                <input
                  type="number"
                  value={cpmRate}
                  onChange={(e) => setCpmRate(e.target.value ? Number(e.target.value) : "")}
                  required
                  min="1"
                  step="0.01"
                  placeholder="25"
                  className="min-w-0 w-full rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] py-2.5 pl-8 pr-4 text-sm text-[var(--ts-ink-on-paper)] placeholder:text-[var(--ts-ink-muted-on-paper)] focus:border-[var(--ts-accent)] focus:outline-none"
                />
              </div>
              <FieldError message={fieldErrors.cpm_rate} />
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-[var(--ts-ink-on-paper)] mb-1.5">Flat Rate per Episode</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-[var(--ts-ink-muted-on-paper)]">$</span>
                <input
                  type="number"
                  value={flatRate}
                  onChange={(e) => setFlatRate(e.target.value ? Number(e.target.value) : "")}
                  required
                  min="1"
                  step="1"
                  placeholder="875"
                  className="min-w-0 w-full rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] py-2.5 pl-8 pr-4 text-sm text-[var(--ts-ink-on-paper)] placeholder:text-[var(--ts-ink-muted-on-paper)] focus:border-[var(--ts-accent)] focus:outline-none"
                />
                <FieldError message={fieldErrors.flat_rate} />
              </div>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-[var(--ts-ink-on-paper)] mb-1.5">Guaranteed Downloads</label>
            <input
              type="number"
              value={guaranteedDownloads}
              onChange={(e) => setGuaranteedDownloads(e.target.value ? Number(e.target.value) : "")}
              required
              min="100"
              step="100"
              placeholder="35000"
              className="min-w-0 w-full rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-4 py-2.5 text-sm text-[var(--ts-ink-on-paper)] placeholder:text-[var(--ts-ink-muted-on-paper)] focus:border-[var(--ts-accent)] focus:outline-none"
            />
            <p className="text-xs text-[var(--ts-ink-muted-on-paper)] mt-1.5">Per episode</p>
            <FieldError message={fieldErrors.guaranteed_downloads} />
          </div>
        </div>

        {/* Content Options */}
        <div>
          <label className="block text-sm font-medium text-[var(--ts-ink-on-paper)] mb-2">Content Options</label>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setIsScripted(!isScripted)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-[var(--ts-radius)] border text-sm font-medium transition-all ${
                isScripted
                  ? "border-[var(--ts-hairline-on-paper)] bg-[var(--ts-band-brands)] text-[var(--ts-ink-on-paper)]"
                  : "border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] text-[var(--ts-ink-muted-on-paper)] hover:bg-[var(--ts-band-shows)]"
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
              className={`flex items-center gap-2 px-4 py-2.5 rounded-[var(--ts-radius)] border text-sm font-medium transition-all ${
                isPersonalExperience
                  ? "border-[var(--ts-hairline-on-paper)] bg-[var(--ts-band-brands)] text-[var(--ts-ink-on-paper)]"
                  : "border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] text-[var(--ts-ink-muted-on-paper)] hover:bg-[var(--ts-band-shows)]"
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
          <p className="text-xs text-[var(--ts-ink-muted-on-paper)] mt-2">
            Personal experience means the host has used the product. Most brands prefer this.
          </p>
        </div>

        {/* Post Dates */}
        <div>
          <label className="block text-sm font-medium text-[var(--ts-ink-on-paper)] mb-2">Post Dates</label>
          <div className="space-y-2">
            {postDates.map((date, index) => (
              <div key={index} className="flex items-center gap-2">
                <span className="text-xs text-[var(--ts-ink-muted-on-paper)] w-6 text-right shrink-0">
                  {index + 1}.
                </span>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => updatePostDate(index, e.target.value)}
                  required
                  className="min-w-0 flex-1 rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-4 py-2.5 text-sm text-[var(--ts-ink-on-paper)] focus:border-[var(--ts-accent)] focus:outline-none"
                />
                {postDates.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removePostDate(index)}
                    className="rounded-[var(--ts-radius)] p-2 text-[var(--ts-ink-muted-on-paper)] hover:text-[var(--ts-accent)]"
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
            className={linkClass}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add episode
          </button>
          <p className="text-xs text-[var(--ts-ink-muted-on-paper)] mt-1.5">
            Each date is a separate episode/line item on the IO.
          </p>
          <FieldError message={fieldErrors.flight_start || fieldErrors.flight_end || fieldErrors.num_episodes} />
        </div>

        {/* Notes */}
        <div>
          <label className="block text-sm font-medium text-[var(--ts-ink-on-paper)] mb-1.5">
            Notes <span className="text-[var(--ts-ink-muted-on-paper)] font-normal ml-1">(optional)</span>
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Any additional deal context, competitor exclusions, etc."
            className="min-w-0 w-full resize-none rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-4 py-2.5 text-sm text-[var(--ts-ink-on-paper)] placeholder:text-[var(--ts-ink-muted-on-paper)] focus:border-[var(--ts-accent)] focus:outline-none"
          />
        </div>

        {/* Deal Summary */}
        {(netPerEpisode > 0 || selectedShow) && (
          <div className="rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] p-5">
            <h3 className="text-sm font-semibold text-[var(--ts-ink-on-paper)] mb-3">Deal Summary</h3>
            <div className="grid grid-cols-2 gap-y-2 gap-x-8 text-sm">
              {selectedShow && (
                <div className="flex justify-between col-span-2">
                  <span className="text-[var(--ts-ink-muted-on-paper)]">Show</span>
                  <span className="font-medium text-[var(--ts-ink-on-paper)]">{selectedShow.name}</span>
                </div>
              )}
              {showAgency && agencyName && (
                <div className="flex justify-between col-span-2">
                  <span className="text-[var(--ts-ink-muted-on-paper)]">Agency</span>
                  <span className="font-medium text-[var(--ts-ink-on-paper)]">{agencyName}</span>
                </div>
              )}
              {!showAgency && brandName && (
                <div className="flex justify-between col-span-2">
                  <span className="text-[var(--ts-ink-muted-on-paper)]">Billing party</span>
                  <span className="font-medium text-[var(--ts-ink-on-paper)]">{brandName} (direct)</span>
                </div>
              )}
              {numEpisodes > 0 && (
                <div className="flex justify-between col-span-2">
                  <span className="text-[var(--ts-ink-muted-on-paper)]">Episodes</span>
                  <span className="font-medium text-[var(--ts-ink-on-paper)]">{numEpisodes}</span>
                </div>
              )}
              {netPerEpisode > 0 && (
                <>
                  <div className="flex justify-between col-span-2">
                    <span className="text-[var(--ts-ink-muted-on-paper)]">Rate per episode</span>
                    <span className="font-medium text-[var(--ts-ink-on-paper)]">
                      ${netPerEpisode.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="flex justify-between col-span-2 pt-2 border-t border-[var(--ts-hairline-on-paper)]">
                    <span className="font-semibold text-[var(--ts-ink-on-paper)]">Total net</span>
                    <span className={`font-bold ${inkText}`}>
                      ${totalNet.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Submit */}
        <div className="border-t border-[var(--ts-hairline-on-paper)] pt-6">
          {submitError && (
            <p className="mb-3 text-sm text-[var(--ts-accent)]">{submitError}</p>
          )}
          <button
            type="submit"
            disabled={isSubmitting || !showId || !brandName}
            className="flex w-full items-center justify-center gap-2 rounded-[var(--ts-radius)] bg-[var(--ts-ink-on-paper)] py-3 text-sm font-medium text-[var(--ts-paper)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
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
