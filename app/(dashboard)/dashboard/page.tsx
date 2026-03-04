"use client";

import Link from "next/link";
import {
  getDealsByAgent,
  getAgentStats,
  getShowById,
  getIOByDeal,
  invoices,
  insertionOrders,
  deals,
  profiles,
} from "@/lib/data";

const agentId = "user-agent-001";
const stats = getAgentStats(agentId);
const agentDeals = getDealsByAgent(agentId);

// Compute pipeline value (all non-cancelled, non-completed deals)
const pipelineDeals = agentDeals.filter((d) =>
  ["proposed", "negotiating", "approved", "io_sent", "signed", "live"].includes(d.status)
);
const pipelineValue = pipelineDeals.reduce((s, d) => s + d.total_net, 0);

// Overdue invoices
const now = new Date();
const overdueInvoices = invoices.filter((inv) => {
  if (inv.status !== "sent") return false;
  return new Date(inv.due_date) < now;
});

// Pending invoices total
const pendingInvoices = invoices.filter((inv) => inv.status === "sent");
const pendingTotal = pendingInvoices.reduce((s, inv) => s + inv.total_due, 0);

// Build activity feed from deals, IOs, invoices
type Activity = {
  id: string;
  type: "deal" | "io" | "invoice";
  title: string;
  subtitle: string;
  date: string;
  status?: string;
  href: string;
};

function buildActivityFeed(): Activity[] {
  const items: Activity[] = [];

  // Deals
  for (const deal of agentDeals) {
    const show = getShowById(deal.show_id);
    const brand = profiles.find((p) => p.id === deal.brand_id);
    items.push({
      id: `deal-${deal.id}`,
      type: "deal",
      title: `${show?.name ?? "Unknown Show"} × ${brand?.company_name ?? "Unknown"}`,
      subtitle: `${deal.num_episodes} ep · $${deal.total_net.toLocaleString()}`,
      date: deal.updated_at ?? deal.created_at,
      status: deal.status,
      href: `/deals/${deal.id}`,
    });
  }

  // IOs
  for (const io of insertionOrders) {
    const deal = deals.find((d) => d.id === io.deal_id);
    if (deal?.agent_id !== agentId) continue;
    items.push({
      id: `io-${io.id}`,
      type: "io",
      title: `${io.io_number} — ${io.advertiser_name}`,
      subtitle: `${io.line_items.length} line items · $${io.total_net.toLocaleString()}`,
      date: io.sent_at ?? io.created_at,
      status: io.status,
      href: `/deals/${io.deal_id}/io`,
    });
  }

  // Invoices
  for (const inv of invoices) {
    const io = insertionOrders.find((o) => o.id === inv.io_id);
    const deal = io ? deals.find((d) => d.id === io.deal_id) : undefined;
    if (deal?.agent_id !== agentId) continue;
    items.push({
      id: `inv-${inv.id}`,
      type: "invoice",
      title: `${inv.invoice_number} — ${inv.advertiser_name}`,
      subtitle: `${inv.campaign_period} · $${inv.total_due.toLocaleString()}`,
      date: inv.sent_at ?? inv.created_at,
      status: inv.status,
      href: "/invoices",
    });
  }

  // Sort by date descending
  items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return items;
}

const activityFeed = buildActivityFeed();

const typeIcons: Record<string, React.ReactNode> = {
  deal: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.42 4.58a5.4 5.4 0 0 0-7.65 0l-.77.78-.77-.78a5.4 5.4 0 0 0-7.65 0C1.46 6.7 1.33 10.28 4 13l8 8 8-8c2.67-2.72 2.54-6.3.42-8.42z" />
    </svg>
  ),
  io: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  ),
  invoice: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <line x1="2" y1="10" x2="22" y2="10" />
    </svg>
  ),
};

const typeColors: Record<string, string> = {
  deal: "var(--brand-blue)",
  io: "var(--brand-teal)",
  invoice: "var(--brand-orange)",
};

