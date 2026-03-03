"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import IOPreview from "@/components/io/IOPreview";
import type { InsertionOrder, IOLineItem, Placement, PriceType } from "@/lib/data";

type Step = "choose" | "pdf" | "manual" | "preview" | "confirmed";

// Reusable classes matching existing patterns
const inputClass =
  "w-full px-4 py-2.5 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] text-[var(--brand-text)] text-sm placeholder:text-[var(--brand-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30 focus:border-[var(--brand-blue)] transition-all";
const labelClass = "block text-sm font-medium text-[var(--brand-text)] mb-1.5";

// Default empty line item
function emptyLineItem(index: number): IOLineItem {
  return {
    id: `line-manual-${index + 1}`,
    format: "podcast",
    post_date: "",
    guaranteed_downloads: 0,
    show_name: "",
    placement: "mid-roll",
    is_scripted: false,
    is_personal_experience: true,
    reader_type: "host_read",
    content_type: "evergreen",
    pixel_required: false,
    gross_rate: 0,
    gross_cpm: 0,
    price_type: "cpm",
    net_due: 0,
    verified: false,
    make_good_triggered: false,
  };
}

export default function ImportIOPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("choose");
  const [ioData, setIOData] = useState<Partial<InsertionOrder> | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);

  // PDF upload state
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Manual entry state
  const [advertiserName, setAdvertiserName] = useState("");
  const [advertiserContactName, setAdvertiserContactName] = useState("");
  const [advertiserContactEmail, setAdvertiserContactEmail] = useState("");
  const [publisherName, setPublisherName] = useState("");
  const [publisherContactName, setPublisherContactName] = useState("");
  const [publisherContactEmail, setPublisherContactEmail] = useState("");
  const [publisherAddress, setPublisherAddress] = useState("");
  const [showAgency, setShowAgency] = useState(false);
  const [agencyName, setAgencyName] = useState("");
  const [agencyContactName, setAgencyContactName] = useState("");
  const [agencyContactEmail, setAgencyContactEmail] = useState("");
  const [sendInvoicesTo, setSendInvoicesTo] = useState("");
  const [lineItems, setLineItems] = useState<IOLineItem[]>([emptyLineItem(0)]);
  const [paymentTerms, setPaymentTerms] = useState("Net 30 EOM");
  const [exclusivityDays, setExclusivityDays] = useState(90);
  const [rofrDays, setRofrDays] = useState(30);
  const [cancellationDays, setCancellationDays] = useState(14);
  const [trackingDays, setTrackingDays] = useState(45);
  const [makeGoodThreshold, setMakeGoodThreshold] = useState(10);
  const [manualError, setManualError] = useState<string | null>(null);

  // --- PDF Upload ---

  const handleFileUpload = useCallback(async (file: File) => {
    if (file.type !== "application/pdf") {
      setUploadError("Only PDF files are supported.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setUploadError("File must be under 10MB.");
      return;
    }

    setIsUploading(true);
    setUploadError(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/deals/import", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.code === "NO_API_KEY") {
          setUploadError(data.error);
        } else {
          setUploadError(data.error || "Upload failed. Try manual entry instead.");
        }
        return;
      }

      setIOData(data.io);
      setStep("preview");
    } catch {
      setUploadError("Network error. Please try again or use manual entry.");
    } finally {
      setIsUploading(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFileUpload(file);
    },
    [handleFileUpload]
  );

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(true);
  };

  const handleDragLeave = () => setDragActive(false);

  // --- Manual Entry ---

  const addLineItem = () => {
    setLineItems((prev) => [...prev, emptyLineItem(prev.length)]);
  };

  const removeLineItem = (index: number) => {
    setLineItems((prev) => prev.filter((_, i) => i !== index));
  };

  const updateLineItem = (index: number, field: keyof IOLineItem, value: string | number | boolean) => {
    setLineItems((prev) =>
      prev.map((li, i) => {
        if (i !== index) return li;
        const updated = { ...li, [field]: value };
        // Auto-calculate CPM when rate and downloads change
        if (
          (field === "gross_rate" || field === "guaranteed_downloads") &&
          updated.price_type === "cpm" &&
          updated.guaranteed_downloads > 0 &&
          updated.gross_rate > 0
        ) {
          updated.gross_cpm =
            Math.round((updated.gross_rate / updated.guaranteed_downloads) * 1000 * 100) / 100;
        }
        // Default net_due to gross_rate if not explicitly different
        if (field === "gross_rate" && updated.net_due === 0) {
          updated.net_due = updated.gross_rate;
        }
        return updated;
      })
    );
  };

  const handleManualSubmit = async () => {
    setManualError(null);

    // Basic validation
    if (!advertiserName.trim()) {
      setManualError("Advertiser name is required.");
      return;
    }
    if (!publisherName.trim()) {
      setManualError("Publisher name is required.");
      return;
    }
    if (!publisherContactName.trim()) {
      setManualError("Publisher contact name is required.");
      return;
    }
    if (!publisherContactEmail.trim()) {
      setManualError("Publisher contact email is required.");
      return;
    }
    if (lineItems.length === 0) {
      setManualError("At least one line item is required.");
      return;
    }

    const body = {
      advertiser_name: advertiserName,
      advertiser_contact_name: advertiserContactName || undefined,
      advertiser_contact_email: advertiserContactEmail || undefined,
      publisher_name: publisherName,
      publisher_contact_name: publisherContactName,
      publisher_contact_email: publisherContactEmail,
      publisher_address: publisherAddress || undefined,
      agency_name: showAgency ? agencyName || undefined : undefined,
      agency_contact_name: showAgency ? agencyContactName || undefined : undefined,
      agency_contact_email: showAgency ? agencyContactEmail || undefined : undefined,
      send_invoices_to: showAgency ? sendInvoicesTo || undefined : undefined,
      line_items: lineItems.map((li) => ({
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
        net_due: li.net_due || li.gross_rate,
      })),
      payment_terms: paymentTerms,
      exclusivity_days: exclusivityDays,
      rofr_days: rofrDays,
      cancellation_notice_days: cancellationDays,
      download_tracking_days: trackingDays,
      make_good_threshold: makeGoodThreshold / 100,
    };

    try {
      const res = await fetch("/api/deals/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setManualError(data.error || "Submission failed.");
        return;
      }
      setIOData(data.io);
      setStep("preview");
    } catch {
      setManualError("Network error. Please try again.");
    }
  };

  // --- Confirm Import ---

  const handleConfirm = async () => {
    setIsConfirming(true);
    // Simulate save — will wire to Supabase later
    await new Promise((r) => setTimeout(r, 1200));
    setIsConfirming(false);
    setStep("confirmed");
  };

  const handleEditFromPreview = () => {
    // Go back to manual entry (populate from ioData)
    if (ioData) {
      setAdvertiserName(ioData.advertiser_name || "");
      setAdvertiserContactName(ioData.advertiser_contact_name || "");
      setAdvertiserContactEmail(ioData.advertiser_contact_email || "");
      setPublisherName(ioData.publisher_name || "");
      setPublisherContactName(ioData.publisher_contact_name || "");
      setPublisherContactEmail(ioData.publisher_contact_email || "");
      setPublisherAddress(ioData.publisher_address || "");
      if (ioData.agency_name) {
        setShowAgency(true);
        setAgencyName(ioData.agency_name || "");
        setAgencyContactName(ioData.agency_contact_name || "");
        setAgencyContactEmail(ioData.agency_contact_email || "");
        setSendInvoicesTo(ioData.send_invoices_to || "");
      }
      if (ioData.line_items && ioData.line_items.length > 0) {
        setLineItems(ioData.line_items);
      }
      setPaymentTerms(ioData.payment_terms || "Net 30 EOM");
      setExclusivityDays(ioData.exclusivity_days ?? 90);
      setRofrDays(ioData.rofr_days ?? 30);
      setCancellationDays(ioData.cancellation_notice_days ?? 14);
      setTrackingDays(ioData.download_tracking_days ?? 45);
      setMakeGoodThreshold((ioData.make_good_threshold ?? 0.1) * 100);
    }
    setStep("manual");
  };

  return (
    <div className="p-8 max-w-3xl">
      {/* Header */}
      <div className="mb-8">
        <button
          onClick={() => {
            if (step === "choose" || step === "confirmed") {
              router.push("/deals");
            } else if (step === "preview") {
              handleEditFromPreview();
            } else {
              setStep("choose");
            }
          }}
          className="flex items-center gap-1.5 text-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors mb-4"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
          {step === "choose" || step === "confirmed" ? "Deals" : "Back"}
        </button>
        <h1 className="text-2xl font-bold text-[var(--brand-text)] tracking-tight">Import IO</h1>
        <p className="text-sm text-[var(--brand-text-secondary)] mt-1">
          {step === "choose" && "Import an existing insertion order into Taylslate."}
          {step === "pdf" && "Upload an IO PDF to extract data automatically."}
          {step === "manual" && "Enter insertion order details manually."}
          {step === "preview" && "Review the extracted data before importing."}
          {step === "confirmed" && "Your insertion order has been imported."}
        </p>
      </div>

      {/* Step 1: Choose Mode */}
      {step === "choose" && (
        <div className="grid grid-cols-2 gap-4">
          <button
            onClick={() => setStep("pdf")}
            className="flex flex-col items-center gap-4 p-8 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)] hover:border-[var(--brand-blue)]/40 hover:shadow-sm transition-all text-left group"
          >
            <div className="w-14 h-14 rounded-2xl bg-[var(--brand-blue)]/[0.08] flex items-center justify-center group-hover:bg-[var(--brand-blue)]/[0.12] transition-colors">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--brand-blue)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
            </div>
            <div className="text-center">
              <h3 className="font-semibold text-[var(--brand-text)] mb-1">Upload PDF</h3>
              <p className="text-xs text-[var(--brand-text-muted)]">
                Upload an IO document and we&apos;ll extract the data automatically using AI.
              </p>
            </div>
          </button>
          <button
            onClick={() => setStep("manual")}
            className="flex flex-col items-center gap-4 p-8 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)] hover:border-[var(--brand-teal)]/40 hover:shadow-sm transition-all text-left group"
          >
            <div className="w-14 h-14 rounded-2xl bg-[var(--brand-teal)]/[0.08] flex items-center justify-center group-hover:bg-[var(--brand-teal)]/[0.12] transition-colors">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--brand-teal)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </div>
            <div className="text-center">
              <h3 className="font-semibold text-[var(--brand-text)] mb-1">Manual Entry</h3>
              <p className="text-xs text-[var(--brand-text-muted)]">
                Enter IO details by hand — advertiser, publisher, line items, and terms.
              </p>
            </div>
          </button>
        </div>
      )}

      {/* Step 2a: PDF Upload */}
      {step === "pdf" && (
        <div>
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
            className={`flex flex-col items-center justify-center py-16 rounded-xl border-2 border-dashed cursor-pointer transition-all ${
              dragActive
                ? "border-[var(--brand-blue)] bg-[var(--brand-blue)]/[0.04]"
                : "border-[var(--brand-border)] bg-[var(--brand-surface-elevated)] hover:border-[var(--brand-blue)]/30"
            }`}
          >
            {isUploading ? (
              <>
                <svg className="animate-spin h-8 w-8 text-[var(--brand-blue)] mb-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <p className="text-sm font-medium text-[var(--brand-text)]">Extracting IO data...</p>
                <p className="text-xs text-[var(--brand-text-muted)] mt-1">This may take a few seconds.</p>
              </>
            ) : (
              <>
                <div className="w-14 h-14 rounded-2xl bg-[var(--brand-blue)]/[0.08] flex items-center justify-center mb-4">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--brand-blue)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-[var(--brand-text)]">
                  Drop your IO PDF here, or click to browse
                </p>
                <p className="text-xs text-[var(--brand-text-muted)] mt-1">PDF files only, up to 10MB</p>
              </>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileUpload(file);
            }}
          />

          {uploadError && (
            <div className="mt-4 p-4 rounded-lg bg-[var(--brand-error)]/[0.06] border border-[var(--brand-error)]/20">
              <p className="text-sm text-[var(--brand-error)]">{uploadError}</p>
              <button
                onClick={() => {
                  setUploadError(null);
                  setStep("manual");
                }}
                className="text-sm text-[var(--brand-blue)] hover:underline font-medium mt-2"
              >
                Switch to manual entry
              </button>
            </div>
          )}
        </div>
      )}

      {/* Step 2b: Manual Entry */}
      {step === "manual" && (
        <div className="space-y-6">
          {/* Advertiser Section */}
          <section className="p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)]">
            <h2 className="text-sm font-semibold text-[var(--brand-text)] uppercase tracking-wider mb-4">
              Advertiser
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className={labelClass}>Company Name *</label>
                <input
                  type="text"
                  value={advertiserName}
                  onChange={(e) => setAdvertiserName(e.target.value)}
                  placeholder="e.g., Athletic Greens"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Contact Name</label>
                <input
                  type="text"
                  value={advertiserContactName}
                  onChange={(e) => setAdvertiserContactName(e.target.value)}
                  placeholder="John Smith"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Contact Email</label>
                <input
                  type="email"
                  value={advertiserContactEmail}
                  onChange={(e) => setAdvertiserContactEmail(e.target.value)}
                  placeholder="john@example.com"
                  className={inputClass}
                />
              </div>
            </div>
          </section>

          {/* Publisher Section */}
          <section className="p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)]">
            <h2 className="text-sm font-semibold text-[var(--brand-text)] uppercase tracking-wider mb-4">
              Publisher
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Company Name *</label>
                <input
                  type="text"
                  value={publisherName}
                  onChange={(e) => setPublisherName(e.target.value)}
                  placeholder="e.g., Left Field Enterprises"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Contact Name *</label>
                <input
                  type="text"
                  value={publisherContactName}
                  onChange={(e) => setPublisherContactName(e.target.value)}
                  placeholder="Jane Doe"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Contact Email *</label>
                <input
                  type="email"
                  value={publisherContactEmail}
                  onChange={(e) => setPublisherContactEmail(e.target.value)}
                  placeholder="jane@publisher.com"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Address</label>
                <input
                  type="text"
                  value={publisherAddress}
                  onChange={(e) => setPublisherAddress(e.target.value)}
                  placeholder="123 Main St, City, ST 12345"
                  className={inputClass}
                />
              </div>
            </div>
          </section>

          {/* Agency Toggle + Section */}
          <section className="p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)]">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-[var(--brand-text)] uppercase tracking-wider">
                Agency
              </h2>
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
            {showAgency && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Company Name</label>
                  <input
                    type="text"
                    value={agencyName}
                    onChange={(e) => setAgencyName(e.target.value)}
                    placeholder="e.g., VeritoneOne"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Contact Name</label>
                  <input
                    type="text"
                    value={agencyContactName}
                    onChange={(e) => setAgencyContactName(e.target.value)}
                    placeholder="Agency contact"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Contact Email</label>
                  <input
                    type="email"
                    value={agencyContactEmail}
                    onChange={(e) => setAgencyContactEmail(e.target.value)}
                    placeholder="billing@agency.com"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Send Invoices To</label>
                  <input
                    type="email"
                    value={sendInvoicesTo}
                    onChange={(e) => setSendInvoicesTo(e.target.value)}
                    placeholder="ap@agency.com"
                    className={inputClass}
                  />
                </div>
              </div>
            )}
            {!showAgency && (
              <p className="text-xs text-[var(--brand-text-muted)]">
                Only add an agency if this IO involves a media buying agency.
              </p>
            )}
          </section>

          {/* Line Items */}
          <section className="p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)]">
            <h2 className="text-sm font-semibold text-[var(--brand-text)] uppercase tracking-wider mb-4">
              Line Items
            </h2>
            <div className="space-y-4">
              {lineItems.map((item, index) => (
                <div
                  key={item.id}
                  className="p-4 bg-[var(--brand-surface)] rounded-lg border border-[var(--brand-border)]/50"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[var(--brand-blue)]/10 text-xs font-bold text-[var(--brand-blue)]">
                        {index + 1}
                      </span>
                      <span className="text-sm font-medium text-[var(--brand-text)]">
                        {item.show_name || "Line Item"}
                      </span>
                    </div>
                    {lineItems.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeLineItem(index)}
                        className="p-1.5 rounded-lg text-[var(--brand-text-muted)] hover:text-[var(--brand-error)] hover:bg-[var(--brand-error)]/[0.06] transition-all"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M18 6 6 18M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className={labelClass}>Show Name</label>
                      <input
                        type="text"
                        value={item.show_name}
                        onChange={(e) => updateLineItem(index, "show_name", e.target.value)}
                        placeholder="The Daily"
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Post Date</label>
                      <input
                        type="date"
                        value={item.post_date}
                        onChange={(e) => updateLineItem(index, "post_date", e.target.value)}
                        className={inputClass}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3 mb-3">
                    <div>
                      <label className={labelClass}>Placement</label>
                      <select
                        value={item.placement}
                        onChange={(e) => updateLineItem(index, "placement", e.target.value as Placement)}
                        className={inputClass}
                      >
                        <option value="pre-roll">Pre-roll</option>
                        <option value="mid-roll">Mid-roll</option>
                        <option value="post-roll">Post-roll</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelClass}>Price Type</label>
                      <select
                        value={item.price_type}
                        onChange={(e) => updateLineItem(index, "price_type", e.target.value as PriceType)}
                        className={inputClass}
                      >
                        <option value="cpm">CPM</option>
                        <option value="flat_rate">Flat Rate</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelClass}>Format</label>
                      <select
                        value={item.format}
                        onChange={(e) => updateLineItem(index, "format", e.target.value)}
                        className={inputClass}
                      >
                        <option value="podcast">Podcast</option>
                        <option value="youtube">YouTube</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className={labelClass}>Guaranteed DLs</label>
                      <input
                        type="number"
                        value={item.guaranteed_downloads || ""}
                        onChange={(e) => updateLineItem(index, "guaranteed_downloads", Number(e.target.value) || 0)}
                        placeholder="35000"
                        min="0"
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Gross Rate ($)</label>
                      <input
                        type="number"
                        value={item.gross_rate || ""}
                        onChange={(e) => updateLineItem(index, "gross_rate", Number(e.target.value) || 0)}
                        placeholder="875.00"
                        min="0"
                        step="0.01"
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Net Due ($)</label>
                      <input
                        type="number"
                        value={item.net_due || ""}
                        onChange={(e) => updateLineItem(index, "net_due", Number(e.target.value) || 0)}
                        placeholder="875.00"
                        min="0"
                        step="0.01"
                        className={inputClass}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addLineItem}
              className="flex items-center gap-1.5 mt-3 text-sm text-[var(--brand-blue)] hover:text-[var(--brand-blue-light)] font-medium transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Add line item
            </button>
          </section>

          {/* Terms */}
          <section className="p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)]">
            <h2 className="text-sm font-semibold text-[var(--brand-text)] uppercase tracking-wider mb-4">
              Terms &amp; Conditions
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Payment Terms</label>
                <input
                  type="text"
                  value={paymentTerms}
                  onChange={(e) => setPaymentTerms(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Exclusivity (days)</label>
                <input
                  type="number"
                  value={exclusivityDays}
                  onChange={(e) => setExclusivityDays(Number(e.target.value))}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>ROFR (days)</label>
                <input
                  type="number"
                  value={rofrDays}
                  onChange={(e) => setRofrDays(Number(e.target.value))}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Cancellation Notice (days)</label>
                <input
                  type="number"
                  value={cancellationDays}
                  onChange={(e) => setCancellationDays(Number(e.target.value))}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Download Tracking (days)</label>
                <input
                  type="number"
                  value={trackingDays}
                  onChange={(e) => setTrackingDays(Number(e.target.value))}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Make-Good Threshold (%)</label>
                <input
                  type="number"
                  value={makeGoodThreshold}
                  onChange={(e) => setMakeGoodThreshold(Number(e.target.value))}
                  min={0}
                  max={100}
                  className={inputClass}
                />
              </div>
            </div>
          </section>

          {manualError && (
            <div className="p-4 rounded-lg bg-[var(--brand-error)]/[0.06] border border-[var(--brand-error)]/20">
              <p className="text-sm text-[var(--brand-error)]">{manualError}</p>
            </div>
          )}

          <div className="border-t border-[var(--brand-border)] pt-6">
            <button
              onClick={handleManualSubmit}
              className="w-full flex items-center justify-center gap-2 bg-[var(--brand-blue)] hover:bg-[var(--brand-blue-light)] text-white py-3 rounded-xl text-sm font-semibold transition-all"
            >
              Preview IO
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Preview */}
      {step === "preview" && ioData && (
        <IOPreview
          io={ioData}
          onEdit={handleEditFromPreview}
          onConfirm={handleConfirm}
          isConfirming={isConfirming}
        />
      )}

      {/* Step 4: Confirmed */}
      {step === "confirmed" && (
        <div className="flex flex-col items-center justify-center py-20 bg-[var(--brand-surface-elevated)] rounded-2xl border border-[var(--brand-border)]">
          <div className="w-16 h-16 rounded-2xl bg-[var(--brand-success)]/[0.08] flex items-center justify-center mb-5">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--brand-success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-[var(--brand-text)] mb-2">IO Imported</h3>
          <p className="text-sm text-[var(--brand-text-muted)] mb-1">
            {ioData?.io_number ?? "IO"} &mdash; {ioData?.advertiser_name ?? "Unknown Advertiser"}
          </p>
          <p className="text-sm text-[var(--brand-text-muted)] mb-6">
            {ioData?.line_items?.length ?? 0} line item{(ioData?.line_items?.length ?? 0) !== 1 ? "s" : ""} &middot; $
            {(ioData?.total_net ?? 0).toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}{" "}
            net
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push("/deals")}
              className="px-5 py-2.5 rounded-lg bg-[var(--brand-blue)] hover:bg-[var(--brand-blue-light)] text-white text-sm font-medium transition-colors"
            >
              View Deals
            </button>
            <button
              onClick={() => {
                setStep("choose");
                setIOData(null);
              }}
              className="px-5 py-2.5 rounded-lg border border-[var(--brand-border)] text-sm font-medium text-[var(--brand-text-secondary)] hover:bg-[var(--brand-surface)] transition-colors"
            >
              Import Another
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
