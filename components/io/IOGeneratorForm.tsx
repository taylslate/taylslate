"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { tokens } from "@/lib/brand/tokens";
import type { Deal, Show, InsertionOrder, Profile, IOLineItem, Placement, IoPayer } from "@/lib/data/types";

const radiusStyle = { borderRadius: tokens.radius };
const inkText = "text-[var(--ts-ink-on-paper)]";
const mutedText = "text-[var(--ts-ink-muted-on-paper)]";
const accentText = "text-[var(--ts-accent-text)]";
const kickerClass =
  "text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--ts-accent-text)]";
const panelClass =
  "mb-6 border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] p-5";
const sectionHead =
  "mb-4 text-sm font-semibold uppercase tracking-wider text-[var(--ts-ink-on-paper)]";
const inkBtnClass =
  "inline-flex items-center justify-center gap-2 bg-[var(--ts-accent)] px-5 py-2.5 text-sm font-medium text-[var(--ts-accent-foreground)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";
const ghostBtnClass =
  "inline-flex items-center justify-center gap-2 border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-5 py-2.5 text-sm font-medium text-[var(--ts-ink-on-paper)] hover:bg-[var(--ts-band-shows)] disabled:cursor-not-allowed disabled:opacity-50";
const netDueClass =
  "w-full border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-band-brands)] px-3 py-2 text-sm font-semibold text-[var(--ts-ink-on-paper)] focus:border-[var(--ts-accent)] focus:outline-none";

interface IOGeneratorFormProps {
  deal: Deal;
  show: Show;
  existingIO?: InsertionOrder;
  brand: Profile;
  agency?: Profile;
  agent?: Profile;
  /** Used only when this deal has no saved IO yet. A saved false stays off. */
  brandIsManaged?: boolean;
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
    // Advance in UTC. flight_start is a date-only string parsed as UTC midnight;
    // mixing UTC parse with local getDate/setDate was what shifted post dates a
    // day off from the Agreed Terms panel.
    postDate.setUTCDate(postDate.getUTCDate() + i * spacing);

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
      spot_format: null,
      verified: false,
      make_good_triggered: false,
    });
  }
  return items;
}

const inputClass =
  "w-full border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-3 py-2 text-sm text-[var(--ts-ink-on-paper)] placeholder:text-[var(--ts-ink-muted-on-paper)] focus:border-[var(--ts-accent)] focus:outline-none";
const labelClass = "mb-1.5 block text-sm font-medium text-[var(--ts-ink-on-paper)]";
const readOnlyClass =
  "w-full cursor-default break-words border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-band-shows)] px-3 py-2 text-sm text-[var(--ts-ink-muted-on-paper)]";

function editorPayload(io: InsertionOrder, sync: boolean) {
  return {
    advertiser_name: io.advertiser_name,
    advertiser_contact_name: io.advertiser_contact_name ?? null,
    advertiser_contact_email: io.advertiser_contact_email ?? null,
    publisher_name: io.publisher_name,
    publisher_contact_name: io.publisher_contact_name,
    publisher_contact_email: io.publisher_contact_email,
    agency_name: io.agency_name ?? null,
    agency_contact_name: io.agency_contact_name ?? null,
    agency_contact_email: io.agency_contact_email ?? null,
    payment_terms: io.payment_terms,
    payment_off_platform: io.payment_off_platform === true,
    competitor_exclusion: io.competitor_exclusion,
    exclusivity_days: io.exclusivity_days,
    rofr_days: io.rofr_days,
    rofr_enabled: io.rofr_enabled !== false,
    cancellation_notice_days: io.cancellation_notice_days,
    download_tracking_days: io.download_tracking_days,
    download_tracking_enabled: io.download_tracking_enabled !== false,
    make_good_threshold: io.make_good_threshold,
    make_good_enabled: io.make_good_enabled !== false,
    payer: io.payer === "agency" ? "agency" : "brand",
    sync_line_items: sync,
    line_items: io.line_items.map((li) => ({
      id: li.id,
      format: li.format,
      post_date: li.post_date,
      guaranteed_downloads: li.guaranteed_downloads,
      show_name: li.show_name,
      placement: li.placement,
      is_scripted: li.is_scripted,
      is_personal_experience: li.is_personal_experience,
      reader_type: li.reader_type,
      content_type: li.content_type,
      pixel_required: li.pixel_required,
      gross_rate: li.gross_rate,
      gross_cpm: li.gross_cpm,
      price_type: li.price_type,
      net_due: li.net_due,
      spot_format: li.spot_format?.trim() || null,
      ...(li.show_surface_id ? { show_surface_id: li.show_surface_id } : {}),
      verified: li.verified,
      make_good_triggered: li.make_good_triggered,
    })),
  };
}

