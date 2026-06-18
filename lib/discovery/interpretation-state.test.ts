import { describe, it, expect } from "vitest";
import { reconstructInterpretation } from "./interpretation-state";
import type { CampaignPatternRow, RingHypothesisRow } from "@/lib/data/types";

const PATTERN: CampaignPatternRow = {
  id: "pat_1",
  campaign_id: "camp_1",
  customer_id: "user_1",
  created_at: "2026-06-10T12:00:00.000Z",
  product_attributes: {
    customer_summary: "Affluent recovery-obsessed men 30-55.",
    interpretation_confidence: "high",
    interpretation: {
      campaign_pattern: { exclusions_parsed: ["competitor sauna brands"] },
      primary_ring: {
        ring_label: "protocol recovery",
        analog_campaigns: ["ColdCo"],
      },
      lateral_rings: [
        { ring_label: "overlanding", analog_campaigns: ["HeatWorks"] },
      ],
    },
  },
  customer_description: "Recovery buyers.",
  aov_bucket: "high",
  scoring_weights: null,
};

function ring(overrides: Partial<RingHypothesisRow>): RingHypothesisRow {
  return {
    id: "ring_x",
    campaign_pattern_id: "pat_1",
    created_at: "2026-06-10T12:00:01.000Z",
    kind: "lateral",
    label: "a ring",
    reasoning: "because.",
    confidence: "medium",
    confidence_score: null,
    brand_confirmed: null,
    brand_decision: "pending",
    slot_position: null,
    ...overrides,
  };
}

describe("reconstructInterpretation", () => {
  it("excludes refined rings and keeps the replacement", () => {
    const rings: RingHypothesisRow[] = [
      ring({ id: "p1", kind: "primary", label: "protocol recovery", confidence: "high", created_at: "2026-06-10T12:00:01.000Z" }),
      ring({ id: "l1_old", label: "overlanding", brand_decision: "refined", created_at: "2026-06-10T12:00:02.000Z" }),
      ring({ id: "l1_new", label: "van-life & overlanding", brand_decision: "pending", created_at: "2026-06-10T12:00:03.000Z" }),
    ];

    const result = reconstructInterpretation(PATTERN, rings);
    expect(result).not.toBeNull();
    const labels = result!.interpretation.lateral_rings.map((r) => r.ring_label);
    expect(labels).toEqual(["van-life & overlanding"]);
    expect(labels).not.toContain("overlanding");
    expect(result!.interpretation.primary_ring.ring_label).toBe("protocol recovery");
  });

  it("recovers analog citations by label and exclusions from the blob", () => {
    const rings: RingHypothesisRow[] = [
      ring({ id: "p1", kind: "primary", label: "protocol recovery", confidence: "high" }),
      ring({ id: "l1", label: "overlanding", created_at: "2026-06-10T12:00:02.000Z" }),
    ];
    const result = reconstructInterpretation(PATTERN, rings)!;
    expect(result.interpretation.primary_ring.analog_campaigns).toEqual(["ColdCo"]);
    expect(result.interpretation.lateral_rings[0].analog_campaigns).toEqual(["HeatWorks"]);
    expect(result.interpretation.campaign_pattern.exclusions_parsed).toEqual([
      "competitor sauna brands",
    ]);
    expect(result.interpretation.campaign_pattern.interpretation_confidence).toBe("high");
  });

  it("maps brand_decision into the decisions map for non-refined rings", () => {
    const rings: RingHypothesisRow[] = [
      ring({ id: "p1", kind: "primary", label: "protocol recovery", brand_decision: "pending" }),
      ring({ id: "l1", label: "overlanding", brand_decision: "added_by_brand", created_at: "2026-06-10T12:00:02.000Z" }),
      ring({ id: "l2_old", label: "gone", brand_decision: "refined", created_at: "2026-06-10T12:00:03.000Z" }),
    ];
    const result = reconstructInterpretation(PATTERN, rings)!;
    expect(result.decisions).toEqual({ p1: "pending", l1: "added_by_brand" });
    expect(result.decisions).not.toHaveProperty("l2_old");
  });

  it("orders laterals by slot_position, not created_at (refinement keeps its slot)", () => {
    // The replacement for slot 1 was created LAST (12:00:05) but must stay
    // ahead of the slot-2 lateral created earlier (12:00:02). created_at order
    // would put it last; slot_position order keeps it first.
    const rings: RingHypothesisRow[] = [
      ring({ id: "p1", kind: "primary", label: "protocol recovery", confidence: "high", slot_position: 0, created_at: "2026-06-10T12:00:00.000Z" }),
      ring({ id: "l1_old", label: "overlanding", brand_decision: "refined", slot_position: 1, created_at: "2026-06-10T12:00:01.000Z" }),
      ring({ id: "l2", label: "endurance athletes", slot_position: 2, created_at: "2026-06-10T12:00:02.000Z" }),
      ring({ id: "l1_new", label: "van-life & overlanding", slot_position: 1, created_at: "2026-06-10T12:00:05.000Z" }),
    ];

    const result = reconstructInterpretation(PATTERN, rings)!;
    expect(result.interpretation.lateral_rings.map((r) => r.ring_label)).toEqual([
      "van-life & overlanding", // slot 1 (the refinement)
      "endurance athletes", // slot 2
    ]);
  });

  it("returns null when there is no non-refined primary", () => {
    const rings: RingHypothesisRow[] = [
      ring({ id: "p1", kind: "primary", label: "old primary", brand_decision: "refined" }),
      ring({ id: "l1", label: "overlanding" }),
    ];
    expect(reconstructInterpretation(PATTERN, rings)).toBeNull();
  });
});
