import { describe, expect, it } from "vitest";
import { applyPostAirLift } from "./post-air-lift";

describe("applyPostAirLift", () => {
  it("leaves the score alone when no count was reported", () => {
    const lift = applyPostAirLift(70, null);
    expect(lift).toEqual({ delta: 0, adjusted: 70, reasoningLine: null });
  });

  it("does not penalize an explicit zero", () => {
    const lift = applyPostAirLift(70, 0);
    expect(lift.delta).toBe(0);
    expect(lift.adjusted).toBe(70);
    expect(lift.reasoningLine).toBeNull();
  });

  it("lifts a converting show by a bounded amount and says so", () => {
    const lift = applyPostAirLift(70, 4);
    expect(lift.delta).toBe(8);
    expect(lift.adjusted).toBe(78);
    expect(lift.reasoningLine).toBe("Post-air: 4 reported conversions. Score lifted +8.");
  });

  it("caps the lift at 100", () => {
    const lift = applyPostAirLift(97, 2);
    expect(lift.delta).toBe(3);
    expect(lift.adjusted).toBe(100);
    expect(lift.reasoningLine).toBe("Post-air: 2 reported conversions. Score lifted +3.");
  });

  it("keeps a visible line when the score is already at the cap", () => {
    const lift = applyPostAirLift(100, 1);
    expect(lift.delta).toBe(0);
    expect(lift.adjusted).toBe(100);
    expect(lift.reasoningLine).toBe(
      "Post-air: 1 reported conversion. Score held at 100; the lift is capped."
    );
  });

  it("does not invent a score when the composite is missing", () => {
    const lift = applyPostAirLift(null, 5);
    expect(lift).toEqual({ delta: 0, adjusted: null, reasoningLine: null });
  });

  it("never returns a lower score", () => {
    for (const count of [null, 0, 1, 12]) {
      const lift = applyPostAirLift(40, count);
      expect(lift.adjusted).toBeGreaterThanOrEqual(40);
    }
  });
});