export default function IOGeneratorForm({ deal, show, existingIO, brand, agency, agent, brandIsManaged }: IOGeneratorFormProps) {
  const router = useRouter();
  const [savedIO, setSavedIO] = useState(existingIO);
  const hasExistingIO = !!savedIO;
  const [isEditing, setIsEditing] = useState(!hasExistingIO);

  const [ioNumber, setIoNumber] = useState(existingIO?.io_number ?? generateIONumber());
  const [lineItems, setLineItems] = useState<IOLineItem[]>(
    existingIO?.line_items ?? generateLineItems(deal, show)
  );
  const [paymentTerms, setPaymentTerms] = useState(existingIO?.payment_terms ?? "Net 30 EOM");
  const [paymentOffPlatform, setPaymentOffPlatform] = useState(
    existingIO ? existingIO.payment_off_platform === true : brandIsManaged === true
  );
  const [exclusivityDays, setExclusivityDays] = useState(existingIO?.exclusivity_days ?? deal.exclusivity_days);
  const [rofrDays, setRofrDays] = useState(existingIO?.rofr_days ?? deal.rofr_days);
  const [rofrEnabled, setRofrEnabled] = useState(existingIO?.rofr_enabled !== false);
  const [cancellationDays, setCancellationDays] = useState(existingIO?.cancellation_notice_days ?? 14);
  const [trackingDays, setTrackingDays] = useState(existingIO?.download_tracking_days ?? 45);
  const [trackingEnabled, setTrackingEnabled] = useState(existingIO?.download_tracking_enabled !== false);
  const [makeGoodThreshold, setMakeGoodThreshold] = useState(existingIO?.make_good_threshold ?? 0.10);
  const [makeGoodEnabled, setMakeGoodEnabled] = useState(existingIO?.make_good_enabled !== false);
  const [payer, setPayer] = useState<IoPayer>(existingIO?.payer === "agency" ? "agency" : "brand");
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
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ success: boolean; to?: string; toName?: string; error?: string } | null>(null);
  const [showSendConfirm, setShowSendConfirm] = useState(false);

  // Delivery tracking state
  const [deliveryEditing, setDeliveryEditing] = useState<Record<string, boolean>>({});
  const [deliveryFields, setDeliveryFields] = useState<Record<string, { actual_downloads: number; episode_url: string }>>({});
  const [isSavingDelivery, setIsSavingDelivery] = useState(false);
  const [isGeneratingInvoice, setIsGeneratingInvoice] = useState(false);
  const [deliveryError, setDeliveryError] = useState<string | null>(null);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);

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
        spot_format: null,
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
    id: savedIO?.id ?? `io-gen-${deal.id}`,
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
    payment_off_platform: paymentOffPlatform,
    competitor_exclusion: competitorExclusion.split(",").map((s) => s.trim()).filter(Boolean),
    exclusivity_days: exclusivityDays,
    rofr_days: rofrDays,
    rofr_enabled: rofrEnabled,
    cancellation_notice_days: cancellationDays,
    download_tracking_days: trackingDays,
    download_tracking_enabled: trackingEnabled,
    make_good_threshold: makeGoodThreshold,
    make_good_enabled: makeGoodEnabled,
    payer,
    status: savedIO?.status ?? "draft",
    sent_at: savedIO?.sent_at,
    signed_at: savedIO?.signed_at,
    signed_by_publisher: savedIO?.signed_by_publisher,
    signed_by_agency: savedIO?.signed_by_agency,
    created_at: savedIO?.created_at ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  const recipientEmail = agencyEmail || advEmail;
  const recipientName = agencyContact || advContact;

  const handleSave = async () => {
    setIsSaving(true);
    setSaveError(null);
    try {
      const io = buildIO();
      const res = await fetch(`/api/deals/${deal.id}/io`, {
        method: hasExistingIO ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editorPayload(io, hasExistingIO)),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Failed to save IO");
      }
      const saved = data.io as InsertionOrder | undefined;
      if (saved) {
        setSavedIO(saved);
        if (saved.io_number) setIoNumber(saved.io_number);
        if (saved.line_items) setLineItems(saved.line_items);
      } else {
        setSavedIO(io);
      }
      setIsEditing(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save IO");
    } finally {
      setIsSaving(false);
    }
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

  // Delivery tracking handlers
  const handleMarkAsDelivered = (item: IOLineItem) => {
    setDeliveryEditing((prev) => ({ ...prev, [item.id]: true }));
    setDeliveryFields((prev) => ({
      ...prev,
      [item.id]: {
        actual_downloads: item.actual_downloads ?? item.guaranteed_downloads,
        episode_url: item.episode_url ?? "",
      },
    }));
    // Update the line item in local state immediately
    setLineItems((prev) =>
      prev.map((li) =>
        li.id === item.id
          ? {
              ...li,
              actual_post_date: li.actual_post_date ?? new Date().toISOString().split("T")[0],
              verified: true,
              actual_downloads: li.actual_downloads ?? li.guaranteed_downloads,
            }
          : li
      )
    );
  };

  const handleCancelDelivery = (itemId: string) => {
    setDeliveryEditing((prev) => ({ ...prev, [itemId]: false }));
    // Revert local state if this item wasn't previously verified
    const original = savedIO?.line_items?.find((li) => li.id === itemId);
    if (original && !original.verified) {
      setLineItems((prev) =>
        prev.map((li) =>
          li.id === itemId
            ? { ...li, actual_post_date: original.actual_post_date, verified: false, actual_downloads: original.actual_downloads }
            : li
        )
      );
    }
  };

  const handleSaveDelivery = async (itemId: string) => {
    setIsSavingDelivery(true);
    setDeliveryError(null);
    try {
      const fields = deliveryFields[itemId];
      const item = lineItems.find((li) => li.id === itemId);
      if (!fields || !item) return;

      const res = await fetch(`/api/deals/${deal.id}/io`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          line_items: [
            {
              id: itemId,
              actual_post_date: item.actual_post_date ?? new Date().toISOString().split("T")[0],
              actual_downloads: fields.actual_downloads,
              episode_url: fields.episode_url,
              verified: true,
            },
          ],
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save delivery data");
      }

      const { io: updatedIO } = await res.json();

      // Update local line items from server response
      if (updatedIO?.line_items) {
        setLineItems(updatedIO.line_items);
      } else {
        // Fallback: update local state
        setLineItems((prev) =>
          prev.map((li) =>
            li.id === itemId
              ? { ...li, actual_downloads: fields.actual_downloads, episode_url: fields.episode_url, verified: true }
              : li
          )
        );
      }

      setDeliveryEditing((prev) => ({ ...prev, [itemId]: false }));

      // Check if all line items are now verified — auto-complete deal
      const allItems = updatedIO?.line_items ?? lineItems;
      const allVerified = allItems.every((li: IOLineItem) => li.verified);
      if (allVerified) {
        await fetch(`/api/deals/${deal.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "completed" }),
        });
      }
    } catch (err) {
      setDeliveryError(err instanceof Error ? err.message : "Failed to save delivery");
    } finally {
      setIsSavingDelivery(false);
    }
  };

  const handleGenerateInvoice = async () => {
    if (!savedIO?.id) return;
    setIsGeneratingInvoice(true);
    setInvoiceError(null);
    try {
      const res = await fetch("/api/invoices/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ io_id: savedIO.id }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to generate invoice");
      }
      router.push("/invoices");
    } catch (err) {
      setInvoiceError(err instanceof Error ? err.message : "Failed to generate invoice");
    } finally {
      setIsGeneratingInvoice(false);
    }
  };

  const hasDeliveredItems = lineItems.some((li) => li.verified);

  return (
    <div className="max-w-4xl p-4 sm:p-8">
      {/* Header */}
      <div className="mb-8">
        <div className="mb-3 flex items-center gap-3">
          <Link
            href="/deals"
            className={`flex items-center gap-1.5 text-xs ${mutedText} hover:text-[var(--ts-ink-on-paper)]`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
            All Deals
          </Link>
          <p className={kickerClass}>For brands</p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className={`text-xl font-semibold tracking-tight ${inkText}`}>
              {hasExistingIO && !isEditing ? "Insertion Order" : isEditing && hasExistingIO ? "Edit Insertion Order" : "Generate Insertion Order"}
            </h1>
            <p className={`mt-1 text-sm ${mutedText}`}>
              {show.name} &middot; {brand.company_name} &middot; {deal.num_episodes} episode{deal.num_episodes !== 1 ? "s" : ""}
            </p>
          </div>
          {hasExistingIO && !isEditing && (
            <button
              onClick={() => setIsEditing(true)}
              className={ghostBtnClass}
              style={radiusStyle}
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
      <div className={panelClass} style={radiusStyle}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <span className={`text-xs font-medium uppercase tracking-wider ${mutedText}`}>IO Number</span>
            <div className={`mt-0.5 text-lg font-semibold ${inkText}`}>{ioNumber}</div>
          </div>
          {hasExistingIO && savedIO && (
            <span
              className={`px-2.5 py-1 text-xs font-medium ${
                savedIO.status === "signed" || savedIO.status === "active"
                  ? "bg-[var(--ts-band-brands)] text-[var(--ts-ink-on-paper)]"
                  : savedIO.status === "completed"
                    ? "border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] text-[var(--ts-ink-muted-on-paper)]"
                    : "bg-[var(--ts-band-shows)] text-[var(--ts-ink-on-paper)]"
              }`}
              style={radiusStyle}
            >
              {savedIO.status.charAt(0).toUpperCase() + savedIO.status.slice(1)}
            </span>
          )}
        </div>
      </div>

      {/* Advertiser */}
      <section className={panelClass} style={radiusStyle}>
        <h2 className={sectionHead}>Advertiser</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass}>Company</label>
            {isEditing ? (
              <input type="text" value={advCompany} onChange={(e) => setAdvCompany(e.target.value)} className={inputClass} style={radiusStyle} />
            ) : (
              <div className={readOnlyClass} style={radiusStyle}>{advCompany}</div>
            )}
          </div>
          <div>
            <label className={labelClass}>Contact</label>
            {isEditing ? (
              <input type="text" value={advContact} onChange={(e) => setAdvContact(e.target.value)} className={inputClass} style={radiusStyle} />
            ) : (
              <div className={readOnlyClass} style={radiusStyle}>{advContact}</div>
            )}
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass}>Email</label>
            {isEditing ? (
              <input type="email" value={advEmail} onChange={(e) => setAdvEmail(e.target.value)} className={inputClass} style={radiusStyle} />
            ) : (
              <div className={readOnlyClass} style={radiusStyle}>{advEmail}</div>
            )}
          </div>
        </div>
      </section>

      {/* Publisher */}
      <section className={panelClass} style={radiusStyle}>
        <h2 className={sectionHead}>Publisher</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass}>Company</label>
            {isEditing ? (
              <input type="text" value={pubCompany} onChange={(e) => setPubCompany(e.target.value)} className={inputClass} style={radiusStyle} />
            ) : (
              <div className={readOnlyClass} style={radiusStyle}>{pubCompany || "\u2014"}</div>
            )}
          </div>
          <div>
            <label className={labelClass}>Contact</label>
            {isEditing ? (
              <input type="text" value={pubContact} onChange={(e) => setPubContact(e.target.value)} className={inputClass} style={radiusStyle} />
            ) : (
              <div className={readOnlyClass} style={radiusStyle}>{pubContact || "\u2014"}</div>
            )}
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass}>Email</label>
            {isEditing ? (
              <input type="email" value={pubEmail} onChange={(e) => setPubEmail(e.target.value)} className={inputClass} style={radiusStyle} />
            ) : (
              <div className={readOnlyClass} style={radiusStyle}>{pubEmail || "\u2014"}</div>
            )}
          </div>
        </div>
      </section>

      {/* Agency */}
      {(isEditing || agencyCompany) && (
        <section className={panelClass} style={radiusStyle}>
          <h2 className={sectionHead}>Agency</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass}>Company</label>
              {isEditing ? (
                <input type="text" value={agencyCompany} onChange={(e) => setAgencyCompany(e.target.value)} placeholder="Leave blank if no agency" className={inputClass} style={radiusStyle} />
              ) : (
                <div className={readOnlyClass} style={radiusStyle}>{agencyCompany}</div>
              )}
            </div>
            <div>
              <label className={labelClass}>Contact</label>
              {isEditing ? (
                <input type="text" value={agencyContact} onChange={(e) => setAgencyContact(e.target.value)} className={inputClass} style={radiusStyle} />
              ) : (
                <div className={readOnlyClass} style={radiusStyle}>{agencyContact}</div>
              )}
            </div>
            <div>
              <label className={labelClass}>Email</label>
              {isEditing ? (
                <input type="email" value={agencyEmail} onChange={(e) => setAgencyEmail(e.target.value)} className={inputClass} style={radiusStyle} />
              ) : (
                <div className={readOnlyClass} style={radiusStyle}>{agencyEmail}</div>
              )}
            </div>
            <div>
              <label className={labelClass}>Payer</label>
              {isEditing ? (
                <select
                  value={payer}
                  onChange={(e) => setPayer(e.target.value === "agency" ? "agency" : "brand")}
                  className={inputClass}
                  style={radiusStyle}
                >
                  <option value="brand">Advertiser</option>
                  <option value="agency">Agency of record</option>
                </select>
              ) : (
                <div className={readOnlyClass} style={radiusStyle}>
                  {payer === "agency" ? "Agency of record" : "Advertiser"}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Line Items */}
      <section className={panelClass} style={radiusStyle}>
        <div className="flex items-center justify-between mb-4">
          <h2 className={`${sectionHead} mb-0`}>Line Items</h2>
          {isEditing && (
            <button
              type="button"
              onClick={addLineItem}
              className={`flex items-center gap-1.5 text-sm font-medium ${accentText} hover:underline`}
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
            <div key={item.id} className="border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-band-shows)] p-4" style={radiusStyle}>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="inline-flex h-6 w-6 items-center justify-center bg-[var(--ts-band-brands)] text-xs font-medium text-[var(--ts-ink-on-paper)]" style={radiusStyle}>
                  {index + 1}
                </span>
                {isEditing ? (
                  <input
                    type="text"
                    value={item.show_name}
                    onChange={(e) => updateLineItem(index, "show_name", e.target.value)}
                    className={`${inputClass} min-w-0 flex-1 !w-auto px-2 py-1 font-medium`} style={radiusStyle}
                  />
                ) : (
                  <span className={`text-sm font-medium ${inkText}`}>{item.show_name}</span>
                )}
                {isEditing ? (
                  <select
                    value={item.placement}
                    onChange={(e) => updateLineItem(index, "placement", e.target.value)}
                    className={`${inputClass} !w-auto px-2 py-1 text-xs`} style={radiusStyle}
                  >
                    {(["pre-roll", "mid-roll", "post-roll"] as Placement[]).map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                ) : (
                  <span className={`px-2 py-0.5 text-xs ${mutedText}`} style={radiusStyle}>
                    {item.placement} &middot; {item.reader_type.replace("_", " ")}
                  </span>
                )}
                {isEditing && lineItems.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeLineItem(index)}
                    className={`ml-auto p-1.5 ${mutedText} hover:text-[var(--ts-ink-on-paper)]`} style={radiusStyle}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <label className={labelClass}>Post Date</label>
                  {isEditing ? (
                    <input
                      type="date"
                      value={item.post_date}
                      onChange={(e) => updateLineItem(index, "post_date", e.target.value)}
                      className={inputClass} style={radiusStyle}
                    />
                  ) : (
                    <div className={readOnlyClass} style={radiusStyle}>
                      {new Date(item.post_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}
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
                      className={inputClass} style={radiusStyle}
                    />
                  ) : (
                    <div className={readOnlyClass} style={radiusStyle}>{item.guaranteed_downloads.toLocaleString()}</div>
                  )}
                </div>
                <div>
                  <label className={labelClass}>Gross Rate</label>
                  {isEditing ? (
                    <div className="relative">
                      <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-xs ${mutedText}`}>$</span>
                      <input
                        type="number"
                        value={item.gross_rate}
                        onChange={(e) => updateLineItem(index, "gross_rate", Number(e.target.value))}
                        min="0"
                        step="0.01"
                        className={`${inputClass} pl-6`} style={radiusStyle}
                      />
                    </div>
                  ) : (
                    <div className={readOnlyClass} style={radiusStyle}>${item.gross_rate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                  )}
                </div>
                <div>
                  <label className={labelClass}>Net Due</label>
                  {isEditing ? (
                    <div className="relative">
                      <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-xs ${mutedText}`}>$</span>
                      <input
                        type="number"
                        value={item.net_due}
                        onChange={(e) => updateLineItem(index, "net_due", Number(e.target.value))}
                        min="0"
                        step="0.01"
                        className={`${netDueClass} pl-6`} style={radiusStyle}
                      />
                    </div>
                  ) : (
                    <div className={netDueClass} style={radiusStyle}>
                      ${item.net_due.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                  )}
                </div>
              </div>
              {isEditing ? (
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <label className={labelClass}>Price Type</label>
                    <select
                      value={item.price_type}
                      onChange={(e) => updateLineItem(index, "price_type", e.target.value)}
                      className={inputClass} style={radiusStyle}
                    >
                      <option value="cpm">CPM</option>
                      <option value="flat_rate">Flat Rate</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelClass}>Gross CPM</label>
                    <div className="relative">
                      <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-xs ${mutedText}`}>$</span>
                      <input
                        type="number"
                        value={item.gross_cpm}
                        onChange={(e) => updateLineItem(index, "gross_cpm", Number(e.target.value))}
                        min="0"
                        step="0.01"
                        className={`${inputClass} pl-6`} style={radiusStyle}
                      />
                    </div>
                  </div>
                  <div>
                    <label className={labelClass}>Reader Type</label>
                    <select
                      value={item.reader_type}
                      onChange={(e) => updateLineItem(index, "reader_type", e.target.value)}
                      className={inputClass} style={radiusStyle}
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
                      className={inputClass} style={radiusStyle}
                    >
                      <option value="evergreen">Evergreen</option>
                      <option value="dated">Dated</option>
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className={labelClass}>Format</label>
                    <input
                      type="text"
                      value={item.spot_format ?? ""}
                      onChange={(e) => updateLineItem(index, "spot_format", e.target.value)}
                      placeholder="Host-read, produced"
                      className={inputClass}
                      style={radiusStyle}
                    />
                  </div>
                </div>
              ) : (
                <div className={`mt-3 flex flex-wrap items-center gap-4 text-xs ${mutedText}`}>
                  {item.show_surface_id ? (
                    <span data-testid="io-surface-line">Add-on · {item.spot_format || "Creator surface"}</span>
                  ) : item.spot_format ? (
                    <span>{item.spot_format}</span>
                  ) : null}
                  <span>{item.price_type === "cpm" ? `$${item.gross_cpm} CPM` : "Flat rate"}</span>
                  <span>{item.is_scripted ? "Scripted" : "Organic"}</span>
                  <span>{item.is_personal_experience ? "Personal exp." : "Standard"}</span>
                  <span>{item.content_type}</span>
                  {item.pixel_required && <span className={inkText}>Pixel</span>}
                </div>
              )}

              {/* Delivery Tracking */}
              {hasExistingIO && !isEditing && (
                <div className="mt-3 border-t border-[var(--ts-hairline-on-paper)] pt-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-medium uppercase tracking-wider ${mutedText}`}>Delivery</span>
                      {item.verified ? (
                        <span className="inline-flex items-center gap-1 bg-[var(--ts-band-brands)] px-2 py-0.5 text-xs font-medium text-[var(--ts-ink-on-paper)]" style={radiusStyle}>
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M20 6 9 17l-5-5" />
                          </svg>
                          Delivered
                        </span>
                      ) : (
                        <span className="inline-flex items-center bg-[var(--ts-band-shows)] px-2 py-0.5 text-xs font-medium text-[var(--ts-ink-muted-on-paper)]" style={radiusStyle}>
                          Pending
                        </span>
                      )}
                    </div>
                    {!item.verified && !deliveryEditing[item.id] && (
                      <button
                        type="button"
                        onClick={() => handleMarkAsDelivered(item)}
                        className={`text-xs font-medium ${accentText} hover:underline`}
                      >
                        Mark as Delivered
                      </button>
                    )}
                  </div>

                  {/* Delivery edit fields */}
                  {deliveryEditing[item.id] && (
                    <div className="space-y-2">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label className={labelClass}>Actual Downloads</label>
                          <input
                            type="number"
                            value={deliveryFields[item.id]?.actual_downloads ?? item.guaranteed_downloads}
                            onChange={(e) =>
                              setDeliveryFields((prev) => ({
                                ...prev,
                                [item.id]: { ...prev[item.id], actual_downloads: Number(e.target.value) },
                              }))
                            }
                            min="0"
                            className={inputClass} style={radiusStyle}
                          />
                        </div>
                        <div>
                          <label className={labelClass}>Episode URL</label>
                          <input
                            type="text"
                            value={deliveryFields[item.id]?.episode_url ?? ""}
                            onChange={(e) =>
                              setDeliveryFields((prev) => ({
                                ...prev,
                                [item.id]: { ...prev[item.id], episode_url: e.target.value },
                              }))
                            }
                            placeholder="https://..."
                            className={inputClass} style={radiusStyle}
                          />
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleSaveDelivery(item.id)}
                          disabled={isSavingDelivery}
                          className={`${inkBtnClass} px-3 py-1.5 text-xs`} style={radiusStyle}
                        >
                          {isSavingDelivery ? "Saving..." : "Save Delivery"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCancelDelivery(item.id)}
                          className={`${ghostBtnClass} px-3 py-1.5 text-xs`} style={radiusStyle}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Delivery summary (when already verified and not editing) */}
                  {item.verified && !deliveryEditing[item.id] && (
                    <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-3">
                      <div>
                        <span className={mutedText}>Actual DLs: </span>
                        <span className={`font-medium ${
                          (item.actual_downloads ?? 0) >= item.guaranteed_downloads
                            ? inkText
                            : accentText
                        }`}>
                          {(item.actual_downloads ?? 0).toLocaleString()}
                          {" / "}
                          {item.guaranteed_downloads.toLocaleString()}
                        </span>
                      </div>
                      {item.actual_post_date && (
                        <div>
                          <span className={mutedText}>Aired: </span>
                          <span className={`font-medium ${inkText}`}>
                            {new Date(item.actual_post_date).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}
                          </span>
                        </div>
                      )}
                      {item.episode_url && (
                        <div className="truncate">
                          <a
                            href={item.episode_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`${accentText} hover:underline`}
                          >
                            View Episode
                          </a>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Totals */}
        <div className="mt-4 border-t border-[var(--ts-hairline-on-paper)] pt-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="text-center">
              <div className={`mb-1 text-xs font-medium uppercase tracking-wider ${mutedText}`}>Total Downloads</div>
              <div className={`text-lg font-semibold ${inkText}`}>{totalDownloads.toLocaleString()}</div>
            </div>
            <div className="text-center">
              <div className={`mb-1 text-xs font-medium uppercase tracking-wider ${mutedText}`}>Total Gross</div>
              <div className={`text-lg font-semibold ${inkText}`}>${totalGross.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            </div>
            <div className="text-center">
              <div className={`mb-1 text-xs font-medium uppercase tracking-wider ${mutedText}`}>Total Net</div>
              <div className={`text-lg font-semibold ${inkText}`}>${totalNet.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            </div>
          </div>
        </div>
      </section>

      {/* Terms */}
      <section className={panelClass} style={radiusStyle}>
        <h2 className={sectionHead}>Terms &amp; Conditions</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={labelClass}>Payment Terms</label>
            {isEditing ? (
              <>
                <input
                  type="text"
                  list="payment-terms-options"
                  value={paymentTerms}
                  onChange={(e) => setPaymentTerms(e.target.value)}
                  className={inputClass}
                  style={radiusStyle}
                />
                <datalist id="payment-terms-options">
                  {PAYMENT_TERMS_OPTIONS.map((pt) => (
                    <option key={pt} value={pt} />
                  ))}
                </datalist>
                <label className={`mt-2 flex items-center gap-2 text-sm ${inkText}`}>
                  <input
                    type="checkbox"
                    checked={paymentOffPlatform}
                    onChange={(e) => setPaymentOffPlatform(e.target.checked)}
                  />
                  Paid off-platform
                </label>
              </>
            ) : (
              <div className={readOnlyClass} style={radiusStyle}>
                {paymentOffPlatform ? `${paymentTerms} (off-platform)` : paymentTerms}
              </div>
            )}
          </div>
          <div>
            <label className={labelClass}>Exclusivity (days)</label>
            {isEditing ? (
              <input type="number" value={exclusivityDays} onChange={(e) => setExclusivityDays(Number(e.target.value))} className={inputClass} style={radiusStyle} />
            ) : (
              <div className={readOnlyClass} style={radiusStyle}>{exclusivityDays}</div>
            )}
          </div>
          <div>
            <label className={labelClass}>ROFR (days)</label>
            {isEditing ? (
              <div className="space-y-2">
                <label className={`flex items-center gap-2 text-sm ${inkText}`}>
                  <input type="checkbox" aria-label="Include ROFR" checked={rofrEnabled} onChange={(e) => setRofrEnabled(e.target.checked)} />
                  Include on the IO
                </label>
                <input type="number" value={rofrDays} onChange={(e) => setRofrDays(Number(e.target.value))} className={inputClass} style={radiusStyle} />
              </div>
            ) : (
              <div className={readOnlyClass} style={radiusStyle}>{rofrEnabled ? rofrDays : "Off"}</div>
            )}
          </div>
          <div>
            <label className={labelClass}>Cancellation Notice (calendar days)</label>
            {isEditing ? (
              <input type="number" value={cancellationDays} onChange={(e) => setCancellationDays(Number(e.target.value))} className={inputClass} style={radiusStyle} />
            ) : (
              <div className={readOnlyClass} style={radiusStyle}>{cancellationDays}</div>
            )}
          </div>
          <div>
            <label className={labelClass}>Download Tracking (days)</label>
            {isEditing ? (
              <div className="space-y-2">
                <label className={`flex items-center gap-2 text-sm ${inkText}`}>
                  <input type="checkbox" aria-label="Include download tracking" checked={trackingEnabled} onChange={(e) => setTrackingEnabled(e.target.checked)} />
                  Include on the IO
                </label>
                <input type="number" value={trackingDays} onChange={(e) => setTrackingDays(Number(e.target.value))} className={inputClass} style={radiusStyle} />
              </div>
            ) : (
              <div className={readOnlyClass} style={radiusStyle}>{trackingEnabled ? trackingDays : "Off"}</div>
            )}
          </div>
          <div>
            <label className={labelClass}>Make-Good Threshold</label>
            {isEditing ? (
              <div className="space-y-2">
                <label className={`flex items-center gap-2 text-sm ${inkText}`}>
                  <input type="checkbox" aria-label="Include make-good" checked={makeGoodEnabled} onChange={(e) => setMakeGoodEnabled(e.target.checked)} />
                  Include on the IO
                </label>
                <div className="relative">
                  <input
                    type="number"
                    value={(makeGoodThreshold * 100).toFixed(0)}
                    onChange={(e) => setMakeGoodThreshold(Number(e.target.value) / 100)}
                    className={inputClass} style={radiusStyle}
                    min={0}
                    max={100}
                  />
                  <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs ${mutedText}`}>%</span>
                </div>
              </div>
            ) : (
              <div className={readOnlyClass} style={radiusStyle}>{makeGoodEnabled ? `${(makeGoodThreshold * 100).toFixed(0)}%` : "Off"}</div>
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
                className={inputClass} style={radiusStyle}
              />
              <p className={`mt-1 text-xs ${mutedText}`}>Comma-separated brand names</p>
            </>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              {competitorExclusion.split(",").map((c) => c.trim()).filter(Boolean).length > 0 ? (
                competitorExclusion.split(",").map((c) => c.trim()).filter(Boolean).map((comp) => (
                  <span key={comp} className="bg-[var(--ts-band-shows)] px-2.5 py-1 text-xs font-medium text-[var(--ts-ink-on-paper)]" style={radiusStyle}>
                    {comp}
                  </span>
                ))
              ) : (
                <span className={`text-xs ${mutedText}`}>None</span>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Signature section (view mode, existing signed IO) */}
      {!isEditing && hasExistingIO && savedIO?.signed_at && (
        <section className={panelClass} style={radiusStyle}>
          <h2 className={sectionHead}>Signed</h2>
          <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
            <div>
              <span className={mutedText}>Publisher: </span>
              <span className={`font-medium ${inkText}`}>{savedIO.signed_by_publisher}</span>
            </div>
            <div>
              <span className={mutedText}>Agency: </span>
              <span className={`font-medium ${inkText}`}>{savedIO.signed_by_agency ?? "\u2014"}</span>
            </div>
            <div className="sm:col-span-2">
              <span className={mutedText}>Signed on: </span>
              <span className={`font-medium ${inkText}`}>
                {new Date(savedIO.signed_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
              </span>
            </div>
          </div>
        </section>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3">
        {isEditing && (
          <>
            {hasExistingIO && (
              <button
                onClick={() => setIsEditing(false)}
                className={ghostBtnClass} style={radiusStyle}
              >
                Cancel
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={isSaving}
              className={ghostBtnClass} style={radiusStyle}
            >
              {isSaving ? "Saving..." : "Save Draft"}
            </button>
            {!hasExistingIO && (
              <button
                onClick={handleSave}
                disabled={isSaving}
                className={inkBtnClass} style={radiusStyle}
              >
                {isSaving ? "Sending..." : "Send IO"}
              </button>
            )}
          </>
        )}
        <button
          onClick={handleDownloadPdf}
          disabled={isDownloading}
          className={ghostBtnClass} style={radiusStyle}
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
          className={inkBtnClass} style={radiusStyle}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
          Send via Email
        </button>
        {hasExistingIO && hasDeliveredItems && (
          <button
            onClick={handleGenerateInvoice}
            disabled={isGeneratingInvoice}
            className={inkBtnClass} style={radiusStyle}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
            {isGeneratingInvoice ? "Generating..." : "Generate Invoice"}
          </button>
        )}
      </div>

      {saveError && (
        <div className="mt-4 border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] p-3" style={radiusStyle}>
          <p className={`text-sm ${accentText}`}>{saveError}</p>
        </div>
      )}

      {/* Delivery / Invoice error messages */}
      {deliveryError && (
        <div className="mt-4 border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] p-3" style={radiusStyle}>
          <div className="flex items-center justify-between">
            <p className={`text-sm ${accentText}`}>{deliveryError}</p>
            <button onClick={() => setDeliveryError(null)} className={`p-1 ${mutedText} hover:text-[var(--ts-ink-on-paper)]`}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}
      {invoiceError && (
        <div className="mt-4 border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] p-3" style={radiusStyle}>
          <div className="flex items-center justify-between">
            <p className={`text-sm ${accentText}`}>{invoiceError}</p>
            <button onClick={() => setInvoiceError(null)} className={`p-1 ${mutedText} hover:text-[var(--ts-ink-on-paper)]`}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Send confirmation modal */}
      {showSendConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--ts-ink-on-paper)]/40" onClick={() => setShowSendConfirm(false)}>
          <div className="mx-4 w-full max-w-md border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] p-6" style={radiusStyle} onClick={(e) => e.stopPropagation()}>
            <h3 className={`mb-2 text-lg font-semibold ${inkText}`}>Send IO via Email</h3>
            <p className={`mb-4 text-sm ${mutedText}`}>
              This will email <strong>{ioNumber}</strong> as a PDF attachment to:
            </p>
            <div className="mb-5 border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-band-shows)] p-3" style={radiusStyle}>
              <div className={`text-sm font-medium ${inkText}`}>{recipientName}</div>
              <div className={`text-sm ${mutedText}`}>{recipientEmail}</div>
            </div>
            <div className="flex items-center gap-3 justify-end">
              <button
                onClick={() => setShowSendConfirm(false)}
                className={ghostBtnClass} style={radiusStyle}
              >
                Cancel
              </button>
              <button
                onClick={handleSendEmail}
                disabled={isSending}
                className={inkBtnClass} style={radiusStyle}
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
        <div
          className="mt-4 border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] p-4"
          style={radiusStyle}
        >
          <div className="flex items-start gap-3">
            {sendResult.success ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`mt-0.5 shrink-0 ${accentText}`}>
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            )}
            <div>
              <p className={`text-sm font-medium ${sendResult.success ? inkText : accentText}`}>
                {sendResult.success
                  ? `IO sent to ${sendResult.toName ?? sendResult.to}`
                  : "Failed to send"}
              </p>
              {sendResult.success && sendResult.to && (
                <p className={`mt-0.5 text-xs ${mutedText}`}>{sendResult.to}</p>
              )}
              {sendResult.error && (
                <p className={`mt-0.5 text-xs ${accentText}`}>{sendResult.error}</p>
              )}
            </div>
            <button
              onClick={() => setSendResult(null)}
              className={`ml-auto p-1 ${mutedText} hover:text-[var(--ts-ink-on-paper)]`} style={radiusStyle}
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
