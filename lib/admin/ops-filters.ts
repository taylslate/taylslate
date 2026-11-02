// Query string for the read-only operations dashboard.
// Defaults match the founder's first question: who signed up, and what is active.

export const ACCOUNT_ROLES = ["brand", "show", "agency", "agent"] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

export const CAMPAIGN_STATUSES = ["draft", "planned", "active", "completed", "archived"] as const;
export type CampaignFilterStatus = (typeof CAMPAIGN_STATUSES)[number];

export const DEAL_STATUSES = [
  "planning",
  "io_sent",
  "brand_signed",
  "show_signed",
  "live",
  "delivering",
  "completed",
  "cancelled",
  "proposed",
  "negotiating",
  "approved",
  "signed",
] as const;
export type DealFilterStatus = (typeof DEAL_STATUSES)[number];

export const ACTIVE_DEAL_STATUSES: readonly DealFilterStatus[] = DEAL_STATUSES.filter(
  (status) => status !== "completed" && status !== "cancelled",
);

export interface OpsFilters {
  role: "all" | AccountRole;
  userQ: string;
  campaignStatus: "all" | CampaignFilterStatus;
  campaignQ: string;
  dealStatus: "all" | "active" | DealFilterStatus;
  dealQ: string;
}

export const DEFAULT_OPS_FILTERS: OpsFilters = {
  role: "all",
  userQ: "",
  campaignStatus: "active",
  campaignQ: "",
  dealStatus: "active",
  dealQ: "",
};

type FilterKey = "role" | "userQ" | "campaignStatus" | "campaignQ" | "dealStatus" | "dealQ";

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

/** Letters, numbers, and the characters that show up in names and emails. */
export function sanitizeSearch(raw: string | undefined): string {
  if (!raw) return "";
  return raw
    .trim()
    .slice(0, 80)
    .replace(/[^a-zA-Z0-9 @.+_-]/g, "");
}

function oneOf<T extends string>(value: string, allowed: readonly T[], fallback: T | "all"): T | "all" {
  if (value === "all") return "all";
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function parseOpsFilters(
  raw: Record<string, string | string[] | undefined>,
): OpsFilters {
  const role = oneOf(first(raw.role), ACCOUNT_ROLES, "all");
  const campaignStatus = oneOf(first(raw.campaignStatus), CAMPAIGN_STATUSES, "active");
  const dealRaw = first(raw.dealStatus);
  let dealStatus: OpsFilters["dealStatus"] = "active";
  if (dealRaw === "all") dealStatus = "all";
  else if ((DEAL_STATUSES as readonly string[]).includes(dealRaw)) {
    dealStatus = dealRaw as OpsFilters["dealStatus"];
  }
  return {
    role,
    userQ: sanitizeSearch(first(raw.userQ)),
    campaignStatus,
    campaignQ: sanitizeSearch(first(raw.campaignQ)),
    dealStatus,
    dealQ: sanitizeSearch(first(raw.dealQ)),
  };
}

export function filtersToEntries(filters: OpsFilters): [FilterKey, string][] {
  const entries: [FilterKey, string][] = [];
  if (filters.role !== DEFAULT_OPS_FILTERS.role) entries.push(["role", filters.role]);
  if (filters.userQ) entries.push(["userQ", filters.userQ]);
  if (filters.campaignStatus !== DEFAULT_OPS_FILTERS.campaignStatus) {
    entries.push(["campaignStatus", filters.campaignStatus]);
  }
  if (filters.campaignQ) entries.push(["campaignQ", filters.campaignQ]);
  if (filters.dealStatus !== DEFAULT_OPS_FILTERS.dealStatus) {
    entries.push(["dealStatus", filters.dealStatus]);
  }
  if (filters.dealQ) entries.push(["dealQ", filters.dealQ]);
  return entries;
}

export function filtersToHref(filters: OpsFilters, omit: readonly FilterKey[] = []): string {
  const params = new URLSearchParams();
  for (const [key, value] of filtersToEntries(filters)) {
    if (omit.includes(key)) continue;
    params.set(key, value);
  }
  const query = params.toString();
  return query ? `/admin?${query}` : "/admin";
}

export function orIlike(columns: readonly string[], q: string): string {
  const star = `*${q}*`;
  return columns.map((column) => `${column}.ilike.${star}`).join(",");
}
