"use client";

import { useState, useEffect, useCallback, use } from "react";
import Link from "next/link";
import type { Invoice, InvoiceStatus } from "@/lib/data/types";

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

function fmt(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d: string): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [invoice, setInvoice] = useState<Invoice | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isMarkingPaid, setIsMarkingPaid] = useState(false);
  const [showSendModal, setShowSendModal] = useState(false);

  const fetchInvoice = useCallback(async () => {
    try {
      const res = await fetch(`/api/invoices/${id}`);
      if (!res.ok) {
        setError(res.status === 404 ? "Invoice not found" : "Failed to load invoice");
        return;
      }
      const data = await res.json();
      if (data?.invoice) {
        setInvoice(data.invoice);
      }
    } catch {
      setError("Failed to load invoice");
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchInvoice();
  }, [fetchInvoice]);

  const handleDownloadPdf = async () => {
    try {
      const res = await fetch(`/api/invoices/${id}/pdf`);
      if (!res.ok) {
        alert("Failed to download PDF");
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${invoice?.invoice_number?.replace(/\s+/g, "_") ?? "invoice"}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      alert("Failed to download PDF");
    }
  };

  const handleSendInvoice = async () => {
    setIsSending(true);
    try {
      const res = await fetch("/api/invoices/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoice_id: id }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Failed to send invoice");
        return;
      }
      setShowSendModal(false);
      // Refresh to get updated status
      await fetchInvoice();
    } catch {
      alert("Failed to send invoice");
    } finally {
      setIsSending(false);
    }
  };

  const handleMarkPaid = async () => {
    setIsMarkingPaid(true);
    try {
      const res = await fetch(`/api/invoices/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "paid" }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Failed to mark as paid");
        return;
      }
      await fetchInvoice();
    } catch {
      alert("Failed to mark as paid");
    } finally {
      setIsMarkingPaid(false);
    }
  };

  if (isLoading) {
    return (
      <div className="p-8 max-w-4xl">
        <div className="flex items-center justify-center py-24">
          <div className="w-8 h-8 border-3 border-[var(--brand-blue)]/20 border-t-[var(--brand-blue)] rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="p-8 max-w-4xl">
        <Link href="/invoices" className="flex items-center gap-1.5 text-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors mb-4">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
          All Invoices
        </Link>
        <h1 className="text-2xl font-bold text-[var(--brand-text)]">{error || "Invoice not found"}</h1>
      </div>
    );
  }

  const canMarkPaid = invoice.status === "sent" || invoice.status === "overdue";

  return (
    <div className="p-8 max-w-4xl">
      {/* Back + Header */}
      <div className="mb-8">
        <Link
          href="/invoices"
          className="flex items-center gap-1.5 text-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors mb-4"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
          All Invoices
        </Link>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-[var(--brand-text)] tracking-tight">
              {invoice.invoice_number}
            </h1>
            <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${statusStyles[invoice.status]}`}>
              {statusLabels[invoice.status]}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDownloadPdf}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-[var(--brand-border)] text-sm font-medium text-[var(--brand-text-secondary)] hover:border-[var(--brand-blue)] hover:text-[var(--brand-blue)] transition-all"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Download PDF
            </button>
            <button
              onClick={() => setShowSendModal(true)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--brand-blue)] hover:bg-[var(--brand-blue-light)] text-white text-sm font-medium transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
              Send Invoice
            </button>
            {canMarkPaid && (
              <button
                onClick={handleMarkPaid}
                disabled={isMarkingPaid}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--brand-success)] hover:opacity-90 text-white text-sm font-medium transition-colors disabled:opacity-50"
              >
                {isMarkingPaid ? (
                  <>
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Saving...
                  </>
                ) : (
                  <>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Mark as Paid
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* From / To */}
      <section className="p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)] mb-6">
        <div className="grid grid-cols-2 gap-8">
          <div>
            <h2 className="text-xs font-semibold text-[var(--brand-text-muted)] uppercase tracking-wider mb-3">From</h2>
            <p className="text-sm font-medium text-[var(--brand-text)]">{invoice.from_name}</p>
            <p className="text-sm text-[var(--brand-text-secondary)]">{invoice.from_email}</p>
          </div>
          <div>
            <h2 className="text-xs font-semibold text-[var(--brand-text-muted)] uppercase tracking-wider mb-3">Bill To</h2>
            <p className="text-sm font-medium text-[var(--brand-text)]">{invoice.bill_to_name}</p>
            <p className="text-sm text-[var(--brand-text-secondary)]">{invoice.bill_to_email}</p>
          </div>
        </div>
      </section>

      {/* Reference Info */}
      <section className="p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)] mb-6">
        <h2 className="text-xs font-semibold text-[var(--brand-text-muted)] uppercase tracking-wider mb-4">Reference</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-[var(--brand-text-muted)] mb-1">IO Number</label>
            <p className="text-sm font-medium text-[var(--brand-text)]">{invoice.io_number}</p>
          </div>
          <div>
            <label className="block text-xs text-[var(--brand-text-muted)] mb-1">Advertiser</label>
            <p className="text-sm font-medium text-[var(--brand-text)]">{invoice.advertiser_name}</p>
          </div>
          <div>
            <label className="block text-xs text-[var(--brand-text-muted)] mb-1">Campaign Period</label>
            <p className="text-sm font-medium text-[var(--brand-text)]">{invoice.campaign_period}</p>
          </div>
          <div>
            <label className="block text-xs text-[var(--brand-text-muted)] mb-1">Due Date</label>
            <p className="text-sm font-medium text-[var(--brand-text)]">{fmtDate(invoice.due_date)}</p>
          </div>
        </div>
      </section>

      {/* Line Items Table */}
      <section className="bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)] mb-6 overflow-hidden">
        <div className="px-5 pt-5 pb-3">
          <h2 className="text-xs font-semibold text-[var(--brand-text-muted)] uppercase tracking-wider">Line Items</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-t border-b border-[var(--brand-border)] bg-[var(--brand-surface)]">
                <th className="text-left px-5 py-2.5 text-xs font-semibold text-[var(--brand-text-muted)] uppercase tracking-wider">#</th>
                <th className="text-left px-5 py-2.5 text-xs font-semibold text-[var(--brand-text-muted)] uppercase tracking-wider">Show</th>
                <th className="text-left px-5 py-2.5 text-xs font-semibold text-[var(--brand-text-muted)] uppercase tracking-wider">Post Date</th>
                <th className="text-left px-5 py-2.5 text-xs font-semibold text-[var(--brand-text-muted)] uppercase tracking-wider">Description</th>
                <th className="text-right px-5 py-2.5 text-xs font-semibold text-[var(--brand-text-muted)] uppercase tracking-wider">Guaranteed DLs</th>
                <th className="text-right px-5 py-2.5 text-xs font-semibold text-[var(--brand-text-muted)] uppercase tracking-wider">Actual DLs</th>
                <th className="text-right px-5 py-2.5 text-xs font-semibold text-[var(--brand-text-muted)] uppercase tracking-wider">Amount</th>
                <th className="text-center px-5 py-2.5 text-xs font-semibold text-[var(--brand-text-muted)] uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody>
              {invoice.line_items.map((li, i) => (
                <tr key={li.id} className="border-b border-[var(--brand-border)] last:border-b-0">
                  <td className="px-5 py-3 text-[var(--brand-text-muted)]">{i + 1}</td>
                  <td className="px-5 py-3 font-medium text-[var(--brand-text)]">{li.show_name}</td>
                  <td className="px-5 py-3 text-[var(--brand-text-secondary)]">{fmtDate(li.post_date)}</td>
                  <td className="px-5 py-3 text-[var(--brand-text-secondary)]">{li.description}</td>
                  <td className="px-5 py-3 text-right text-[var(--brand-text-secondary)]">{li.guaranteed_downloads.toLocaleString()}</td>
                  <td className="px-5 py-3 text-right text-[var(--brand-text-secondary)]">
                    {li.actual_downloads != null ? li.actual_downloads.toLocaleString() : "—"}
                  </td>
                  <td className="px-5 py-3 text-right font-medium text-[var(--brand-text)]">
                    {li.make_good ? "$0.00" : `$${fmt(li.rate)}`}
                  </td>
                  <td className="px-5 py-3 text-center">
                    {li.make_good ? (
                      <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--brand-warning)]/10 text-[var(--brand-warning)]">
                        Make-Good
                      </span>
                    ) : (
                      <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--brand-success)]/10 text-[var(--brand-success)]">
                        Delivered
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Totals */}
      <section className="p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)] mb-6">
        <div className="flex flex-col items-end gap-2 text-sm">
          <div className="flex justify-between w-64">
            <span className="text-[var(--brand-text-muted)]">Subtotal</span>
            <span className="font-medium text-[var(--brand-text)]">${fmt(invoice.subtotal)}</span>
          </div>
          {invoice.adjustments !== 0 && (
            <div className="flex justify-between w-64">
              <span className="text-[var(--brand-warning)]">Adjustments</span>
              <span className="font-medium text-[var(--brand-warning)]">-${fmt(Math.abs(invoice.adjustments))}</span>
            </div>
          )}
          <div className="flex justify-between w-64 pt-2 border-t border-[var(--brand-border)]">
            <span className="font-semibold text-[var(--brand-text)]">Total Due</span>
            <span className="font-bold text-[var(--brand-blue)]">${fmt(invoice.total_due)}</span>
          </div>
        </div>
      </section>

      {/* Notes */}
      {invoice.notes && (
        <section className="p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)] mb-6">
          <h2 className="text-xs font-semibold text-[var(--brand-text-muted)] uppercase tracking-wider mb-3">Notes</h2>
          <p className="text-sm text-[var(--brand-text-secondary)] whitespace-pre-wrap">{invoice.notes}</p>
        </section>
      )}

      {/* Send Confirmation Modal */}
      {showSendModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => !isSending && setShowSendModal(false)} />
          <div className="relative bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)] p-6 w-full max-w-md shadow-xl">
            <h3 className="text-lg font-semibold text-[var(--brand-text)] mb-2">Send Invoice</h3>
            <p className="text-sm text-[var(--brand-text-secondary)] mb-1">
              This will send <span className="font-medium text-[var(--brand-text)]">{invoice.invoice_number}</span> to:
            </p>
            <p className="text-sm font-medium text-[var(--brand-text)] mb-4">
              {invoice.bill_to_name} &lt;{invoice.bill_to_email}&gt;
            </p>
            <p className="text-sm text-[var(--brand-text-secondary)] mb-6">
              A PDF copy of the invoice will be attached to the email.
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setShowSendModal(false)}
                disabled={isSending}
                className="px-4 py-2.5 rounded-lg border border-[var(--brand-border)] text-sm font-medium text-[var(--brand-text-secondary)] hover:bg-[var(--brand-surface)] transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSendInvoice}
                disabled={isSending}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--brand-blue)] hover:bg-[var(--brand-blue-light)] text-white text-sm font-medium transition-colors disabled:opacity-50"
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
    </div>
  );
}
