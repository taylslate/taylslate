import { describe, it, expect } from "vitest";
import { ONBOARDING_ROLES } from "./roles";

describe("ONBOARDING_ROLES", () => {
  it("excludes show/creator (shows onboard via magic-link, not password self-signup)", () => {
    expect(ONBOARDING_ROLES.some((r) => r.id === "show")).toBe(false);
  });

  it("offers exactly brand, agency, agent", () => {
    expect(ONBOARDING_ROLES.map((r) => r.id)).toEqual(["brand", "agency", "agent"]);
  });
});
