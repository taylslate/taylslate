import { describe, expect, it } from "vitest";
import { CONTACT_STRIP_PATTERNS, stripContactDetails } from "./strip-contacts";

const locked = { unlocked: false } as const;

describe("stripContactDetails", () => {
  it("exports the pattern list", () => {
    expect(CONTACT_STRIP_PATTERNS.map((pattern) => pattern.name)).toEqual([
      "mailto",
      "contact_host",
      "linkedin",
      "url",
      "email",
    ]);
  });

  it("removes email shapes when locked", () => {
    const samples = [
      "write ada@example.test today",
      "write ada @ example.test today",
      "write ada at example dot test today",
      "write ada [at] example [dot] test today",
      "write ada(at)example.test today",
    ];
    for (const sample of samples) {
      const out = stripContactDetails(sample, locked);
      expect(out.removed).toBe(true);
      expect(out.text).toContain("[contact removed]");
      expect(out.text).not.toContain("example.test");
    }
  });

  it("removes mailto, tel, and sms links", () => {
    const out = stripContactDetails(
      "Use mailto:ada@example.test or tel:+1-555-555-0199 or sms:+15555550199",
      locked
    );
    expect(out.text).not.toContain("mailto:");
    expect(out.text).not.toContain("tel:");
    expect(out.text).not.toContain("sms:");
    expect(out.text).not.toContain("ada@");
  });

  it("removes phone shapes and keeps prices, dates, and short numbers", () => {
    const out = stripContactDetails(
      "Call (555) 555-0199 or 555.555.0199 or +44 20 7946 0958 or 555 555 0199. Budget is $25 CPM on 2026-12-01 for 3 episodes and code 123456.",
      locked
    );
    expect(out.text).not.toContain("555");
    expect(out.text).not.toContain("7946");
    expect(out.text).toContain("$25 CPM");
    expect(out.text).toContain("2026-12-01");
    expect(out.text).toContain("3 episodes");
    expect(out.text).toContain("123456");
  });

  it("removes contact links and keeps a brand site", () => {
    const out = stripContactDetails(
      "Book https://calendly.com/ada/15 and https://wa.me/15555550199 and https://linkedin.com/in/ada and https://example.com/hello?email=ada@example.test. Site https://aurora.example/products stays.",
      locked
    );
    expect(out.text).not.toContain("calendly.com");
    expect(out.text).not.toContain("wa.me");
    expect(out.text).not.toContain("linkedin.com/in");
    expect(out.text).not.toContain("ada@example.test");
    expect(out.text).toContain("https://aurora.example/products");
  });

  it("returns the input unchanged when unlocked", () => {
    const text = "ada@example.test (555) 555-0199 https://wa.me/1555";
    expect(stripContactDetails(text, { unlocked: true })).toEqual({ text, removed: false });
  });

  it.each([
    ["20,000 open parens", "(".repeat(20000)],
    ["20,000 digits", "1".repeat(20000)],
    ["20,000 a", "a".repeat(20000)],
    ["20,000 dashes", "-".repeat(20000)],
    ["5,000 open parens", "(".repeat(5000)],
  ])("finishes %s in under 200 ms", (_label, nasty) => {
    const start = performance.now();
    stripContactDetails(nasty, locked);
    expect(performance.now() - start).toBeLessThan(200);
  });
});
