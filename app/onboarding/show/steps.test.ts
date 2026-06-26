import { describe, it, expect } from "vitest";
import {
  SHOW_ONBOARDING_STEPS,
  TOTAL_STEPS,
  nextStepSlug,
  prevStepSlug,
  stepIndexOf,
} from "./steps";

describe("show onboarding steps", () => {
  it("is now 13 steps with brand-history inserted before contacts", () => {
    expect(TOTAL_STEPS).toBe(13);
    expect(SHOW_ONBOARDING_STEPS[10].slug).toBe("brand-history");
    expect(SHOW_ONBOARDING_STEPS[11].slug).toBe("contacts");
    expect(SHOW_ONBOARDING_STEPS[12].slug).toBe("summary");
  });

  it("links exclusions → brand-history → contacts → summary", () => {
    expect(nextStepSlug("exclusions")).toBe("brand-history");
    expect(nextStepSlug("brand-history")).toBe("contacts");
    expect(nextStepSlug("contacts")).toBe("summary");
    expect(prevStepSlug("summary")).toBe("contacts");
    expect(prevStepSlug("contacts")).toBe("brand-history");
    expect(prevStepSlug("brand-history")).toBe("exclusions");
  });

  it("indexOf finds the new step", () => {
    expect(stepIndexOf("brand-history")).toBe(10);
    expect(stepIndexOf("contacts")).toBe(11);
  });
});
