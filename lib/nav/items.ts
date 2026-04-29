// Role-aware navigation mapping.
// Pure module — no JSX, no React imports, no Supabase imports.
// Sidebar maps `iconKey` to local SVG; tests assert on the data shape.

import type { UserRole } from "@/lib/data/types";

export type IconKey =
  | "dashboard"
  | "campaigns"
  | "deals"
  | "invoices"
  | "shows"
  | "settings"
  | "plus"
  | "upload";

export interface NavItem {
  label: string;
  href: string;
  iconKey: IconKey;
}

export interface PrimaryCta {
  label: string;
  href: string;
  iconKey: IconKey;
}

const DASHBOARD: NavItem = { label: "Dashboard", href: "/dashboard", iconKey: "dashboard" };
const CAMPAIGNS: NavItem = { label: "Campaigns", href: "/campaigns", iconKey: "campaigns" };
const DEALS: NavItem = { label: "Deals", href: "/deals", iconKey: "deals" };
const INVOICES: NavItem = { label: "Invoices", href: "/invoices", iconKey: "invoices" };
const SHOWS: NavItem = { label: "Shows", href: "/shows", iconKey: "shows" };
const SETTINGS: NavItem = { label: "Settings", href: "/settings", iconKey: "settings" };

const BRAND_NAV: NavItem[] = [DASHBOARD, CAMPAIGNS, DEALS, INVOICES, SETTINGS];
const SHOW_NAV: NavItem[] = [DASHBOARD, SHOWS, DEALS, INVOICES, SETTINGS];

export function getNavItemsForRole(role: UserRole): NavItem[] {
  if (role === "brand" || role === "agency") return BRAND_NAV;
  return SHOW_NAV;
}

export function getPrimaryCtaForRole(role: UserRole): PrimaryCta {
  if (role === "brand" || role === "agency") {
    return { label: "New Campaign", href: "/campaigns/new", iconKey: "plus" };
  }
  if (role === "agent") {
    return { label: "Import Shows", href: "/shows", iconKey: "upload" };
  }
  return { label: "Add Show", href: "/shows", iconKey: "plus" };
}

export function isRouteAllowedForRole(route: string, role: UserRole): boolean {
  // Match leading segment so /campaigns/new and /shows/123 inherit the parent rule.
  const segment = "/" + (route.split("/")[1] ?? "");
  if (segment === "/campaigns") return role === "brand" || role === "agency";
  if (segment === "/shows") return role === "show" || role === "agent";
  return true;
}

// True when the role behaves as a brand for chrome / page-routing purposes.
export function isBrandSide(role: UserRole): boolean {
  return role === "brand" || role === "agency";
}
