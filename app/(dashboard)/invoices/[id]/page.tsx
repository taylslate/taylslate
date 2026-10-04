"use client";

import { useState, useEffect, useCallback, use } from "react";
import Link from "next/link";
import type { Invoice, InvoiceStatus } from "@/lib/data/types";

const inkText = "text-[var(--ts-ink-on-paper)]";
const mutedText = "text-[var(--ts-ink-muted-on-paper)]";
const accentText = "text-[var(--ts-accent)]";
const hairlineRule = "border-[var(--ts-hairline-on-paper)]";
const panelClass = "border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)]";
const radiusClass = "rounded-[var(--ts-radius)]";
const inkBtnClass =
  "inline-flex items-center gap-2 rounded-[var(--ts-radius)] bg-[var(--ts-ink-on-paper)] px-4 py-2.5 text-sm font-medium text-[var(--ts-paper)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";
const ghostBtnClass =
  "inline-flex items-center gap-2 rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-4 py-2.5 text-sm font-medium text-[var(--ts-ink-on-paper)] hover:bg-[var(--ts-ink-on-paper)]/[0.04] disabled:cursor-not-allowed disabled:opacity-50";
const pillBase =
  "inline-block rounded-[var(--ts-radius)] border border-[var(--ts-hairline-on-paper)] bg-[var(--ts-paper)] px-2.5 py-1 text-xs font-medium";

