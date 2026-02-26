"use client";

import { useState } from "react";
import Link from "next/link";
import type { Deal, Show, InsertionOrder, Profile, IOLineItem } from "@/lib/data";

interface IOGeneratorFormProps {
  deal: Deal;
  show: Show;
  existingIO?: InsertionOrder;
  brand: Profile;
  agency?: Profile;
  agent?: Profile;
}

function generateIONumber(): string {
  const year = new Date().getFullYear();
  return `IO-${year}-${String(3).padStart(4, "0")}`; // next after 0001, 0002
}

function generateLineItems(deal: Deal, show: Show): IOLineItem[] {
  const items: IOLineItem[] = [];
  const startDate = new Date(deal.flight_start);

  // Determine spacing based on episode cadence
  const cadenceDays: Record<string, number> = {
    daily: 7, // weekly for ads even if daily show
    weekly: 7,
    biweekly: 14,
    monthly: 28,
  };
  const spacing = cadenceDays[show.episode_cadence] ?? 7;

  for (let i = 0; i < deal.num_episodes; i++) {
    const postDate = new Date(startDate);
    postDate.setDate(postDate.getDate() + i * spacing);

    items.push({
      id: `line-new-${i + 1}`,
      format: show.platform,
      post_date: postDate.toISOString().split("T")[0],
      guaranteed_downloads: deal.guaranteed_downloads,
      show_name: show.name,
      placement: deal.placement,
      is_scripted: deal.is_scripted,
      is_personal_experience: deal.is_personal_experience,
      reader_type: deal.reader_type,
      content_type: deal.content_type,
      pixel_required: deal.pixel_required,
      gross_rate: deal.gross_per_episode ?? deal.net_per_episode,
      gross_cpm: deal.gross_cpm ?? deal.cpm_rate,
      price_type: deal.price_type,
      net_due: deal.net_per_episode,
      verified: false,
      make_good_triggered: false,
    });
  }
  return items;
}

const inputClass =
  "w-full px-3 py-2 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface)] text-sm text-[var(--brand-text)] placeholder-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)] focus:border-transparent transition-all";
const labelClass = "text-sm font-medium text-[var(--brand-text)] mb-1.5 block";
const readOnlyClass =
  "w-full px-3 py-2 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface)]/60 text-sm text-[var(--brand-text-secondary)] cursor-default";

