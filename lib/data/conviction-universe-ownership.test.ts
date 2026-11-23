import { beforeEach, describe, expect, it, vi } from "vitest";

const rows: Record<string, unknown[]> = {
  ring_hypotheses: [],
  conviction_scores: [],
};

function builder(table: string) {
  const payload = { data: rows[table] ?? [], error: null };
  const api: Record<string, unknown> = {};
  const self = () => api;
  api.select = self;
  api.eq = self;
  api.in = self;
  api.order = self;
  api.then = (
    resolve: (value: unknown) => unknown,
    reject?: (reason: unknown) => unknown
  ) => Promise.resolve(payload).then(resolve, reject);
  return api;
}

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from(table: string) {
      return builder(table);
    },
  },
}));

import {
  getConvictionScoresWithShowsForPattern,
  getConvictionUniverse,
} from "./reasoning-log";

const PATTERN = "cp-1";
const RING = "ring-1";

beforeEach(() => {
  rows.ring_hypotheses = [
    {
      id: RING,
      campaign_pattern_id: PATTERN,
      brand_decision: "confirmed",
    },
  ];
  rows.conviction_scores = [
    {
      id: "score-1",
      campaign_pattern_id: PATTERN,
      ring_hypothesis_id: RING,
      composite_score: 80,
      shows: {
        id: "show-1",
        name: "Recovery Lab",
        platform: "podcast",
        ownership_status: "verified",
        contact_email: "host@show.test",
        contact_name: "Host",
      },
    },
  ];
});

describe("brand conviction reads omit ownership_status", () => {
  it("getConvictionUniverse shows have no ownership_status", async () => {
    const universe = await getConvictionUniverse(PATTERN);
    const show = universe.groups[0]?.shows[0]?.show;
    expect(show?.name).toBe("Recovery Lab");
    expect(show?.contact.email).toBe("host@show.test");
    expect(show).not.toHaveProperty("ownership_status");
  });

  it("getConvictionScoresWithShowsForPattern shows have no ownership_status", async () => {
    const scores = await getConvictionScoresWithShowsForPattern(PATTERN);
    expect(scores[0]?.show?.name).toBe("Recovery Lab");
    expect(scores[0]?.show).not.toHaveProperty("ownership_status");
  });
});
