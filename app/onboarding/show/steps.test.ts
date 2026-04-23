import { describe, it, expect } from "vitest";
import {
  SHOW_ONBOARDING_STEPS,
  TOTAL_STEPS,
  nextStepSlug,
  prevStepSlug,
  stepIndexOf,
} from "./steps";

describe("show onboarding steps", () => {
  it("is now 12 steps with contacts inserted before summary", () => {
    expect(TOTAL_STEPS).toBe(12);
    expect(SHOW_ONBOARDING_STEPS[10].slug).toBe("contacts");
    expect(SHOW_ONBOARDING_STEPS[11].slug).toBe("summary");
  });

  it("links exclusions → contacts → summary", () => {
    expect(nextStepSlug("exclusions")).toBe("contacts");
    expect(nextStepSlug("contacts")).toBe("summary");
    expect(prevStepSlug("summary")).toBe("contacts");
    expect(prevStepSlug("contacts")).toBe("exclusions");
  });

  it("indexOf finds the new step", () => {
    expect(stepIndexOf("contacts")).toBe(10);
  });
});
