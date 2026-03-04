import Link from "next/link";
import { getDealsByAgent, getShowById, getIOByDeal, profiles } from "@/lib/data";
import type { DealStatus } from "@/lib/data";

const agentDeals = getDealsByAgent("user-agent-001");

const statusStyles: Record<DealStatus, string> = {
  proposed: "bg-[var(--brand-blue)]/10 text-[var(--brand-blue)]",
  negotiating: "bg-[var(--brand-warning)]/10 text-[var(--brand-warning)]",
  approved: "bg-[var(--brand-teal)]/10 text-[var(--brand-teal)]",
  io_sent: "bg-[var(--brand-teal)]/10 text-[var(--brand-teal)]",
  signed: "bg-[var(--brand-success)]/10 text-[var(--brand-success)]",
  live: "bg-[var(--brand-success)]/10 text-[var(--brand-success)]",
  completed: "bg-[var(--brand-text-muted)]/10 text-[var(--brand-text-muted)]",
  cancelled: "bg-[var(--brand-error)]/10 text-[var(--brand-error)]",
};

const statusLabels: Record<DealStatus, string> = {
  proposed: "Proposed",
  negotiating: "Negotiating",
  approved: "Approved",
  io_sent: "IO Sent",
  signed: "Signed",
  live: "Live",
  completed: "Completed",
  cancelled: "Cancelled",
};

function getBrandName(brandId: string): string {
  return profiles.find((p) => p.id === brandId)?.company_name ?? "Unknown Brand";
}

export default function DealsPage() {
  const hasDeals = agentDeals.length > 0;

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-[var(--brand-text)] tracking-tight">Deals</h1>
          <p className="text-sm text-[var(--brand-text-secondary)] mt-1">
            Track and manage sponsorship deals across your shows.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/deals/import"
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-[var(--brand-border)] text-[var(--brand-text-secondary)] hover:bg-[var(--brand-surface)] text-sm font-medium transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            Import IO
          </Link>
          <Link
            href="/deals/new"
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--brand-blue)] hover:bg-[var(--brand-blue-light)] text-white text-sm font-medium transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            New Deal
          </Link>
        </div>
      </div>

      {hasDeals ? (
        <div className="space-y-3">
          {agentDeals.map((deal) => {
            const show = getShowById(deal.show_id);
            const brandName = getBrandName(deal.brand_id);
            const existingIO = getIOByDeal(deal.id);
            const showIOLink = ["approved", "io_sent", "signed", "live", "completed"].includes(deal.status);
            const ioLabel = existingIO ? "View IO" : "Generate IO";
            const flightStart = new Date(deal.flight_start).toLocaleDateString("en-US", { month: "short", day: "numeric" });
            const flightEnd = new Date(deal.flight_end).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

            return (
              <div
                key={deal.id}
                className="flex items-center justify-between p-5 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)] hover:border-[var(--brand-blue)]/30 hover:shadow-sm transition-all group"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--brand-blue)]/10 to-[var(--brand-teal)]/10 flex items-center justify-center">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--brand-blue)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20.42 4.58a5.4 5.4 0 0 0-7.65 0l-.77.78-.77-.78a5.4 5.4 0 0 0-7.65 0C1.46 6.7 1.33 10.28 4 13l8 8 8-8c2.67-2.72 2.54-6.3.42-8.42z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-[var(--brand-text)]">
                      {show?.name ?? "Unknown Show"}
                    </h3>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-xs text-[var(--brand-text-muted)]">{brandName}</span>
                      <span className="text-xs text-[var(--brand-text-muted)]">{deal.num_episodes} ep{deal.num_episodes !== 1 ? "s" : ""} &middot; {deal.placement}</span>
                      <span className="text-xs text-[var(--brand-text-muted)]">{flightStart} &ndash; {flightEnd}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-5">
                  {["live", "completed"].includes(deal.status) && existingIO && existingIO.line_items.some((li) => li.actual_post_date || li.verified) && (
                    <Link
                      href="/invoices"
                      className="text-xs text-[var(--brand-teal)] hover:underline font-medium"
                    >
                      Generate Invoice
                    </Link>
                  )}
                  {showIOLink && (
                    <Link
                      href={`/deals/${deal.id}/io`}
                      className="text-xs text-[var(--brand-blue)] hover:underline font-medium"
                    >
                      {ioLabel}
                    </Link>
                  )}
                  <div className="text-right">
                    <div className="text-sm font-semibold text-[var(--brand-text)]">${deal.total_net.toLocaleString()}</div>
                    <div className="text-xs text-[var(--brand-text-muted)]">net revenue</div>
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${statusStyles[deal.status]}`}>
                    {statusLabels[deal.status]}
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
              <path d="M20.42 4.58a5.4 5.4 0 0 0-7.65 0l-.77.78-.77-.78a5.4 5.4 0 0 0-7.65 0C1.46 6.7 1.33 10.28 4 13l8 8 8-8c2.67-2.72 2.54-6.3.42-8.42z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-[var(--brand-text)] mb-2">No deals yet</h3>
          <p className="text-sm text-[var(--brand-text-muted)] mb-6 max-w-sm text-center">
            Deals will appear here as brands reach out to sponsor your shows.
          </p>
        </div>
      )}
    </div>
  );
}
