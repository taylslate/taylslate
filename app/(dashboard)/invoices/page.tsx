"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import type { InvoiceStatus, Invoice, InvoiceLineItem, InsertionOrder } from "@/lib/data/types";

interface InvoiceWithLineItems extends Invoice {
  line_items: InvoiceLineItem[];
}

interface InvoiceStats {
  total_outstanding: number;
  total_paid_this_month: number;
  count_by_status: Record<string, number>;
}

interface Deal {
  id: string;
  status: string;
}

const statusStyles: Record<InvoiceStatus, string> = {
  draft: "bg-[var(--brand-text-muted)]/10 text-[var(--brand-text-muted)]",
  sent: "bg-[var(--brand-blue)]/10 text-[var(--brand-blue)]",
  paid: "bg-[var(--brand-success)]/10 text-[var(--brand-success)]",
  overdue: "bg-[var(--brand-error)]/10 text-[var(--brand-error)]",
  disputed: "bg-[var(--brand-warning)]/10 text-[var(--brand-warning)]",
  cancelled: "bg-[var(--brand-text-muted)]/10 text-[var(--brand-text-muted)]",
};

const statusLabels: Record<InvoiceStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  paid: "Paid",
  overdue: "Overdue",
  disputed: "Disputed",
  cancelled: "Cancelled",
};

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<InvoiceWithLineItems[]>([]);
  const [stats, setStats] = useState<InvoiceStats>({
    total_outstanding: 0,
    total_paid_this_month: 0,
    count_by_status: {},
  });
  const [invoiceableIOs, setInvoiceableIOs] = useState<InsertionOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [selectedIOId, setSelectedIOId] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedInvoice, setGeneratedInvoice] = useState<Invoice | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState<string | null>(null);

  // Send state
  const [showSendConfirm, setShowSendConfirm] = useState(false);
  const [sendingInvoice, setSendingInvoice] = useState<Invoice | null>(null);
  const [sendingInvoiceId, setSendingInvoiceId] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ success: boolean; to?: string; toName?: string; error?: string } | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch invoices and deals in parallel
      const [invoicesRes, dealsRes] = await Promise.all([
        fetch("/api/invoices"),
        fetch("/api/deals"),
      ]);

      if (!invoicesRes.ok) throw new Error("Failed to load invoices");
      const invoicesData = await invoicesRes.json();
      setInvoices(invoicesData.invoices ?? []);
      setStats(invoicesData.stats ?? { total_outstanding: 0, total_paid_this_month: 0, count_by_status: {} });

      if (dealsRes.ok) {
        const dealsData = await dealsRes.json();
        const activeDeals = (dealsData.deals ?? []).filter(
          (d: Deal) => d.status === "live" || d.status === "completed"
        );

        // Fetch IOs for active deals in parallel
        const ioResults = await Promise.all(
          activeDeals.map(async (deal: Deal) => {
            try {
              const res = await fetch(`/api/deals/${deal.id}/io`);
              if (!res.ok) return null;
              const data = await res.json();
              return data.io as InsertionOrder | null;
            } catch {
              return null;
            }
          })
        );

        // Filter for IOs with delivered line items
        const ios = ioResults
          .filter((io): io is InsertionOrder => !!io)
          .filter((io) =>
            io.line_items.some((li) => li.actual_post_date || li.verified)
          );
        setInvoiceableIOs(ios);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleGenerate = async () => {
    if (!selectedIOId) return;
    setIsGenerating(true);
    setGenerateError(null);

    try {
      const res = await fetch("/api/invoices/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ io_id: selectedIOId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setGenerateError(data.error);
        return;
      }
      setGeneratedInvoice(data.invoice);
      // Refresh invoice list after generation
      fetchData();
    } catch {
      setGenerateError("Network error. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownloadExisting = async (invoiceId: string) => {
    setIsDownloading(invoiceId);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/pdf`);
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `invoice-${invoiceId}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // silent fail
    } finally {
      setIsDownloading(null);
    }
  };

  const handleDownloadGenerated = async () => {
    if (!generatedInvoice) return;
    setIsDownloading("generated");
    try {
      const res = await fetch("/api/invoices/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoice: generatedInvoice }),
      });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${generatedInvoice.invoice_number}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // silent fail
    } finally {
      setIsDownloading(null);
    }
  };

  // Open send confirmation for an existing invoice (by ID)
  const handleSendExisting = (invoice: InvoiceWithLineItems) => {
    setSendingInvoice(null);
    setSendingInvoiceId(invoice.id);
    setSendResult(null);
    setShowSendConfirm(true);
  };

  // Open send confirmation for a generated invoice (full object)
  const handleSendGenerated = () => {
    if (!generatedInvoice) return;
    setSendingInvoice(generatedInvoice);
    setSendingInvoiceId(null);
    setSendResult(null);
    setShowSendConfirm(true);
  };

  // The invoice being sent — either from list or generated
  const invoiceToSend = sendingInvoiceId
    ? invoices.find((inv) => inv.id === sendingInvoiceId) ?? null
    : sendingInvoice;

  const handleSendEmail = async () => {
    if (!invoiceToSend) return;
    setIsSending(true);
    setSendResult(null);

    try {
      const body = sendingInvoiceId
        ? { invoice_id: sendingInvoiceId }
        : { invoice: sendingInvoice };

      const res = await fetch("/api/invoices/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setSendResult({ success: false, error: data.error });
      } else {
        setSendResult({ success: true, to: data.to, toName: data.toName });
        // Refresh after sending (status may change)
        fetchData();
      }
    } catch {
      setSendResult({ success: false, error: "Network error. Please try again." });
    } finally {
      setIsSending(false);
      setShowSendConfirm(false);
    }
  };

  const pendingCount = (stats.count_by_status["sent"] ?? 0) + (stats.count_by_status["draft"] ?? 0);

  if (loading) {
    return (
      <div className="p-8 max-w-5xl">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-[var(--brand-text)] tracking-tight">Invoices</h1>
            <p className="text-sm text-[var(--brand-text-secondary)] mt-1">
              Track invoices and payments for your shows.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4 mb-8">
          {[1, 2, 3].map((i) => (
            <div key={i} className="p-4 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)] animate-pulse">
              <div className="h-3 w-20 bg-[var(--brand-border)] rounded mb-2" />
              <div className="h-6 w-16 bg-[var(--brand-border)] rounded" />
            </div>
          ))}
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)] animate-pulse">
              <div className="h-4 w-48 bg-[var(--brand-border)] rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 max-w-5xl">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-[var(--brand-text)] tracking-tight">Invoices</h1>
            <p className="text-sm text-[var(--brand-text-secondary)] mt-1">
              Track invoices and payments for your shows.
            </p>
          </div>
        </div>
        <div className="p-6 bg-[var(--brand-error)]/[0.06] border border-[var(--brand-error)]/20 rounded-xl text-center">
          <p className="text-sm text-[var(--brand-error)] font-medium">{error}</p>
          <button
            onClick={fetchData}
            className="mt-3 px-4 py-2 rounded-lg bg-[var(--brand-blue)] hover:bg-[var(--brand-blue-light)] text-white text-sm font-medium transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const hasInvoices = invoices.length > 0;

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-[var(--brand-text)] tracking-tight">Invoices</h1>
          <p className="text-sm text-[var(--brand-text-secondary)] mt-1">
            Track invoices and payments for your shows.
          </p>
        </div>
        {invoiceableIOs.length > 0 && (
          <button
            onClick={() => {
              setShowGenerateModal(true);
              setGeneratedInvoice(null);
              setGenerateError(null);
              setSelectedIOId("");
            }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--brand-blue)] hover:bg-[var(--brand-blue-light)] text-white text-sm font-medium transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Generate Invoice
          </button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="p-4 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)]">
          <div className="text-xs text-[var(--brand-text-muted)] font-medium uppercase tracking-wider mb-1">Outstanding</div>
          <div className="text-xl font-bold text-[var(--brand-text)]">${stats.total_outstanding.toLocaleString()}</div>
        </div>
        <div className="p-4 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)]">
          <div className="text-xs text-[var(--brand-text-muted)] font-medium uppercase tracking-wider mb-1">Paid This Month</div>
          <div className="text-xl font-bold text-[var(--brand-success)]">${stats.total_paid_this_month.toLocaleString()}</div>
        </div>
        <div className="p-4 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)]">
          <div className="text-xs text-[var(--brand-text-muted)] font-medium uppercase tracking-wider mb-1">Pending</div>
          <div className="text-xl font-bold text-[var(--brand-text)]">{pendingCount}</div>
        </div>
      </div>

      {hasInvoices ? (
        <div className="space-y-3">
          {invoices.map((invoice) => {
            const dueDate = new Date(invoice.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
            const showNames = invoice.line_items?.map((li) => li.show_name).filter((v, i, a) => a.indexOf(v) === i).join(", ");

            return (
              <Link
                key={invoice.id}
                href={`/invoices/${invoice.id}`}
                className="flex items-center justify-between p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)] hover:border-[var(--brand-blue)]/30 hover:shadow-sm transition-all group"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--brand-blue)]/10 to-[var(--brand-teal)]/10 flex items-center justify-center">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--brand-blue)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="16" x2="8" y1="13" y2="13" />
                      <line x1="16" x2="8" y1="17" y2="17" />
                      <polyline points="10 9 9 9 8 9" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-[var(--brand-text)]">{invoice.invoice_number}</h3>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-xs text-[var(--brand-text-muted)]">{invoice.advertiser_name}</span>
                      {showNames && <span className="text-xs text-[var(--brand-text-muted)]">{showNames}</span>}
                      <span className="text-xs text-[var(--brand-text-muted)]">Due {dueDate}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-5">
                  <div className="flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => { e.preventDefault(); handleDownloadExisting(invoice.id); }}
                      disabled={isDownloading === invoice.id}
                      className="flex items-center gap-1.5 text-xs text-[var(--brand-blue)] hover:underline font-medium disabled:opacity-50"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                      {isDownloading === invoice.id ? "..." : "PDF"}
                    </button>
                    <button
                      onClick={(e) => { e.preventDefault(); handleSendExisting(invoice); }}
                      className="flex items-center gap-1.5 text-xs text-[var(--brand-teal)] hover:underline font-medium"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="22" y1="2" x2="11" y2="13" />
                        <polygon points="22 2 15 22 11 13 2 9 22 2" />
                      </svg>
                      Send
                    </button>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold text-[var(--brand-text)]">${invoice.total_due.toLocaleString()}</div>
                    <div className="text-xs text-[var(--brand-text-muted)]">total due</div>
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${statusStyles[invoice.status]}`}>
                    {statusLabels[invoice.status]}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-24 bg-[var(--brand-surface-elevated)] rounded-2xl border border-[var(--brand-border)] border-dashed">
          <div className="w-16 h-16 rounded-2xl bg-[var(--brand-blue)]/[0.06] flex items-center justify-center mb-5">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--brand-blue)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" x2="8" y1="13" y2="13" />
              <line x1="16" x2="8" y1="17" y2="17" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-[var(--brand-text)] mb-2">No invoices yet</h3>
          <p className="text-sm text-[var(--brand-text-muted)] mb-6 max-w-sm text-center">
            Invoices will appear here once deals are completed and delivered.
          </p>
        </div>
      )}

      {/* Generate Invoice Modal */}
      {showGenerateModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowGenerateModal(false)}>
          <div
            className="bg-[var(--brand-surface-elevated)] rounded-2xl border border-[var(--brand-border)] shadow-xl p-6 max-w-lg w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            {!generatedInvoice ? (
              <>
                <h3 className="text-lg font-semibold text-[var(--brand-text)] mb-2">Generate Invoice</h3>
                <p className="text-sm text-[var(--brand-text-secondary)] mb-4">
                  Select an IO with delivered episodes to generate an invoice.
                </p>

                <div className="mb-4">
                  <label className="block text-sm font-medium text-[var(--brand-text)] mb-1.5">Insertion Order</label>
                  <select
                    value={selectedIOId}
                    onChange={(e) => setSelectedIOId(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-surface)] text-[var(--brand-text)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--brand-blue)]/30 focus:border-[var(--brand-blue)] transition-all"
                  >
                    <option value="">Select an IO</option>
                    {invoiceableIOs.map((io) => {
                      const deliveredCount = io.line_items.filter((li) => li.actual_post_date || li.verified).length;
                      return (
                        <option key={io.id} value={io.id}>
                          {io.io_number} — {io.advertiser_name} ({deliveredCount} delivered ep{deliveredCount !== 1 ? "s" : ""})
                        </option>
                      );
                    })}
                  </select>
                </div>

                {selectedIOId && (
                  <div className="p-3 rounded-lg bg-[var(--brand-surface)] border border-[var(--brand-border)] mb-4">
                    {(() => {
                      const io = invoiceableIOs.find((o) => o.id === selectedIOId);
                      if (!io) return null;
                      const delivered = io.line_items.filter((li) => li.actual_post_date || li.verified);
                      return (
                        <div className="space-y-1.5 text-sm">
                          <div className="flex justify-between">
                            <span className="text-[var(--brand-text-muted)]">Advertiser</span>
                            <span className="font-medium text-[var(--brand-text)]">{io.advertiser_name}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-[var(--brand-text-muted)]">Delivered episodes</span>
                            <span className="font-medium text-[var(--brand-text)]">{delivered.length}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-[var(--brand-text-muted)]">Total net</span>
                            <span className="font-medium text-[var(--brand-blue)]">
                              ${delivered.reduce((s, li) => s + li.net_due, 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </span>
                          </div>
                          {delivered.some((li) => li.actual_downloads != null && li.actual_downloads < li.guaranteed_downloads * 0.9) && (
                            <div className="flex items-center gap-1.5 mt-1 text-xs text-[var(--brand-warning)]">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                                <line x1="12" y1="9" x2="12" y2="13" />
                                <line x1="12" y1="17" x2="12.01" y2="17" />
                              </svg>
                              Some episodes underdelivered — make-good may apply
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}

                {generateError && (
                  <div className="p-3 rounded-lg bg-[var(--brand-error)]/[0.06] border border-[var(--brand-error)]/20 mb-4">
                    <p className="text-sm text-[var(--brand-error)]">{generateError}</p>
                  </div>
                )}

                <div className="flex items-center gap-3 justify-end">
                  <button
                    onClick={() => setShowGenerateModal(false)}
                    className="px-4 py-2 rounded-lg border border-[var(--brand-border)] text-sm font-medium text-[var(--brand-text-secondary)] hover:bg-[var(--brand-surface)] transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleGenerate}
                    disabled={!selectedIOId || isGenerating}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--brand-blue)] hover:bg-[var(--brand-blue-light)] text-white text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    {isGenerating ? (
                      <>
                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Generating...
                      </>
                    ) : (
                      "Generate"
                    )}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-[var(--brand-success)]/[0.08] flex items-center justify-center">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--brand-success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-[var(--brand-text)]">Invoice Generated</h3>
                    <p className="text-sm text-[var(--brand-text-muted)]">{generatedInvoice.invoice_number}</p>
                  </div>
                </div>

                <div className="p-4 rounded-lg bg-[var(--brand-surface)] border border-[var(--brand-border)] mb-4 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-[var(--brand-text-muted)]">Bill to</span>
                    <span className="font-medium text-[var(--brand-text)]">{generatedInvoice.bill_to_name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--brand-text-muted)]">Advertiser</span>
                    <span className="font-medium text-[var(--brand-text)]">{generatedInvoice.advertiser_name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--brand-text-muted)]">Period</span>
                    <span className="font-medium text-[var(--brand-text)]">{generatedInvoice.campaign_period}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--brand-text-muted)]">Line items</span>
                    <span className="font-medium text-[var(--brand-text)]">{generatedInvoice.line_items.length}</span>
                  </div>
                  {generatedInvoice.adjustments !== 0 && (
                    <div className="flex justify-between">
                      <span className="text-[var(--brand-text-muted)]">Adjustments</span>
                      <span className="font-medium text-[var(--brand-warning)]">
                        -${Math.abs(generatedInvoice.adjustments).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between pt-2 border-t border-[var(--brand-border)]">
                    <span className="font-semibold text-[var(--brand-text)]">Total due</span>
                    <span className="font-bold text-[var(--brand-blue)]">
                      ${generatedInvoice.total_due.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--brand-text-muted)]">Due date</span>
                    <span className="font-medium text-[var(--brand-text)]">
                      {new Date(generatedInvoice.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </span>
                  </div>
                </div>

                {generatedInvoice.line_items.some((li) => li.make_good) && (
                  <div className="p-3 rounded-lg bg-[var(--brand-warning)]/[0.06] border border-[var(--brand-warning)]/20 mb-4">
                    <p className="text-sm text-[var(--brand-warning)] font-medium">Make-good applied</p>
                    <p className="text-xs text-[var(--brand-text-muted)] mt-0.5">
                      One or more episodes underdelivered by &gt;10%. Those line items are zeroed out and make-good episodes will be scheduled.
                    </p>
                  </div>
                )}

                <div className="flex items-center gap-3 justify-end">
                  <button
                    onClick={() => setShowGenerateModal(false)}
                    className="px-4 py-2 rounded-lg border border-[var(--brand-border)] text-sm font-medium text-[var(--brand-text-secondary)] hover:bg-[var(--brand-surface)] transition-colors"
                  >
                    Close
                  </button>
                  <button
                    onClick={handleDownloadGenerated}
                    disabled={isDownloading === "generated"}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[var(--brand-border)] text-sm font-medium text-[var(--brand-text-secondary)] hover:bg-[var(--brand-surface)] transition-colors disabled:opacity-50"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    {isDownloading === "generated" ? "Generating..." : "Download PDF"}
                  </button>
                  <button
                    onClick={handleSendGenerated}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--brand-teal)] hover:bg-[var(--brand-teal-light)] text-white text-sm font-medium transition-colors"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="22" y1="2" x2="11" y2="13" />
                      <polygon points="22 2 15 22 11 13 2 9 22 2" />
                    </svg>
                    Send via Email
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Send Confirmation Modal */}
      {showSendConfirm && invoiceToSend && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowSendConfirm(false)}>
          <div className="bg-[var(--brand-surface-elevated)] rounded-2xl border border-[var(--brand-border)] shadow-xl p-6 max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-[var(--brand-text)] mb-2">Send Invoice via Email</h3>
            <p className="text-sm text-[var(--brand-text-secondary)] mb-4">
              This will email <strong>{invoiceToSend.invoice_number}</strong> as a PDF attachment to:
            </p>
            <div className="p-3 rounded-lg bg-[var(--brand-surface)] border border-[var(--brand-border)] mb-3">
              <div className="text-sm font-medium text-[var(--brand-text)]">{invoiceToSend.bill_to_name}</div>
              <div className="text-sm text-[var(--brand-text-muted)]">{invoiceToSend.bill_to_email}</div>
            </div>
            <div className="p-3 rounded-lg bg-[var(--brand-surface)] border border-[var(--brand-border)] mb-5 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-[var(--brand-text-muted)]">Advertiser</span>
                <span className="font-medium text-[var(--brand-text)]">{invoiceToSend.advertiser_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--brand-text-muted)]">Period</span>
                <span className="font-medium text-[var(--brand-text)]">{invoiceToSend.campaign_period}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--brand-text-muted)]">Total due</span>
                <span className="font-bold text-[var(--brand-blue)]">
                  ${invoiceToSend.total_due.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--brand-text-muted)]">Due date</span>
                <span className="font-medium text-[var(--brand-text)]">
                  {new Date(invoiceToSend.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </span>
              </div>
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
                  ? `Invoice sent to ${sendResult.toName ?? sendResult.to}`
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
