import { describe, expect, it } from "vitest";
import {
  getNavItemsForRole,
  getPrimaryCtaForRole,
  isRouteAllowedForRole,
  isBrandSide,
} from "./items";
import type { UserRole } from "@/lib/data/types";

const ALL_ROLES: UserRole[] = ["brand", "agency", "agent", "show"];

describe("getNavItemsForRole", () => {
  it("brand sees Dashboard, Campaigns, Deals, CRM, Invoices, Settings (no Shows)", () => {
    const items = getNavItemsForRole("brand");
    const labels = items.map((i) => i.label);
    expect(labels).toEqual(["Dashboard", "Campaigns", "Deals", "CRM", "Invoices", "Settings"]);
    expect(labels).not.toContain("Shows");
    expect(items.find((i) => i.label === "CRM")).toEqual({
      label: "CRM",
      href: "/crm",
      iconKey: "shows",
    });
  });

  it("agency mirrors brand", () => {
    expect(getNavItemsForRole("agency")).toEqual(getNavItemsForRole("brand"));
  });

  it("show sees Dashboard, Shows, Deals, Invoices, Settings (no Campaigns)", () => {
    const labels = getNavItemsForRole("show").map((i) => i.label);
    expect(labels).toEqual(["Dashboard", "Shows", "Deals", "Invoices", "Settings"]);
    expect(labels).not.toContain("Campaigns");
  });

  it("agent mirrors show", () => {
    expect(getNavItemsForRole("agent")).toEqual(getNavItemsForRole("show"));
  });

  it("show and agent navs are unchanged", () => {
    const showNav = getNavItemsForRole("show");
    const agentNav = getNavItemsForRole("agent");
    expect(showNav.map((item) => item.label)).toEqual([
      "Dashboard",
      "Shows",
      "Deals",
      "Invoices",
      "Settings",
    ]);
    expect(showNav.map((item) => item.href)).toEqual([
      "/dashboard",
      "/shows",
      "/deals",
      "/invoices",
      "/settings",
    ]);
    expect(agentNav).toEqual(showNav);
    expect(showNav.map((item) => item.href)).not.toContain("/crm");
    expect(agentNav.map((item) => item.label)).not.toContain("CRM");
  });
});

describe("getPrimaryCtaForRole", () => {
  it("brand → New Campaign at /campaigns/new", () => {
    expect(getPrimaryCtaForRole("brand")).toEqual({
      label: "New Campaign",
      href: "/campaigns/new",
      iconKey: "plus",
    });
  });

  it("agency → New Campaign at /campaigns/new", () => {
    expect(getPrimaryCtaForRole("agency").href).toBe("/campaigns/new");
  });

  it("agent → Import Shows at /shows", () => {
    expect(getPrimaryCtaForRole("agent")).toEqual({
      label: "Import Shows",
      href: "/shows",
      iconKey: "upload",
    });
  });

  it("show → Add Show at /shows", () => {
    expect(getPrimaryCtaForRole("show")).toEqual({
      label: "Add Show",
      href: "/shows",
      iconKey: "plus",
    });
  });
});

describe("isRouteAllowedForRole", () => {
  it("blocks /campaigns for show and agent", () => {
    expect(isRouteAllowedForRole("/campaigns", "show")).toBe(false);
    expect(isRouteAllowedForRole("/campaigns", "agent")).toBe(false);
  });

  it("allows /campaigns for brand and agency", () => {
    expect(isRouteAllowedForRole("/campaigns", "brand")).toBe(true);
    expect(isRouteAllowedForRole("/campaigns", "agency")).toBe(true);
  });

  it("blocks /shows for brand and agency", () => {
    expect(isRouteAllowedForRole("/shows", "brand")).toBe(false);
    expect(isRouteAllowedForRole("/shows", "agency")).toBe(false);
  });

  it("allows /shows for show and agent", () => {
    expect(isRouteAllowedForRole("/shows", "show")).toBe(true);
    expect(isRouteAllowedForRole("/shows", "agent")).toBe(true);
  });

  it("inherits parent rule for nested routes", () => {
    expect(isRouteAllowedForRole("/campaigns/new", "show")).toBe(false);
    expect(isRouteAllowedForRole("/shows/abc-123/edit", "brand")).toBe(false);
  });

  it("/deals, /invoices, /dashboard, /settings allowed for every role", () => {
    for (const role of ALL_ROLES) {
      expect(isRouteAllowedForRole("/deals", role)).toBe(true);
      expect(isRouteAllowedForRole("/invoices", role)).toBe(true);
      expect(isRouteAllowedForRole("/dashboard", role)).toBe(true);
      expect(isRouteAllowedForRole("/settings", role)).toBe(true);
    }
  });
});

describe("isBrandSide", () => {
  it("returns true for brand and agency", () => {
    expect(isBrandSide("brand")).toBe(true);
    expect(isBrandSide("agency")).toBe(true);
  });
  it("returns false for show and agent", () => {
    expect(isBrandSide("show")).toBe(false);
    expect(isBrandSide("agent")).toBe(false);
  });
});
