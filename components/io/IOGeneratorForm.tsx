"use client";

import { useState } from "react";
import Link from "next/link";
import type { Deal, Show, InsertionOrder, Profile, IOLineItem, Placement, PriceType } from "@/lib/data/types";

interface IOGeneratorFormProps {
  deal: Deal;
  show: Show;
  existingIO?: InsertionOrder;
  brand: Profile;
  agency?: Profile;
  agent?: Profile;
}

const PAYMENT_TERMS_OPTIONS = [
  "Net 15",
  "Net 30",
  "Net 30 EOM",
  "Net 45",
  "Net 60",
  "Net 75",
];

function generateIONumber(): string {
  const year = new Date().getFullYear();
  return `IO-${year}-${String(3).padStart(4, "0")}`;
}

function generateLineItems(deal: Deal, show: Show): IOLineItem[] {
  const items: IOLineItem[] = [];
  const startDate = new Date(deal.flight_start);

  const cadenceDays: Record<string, number> = {
    daily: 7,
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
  const hasExistingIO = !!existingIO;
  const [isEditing, setIsEditing] = useState(!hasExistingIO);

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
  const [competitorExclusion, setCompetitorExclusion] = useState(
    (existingIO?.competitor_exclusion ?? deal.competitor_exclusion).join(", ")
  );

  // Party info state
  const [advCompany, setAdvCompany] = useState(existingIO?.advertiser_name ?? brand.company_name ?? "");
  const [advContact, setAdvContact] = useState(existingIO?.advertiser_contact_name ?? brand.full_name ?? "");
  const [advEmail, setAdvEmail] = useState(existingIO?.advertiser_contact_email ?? brand.email ?? "");

  const [pubCompany, setPubCompany] = useState(existingIO?.publisher_name ?? agent?.company_name ?? "");
  const [pubContact, setPubContact] = useState(existingIO?.publisher_contact_name ?? agent?.full_name ?? "");
  const [pubEmail, setPubEmail] = useState(existingIO?.publisher_contact_email ?? agent?.email ?? "");

  const [agencyCompany, setAgencyCompany] = useState(existingIO?.agency_name ?? agency?.company_name ?? "");
  const [agencyContact, setAgencyContact] = useState(existingIO?.agency_contact_name ?? agency?.full_name ?? "");
  const [agencyEmail, setAgencyEmail] = useState(existingIO?.agency_contact_email ?? agency?.email ?? "");

  const [isSaving, setIsSaving] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ success: boolean; to?: string; toName?: string; error?: string } | null>(null);
  const [showSendConfirm, setShowSendConfirm] = useState(false);

  const totalDownloads = lineItems.reduce((sum, li) => sum + li.guaranteed_downloads, 0);
  const totalGross = lineItems.reduce((sum, li) => sum + li.gross_rate, 0);
  const totalNet = lineItems.reduce((sum, li) => sum + li.net_due, 0);

  const updateLineItem = (index: number, field: keyof IOLineItem, value: string | number | boolean) => {
    setLineItems((prev) =>
      prev.map((li, i) => (i === index ? { ...li, [field]: value } : li))
    );
  };

  const addLineItem = () => {
    const last = lineItems[lineItems.length - 1];
    const newDate = last ? new Date(last.post_date) : new Date();
    newDate.setDate(newDate.getDate() + 7);
    setLineItems([
      ...lineItems,
      {
        id: `line-new-${Date.now()}`,
        format: show.platform,
        post_date: newDate.toISOString().split("T")[0],
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
      },
    ]);
  };

  const removeLineItem = (index: number) => {
    if (lineItems.length <= 1) return;
    setLineItems((prev) => prev.filter((_, i) => i !== index));
  };

  // Build the current IO object from form state
  const buildIO = (): InsertionOrder => ({
    id: existingIO?.id ?? `io-gen-${deal.id}`,
    io_number: ioNumber,
    deal_id: deal.id,
    advertiser_name: advCompany,
    advertiser_contact_name: advContact,
    advertiser_contact_email: advEmail,
    publisher_name: pubCompany,
    publisher_contact_name: pubContact,
    publisher_contact_email: pubEmail,
    agency_name: agencyCompany || undefined,
    agency_contact_name: agencyContact || undefined,
    agency_contact_email: agencyEmail || undefined,
    line_items: lineItems,
    total_downloads: totalDownloads,
    total_gross: totalGross,
    total_net: totalNet,
    payment_terms: paymentTerms,
    competitor_exclusion: competitorExclusion.split(",").map((s) => s.trim()).filter(Boolean),
    exclusivity_days: exclusivityDays,
    rofr_days: rofrDays,
    cancellation_notice_days: cancellationDays,
    download_tracking_days: trackingDays,
    make_good_threshold: makeGoodThreshold,
    status: existingIO?.status ?? "draft",
    sent_at: existingIO?.sent_at,
    signed_at: existingIO?.signed_at,
    signed_by_publisher: existingIO?.signed_by_publisher,
    signed_by_agency: existingIO?.signed_by_agency,
    created_at: existingIO?.created_at ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  const recipientEmail = agencyEmail || advEmail;
  const recipientName = agencyContact || advContact;

  const handleSave = async () => {
    setIsSaving(true);
    await new Promise((r) => setTimeout(r, 1500));
    setIsSaving(false);
    if (hasExistingIO) setIsEditing(false);
  };

  const handleDownloadPdf = async () => {
    setIsDownloading(true);
    try {
      const io = buildIO();
      const res = await fetch(`/api/deals/${deal.id}/io/pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ io }),
      });
      if (!res.ok) throw new Error("PDF generation failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${ioNumber}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // Could add error toast here
    } finally {
      setIsDownloading(false);
    }
  };

  const handleSendEmail = async () => {
    setIsSending(true);
    setSendResult(null);
    try {
      const res = await fetch(`/api/deals/${deal.id}/io/send`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setSendResult({ success: false, error: data.error });
      } else {
        setSendResult({ success: true, to: data.to, toName: data.toName });
      }
    } catch {
      setSendResult({ success: false, error: "Network error. Please try again." });
    } finally {
      setIsSending(false);
      setShowSendConfirm(false);
    }
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
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--brand-text)] tracking-tight">
              {hasExistingIO && !isEditing ? "Insertion Order" : isEditing && hasExistingIO ? "Edit Insertion Order" : "Generate Insertion Order"}
            </h1>
            <p className="text-sm text-[var(--brand-text-secondary)] mt-1">
              {show.name} &middot; {brand.company_name} &middot; {deal.num_episodes} episode{deal.num_episodes !== 1 ? "s" : ""}
            </p>
          </div>
          {hasExistingIO && !isEditing && (
            <button
              onClick={() => setIsEditing(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-[var(--brand-border)] text-sm font-medium text-[var(--brand-text-secondary)] hover:border-[var(--brand-blue)] hover:text-[var(--brand-blue)] transition-all"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
              Edit
            </button>
          )}
        </div>
      </div>

      {/* IO Number */}
      <div className="p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)] mb-6">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-xs text-[var(--brand-text-muted)] font-medium uppercase tracking-wider">IO Number</span>
            <div className="text-lg font-bold text-[var(--brand-text)] mt-0.5">{ioNumber}</div>
          </div>
          {hasExistingIO && existingIO && (
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
            {isEditing ? (
              <input type="text" value={advCompany} onChange={(e) => setAdvCompany(e.target.value)} className={inputClass} />
            ) : (
              <div className={readOnlyClass}>{advCompany}</div>
            )}
          </div>
          <div>
            <label className={labelClass}>Contact</label>
            {isEditing ? (
              <input type="text" value={advContact} onChange={(e) => setAdvContact(e.target.value)} className={inputClass} />
            ) : (
              <div className={readOnlyClass}>{advContact}</div>
            )}
          </div>
          <div className="col-span-2">
            <label className={labelClass}>Email</label>
            {isEditing ? (
              <input type="email" value={advEmail} onChange={(e) => setAdvEmail(e.target.value)} className={inputClass} />
            ) : (
              <div className={readOnlyClass}>{advEmail}</div>
            )}
          </div>
        </div>
      </section>

      {/* Publisher */}
      <section className="p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)] mb-6">
        <h2 className="text-sm font-semibold text-[var(--brand-text)] uppercase tracking-wider mb-4">Publisher</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Company</label>
            {isEditing ? (
              <input type="text" value={pubCompany} onChange={(e) => setPubCompany(e.target.value)} className={inputClass} />
            ) : (
              <div className={readOnlyClass}>{pubCompany || "\u2014"}</div>
            )}
          </div>
          <div>
            <label className={labelClass}>Contact</label>
            {isEditing ? (
              <input type="text" value={pubContact} onChange={(e) => setPubContact(e.target.value)} className={inputClass} />
            ) : (
              <div className={readOnlyClass}>{pubContact || "\u2014"}</div>
            )}
          </div>
          <div className="col-span-2">
            <label className={labelClass}>Email</label>
            {isEditing ? (
              <input type="email" value={pubEmail} onChange={(e) => setPubEmail(e.target.value)} className={inputClass} />
            ) : (
              <div className={readOnlyClass}>{pubEmail || "\u2014"}</div>
            )}
          </div>
        </div>
      </section>

      {/* Agency */}
      {(isEditing || agencyCompany) && (
        <section className="p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)] mb-6">
          <h2 className="text-sm font-semibold text-[var(--brand-text)] uppercase tracking-wider mb-4">Agency</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Company</label>
              {isEditing ? (
                <input type="text" value={agencyCompany} onChange={(e) => setAgencyCompany(e.target.value)} placeholder="Leave blank if no agency" className={inputClass} />
              ) : (
                <div className={readOnlyClass}>{agencyCompany}</div>
              )}
            </div>
            <div>
              <label className={labelClass}>Contact</label>
              {isEditing ? (
                <input type="text" value={agencyContact} onChange={(e) => setAgencyContact(e.target.value)} className={inputClass} />
              ) : (
                <div className={readOnlyClass}>{agencyContact}</div>
              )}
            </div>
            <div className="col-span-2">
              <label className={labelClass}>Email</label>
              {isEditing ? (
                <input type="email" value={agencyEmail} onChange={(e) => setAgencyEmail(e.target.value)} className={inputClass} />
              ) : (
                <div className={readOnlyClass}>{agencyEmail}</div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Line Items */}
      <section className="p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)] mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-[var(--brand-text)] uppercase tracking-wider">Line Items</h2>
          {isEditing && (
            <button
              type="button"
              onClick={addLineItem}
              className="flex items-center gap-1.5 text-sm text-[var(--brand-blue)] hover:text-[var(--brand-blue-light)] font-medium transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Add Line Item
            </button>
          )}
        </div>
        <div className="space-y-3">
          {lineItems.map((item, index) => (
            <div key={item.id} className="p-4 bg-[var(--brand-surface)] rounded-lg border border-[var(--brand-border)]/50">
              <div className="flex items-center gap-2 mb-3">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[var(--brand-blue)]/10 text-xs font-bold text-[var(--brand-blue)]">
                  {index + 1}
                </span>
                {isEditing ? (
                  <input
                    type="text"
                    value={item.show_name}
                    onChange={(e) => updateLineItem(index, "show_name", e.target.value)}
                    className="flex-1 px-2 py-1 rounded border border-[var(--brand-border)] bg-[var(--brand-surface)] text-sm font-medium text-[var(--brand-text)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)] focus:border-transparent"
                  />
                ) : (
                  <span className="text-sm font-medium text-[var(--brand-text)]">{item.show_name}</span>
                )}
                {isEditing ? (
                  <select
                    value={item.placement}
                    onChange={(e) => updateLineItem(index, "placement", e.target.value)}
                    className="px-2 py-1 rounded border border-[var(--brand-border)] bg-[var(--brand-surface)] text-xs text-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]"
                  >
                    {(["pre-roll", "mid-roll", "post-roll"] as Placement[]).map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                ) : (
                  <span className="text-xs text-[var(--brand-text-muted)] bg-[var(--brand-surface-elevated)] px-2 py-0.5 rounded">
                    {item.placement} &middot; {item.reader_type.replace("_", " ")}
                  </span>
                )}
                {isEditing && lineItems.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeLineItem(index)}
                    className="ml-auto p-1.5 rounded-lg text-[var(--brand-text-muted)] hover:text-[var(--brand-error)] hover:bg-[var(--brand-error)]/[0.06] transition-all"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <label className={labelClass}>Post Date</label>
                  {isEditing ? (
                    <input
                      type="date"
                      value={item.post_date}
                      onChange={(e) => updateLineItem(index, "post_date", e.target.value)}
                      className={inputClass}
                    />
                  ) : (
                    <div className={readOnlyClass}>
                      {new Date(item.post_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </div>
                  )}
                </div>
                <div>
                  <label className={labelClass}>Guaranteed DLs</label>
                  {isEditing ? (
                    <input
                      type="number"
                      value={item.guaranteed_downloads}
                      onChange={(e) => updateLineItem(index, "guaranteed_downloads", Number(e.target.value))}
                      min="0"
                      className={inputClass}
                    />
                  ) : (
                    <div className={readOnlyClass}>{item.guaranteed_downloads.toLocaleString()}</div>
                  )}
                </div>
                <div>
                  <label className={labelClass}>Gross Rate</label>
                  {isEditing ? (
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-[var(--brand-text-muted)]">$</span>
                      <input
                        type="number"
                        value={item.gross_rate}
                        onChange={(e) => updateLineItem(index, "gross_rate", Number(e.target.value))}
                        min="0"
                        step="0.01"
                        className={`${inputClass} pl-6`}
                      />
                    </div>
                  ) : (
                    <div className={readOnlyClass}>${item.gross_rate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                  )}
                </div>
                <div>
                  <label className={labelClass}>Net Due</label>
                  {isEditing ? (
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-[var(--brand-text-muted)]">$</span>
                      <input
                        type="number"
                        value={item.net_due}
                        onChange={(e) => updateLineItem(index, "net_due", Number(e.target.value))}
                        min="0"
                        step="0.01"
                        className="w-full pl-6 px-3 py-2 rounded-lg border border-[var(--brand-blue)]/20 bg-[var(--brand-blue)]/[0.04] text-sm font-semibold text-[var(--brand-blue)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)] focus:border-transparent transition-all"
                      />
                    </div>
                  ) : (
                    <div className="w-full px-3 py-2 rounded-lg border border-[var(--brand-blue)]/20 bg-[var(--brand-blue)]/[0.04] text-sm font-semibold text-[var(--brand-blue)]">
                      ${item.net_due.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  )}
                </div>
              </div>
              {isEditing ? (
                <div className="grid grid-cols-4 gap-3 mt-3">
                  <div>
                    <label className={labelClass}>Price Type</label>
                    <select
                      value={item.price_type}
                      onChange={(e) => updateLineItem(index, "price_type", e.target.value)}
                      className={inputClass}
                    >
                      <option value="cpm">CPM</option>
                      <option value="flat_rate">Flat Rate</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Gross CPM</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-[var(--brand-text-muted)]">$</span>
                      <input
                        type="number"
                        value={item.gross_cpm}
                        onChange={(e) => updateLineItem(index, "gross_cpm", Number(e.target.value))}
                        min="0"
                        step="0.01"
                        className={`${inputClass} pl-6`}
                      />
                    </div>
                  </div>
                  <div>
                    <label className={labelClass}>Reader Type</label>
                    <select
                      value={item.reader_type}
                      onChange={(e) => updateLineItem(index, "reader_type", e.target.value)}
                      className={inputClass}
                    >
                      <option value="host_read">Host Read</option>
                      <option value="producer_read">Producer Read</option>
                      <option value="guest_read">Guest Read</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Content</label>
                    <select
                      value={item.content_type}
                      onChange={(e) => updateLineItem(index, "content_type", e.target.value)}
                      className={inputClass}
                    >
                      <option value="evergreen">Evergreen</option>
                      <option value="dated">Dated</option>
                    </select>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-4 mt-3 text-xs text-[var(--brand-text-muted)]">
                  <span>{item.price_type === "cpm" ? `$${item.gross_cpm} CPM` : "Flat rate"}</span>
                  <span>{item.is_scripted ? "Scripted" : "Organic"}</span>
                  <span>{item.is_personal_experience ? "Personal exp." : "Standard"}</span>
                  <span>{item.content_type}</span>
                  {item.pixel_required && <span className="text-[var(--brand-blue)]">Pixel</span>}
                </div>
              )}
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
            {isEditing ? (
              <select value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} className={inputClass}>
                {PAYMENT_TERMS_OPTIONS.map((pt) => (
                  <option key={pt} value={pt}>{pt}</option>
                ))}
              </select>
            ) : (
              <div className={readOnlyClass}>{paymentTerms}</div>
            )}
          </div>
          <div>
            <label className={labelClass}>Exclusivity (days)</label>
            {isEditing ? (
              <input type="number" value={exclusivityDays} onChange={(e) => setExclusivityDays(Number(e.target.value))} className={inputClass} />
            ) : (
              <div className={readOnlyClass}>{exclusivityDays}</div>
            )}
          </div>
          <div>
            <label className={labelClass}>ROFR (days)</label>
            {isEditing ? (
              <input type="number" value={rofrDays} onChange={(e) => setRofrDays(Number(e.target.value))} className={inputClass} />
            ) : (
              <div className={readOnlyClass}>{rofrDays}</div>
            )}
          </div>
          <div>
            <label className={labelClass}>Cancellation Notice (days)</label>
            {isEditing ? (
              <input type="number" value={cancellationDays} onChange={(e) => setCancellationDays(Number(e.target.value))} className={inputClass} />
            ) : (
              <div className={readOnlyClass}>{cancellationDays}</div>
            )}
          </div>
          <div>
            <label className={labelClass}>Download Tracking (days)</label>
            {isEditing ? (
              <input type="number" value={trackingDays} onChange={(e) => setTrackingDays(Number(e.target.value))} className={inputClass} />
            ) : (
              <div className={readOnlyClass}>{trackingDays}</div>
            )}
          </div>
          <div>
            <label className={labelClass}>Make-Good Threshold</label>
            {isEditing ? (
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
            ) : (
              <div className={readOnlyClass}>{(makeGoodThreshold * 100).toFixed(0)}%</div>
            )}
          </div>
        </div>
        <div className="mt-4">
          <label className={labelClass}>Competitor Exclusion</label>
          {isEditing ? (
            <>
              <input
                type="text"
                value={competitorExclusion}
                onChange={(e) => setCompetitorExclusion(e.target.value)}
                placeholder="Brand A, Brand B, Brand C"
                className={inputClass}
              />
              <p className="text-xs text-[var(--brand-text-muted)] mt-1">Comma-separated brand names</p>
            </>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              {competitorExclusion.split(",").map((c) => c.trim()).filter(Boolean).length > 0 ? (
                competitorExclusion.split(",").map((c) => c.trim()).filter(Boolean).map((comp) => (
                  <span key={comp} className="text-xs bg-[var(--brand-orange)]/[0.08] text-[var(--brand-orange)] px-2.5 py-1 rounded-full font-medium">
                    {comp}
                  </span>
                ))
              ) : (
                <span className="text-xs text-[var(--brand-text-muted)]">None</span>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Signature section (view mode, existing signed IO) */}
      {!isEditing && hasExistingIO && existingIO?.signed_at && (
        <section className="p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-success)]/20 mb-6">
          <h2 className="text-sm font-semibold text-[var(--brand-success)] uppercase tracking-wider mb-3">Signed</h2>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-[var(--brand-text-muted)]">Publisher: </span>
              <span className="font-medium text-[var(--brand-text)]">{existingIO.signed_by_publisher}</span>
            </div>
            <div>
              <span className="text-[var(--brand-text-muted)]">Agency: </span>
              <span className="font-medium text-[var(--brand-text)]">{existingIO.signed_by_agency ?? "\u2014"}</span>
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
      <div className="flex items-center gap-3">
        {isEditing && (
          <>
            {hasExistingIO && (
              <button
                onClick={() => setIsEditing(false)}
                className="px-5 py-2.5 rounded-lg border border-[var(--brand-border)] text-sm font-medium text-[var(--brand-text-secondary)] hover:bg-[var(--brand-surface)] transition-colors"
              >
                Cancel
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-5 py-2.5 rounded-lg border border-[var(--brand-border)] text-sm font-medium text-[var(--brand-text-secondary)] hover:bg-[var(--brand-surface)] transition-colors disabled:opacity-50"
            >
              {isSaving ? "Saving..." : "Save Draft"}
            </button>
            {!hasExistingIO && (
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="px-5 py-2.5 rounded-lg bg-[var(--brand-blue)] hover:bg-[var(--brand-blue-light)] text-white text-sm font-medium transition-colors disabled:opacity-50"
              >
                {isSaving ? "Sending..." : "Send IO"}
              </button>
            )}
          </>
        )}
        <button
          onClick={handleDownloadPdf}
          disabled={isDownloading}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg border border-[var(--brand-border)] text-sm font-medium text-[var(--brand-text-secondary)] hover:bg-[var(--brand-surface)] transition-colors disabled:opacity-50"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          {isDownloading ? "Generating..." : "Download PDF"}
        </button>
        <button
          onClick={() => setShowSendConfirm(true)}
          disabled={isSending}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[var(--brand-teal)] hover:bg-[var(--brand-teal-light)] text-white text-sm font-medium transition-colors disabled:opacity-50"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
          Send via Email
        </button>
      </div>

      {/* Send confirmation modal */}
      {showSendConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowSendConfirm(false)}>
          <div className="bg-[var(--brand-surface-elevated)] rounded-2xl border border-[var(--brand-border)] shadow-xl p-6 max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-[var(--brand-text)] mb-2">Send IO via Email</h3>
            <p className="text-sm text-[var(--brand-text-secondary)] mb-4">
              This will email <strong>{ioNumber}</strong> as a PDF attachment to:
            </p>
            <div className="p-3 rounded-lg bg-[var(--brand-surface)] border border-[var(--brand-border)] mb-5">
              <div className="text-sm font-medium text-[var(--brand-text)]">{recipientName}</div>
              <div className="text-sm text-[var(--brand-text-muted)]">{recipientEmail}</div>
            </div>
            <div className="flex items-center gap-3 justify-end">
              <button
                onClick={() => setShowSendConfirm(false)}
                className="px-4 py-2 rounded-lg border border-[var(--brand-border)] text-sm font-medium text-[var(--brand-text-secondary)] hover:bg-[var(--brand-surface)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSendEmail}
                disabled={isSending}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--brand-teal)] hover:bg-[var(--brand-teal-light)] text-white text-sm font-medium transition-colors disabled:opacity-50"
              >
                {isSending ? (
                  <>
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Sending...
                  </>
                ) : (
                  "Send Now"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Send result toast */}
      {sendResult && (
        <div className={`mt-4 p-4 rounded-xl border ${
          sendResult.success
            ? "bg-[var(--brand-success)]/[0.06] border-[var(--brand-success)]/20"
            : "bg-[var(--brand-error)]/[0.06] border-[var(--brand-error)]/20"
        }`}>
          <div className="flex items-start gap-3">
            {sendResult.success ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--brand-success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--brand-error)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0">
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            )}
            <div>
              <p className={`text-sm font-medium ${sendResult.success ? "text-[var(--brand-success)]" : "text-[var(--brand-error)]"}`}>
                {sendResult.success
                  ? `IO sent to ${sendResult.toName ?? sendResult.to}`
                  : "Failed to send"}
              </p>
              {sendResult.success && sendResult.to && (
                <p className="text-xs text-[var(--brand-text-muted)] mt-0.5">{sendResult.to}</p>
              )}
              {sendResult.error && (
                <p className="text-xs text-[var(--brand-error)] mt-0.5">{sendResult.error}</p>
              )}
            </div>
            <button
              onClick={() => setSendResult(null)}
              className="ml-auto p-1 rounded text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