const statusStyles: Record<InvoiceStatus, string> = {
  draft: `${pillBase} ${mutedText}`,
  sent: `${pillBase} ${inkText}`,
  paid: `${pillBase} ${inkText}`,
  overdue: `${pillBase} ${accentText}`,
  disputed: `${pillBase} ${accentText}`,
  cancelled: `${pillBase} ${mutedText}`,
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
      <div className={`bg-[var(--ts-paper)] p-8 max-w-4xl ${inkText}`}>
        <div className="flex items-center justify-center py-24">
          <div className={`h-8 w-8 animate-spin rounded-full border-2 border-[var(--ts-hairline-on-paper)] border-t-[var(--ts-ink-on-paper)]`} />
        </div>
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className={`bg-[var(--ts-paper)] p-8 max-w-4xl ${inkText}`}>
        <Link href="/invoices" className={`mb-4 flex items-center gap-1.5 text-sm ${mutedText} hover:text-[var(--ts-ink-on-paper)]`}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
          All Invoices
        </Link>
        <div className={`p-4 ${panelClass} ${radiusClass}`}>
          <h1 className={`text-sm font-medium ${accentText}`}>{error || "Invoice not found"}</h1>
        </div>
      </div>
    );
  }

  const canMarkPaid = invoice.status === "sent" || invoice.status === "overdue";

  return (
    <div className={`bg-[var(--ts-paper)] p-8 max-w-4xl ${inkText}`}>
      {/* Back + Header */}
      <div className="mb-8">
        <Link
          href="/invoices"
          className={`mb-4 flex items-center gap-1.5 text-sm ${mutedText} hover:text-[var(--ts-ink-on-paper)]`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
          All Invoices
        </Link>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className={`text-2xl font-bold tracking-tight ${inkText}`}>
              {invoice.invoice_number}
            </h1>
            <span className={statusStyles[invoice.status]}>
              {statusLabels[invoice.status]}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDownloadPdf}
              className={ghostBtnClass}
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
              className={inkBtnClass}
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
                className={inkBtnClass}
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
      <section className={`mb-6 p-5 ${panelClass} ${radiusClass}`}>
        <div className="grid grid-cols-2 gap-8">
          <div>
            <h2 className={`mb-3 text-xs font-semibold uppercase tracking-wider ${mutedText}`}>From</h2>
            <p className={`text-sm font-medium ${inkText}`}>{invoice.from_name}</p>
            <p className={`text-sm ${mutedText}`}>{invoice.from_email}</p>
          </div>
          <div>
            <h2 className={`mb-3 text-xs font-semibold uppercase tracking-wider ${mutedText}`}>Bill To</h2>
            <p className={`text-sm font-medium ${inkText}`}>{invoice.bill_to_name}</p>
            <p className={`text-sm ${mutedText}`}>{invoice.bill_to_email}</p>
          </div>
        </div>
      </section>

      {/* Reference Info */}
      <section className={`mb-6 p-5 ${panelClass} ${radiusClass}`}>
        <h2 className={`mb-4 text-xs font-semibold uppercase tracking-wider ${mutedText}`}>Reference</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={`mb-1 block text-xs ${mutedText}`}>IO Number</label>
            <p className={`text-sm font-medium ${inkText}`}>{invoice.io_number}</p>
          </div>
          <div>
            <label className={`mb-1 block text-xs ${mutedText}`}>Advertiser</label>
            <p className={`text-sm font-medium ${inkText}`}>{invoice.advertiser_name}</p>
          </div>
          <div>
            <label className={`mb-1 block text-xs ${mutedText}`}>Campaign Period</label>
            <p className={`text-sm font-medium ${inkText}`}>{invoice.campaign_period}</p>
          </div>
          <div>
            <label className={`mb-1 block text-xs ${mutedText}`}>Due Date</label>
            <p className={`text-sm font-medium ${inkText}`}>{fmtDate(invoice.due_date)}</p>
          </div>
        </div>
      </section>

      {/* Line Items Table */}
      <section className={`mb-6 overflow-hidden ${panelClass} ${radiusClass}`}>
        <div className="px-5 pt-5 pb-3">
          <h2 className={`text-xs font-semibold uppercase tracking-wider ${mutedText}`}>Line Items</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className={`border-t border-b bg-[var(--ts-paper)] ${hairlineRule}`}>
                <th className={`px-5 py-2.5 text-left text-xs font-semibold uppercase tracking-wider ${mutedText}`}>#</th>
                <th className={`px-5 py-2.5 text-left text-xs font-semibold uppercase tracking-wider ${mutedText}`}>Show</th>
                <th className={`px-5 py-2.5 text-left text-xs font-semibold uppercase tracking-wider ${mutedText}`}>Post Date</th>
                <th className={`px-5 py-2.5 text-left text-xs font-semibold uppercase tracking-wider ${mutedText}`}>Description</th>
                <th className={`px-5 py-2.5 text-right text-xs font-semibold uppercase tracking-wider ${mutedText}`}>Guaranteed DLs</th>
                <th className={`px-5 py-2.5 text-right text-xs font-semibold uppercase tracking-wider ${mutedText}`}>Actual DLs</th>
                <th className={`px-5 py-2.5 text-right text-xs font-semibold uppercase tracking-wider ${mutedText}`}>Amount</th>
                <th className={`px-5 py-2.5 text-center text-xs font-semibold uppercase tracking-wider ${mutedText}`}>Status</th>
              </tr>
            </thead>
            <tbody>
              {invoice.line_items.map((li, i) => (
                <tr key={li.id} className={`border-b last:border-b-0 ${hairlineRule}`}>
                  <td className={`px-5 py-3 ${mutedText}`}>{i + 1}</td>
                  <td className={`px-5 py-3 font-medium ${inkText}`}>{li.show_name}</td>
                  <td className={`px-5 py-3 ${mutedText}`}>{fmtDate(li.post_date)}</td>
                  <td className={`px-5 py-3 ${mutedText}`}>{li.description}</td>
                  <td className={`px-5 py-3 text-right ${mutedText}`}>{li.guaranteed_downloads.toLocaleString()}</td>
                  <td className={`px-5 py-3 text-right ${mutedText}`}>
                    {li.actual_downloads != null ? li.actual_downloads.toLocaleString() : "—"}
                  </td>
                  <td className={`px-5 py-3 text-right font-medium ${inkText}`}>
                    {li.make_good ? "$0.00" : `$${fmt(li.rate)}`}
                  </td>
                  <td className="px-5 py-3 text-center">
                    {li.make_good ? (
                      <span className={`${pillBase} ${accentText}`}>
                        Make-Good
                      </span>
                    ) : (
                      <span className={`${pillBase} ${inkText}`}>
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
      <section className={`mb-6 p-5 ${panelClass} ${radiusClass}`}>
        <div className="flex flex-col items-end gap-2 text-sm">
          <div className="flex justify-between w-64">
            <span className={mutedText}>Subtotal</span>
            <span className={`font-medium ${inkText}`}>${fmt(invoice.subtotal)}</span>
          </div>
          {invoice.adjustments !== 0 && (
            <div className="flex justify-between w-64">
              <span className={accentText}>Adjustments</span>
              <span className={`font-medium ${accentText}`}>-${fmt(Math.abs(invoice.adjustments))}</span>
            </div>
          )}
          <div className={`flex w-64 justify-between border-t pt-2 ${hairlineRule}`}>
            <span className={`font-semibold ${inkText}`}>Total Due</span>
            <span className={`font-bold ${inkText}`}>${fmt(invoice.total_due)}</span>
          </div>
        </div>
      </section>

      {/* Notes */}
      {invoice.notes && (
        <section className={`mb-6 p-5 ${panelClass} ${radiusClass}`}>
          <h2 className={`mb-3 text-xs font-semibold uppercase tracking-wider ${mutedText}`}>Notes</h2>
          <p className={`whitespace-pre-wrap text-sm ${mutedText}`}>{invoice.notes}</p>
        </section>
      )}

      {/* Send Confirmation Modal */}
      {showSendModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-[var(--ts-ink-on-paper)]/40" onClick={() => !isSending && setShowSendModal(false)} />
          <div className={`relative w-full max-w-md p-6 ${panelClass} ${radiusClass}`}>
            <h3 className={`mb-2 text-lg font-semibold ${inkText}`}>Send Invoice</h3>
            <p className={`mb-1 text-sm ${mutedText}`}>
              This will send <span className={`font-medium ${inkText}`}>{invoice.invoice_number}</span> to:
            </p>
            <p className={`mb-4 text-sm font-medium ${inkText}`}>
              {invoice.bill_to_name} &lt;{invoice.bill_to_email}&gt;
            </p>
            <p className={`mb-6 text-sm ${mutedText}`}>
              A PDF copy of the invoice will be attached to the email.
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setShowSendModal(false)}
                disabled={isSending}
                className={ghostBtnClass}
              >
                Cancel
              </button>
              <button
                onClick={handleSendInvoice}
                disabled={isSending}
                className={inkBtnClass}
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