const statusBadge: Record<string, { bg: string; text: string; label: string }> = {
  proposed: { bg: "var(--brand-blue)", text: "#fff", label: "Proposed" },
  negotiating: { bg: "var(--brand-warning)", text: "#fff", label: "Negotiating" },
  approved: { bg: "var(--brand-success)", text: "#fff", label: "Signed" },
  io_sent: { bg: "var(--brand-success)", text: "#fff", label: "IO Sent" },
  signed: { bg: "var(--brand-success)", text: "#fff", label: "Signed" },
  live: { bg: "var(--brand-success)", text: "#fff", label: "Live" },
  completed: { bg: "var(--brand-text-muted)", text: "#fff", label: "Completed" },
  draft: { bg: "var(--brand-text-muted)", text: "#fff", label: "Draft" },
  sent: { bg: "var(--brand-warning)", text: "#fff", label: "Sent" },
  paid: { bg: "var(--brand-success)", text: "#fff", label: "Paid" },
};

function fmtDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function DashboardPage() {
  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[var(--brand-text)] tracking-tight">Dashboard</h1>
        <p className="text-sm text-[var(--brand-text-secondary)] mt-1">
          Overview of your deals, invoices, and shows.
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        <StatCard label="Active Deals" value={stats.active_deals} href="/deals" />
        <StatCard
          label="Pipeline Value"
          value={`$${pipelineValue.toLocaleString()}`}
          href="/deals"
        />
        <StatCard label="Shows" value={stats.total_shows} href="/shows" />
        <StatCard
          label="Pending Invoices"
          value={pendingInvoices.length}
          sub={`$${pendingTotal.toLocaleString()}`}
          href="/invoices"
        />
        <StatCard
          label="Overdue"
          value={overdueInvoices.length}
          highlight={overdueInvoices.length > 0}
          href="/invoices"
        />
        <StatCard
          label="Revenue (This Mo.)"
          value={`$${stats.revenue_this_month.toLocaleString()}`}
          href="/invoices"
        />
      </div>

      {/* Quick Actions */}
      <div className="flex items-center gap-3 mb-8">
        <Link
          href="/deals/new"
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--brand-blue)] hover:bg-[var(--brand-blue-light)] text-white text-sm font-medium transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          New Deal
        </Link>
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
          href="/invoices"
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-[var(--brand-border)] text-[var(--brand-text-secondary)] hover:bg-[var(--brand-surface)] text-sm font-medium transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          Invoices
        </Link>
      </div>

      {/* Activity Feed */}
      <div>
        <h2 className="text-sm font-semibold text-[var(--brand-text)] uppercase tracking-wider mb-4">
          Recent Activity
        </h2>
        <div className="bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)] divide-y divide-[var(--brand-border)]">
          {activityFeed.length === 0 ? (
            <div className="p-8 text-center text-sm text-[var(--brand-text-muted)]">
              No activity yet.
            </div>
          ) : (
            activityFeed.map((item) => {
              const badge = item.status ? statusBadge[item.status] : undefined;
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  className="flex items-center gap-4 px-5 py-4 hover:bg-[var(--brand-surface)] transition-colors"
                >
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{
                      backgroundColor: `color-mix(in srgb, ${typeColors[item.type]} 10%, transparent)`,
                      color: typeColors[item.type],
                    }}
                  >
                    {typeIcons[item.type]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-[var(--brand-text)] truncate">
                      {item.title}
                    </div>
                    <div className="text-xs text-[var(--brand-text-muted)]">{item.subtitle}</div>
                  </div>
                  {badge && (
                    <span
                      className="text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: badge.bg, color: badge.text }}
                    >
                      {badge.label}
                    </span>
                  )}
                  <span className="text-xs text-[var(--brand-text-muted)] flex-shrink-0 ml-2">
                    {fmtDate(item.date)}
                  </span>
                </Link>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  highlight,
  href,
}: {
  label: string;
  value: string | number;
  sub?: string;
  highlight?: boolean;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="p-4 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)] hover:border-[var(--brand-blue)]/30 hover:shadow-sm transition-all"
    >
      <div className="text-xs text-[var(--brand-text-muted)] mb-1">{label}</div>
      <div
        className="text-xl font-bold"
        style={{ color: highlight ? "var(--brand-error)" : "var(--brand-text)" }}
      >
        {value}
      </div>
      {sub && <div className="text-xs text-[var(--brand-text-muted)] mt-0.5">{sub}</div>}
    </Link>
  );
}
