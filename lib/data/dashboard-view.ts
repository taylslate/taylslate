import type { Campaign, Deal } from "./types";

export interface DashboardInvoice {
  id: string;
  invoice_number: string;
  advertiser_name: string;
  total_due: number;
  status: string;
  due_date: string;
}

export interface DashboardData {
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
  recentInvoices: DashboardInvoice[];
}

export interface ShowCounts {
  total: number;
  podcast: number;
  youtube: number;
}

const SEED_SHOW_PREFIX = "[SEED]";

const ACTIVE_DEAL_STATUSES = [
  "proposed",
  "negotiating",
  "approved",
  "signed",
  "planning",
  "io_sent",
  "brand_signed",
  "show_signed",
  "live",
  "delivering",
];

export function toDashboardData(input: {
  isBrand: boolean;
  deals: (Deal & { show_name?: string })[];
  invoices: DashboardInvoice[];
  stats: { total_paid_this_month?: number; total_outstanding?: number };
  campaigns: Campaign[];
  showCounts: ShowCounts;
}): DashboardData {
  const deals = input.deals;
  const invoices = input.invoices;
  const activeDeals = deals.filter((deal) => ACTIVE_DEAL_STATUSES.includes(deal.status));
  const pipelineValue = activeDeals.reduce((sum, deal) => sum + (deal.total_net ?? 0), 0);
  const now = new Date();
  const pendingInvs = invoices.filter(
    (inv) => inv.status === "sent" || inv.status === "overdue"
  );
  const overdueInvs = invoices.filter(
    (inv) => inv.status === "sent" && new Date(inv.due_date) < now
  );
  const recentDeals = (
    input.isBrand
      ? deals.filter((deal) => !(deal.show_name ?? "").startsWith(SEED_SHOW_PREFIX))
      : deals
  ).slice(0, 5);

  return {
    totalShows: input.showCounts.total,
    podcastCount: input.showCounts.podcast,
    youtubeCount: input.showCounts.youtube,
    activeDeals: activeDeals.length,
    pendingInvoices: pendingInvs.length,
    revenueThisMonth: input.stats.total_paid_this_month ?? 0,
    revenueOutstanding: input.stats.total_outstanding ?? 0,
    pipelineValue,
    overdueCount: overdueInvs.length,
    campaignCount: input.campaigns.length,
    recentDeals,
    recentInvoices: invoices.slice(0, 5),
  };
}
