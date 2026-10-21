import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LAUNCH, planFee } from "./launch-copy";

const EM_DASH = "\u2014";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

function collectStrings(value: unknown, out: string[]) {
  if (typeof value === "string") {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectStrings(entry, out);
    return;
  }
  if (value && typeof value === "object") {
    for (const entry of Object.values(value)) collectStrings(entry, out);
  }
}

describe("launch copy", () => {
  it("uses the January 2027 headline", () => {
    expect(LAUNCH.headline).toBe(
      "Make 2027 the year you win with podcast ads.",
    );
    expect(LAUNCH.primaryHref).toBe("/signup");
  });

  it("states launch pricing without touching billing math", () => {
    const [free, starter, operator] = LAUNCH.pricing.plans;
    expect(free).toMatchObject({
      name: "Free",
      price: "$0",
      features: ["Discovery, scoring, and media plans", "1 active campaign"],
    });
    expect(planFee(free.cardFee, free.bankFee)).toBe("10% card / 7% bank");
    expect(starter).toMatchObject({
      name: "Starter",
      price: "$79",
      cadence: "/mo",
      features: ["5 active campaigns", "CRM"],
    });
    expect(planFee(starter.cardFee, starter.bankFee)).toBe("8% card / 5% bank");
    expect(operator).toMatchObject({
      name: "Operator",
      price: "$299",
      cadence: "/mo",
      features: ["Unlimited campaigns", "Full CRM"],
    });
    expect(planFee(operator.cardFee, operator.bankFee)).toBe(
      "6% card / 3% bank",
    );
    expect(LAUNCH.pricing.sub).toContain(
      "The brand pays the platform fee on top of each deal.",
    );
    expect(LAUNCH.pricing.sub).toContain("Shows are free.");
  });

  it("marks proof slots as placeholders and not customer claims", () => {
    expect(LAUNCH.proof.sub).toMatch(/Placeholders/);
    expect(LAUNCH.proof.sub).toMatch(/Nothing below is a customer claim/);
    expect(LAUNCH.proof.items.map((item) => item.label)).toEqual([
      "Placeholder",
      "Placeholder",
      "Placeholder",
    ]);
  });

  it("labels the product shot as sample data", () => {
    expect(LAUNCH.product.caption).toMatch(/sample data, not a live campaign/);
    expect(LAUNCH.product.campaignKicker).toBe("Sample campaign");
    expect(LAUNCH.product.audienceValue).toBe("Unmeasured");
  });

  it("has no em dashes in launch copy or marketing components", () => {
    const strings: string[] = [];
    collectStrings(LAUNCH, strings);
    for (const value of strings) {
      expect(value).not.toContain(EM_DASH);
    }
    for (const file of [
      "lib/marketing/launch-copy.ts",
      "lib/marketing/site.ts",
      "components/marketing/launch-home.tsx",
      "components/marketing/product-shot.tsx",
      "app/opengraph-image.tsx",
      "app/page.tsx",
    ]) {
      expect(read(file)).not.toContain(EM_DASH);
    }
    expect(read("components/marketing/launch-home.tsx")).not.toContain(
      "@/lib/billing",
    );
    expect(read("lib/marketing/launch-copy.ts")).not.toContain("plans.ts");
  });
});