export default function IOGeneratorForm({ deal, show, existingIO, brand, agency, agent }: IOGeneratorFormProps) {
  const isViewMode = !!existingIO;

  const [ioNumber] = useState(existingIO?.io_number ?? generateIONumber());
  const [lineItems, setLineItems] = useState<IOLineItem[]>(
    existingIO?.line_items ?? generateLineItems(deal, show)
  );
  const [paymentTerms, setPaymentTerms] = useState(existingIO?.payment_terms ?? "Net 30 EOM");
  const [exclusivityDays, setExclusivityDays] = useState(existingIO?.exclusivity_days ?? deal.exclusivity_days);
  const [rofrDays, setRofrDays] = useState(existingIO?.rofr_days ?? deal.rofr_days);
  const [cancellationDays, setCancellationDays] = useState(existingIO?.cancellation_notice_days ?? 14);
  const [trackingDays, setTrackingDays] = useState(existingIO?.download_tracking_days ?? 45);
  const [makeGoodThreshold, setMakeGoodThreshold] = useState(existingIO?.make_good_threshold ?? 0.10);
  const [showPreview, setShowPreview] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const totalDownloads = lineItems.reduce((sum, li) => sum + li.guaranteed_downloads, 0);
  const totalGross = lineItems.reduce((sum, li) => sum + li.gross_rate, 0);
  const totalNet = lineItems.reduce((sum, li) => sum + li.net_due, 0);

  const updateLineItem = (index: number, field: keyof IOLineItem, value: string | number) => {
    setLineItems((prev) =>
      prev.map((li, i) => (i === index ? { ...li, [field]: value } : li))
    );
  };

  const handleSave = async () => {
    setIsSaving(true);
    // Simulate save delay — will wire to Supabase later
    await new Promise((r) => setTimeout(r, 1500));
    setIsSaving(false);
  };

  return (
    <div className="p-8 max-w-4xl">
      {/* Header */}
      <div className="mb-8">
        <Link
          href="/deals"
          className="flex items-center gap-1.5 text-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors mb-3"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
          All Deals
        </Link>
        <h1 className="text-2xl font-bold text-[var(--brand-text)] tracking-tight">
          {isViewMode ? "Insertion Order" : "Generate Insertion Order"}
        </h1>
        <p className="text-sm text-[var(--brand-text-secondary)] mt-1">
          {show.name} &middot; {brand.company_name} &middot; {deal.num_episodes} episode{deal.num_episodes !== 1 ? "s" : ""}
        </p>
      </div>

      {/* IO Number */}
      <div className="p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)] mb-6">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-xs text-[var(--brand-text-muted)] font-medium uppercase tracking-wider">IO Number</span>
            <div className="text-lg font-bold text-[var(--brand-text)] mt-0.5">{ioNumber}</div>
          </div>
          {isViewMode && existingIO && (
            <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
              existingIO.status === "signed" || existingIO.status === "active"
                ? "bg-[var(--brand-success)]/10 text-[var(--brand-success)]"
                : existingIO.status === "completed"
                  ? "bg-[var(--brand-text-muted)]/10 text-[var(--brand-text-muted)]"
                  : "bg-[var(--brand-blue)]/10 text-[var(--brand-blue)]"
            }`}>
              {existingIO.status.charAt(0).toUpperCase() + existingIO.status.slice(1)}
            </span>
          )}
        </div>
      </div>

      {/* Advertiser */}
      <section className="p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)] mb-6">
        <h2 className="text-sm font-semibold text-[var(--brand-text)] uppercase tracking-wider mb-4">Advertiser</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Company</label>
            <div className={readOnlyClass}>{brand.company_name}</div>
          </div>
          <div>
            <label className={labelClass}>Contact</label>
            <div className={readOnlyClass}>{brand.full_name}</div>
          </div>
          <div className="col-span-2">
            <label className={labelClass}>Email</label>
            <div className={readOnlyClass}>{brand.email}</div>
          </div>
        </div>
      </section>

      {/* Publisher */}
      <section className="p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)] mb-6">
        <h2 className="text-sm font-semibold text-[var(--brand-text)] uppercase tracking-wider mb-4">Publisher</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Company</label>
            <div className={readOnlyClass}>{agent?.company_name ?? "—"}</div>
          </div>
          <div>
            <label className={labelClass}>Contact</label>
            <div className={readOnlyClass}>{agent?.full_name ?? "—"}</div>
          </div>
          <div className="col-span-2">
            <label className={labelClass}>Email</label>
            <div className={readOnlyClass}>{agent?.email ?? "—"}</div>
          </div>
        </div>
      </section>

      {/* Agency (conditional) */}
      {agency && (
        <section className="p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)] mb-6">
          <h2 className="text-sm font-semibold text-[var(--brand-text)] uppercase tracking-wider mb-4">Agency</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Company</label>
              <div className={readOnlyClass}>{agency.company_name}</div>
            </div>
            <div>
              <label className={labelClass}>Contact</label>
              <div className={readOnlyClass}>{agency.full_name}</div>
            </div>
            <div className="col-span-2">
              <label className={labelClass}>Email</label>
              <div className={readOnlyClass}>{agency.email}</div>
            </div>
          </div>
        </section>
      )}

      {/* Line Items */}
      <section className="p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)] mb-6">
        <h2 className="text-sm font-semibold text-[var(--brand-text)] uppercase tracking-wider mb-4">Line Items</h2>
        <div className="space-y-3">
          {lineItems.map((item, index) => (
            <div key={item.id} className="p-4 bg-[var(--brand-surface)] rounded-lg border border-[var(--brand-border)]/50">
              <div className="flex items-center gap-2 mb-3">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[var(--brand-blue)]/10 text-xs font-bold text-[var(--brand-blue)]">
                  {index + 1}
                </span>
                <span className="text-sm font-medium text-[var(--brand-text)]">{item.show_name}</span>
                <span className="text-xs text-[var(--brand-text-muted)] bg-[var(--brand-surface-elevated)] px-2 py-0.5 rounded">
                  {item.placement} &middot; {item.reader_type.replace("_", " ")}
                </span>
              </div>
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <label className={labelClass}>Post Date</label>
                  {isViewMode ? (
                    <div className={readOnlyClass}>
                      {new Date(item.post_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </div>
                  ) : (
                    <input
                      type="date"
                      value={item.post_date}
                      onChange={(e) => updateLineItem(index, "post_date", e.target.value)}
                      className={inputClass}
                    />
                  )}
                </div>
                <div>
                  <label className={labelClass}>Guaranteed DLs</label>
                  <div className={readOnlyClass}>{item.guaranteed_downloads.toLocaleString()}</div>
                </div>
                <div>
                  <label className={labelClass}>Gross Rate</label>
                  <div className={readOnlyClass}>${item.gross_rate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                </div>
                <div>
                  <label className={labelClass}>Net Due</label>
                  <div className="w-full px-3 py-2 rounded-lg border border-[var(--brand-blue)]/20 bg-[var(--brand-blue)]/[0.04] text-sm font-semibold text-[var(--brand-blue)]">
                    ${item.net_due.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4 mt-3 text-xs text-[var(--brand-text-muted)]">
                <span>{item.price_type === "cpm" ? `$${item.gross_cpm} CPM` : "Flat rate"}</span>
                <span>{item.is_scripted ? "Scripted" : "Organic"}</span>
                <span>{item.is_personal_experience ? "Personal exp." : "Standard"}</span>
                <span>{item.content_type}</span>
                {item.pixel_required && <span className="text-[var(--brand-blue)]">Pixel</span>}
              </div>
            </div>
          ))}
        </div>

        {/* Totals */}
        <div className="mt-4 pt-4 border-t border-[var(--brand-border)]">
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <div className="text-xs text-[var(--brand-text-muted)] font-medium uppercase tracking-wider mb-1">Total Downloads</div>
              <div className="text-lg font-bold text-[var(--brand-text)]">{totalDownloads.toLocaleString()}</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-[var(--brand-text-muted)] font-medium uppercase tracking-wider mb-1">Total Gross</div>
              <div className="text-lg font-bold text-[var(--brand-text)]">${totalGross.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-[var(--brand-text-muted)] font-medium uppercase tracking-wider mb-1">Total Net</div>
              <div className="text-lg font-bold text-[var(--brand-blue)]">${totalNet.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            </div>
          </div>
        </div>
      </section>

      {/* Terms */}
      <section className="p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)] mb-6">
        <h2 className="text-sm font-semibold text-[var(--brand-text)] uppercase tracking-wider mb-4">Terms &amp; Conditions</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Payment Terms</label>
            {isViewMode ? (
              <div className={readOnlyClass}>{paymentTerms}</div>
            ) : (
              <input type="text" value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} className={inputClass} />
            )}
          </div>
          <div>
            <label className={labelClass}>Exclusivity (days)</label>
            {isViewMode ? (
              <div className={readOnlyClass}>{exclusivityDays}</div>
            ) : (
              <input type="number" value={exclusivityDays} onChange={(e) => setExclusivityDays(Number(e.target.value))} className={inputClass} />
            )}
          </div>
          <div>
            <label className={labelClass}>ROFR (days)</label>
            {isViewMode ? (
              <div className={readOnlyClass}>{rofrDays}</div>
            ) : (
              <input type="number" value={rofrDays} onChange={(e) => setRofrDays(Number(e.target.value))} className={inputClass} />
            )}
          </div>
          <div>
            <label className={labelClass}>Cancellation Notice (days)</label>
            {isViewMode ? (
              <div className={readOnlyClass}>{cancellationDays}</div>
            ) : (
              <input type="number" value={cancellationDays} onChange={(e) => setCancellationDays(Number(e.target.value))} className={inputClass} />
            )}
          </div>
          <div>
            <label className={labelClass}>Download Tracking (days)</label>
            {isViewMode ? (
              <div className={readOnlyClass}>{trackingDays}</div>
            ) : (
              <input type="number" value={trackingDays} onChange={(e) => setTrackingDays(Number(e.target.value))} className={inputClass} />
            )}
          </div>
          <div>
            <label className={labelClass}>Make-Good Threshold</label>
            {isViewMode ? (
              <div className={readOnlyClass}>{(makeGoodThreshold * 100).toFixed(0)}%</div>
            ) : (
              <div className="relative">
                <input
                  type="number"
                  value={(makeGoodThreshold * 100).toFixed(0)}
                  onChange={(e) => setMakeGoodThreshold(Number(e.target.value) / 100)}
                  className={inputClass}
                  min={0}
                  max={100}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--brand-text-muted)]">%</span>
              </div>
            )}
          </div>
        </div>
        {deal.competitor_exclusion.length > 0 && (
          <div className="mt-4">
            <label className={labelClass}>Competitor Exclusion</label>
            <div className="flex items-center gap-2 flex-wrap">
              {deal.competitor_exclusion.map((comp) => (
                <span key={comp} className="text-xs bg-[var(--brand-orange)]/[0.08] text-[var(--brand-orange)] px-2.5 py-1 rounded-full font-medium">
                  {comp}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Signature section (view mode) */}
      {isViewMode && existingIO?.signed_at && (
        <section className="p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-success)]/20 mb-6">
          <h2 className="text-sm font-semibold text-[var(--brand-success)] uppercase tracking-wider mb-3">Signed</h2>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-[var(--brand-text-muted)]">Publisher: </span>
              <span className="font-medium text-[var(--brand-text)]">{existingIO.signed_by_publisher}</span>
            </div>
            <div>
              <span className="text-[var(--brand-text-muted)]">Agency: </span>
              <span className="font-medium text-[var(--brand-text)]">{existingIO.signed_by_agency ?? "—"}</span>
            </div>
            <div className="col-span-2">
              <span className="text-[var(--brand-text-muted)]">Signed on: </span>
              <span className="font-medium text-[var(--brand-text)]">
                {new Date(existingIO.signed_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
              </span>
            </div>
          </div>
        </section>
      )}

      {/* Actions */}
      {!isViewMode && (
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowPreview(!showPreview)}
            className="px-5 py-2.5 rounded-lg border border-[var(--brand-border)] text-sm font-medium text-[var(--brand-text-secondary)] hover:bg-[var(--brand-surface)] transition-colors"
          >
            {showPreview ? "Edit" : "Preview"}
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-5 py-2.5 rounded-lg border border-[var(--brand-border)] text-sm font-medium text-[var(--brand-text-secondary)] hover:bg-[var(--brand-surface)] transition-colors disabled:opacity-50"
          >
            Save Draft
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-5 py-2.5 rounded-lg bg-[var(--brand-blue)] hover:bg-[var(--brand-blue-light)] text-white text-sm font-medium transition-colors disabled:opacity-50"
          >
            {isSaving ? "Sending..." : "Send IO"}
          </button>
        </div>
      )}
    </div>
  );
}
