import { describe, it, expect } from "vitest";
import {
  SHOW_ONBOARDING_STEPS,
  TOTAL_STEPS,
  nextStepSlug,
  prevStepSlug,
  stepIndexOf,
} from "./steps";

describe("show onboarding steps", () => {
  it("is 15 steps with surfaces before geography", () => {
    expect(TOTAL_STEPS).toBe(15);
    expect(SHOW_ONBOARDING_STEPS[4].slug).toBe("audience");
    expect(SHOW_ONBOARDING_STEPS[5].slug).toBe("pricing");
    expect(SHOW_ONBOARDING_STEPS[10].slug).toBe("brand-history");
    expect(SHOW_ONBOARDING_STEPS[11].slug).toBe("surfaces");
    expect(SHOW_ONBOARDING_STEPS[12].slug).toBe("geography");
    expect(SHOW_ONBOARDING_STEPS[13].slug).toBe("contacts");
    expect(SHOW_ONBOARDING_STEPS[14].slug).toBe("summary");
  });

  it("links brand-history → surfaces → geography → contacts → summary", () => {
    expect(nextStepSlug("exclusions")).toBe("brand-history");
    expect(nextStepSlug("brand-history")).toBe("surfaces");
    expect(nextStepSlug("surfaces")).toBe("geography");
    expect(nextStepSlug("geography")).toBe("contacts");
    expect(nextStepSlug("contacts")).toBe("summary");
    expect(prevStepSlug("summary")).toBe("contacts");
    expect(prevStepSlug("contacts")).toBe("geography");
    expect(prevStepSlug("geography")).toBe("surfaces");
    expect(prevStepSlug("surfaces")).toBe("brand-history");
    expect(prevStepSlug("brand-history")).toBe("exclusions");
  });

  it("links audience → pricing", () => {
    expect(nextStepSlug("audience")).toBe("pricing");
    expect(prevStepSlug("pricing")).toBe("audience");
  });

  it("indexOf finds the new steps", () => {
    expect(stepIndexOf("brand-history")).toBe(10);
    expect(stepIndexOf("surfaces")).toBe(11);
    expect(stepIndexOf("geography")).toBe(12);
    expect(stepIndexOf("contacts")).toBe(13);
  });
});
