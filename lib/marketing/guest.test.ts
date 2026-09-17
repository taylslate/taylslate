import { describe, expect, it } from "vitest";
import { GUEST_COPY, guestHref, parseGuest } from "./guest";

describe("parseGuest", () => {
  it("defaults to brands", () => {
    expect(parseGuest(undefined)).toBe("brands");
    expect(parseGuest(null)).toBe("brands");
    expect(parseGuest("")).toBe("brands");
    expect(parseGuest("brands")).toBe("brands");
    expect(parseGuest("anything")).toBe("brands");
  });

  it("reads shows from the URL param", () => {
    expect(parseGuest("shows")).toBe("shows");
    expect(parseGuest(["shows"])).toBe("shows");
  });
});

describe("guestHref", () => {
  it("keeps brands on the bare path so refresh stays default", () => {
    expect(guestHref("brands")).toBe("/");
  });

  it("persists shows as ?for=shows", () => {
    expect(guestHref("shows")).toBe("/?for=shows");
  });
});

describe("GUEST_COPY", () => {
  it("uses brand copy as the default lane", () => {
    expect(GUEST_COPY.brands.eyebrow).toBe("For brands");
    expect(GUEST_COPY.brands.h1).toBe(
      "Run creator sponsorships without an agency.",
    );
    expect(GUEST_COPY.brands.ctaHref).toBe("/signup");
    expect(GUEST_COPY.brands.steps.map((s) => s.title)).toEqual([
      "Interpret the brief",
      "Build the test portfolio",
      "Close and pay",
    ]);
  });

  it("routes shows to login, not password signup", () => {
    expect(GUEST_COPY.shows.eyebrow).toBe("For shows");
    expect(GUEST_COPY.shows.h1).toBe(
      "Get the brief, the IO, and paid when the episode runs.",
    );
    expect(GUEST_COPY.shows.ctaHref).toBe("/login");
    expect(GUEST_COPY.shows.steps.map((s) => s.title)).toEqual([
      "Review the offer",
      "Sign the IO",
      "Paid on delivery",
    ]);
  });
});
