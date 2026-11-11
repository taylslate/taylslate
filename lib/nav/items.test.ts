import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  getNavItemsForRole,
  getPrimaryCtaForRole,
  isRouteAllowedForRole,
  isBrandSide,
} from "./items";
import type { UserRole } from "@/lib/data/types";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const TODAY_BRAND = [
  "Dashboard",
  "Campaigns",
  "Deals",
  "CRM",
  "Search",
  "Invoices",
  "Settings",
];

const ALL_ROLES: UserRole[] = ["brand", "agency", "agent", "show"];

describe("getNavItemsForRole", () => {
  it("brand sees Dashboard, Campaigns, Deals, CRM, Search, Invoices, Settings (no Shows)", () => {
    const items = getNavItemsForRole("brand");
    const labels = items.map((i) => i.label);
    expect(labels).toEqual(["Dashboard", "Campaigns", "Deals", "CRM", "Search", "Invoices", "Settings"]);
    expect(labels).not.toContain("Shows");
    expect(items.find((i) => i.label === "Search")).toEqual({
      label: "Search",
      href: "/shows/search",
      iconKey: "shows",
    });
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

  it("adds Tay for a brand only when assistant is requested", () => {
    const withTay = getNavItemsForRole("brand", { assistant: true }).map((item) => item.label);
    expect(withTay).toEqual([
      "Dashboard",
      "Campaigns",
      "Deals",
      "CRM",
      "Search",
      "Tay",
      "Invoices",
      "Settings",
    ]);
    expect(getNavItemsForRole("brand", { assistant: true }).find((item) => item.label === "Tay")).toEqual({
      label: "Tay",
      href: "/assistant",
      iconKey: "shows",
    });
    expect(getNavItemsForRole("brand").map((item) => item.label)).toEqual(TODAY_BRAND);
    expect(getNavItemsForRole("brand", { assistant: false }).map((item) => item.label)).toEqual(
      TODAY_BRAND
    );
    expect(getNavItemsForRole("agency")).toEqual(getNavItemsForRole("brand"));
    expect(getNavItemsForRole("agency", { assistant: true }).map((item) => item.label)).toEqual(
      TODAY_BRAND
    );
    expect(getNavItemsForRole("agency", { assistant: true }).map((item) => item.label)).not.toContain(
      "Tay"
    );
    expect(getNavItemsForRole("show", { assistant: true })).toEqual(getNavItemsForRole("show"));
    expect(getNavItemsForRole("agent", { assistant: true })).toEqual(getNavItemsForRole("agent"));
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

function walkTsx(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      files.push(...walkTsx(path));
      continue;
    }
    if (entry.endsWith(".tsx") && !entry.endsWith(".test.tsx")) files.push(path);
  }
  return files;
}

function renderedHits(source: string): string[] {
  const hits: string[] = [];
  const literals = source.match(/(['"`])(?:\\.|(?!\1)[\s\S])*?\1/g) ?? [];
  for (const literal of literals) {
    if (/command agent/i.test(literal)) hits.push(literal);
  }
  const text = source.match(/>([^<{]+)</g) ?? [];
  for (const node of text) {
    if (/command agent/i.test(node)) hits.push(node);
  }
  return hits;
}

describe("rendered copy", () => {
  it("has no command agent text in app or component tsx", () => {
    const files = [...walkTsx(join(ROOT, "app")), ...walkTsx(join(ROOT, "components"))];
    const hits = files.flatMap((file) =>
      renderedHits(readFileSync(file, "utf8")).map((hit) => `${file}: ${hit}`)
    );
    expect(hits).toEqual([]);
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
