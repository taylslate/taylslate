"use client";

import { useState } from "react";
import {
  getInvoicesByAgent,
  getAgentStats,
  getDealsByAgent,
  getIOByDeal,
  insertionOrders,
  type InvoiceStatus,
  type Invoice,
  type InsertionOrder,
} from "@/lib/data";

const agentId = "user-agent-001";
const agentInvoices = getInvoicesByAgent(agentId);
const stats = getAgentStats(agentId);

// Find IOs with delivered line items that could be invoiced
const agentDeals = getDealsByAgent(agentId);
const invoiceableIOs: InsertionOrder[] = agentDeals
  .filter((d) => ["live", "completed"].includes(d.status))
  .map((d) => getIOByDeal(d.id))
  .filter((io): io is InsertionOrder => !!io)
  .filter((io) => io.line_items.some((li) => li.actual_post_date || li.verified));

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
  const hasInvoices = agentInvoices.length > 0;
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [selectedIOId, setSelectedIOId] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedInvoice, setGeneratedInvoice] = useState<Invoice | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState<string | null>(null);

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
          <div className="text-xl font-bold text-[var(--brand-text)]">${stats.revenue_outstanding.toLocaleString()}</div>
        </div>
        <div className="p-4 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)]">
          <div className="text-xs text-[var(--brand-text-muted)] font-medium uppercase tracking-wider mb-1">Paid This Month</div>
          <div className="text-xl font-bold text-[var(--brand-success)]">${stats.revenue_this_month.toLocaleString()}</div>
        </div>
        <div className="p-4 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)]">
          <div className="text-xs text-[var(--brand-text-muted)] font-medium uppercase tracking-wider mb-1">Pending</div>
          <div className="text-xl font-bold text-[var(--brand-text)]">{stats.pending_invoices}</div>
        </div>
      </div>

      {hasInvoices ? (
        <div className="space-y-3">
          {agentInvoices.map((invoice) => {
            const dueDate = new Date(invoice.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

            return (
              <div
                key={invoice.id}
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
                      <span className="text-xs text-[var(--brand-text-muted)]">{invoice.campaign_period}</span>
                      <span className="text-xs text-[var(--brand-text-muted)]">Due {dueDate}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-5">
                  <button
                    onClick={() => handleDownloadExisting(invoice.id)}
                    disabled={isDownloading === invoice.id}
                    className="flex items-center gap-1.5 text-xs text-[var(--brand-blue)] hover:underline font-medium opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    {isDownloading === invoice.id ? "..." : "PDF"}
                  </button>
                  <div className="text-right">
                    <div className="text-sm font-semibold text-[var(--brand-text)]">${invoice.total_due.toLocaleString()}</div>
                    <div className="text-xs text-[var(--brand-text-muted)]">total due</div>
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${statusStyles[invoice.status]}`}>
                    {statusLabels[invoice.status]}
                  </span>
                </div>
              </div>
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
                      const io = insertionOrders.find((o) => o.id === selectedIOId);
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
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--brand-blue)] hover:bg-[var(--brand-blue-light)] text-white text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    {isDownloading === "generated" ? "Generating..." : "Download PDF"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
