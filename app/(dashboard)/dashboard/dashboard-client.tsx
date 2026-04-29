"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import type { Deal, Show, UserRole } from "@/lib/data/types";
import { isBrandSide } from "@/lib/nav/items";

interface DashboardData {
  totalShows: number;
  podcastCount: number;
  youtubeCount: number;
  activeDeals: number;
  pendingInvoices: number;
  revenueThisMonth: number;
  revenueOutstanding: number;
  pipelineValue: number;
  overdueCount: number;
  campaignCount: number;
  recentDeals: (Deal & { show_name?: string })[];
  recentInvoices: { id: string; invoice_number: string; advertiser_name: string; total_due: number; status: string; due_date: string }[];
}

function fmtDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtCurrency(amount: number): string {
  return `$${amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

const statusBadge: Record<string, { bg: string; text: string; label: string }> = {
  proposed: { bg: "var(--brand-blue)", text: "#fff", label: "Proposed" },
  negotiating: { bg: "var(--brand-warning)", text: "#fff", label: "Negotiating" },
  approved: { bg: "var(--brand-success)", text: "#fff", label: "Approved" },
  io_sent: { bg: "var(--brand-success)", text: "#fff", label: "IO Sent" },
  signed: { bg: "var(--brand-success)", text: "#fff", label: "Signed" },
  live: { bg: "var(--brand-success)", text: "#fff", label: "Live" },
  completed: { bg: "var(--brand-text-muted)", text: "#fff", label: "Completed" },
  draft: { bg: "var(--brand-text-muted)", text: "#fff", label: "Draft" },
  sent: { bg: "var(--brand-warning)", text: "#fff", label: "Sent" },
  paid: { bg: "var(--brand-success)", text: "#fff", label: "Paid" },
  overdue: { bg: "var(--brand-error)", text: "#fff", label: "Overdue" },
  cancelled: { bg: "var(--brand-text-muted)", text: "#fff", label: "Cancelled" },
};

export default function DashboardClient({ role }: { role: UserRole }) {
  const isBrand = isBrandSide(role);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchDashboard() {
      try {
        const [showsRes, dealsRes, invoicesRes, campaignsRes] = await Promise.all([
          fetch("/api/shows").then((r) => r.ok ? r.json() : []).catch(() => []),
          fetch("/api/deals").then((r) => r.ok ? r.json() : { deals: [] }).catch(() => ({ deals: [] })),
          fetch("/api/invoices").then((r) => r.ok ? r.json() : { invoices: [], stats: {} }).catch(() => ({ invoices: [], stats: {} })),
          fetch("/api/campaigns").then((r) => r.ok ? r.json() : { campaigns: [] }).catch(() => ({ campaigns: [] })),
        ]);

        const shows: Show[] = Array.isArray(showsRes) ? showsRes : [];
        const deals: (Deal & { show_name?: string })[] = Array.isArray(dealsRes.deals) ? dealsRes.deals : [];
        const invoices = Array.isArray(invoicesRes.invoices) ? invoicesRes.invoices : [];
        const stats = invoicesRes.stats ?? {};

        const activeStatuses = ["proposed", "negotiating", "approved", "io_sent", "signed", "live"];
        const activeDeals = deals.filter((d) => activeStatuses.includes(d.status));
        const pipelineValue = activeDeals.reduce((s, d) => s + (d.total_net ?? 0), 0);

        const now = new Date();
        const pendingInvs = invoices.filter((inv: Record<string, unknown>) =>
          inv.status === "sent" || inv.status === "overdue"
        );
        const overdueInvs = invoices.filter((inv: Record<string, unknown>) =>
          inv.status === "sent" && new Date(inv.due_date as string) < now
        );

        const campaignList = Array.isArray(campaignsRes?.campaigns)
          ? campaignsRes.campaigns
          : Array.isArray(campaignsRes) ? campaignsRes : [];

        setData({
          totalShows: shows.length,
          podcastCount: shows.filter((s) => s.platform === "podcast").length,
          youtubeCount: shows.filter((s) => s.platform === "youtube").length,
          activeDeals: activeDeals.length,
          pendingInvoices: pendingInvs.length,
          revenueThisMonth: stats.total_paid_this_month ?? 0,
          revenueOutstanding: stats.total_outstanding ?? 0,
          pipelineValue,
          overdueCount: overdueInvs.length,
          campaignCount: campaignList.length,
          recentDeals: deals.slice(0, 5),
          recentInvoices: invoices.slice(0, 5),
        });
      } catch (err) {
        console.error("Dashboard fetch error:", err);
        setData({
          totalShows: 0, podcastCount: 0, youtubeCount: 0,
          activeDeals: 0, pendingInvoices: 0, revenueThisMonth: 0,
          revenueOutstanding: 0, pipelineValue: 0, overdueCount: 0,
          campaignCount: 0,
          recentDeals: [], recentInvoices: [],
        });
      } finally {
        setLoading(false);
      }
    }
    fetchDashboard();
  }, []);

  if (loading) {
    return (
      <div className="p-8">
        <div className="mb-8">
          <div className="h-7 w-40 bg-[var(--brand-border)] rounded animate-pulse mb-2" />
          <div className="h-4 w-64 bg-[var(--brand-border)] rounded animate-pulse" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="p-4 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)] animate-pulse">
              <div className="h-3 w-16 bg-[var(--brand-border)] rounded mb-2" />
              <div className="h-6 w-12 bg-[var(--brand-border)] rounded" />
            </div>
          ))}
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)] animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const d = data!;

  const headerSubtitle = isBrand
    ? "Overview of your campaigns, deals, and invoices."
    : "Overview of your shows, deals, and invoices.";

  // Empty-state CTA
  const showBrandEmptyCta = isBrand && d.campaignCount === 0;
  const showShowEmptyCta = !isBrand && d.totalShows === 0;

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[var(--brand-text)] tracking-tight">Dashboard</h1>
        <p className="text-sm text-[var(--brand-text-secondary)] mt-1">{headerSubtitle}</p>
      </div>

      {/* Empty-state CTA */}
      {showBrandEmptyCta && (
        <Link
          href="/campaigns/new"
          className="group block mb-8 rounded-2xl border border-[var(--brand-blue)]/20 bg-gradient-to-br from-[var(--brand-blue)]/[0.06] to-[var(--brand-teal)]/[0.04] p-6 hover:border-[var(--brand-blue)]/40 transition-colors"
        >
          <div className="flex items-start justify-between gap-6">
            <div>
              <div className="text-xs uppercase tracking-wider font-semibold text-[var(--brand-blue)] mb-1.5">Welcome to Taylslate</div>
              <h2 className="text-xl font-bold text-[var(--brand-text)]">Create your first campaign</h2>
              <p className="text-sm text-[var(--brand-text-secondary)] mt-1.5 max-w-xl">
                We&apos;ve saved your brand profile. When you start a campaign, we&apos;ll score 50–100 shows against your audience and surface the best matches. Most brands take 2–5 minutes from brief to IO.
              </p>
            </div>
            <span className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--brand-blue)] text-white text-sm font-semibold whitespace-nowrap group-hover:bg-[var(--brand-blue-light)] transition-colors">
              Start a campaign
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </span>
          </div>
        </Link>
      )}

      {showShowEmptyCta && (
        <Link
          href="/shows"
          className="group block mb-8 rounded-2xl border border-[var(--brand-blue)]/20 bg-gradient-to-br from-[var(--brand-blue)]/[0.06] to-[var(--brand-teal)]/[0.04] p-6 hover:border-[var(--brand-blue)]/40 transition-colors"
        >
          <div className="flex items-start justify-between gap-6">
            <div>
              <div className="text-xs uppercase tracking-wider font-semibold text-[var(--brand-blue)] mb-1.5">Welcome to Taylslate</div>
              <h2 className="text-xl font-bold text-[var(--brand-text)]">Add your first show</h2>
              <p className="text-sm text-[var(--brand-text-secondary)] mt-1.5 max-w-xl">
                {role === "agent"
                  ? "Import your roster or add shows individually. Once a show is on Taylslate, brands can discover it and send sponsorship outreach."
                  : "Add your podcast or YouTube channel so brands can discover it and send sponsorship outreach."}
              </p>
            </div>
            <span className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--brand-blue)] text-white text-sm font-semibold whitespace-nowrap group-hover:bg-[var(--brand-blue-light)] transition-colors">
              {role === "agent" ? "Import shows" : "Add a show"}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </span>
          </div>
        </Link>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        <StatCard label="Active Deals" value={d.activeDeals} href="/deals" />
        {isBrand ? (
          <StatCard label="Pipeline Value" value={fmtCurrency(d.pipelineValue)} href="/deals" />
        ) : (
          <StatCard
            label="Outstanding"
            value={fmtCurrency(d.revenueOutstanding)}
            href="/invoices"
          />
        )}
        {!isBrand && (
          <StatCard
            label="Shows"
            value={d.totalShows}
            sub={d.totalShows > 0 ? `${d.podcastCount} podcasts, ${d.youtubeCount} YT` : undefined}
            href="/shows"
          />
        )}
        <StatCard
          label="Pending Invoices"
          value={d.pendingInvoices}
          sub={d.revenueOutstanding > 0 ? fmtCurrency(d.revenueOutstanding) : undefined}
          href="/invoices"
        />
        <StatCard
          label="Overdue"
          value={d.overdueCount}
          highlight={d.overdueCount > 0}
          href="/invoices"
        />
        <StatCard
          label="Revenue (This Mo.)"
          value={fmtCurrency(d.revenueThisMonth)}
          href="/invoices"
        />
        {isBrand && (
          <StatCard
            label="Campaigns"
            value={d.campaignCount}
            href="/campaigns"
          />
        )}
      </div>

      {/* Quick Actions */}
      <div className="flex items-center gap-3 mb-8">
        {isBrand ? (
          <>
            <Link
              href="/campaigns/new"
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--brand-blue)] hover:bg-[var(--brand-blue-light)] text-white text-sm font-medium transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
              New Campaign
            </Link>
            <Link
              href="/deals"
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-[var(--brand-border)] text-[var(--brand-text-secondary)] hover:bg-[var(--brand-surface)] text-sm font-medium transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20.42 4.58a5.4 5.4 0 0 0-7.65 0l-.77.78-.77-.78a5.4 5.4 0 0 0-7.65 0C1.46 6.7 1.33 10.28 4 13l8 8 8-8c2.67-2.72 2.54-6.3.42-8.42z" />
              </svg>
              View Deals
            </Link>
          </>
        ) : (
          <Link
            href="/shows"
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--brand-blue)] hover:bg-[var(--brand-blue-light)] text-white text-sm font-medium transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              {role === "agent" ? (
                <>
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </>
              ) : (
                <path d="M12 5v14M5 12h14" />
              )}
            </svg>
            {role === "agent" ? "Import Shows" : "Add Show"}
          </Link>
        )}
      </div>

      {/* Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Deals */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-[var(--brand-text)] uppercase tracking-wider">
              Recent Deals
            </h2>
            <Link href="/deals" className="text-xs text-[var(--brand-blue)] hover:underline">View all</Link>
          </div>
          <div className="bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)] divide-y divide-[var(--brand-border)]">
            {d.recentDeals.length === 0 ? (
              <div className="p-8 text-center text-sm text-[var(--brand-text-muted)]">
                {isBrand
                  ? "No deals yet. Send outreach from a campaign to get started."
                  : "No deals yet. Brands will reach out as they discover your show."}
              </div>
            ) : (
              d.recentDeals.map((deal) => {
                const badge = statusBadge[deal.status];
                return (
                  <Link
                    key={deal.id}
                    href={`/deals/${deal.id}`}
                    className="flex items-center gap-4 px-5 py-4 hover:bg-[var(--brand-surface)] transition-colors"
                  >
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "color-mix(in srgb, var(--brand-blue) 10%, transparent)", color: "var(--brand-blue)" }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20.42 4.58a5.4 5.4 0 0 0-7.65 0l-.77.78-.77-.78a5.4 5.4 0 0 0-7.65 0C1.46 6.7 1.33 10.28 4 13l8 8 8-8c2.67-2.72 2.54-6.3.42-8.42z" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-[var(--brand-text)] truncate">
                        {deal.show_name ?? "Unknown Show"}
                      </div>
                      <div className="text-xs text-[var(--brand-text-muted)]">
                        {deal.num_episodes} ep &middot; {fmtCurrency(deal.total_net)}
                      </div>
                    </div>
                    {badge && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0" style={{ backgroundColor: badge.bg, color: badge.text }}>
                        {badge.label}
                      </span>
                    )}
                    <span className="text-xs text-[var(--brand-text-muted)] flex-shrink-0 ml-2">
                      {fmtDate(deal.updated_at ?? deal.created_at)}
                    </span>
                  </Link>
                );
              })
            )}
          </div>
        </div>

        {/* Recent Invoices */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-[var(--brand-text)] uppercase tracking-wider">
              Recent Invoices
            </h2>
            <Link href="/invoices" className="text-xs text-[var(--brand-blue)] hover:underline">View all</Link>
          </div>
          <div className="bg-[var(--brand-surface-elevated)] rounded-xl border border-[var(--brand-border)] divide-y divide-[var(--brand-border)]">
            {d.recentInvoices.length === 0 ? (
              <div className="p-8 text-center text-sm text-[var(--brand-text-muted)]">
                No invoices yet.
              </div>
            ) : (
              d.recentInvoices.map((inv) => {
                const badge = statusBadge[inv.status];
                return (
                  <Link
                    key={inv.id}
                    href="/invoices"
                    className="flex items-center gap-4 px-5 py-4 hover:bg-[var(--brand-surface)] transition-colors"
                  >
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "color-mix(in srgb, var(--brand-orange) 10%, transparent)", color: "var(--brand-orange)" }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-[var(--brand-text)] truncate">
                        {inv.invoice_number} &mdash; {inv.advertiser_name}
                      </div>
                      <div className="text-xs text-[var(--brand-text-muted)]">
                        Due {fmtDate(inv.due_date)} &middot; {fmtCurrency(inv.total_due)}
                      </div>
                    </div>
                    {badge && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0" style={{ backgroundColor: badge.bg, color: badge.text }}>
                        {badge.label}
                      </span>
                    )}
                  </Link>
                );
              })
            )}
          </div>
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
