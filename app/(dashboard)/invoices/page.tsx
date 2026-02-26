import { getInvoicesByAgent, getAgentStats, type InvoiceStatus } from "@/lib/data";

const agentInvoices = getInvoicesByAgent("user-agent-001");
const stats = getAgentStats("user-agent-001");

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
    </div>
  );
}
